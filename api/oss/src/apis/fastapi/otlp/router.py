from typing import TYPE_CHECKING
from uuid import UUID

from fastapi import APIRouter, Request, status
from fastapi.responses import Response

from google.rpc.status_pb2 import Status as ProtoStatus
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceResponse,
)

from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.common import is_ee

from oss.src.apis.fastapi.otlp.models import CollectStatusResponse
from oss.src.apis.fastapi.otlp.opentelemetry.otlp import parse_otlp_stream
from oss.src.apis.fastapi.otlp.utils.processing import parse_from_otel_span_dto

if is_ee():
    from ee.src.utils.entitlements import check_entitlements, Counter
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION

if TYPE_CHECKING:
    from oss.src.core.tracing.service import TracingService


MAX_OTLP_BATCH_SIZE = env.otlp.max_batch_bytes
MAX_OTLP_BATCH_SIZE_MB = MAX_OTLP_BATCH_SIZE // (1024 * 1024)


log = get_module_logger(__name__)


class OTLPRouter:
    def __init__(
        self,
        tracing_service: "TracingService",
    ):
        self.tracing_service = tracing_service

        self.sdk_router = APIRouter()
        self.router = APIRouter()

        self.router.add_api_route(
            "/traces",
            self.otlp_status,
            methods=["GET"],
            operation_id="otlp_status",
            summary="Status check for OTLP",
            status_code=status.HTTP_200_OK,
            response_model=CollectStatusResponse,
        )

        self.router.add_api_route(
            "/traces",
            self.otlp_ingest,
            methods=["POST"],
            operation_id="otlp_ingest",
            summary="Ingest traces via OTLP",
            status_code=status.HTTP_200_OK,
            response_model=CollectStatusResponse,
        )

    @intercept_exceptions()
    async def otlp_status(self):
        """Return the OTLP endpoint liveness status.

        Lightweight readiness probe. Returns `{"status": "ready"}` when
        the router is mounted. Intended for health checks from OTel
        collectors before they start exporting traces.
        """
        return CollectStatusResponse(status="ready")

    @intercept_exceptions()
    async def otlp_ingest(
        self,
        request: Request,
    ):
        """Ingest traces via the OTLP/HTTP protobuf protocol.

        This endpoint accepts a serialized
        `ExportTraceServiceRequest` protobuf. Point any OTLP/HTTP
        collector or SDK at `POST /otlp/v1/traces` and spans will flow
        into the same ingest stream as the Agenta-native endpoints.

        Use this when you already have OTel instrumentation emitting
        OTLP. For new integrations that don't need raw OTLP, prefer
        `POST /tracing/spans/ingest` — it takes JSON, accepts Agenta's
        nested shape directly, and surfaces parse failures immediately.

        ## Content-Type and size limit

        Binary protobuf only (`Content-Type: application/x-protobuf`).
        JSON OTLP is not accepted. Requests larger than the configured
        batch limit (default 4 MB, see `OTLP_MAX_BATCH_BYTES`) return
        `413 Request Entity Too Large`.

        ## Response

        Successful ingest returns `200 OK` with a serialized
        `ExportTraceServiceResponse` protobuf. Parse failures on the
        request body return `400`; malformed spans return `500`; quota
        exhaustion returns `403`. Like the native ingest paths, spans
        are queued on a Redis stream and persisted asynchronously — see
        [Tracing — Async write
        contract](/reference/api-guide/tracing#async-write-contract-202).
        """
        # -------------------------------------------------------------------- #
        # Permission check
        # -------------------------------------------------------------------- #
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        # -------------------------------------------------------------------- #
        # Parse request into OTLP stream
        # -------------------------------------------------------------------- #
        otlp_stream = None
        try:
            otlp_stream = await request.body()
        except Exception:
            log.error(
                "Failed to process OTLP stream from project %s with error:",
                request.state.project_id,
                exc_info=True,
            )
            err_status = ProtoStatus(
                message="Invalid request body: not a valid OTLP stream."
            )
            return Response(
                content=err_status.SerializeToString(),
                media_type="application/x-protobuf",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        # -------------------------------------------------------------------- #
        # Enforce OTLP stream size limit
        # -------------------------------------------------------------------- #
        if len(otlp_stream) > MAX_OTLP_BATCH_SIZE:
            log.error(
                "OTLP batch too large (%s bytes > %s bytes) from project %s",
                len(otlp_stream),
                MAX_OTLP_BATCH_SIZE,
                request.state.project_id,
            )
            err_status = ProtoStatus(
                message=f"OTLP batch size exceeds {MAX_OTLP_BATCH_SIZE_MB}MB limit."
            )
            return Response(
                content=err_status.SerializeToString(),
                media_type="application/x-protobuf",
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            )

        # -------------------------------------------------------------------- #
        # Parse OTLP stream into OTel spans
        # -------------------------------------------------------------------- #
        otel_spans = None
        try:
            otel_spans = parse_otlp_stream(otlp_stream)
        except Exception:
            log.error(
                "Failed to parse OTLP stream from project %s with error:",
                request.state.project_id,
                exc_info=True,
            )
            log.error("OTLP stream: %s", otlp_stream)
            err_status = ProtoStatus(message="Failed to parse OTLP stream.")
            return Response(
                content=err_status.SerializeToString(),
                media_type="application/x-protobuf",
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # -------------------------------------------------------------------- #
        # Parse OTel spans into internal spans
        # -------------------------------------------------------------------- #
        spans = []
        for idx, otel_span in enumerate(otel_spans):
            try:
                span = parse_from_otel_span_dto(otel_span)
                if span is not None:
                    spans.append(span)
                else:
                    log.warning(
                        "Skipping OTEL span from project %s: parser returned None (index=%s)",
                        request.state.project_id,
                        idx,
                    )
            except Exception:
                log.warning(
                    "Skipping malformed OTEL span from project %s (index=%s)",
                    request.state.project_id,
                    idx,
                    exc_info=True,
                )

        if otel_spans and not spans:
            err_status = ProtoStatus(message="Failed to parse OTEL span.")
            return Response(
                content=err_status.SerializeToString(),
                media_type="application/x-protobuf",
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # -------------------------------------------------------------------- #
        # Layer 1 Soft Check: Validate quota using cached meter
        # -------------------------------------------------------------------- #
        if is_ee() and spans:
            try:
                delta = sum(1 for span in spans if span.parent_id is None)

                if delta > 0:
                    allowed, _, _ = await check_entitlements(
                        organization_id=UUID(request.state.organization_id),
                        key=Counter.TRACES,
                        delta=delta,
                        use_cache=True,
                    )

                    if not allowed:
                        log.warning(
                            "[OTLP] Soft meter check failed - quota exceeded",
                            org_id=str(request.state.organization_id),
                            delta=delta,
                        )
                        err_status = ProtoStatus(
                            message="You have reached your monthly quota limit. Please upgrade your plan to continue."
                        )
                        return Response(
                            content=err_status.SerializeToString(),
                            media_type="application/x-protobuf",
                            status_code=status.HTTP_403_FORBIDDEN,
                        )

            except Exception as e:
                log.warning(
                    f"[OTLP] Soft meter check failed with exception: {e}",
                    org_id=str(request.state.organization_id),
                    exc_info=True,
                )

        # -------------------------------------------------------------------- #
        # Preprocess and publish spans to Redis Streams for async processing
        # Layer 2 Hard Check and database storage deferred to worker
        # -------------------------------------------------------------------- #
        if spans:
            try:
                await self.tracing_service.ingest_span_dtos(
                    organization_id=UUID(request.state.organization_id),
                    project_id=UUID(request.state.project_id),
                    user_id=UUID(request.state.user_id),
                    span_dtos=spans,
                )
            except Exception as e:
                log.error(
                    f"[OTLP] Failed to preprocess and queue spans: {e}",
                    exc_info=True,
                )
                err_status = ProtoStatus(
                    message="Failed to queue spans for processing."
                )
                return Response(
                    content=err_status.SerializeToString(),
                    media_type="application/x-protobuf",
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

        # -------------------------------------------------------------------- #
        # According to the OTLP/HTTP spec a full-success response must be an
        # HTTP 200 with a serialized ExportTraceServiceResponse protobuf and
        # the same Content-Type that the client used.
        # We only support binary protobuf at the moment.
        # -------------------------------------------------------------------- #
        export_response = ExportTraceServiceResponse()
        return Response(
            content=export_response.SerializeToString(),
            media_type="application/x-protobuf",
            status_code=status.HTTP_200_OK,
        )
