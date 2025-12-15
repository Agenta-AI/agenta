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
from oss.src.core.tracing.utils import calculate_and_propagate_metrics

if is_ee():
    from ee.src.utils.entitlements import check_entitlements, Counter

# TYPE_CHECKING to avoid circular import at runtime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from oss.src.tasks.asyncio.tracing.worker import TracingWorker


MAX_OTLP_BATCH_SIZE = env.AGENTA_OTLP_MAX_BATCH_BYTES
MAX_OTLP_BATCH_SIZE_MB = MAX_OTLP_BATCH_SIZE // (1024 * 1024)


log = get_module_logger(__name__)


class OTLPRouter:
    def __init__(
        self,
        tracing_worker: "TracingWorker",
    ):
        self.worker = tracing_worker

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
        return CollectStatusResponse(status="ready")

    @intercept_exceptions()
    async def otlp_ingest(
        self,
        request: Request,
    ):
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
        spans = None
        try:
            spans = [parse_from_otel_span_dto(s) for s in otel_spans]
            spans = [s for s in spans if s is not None]
        except Exception:
            log.error(
                "Failed to parse spans from project %s with error:",
                request.state.project_id,
                exc_info=True,
            )
            for otel_span in otel_spans:
                log.error(
                    "Span: [%s] %s",
                    UUID(otel_span.context.trace_id[2:]),
                    otel_span,
                )
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
        # Calculate and propagate costs/tokens BEFORE batching
        # This ensures complete trace trees for proper metric propagation
        # -------------------------------------------------------------------- #
        if spans:
            try:
                spans = calculate_and_propagate_metrics(spans)
            except Exception as e:
                log.error(
                    f"[OTLP] Failed to calculate metrics: {e}",
                    exc_info=True,
                )
                # Continue without metrics rather than failing the entire request

        # -------------------------------------------------------------------- #
        # Write spans to Redis Streams for async processing
        # Layer 2 Hard Check and database storage deferred to worker
        # -------------------------------------------------------------------- #
        if spans:
            try:
                await self.worker.publish_to_stream(
                    organization_id=UUID(request.state.organization_id),
                    project_id=UUID(request.state.project_id),
                    user_id=UUID(request.state.user_id),
                    span_dtos=spans,
                )
            except Exception as e:
                log.error(
                    f"[OTLP] Failed to write spans to Redis Stream: {e}",
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
