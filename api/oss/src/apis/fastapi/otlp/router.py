from uuid import UUID

from fastapi import APIRouter, Request, status
from fastapi.responses import Response

from google.rpc.status_pb2 import Status as ProtoStatus
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceResponse,
)

from oss.src.utils.env import env
from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions

from oss.src.apis.fastapi.otlp.models import CollectStatusResponse
from oss.src.apis.fastapi.otlp.opentelemetry.otlp import parse_otlp_stream
from oss.src.apis.fastapi.otlp.utils.processing import parse_from_otel_span_dto

from oss.src.core.tracing.service import TracingService

if is_ee():
    from ee.src.utils.entitlements import check_entitlements, Counter


MAX_OTLP_BATCH_SIZE = env.AGENTA_OTLP_MAX_BATCH_BYTES
MAX_OTLP_BATCH_SIZE_MB = MAX_OTLP_BATCH_SIZE // (1024 * 1024)


log = get_module_logger(__name__)


class OTLPRouter:
    def __init__(
        self,
        tracing_service: TracingService,
    ):
        self.tracing = tracing_service

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
        # Update meter with internal traces count (EE only)
        # -------------------------------------------------------------------- #
        if is_ee() and check_entitlements and Counter:  # type: ignore
            delta = sum([1 for s in spans if s and s.parent_id is None])
            check, _, _ = await check_entitlements(
                organization_id=request.state.organization_id,
                key=Counter.TRACES,
                delta=delta,
            )
            if not check:
                err_status = ProtoStatus(
                    message="You have reached your quota limit. "
                    "Please upgrade your plan to continue."
                )
                return Response(
                    content=err_status.SerializeToString(),
                    media_type="application/x-protobuf",
                    status_code=status.HTTP_403_FORBIDDEN,
                )

        # -------------------------------------------------------------------- #
        # Store internal spans
        # -------------------------------------------------------------------- #
        try:
            await self.tracing.create(
                project_id=UUID(request.state.project_id),
                user_id=UUID(request.state.user_id),
                span_dtos=spans,
            )
        except Exception:
            log.warn(
                "Failed to create spans from project %s with error:",
                request.state.project_id,
                exc_info=True,
            )
            for span in spans:
                log.warn(
                    "Span: [%s] %s",
                    span.trace_id,
                    span,
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
