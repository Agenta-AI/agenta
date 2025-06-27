from typing import Union, Optional
from uuid import UUID

from fastapi import APIRouter, Request, Depends, status, HTTPException

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions, suppress_exceptions
from oss.src.utils.caching import get_cache, set_cache, invalidate_cache

from oss.src.apis.fastapi.tracing.utils import (
    merge_queries,
    parse_query_request,
    parse_body_request,
    parse_trace_id_to_uuid,
    parse_spans_from_request,
    parse_spans_into_response,
)
from oss.src.apis.fastapi.tracing.models import (
    OTelLinksResponse,
    OTelTracingRequest,
    OTelTracingResponse,
)
from oss.src.core.tracing.service import TracingService
from oss.src.core.tracing.utils import FilteringException
from oss.src.core.tracing.dtos import (
    OTelLinks,
    OTelSpan,
    OTelFlatSpans,
    OTelTraceTree,
    OTelSpansTree,
    Query,
    Focus,
    Format,
)

log = get_module_logger(__name__)


class TracingRouter:
    VERSION = "1.0.0"

    def __init__(
        self,
        tracing_service: TracingService,
    ):
        self.service = tracing_service

        self.router = APIRouter()

        ### CRUD ON TRACES

        self.router.add_api_route(
            "/traces/",
            self.add_trace,
            methods=["POST"],
            operation_id="add_trace",
            status_code=status.HTTP_202_ACCEPTED,
            response_model=OTelLinksResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/traces/{trace_id}",
            self.fetch_trace,
            methods=["GET"],
            operation_id="fetch_trace",
            status_code=status.HTTP_200_OK,
            response_model=OTelTracingResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/traces/",
            self.edit_trace,
            methods=["PUT"],
            operation_id="edit_trace",
            status_code=status.HTTP_202_ACCEPTED,
            response_model=OTelLinksResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/traces/{trace_id}",
            self.remove_trace,
            methods=["DELETE"],
            operation_id="remove_trace",
            status_code=status.HTTP_202_ACCEPTED,
            response_model=OTelLinksResponse,
            response_model_exclude_none=True,
        )

        ### RPC ON SPANS

        self.router.add_api_route(
            "/spans/",
            self.ingest_spans,
            methods=["POST"],
            operation_id="ingest_spans",
            status_code=status.HTTP_202_ACCEPTED,
            response_model=OTelLinksResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/spans/ingest",
            self.ingest_spans,
            methods=["POST"],
            operation_id="ingest_spans_rpc",
            status_code=status.HTTP_202_ACCEPTED,
            response_model=OTelLinksResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/spans/",
            self.query_spans,
            methods=["GET"],
            operation_id="query_spans",
            status_code=status.HTTP_200_OK,
            response_model=OTelTracingResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/spans/query",
            self.query_spans,
            methods=["POST"],
            operation_id="query_spans_rpc",
            status_code=status.HTTP_200_OK,
            response_model=OTelTracingResponse,
            response_model_exclude_none=True,
        )

    ### HELPERS

    async def _upsert(
        self,
        project_id: UUID,
        spans: Optional[OTelFlatSpans] = None,
        traces: Optional[OTelTraceTree] = None,
        strict: Optional[bool] = False,
        user_id: Optional[UUID] = None,
    ) -> OTelLinks:
        _spans = {}

        if spans:
            _spans = {"spans": [OTelSpan(**span.model_dump()) for span in spans]}

        elif traces:
            for spans in traces.values():
                spans: OTelSpansTree

                for span in spans.spans.values():
                    _spans[span.span_id] = OTelSpan(**span.model_dump())

        span_dtos = parse_spans_from_request(_spans)

        if strict:
            links = (
                await self.service.create(
                    project_id=project_id,
                    span_dtos=span_dtos,
                    user_id=user_id,
                )
                or []
            )
        else:
            links = (
                await self.service.update(
                    project_id=project_id,
                    span_dtos=span_dtos,
                    user_id=user_id,
                )
                or []
            )

        return links

    ### CRUD ON TRACES

    @intercept_exceptions()
    async def add_trace(  # CREATE
        self,
        request: Request,
        trace_request: OTelTracingRequest,
    ) -> OTelLinksResponse:
        spans = None

        if trace_request.traces:
            if len(trace_request.traces) == 0:
                return HTTPException(
                    status_code=400,
                    detail="Missing trace.",
                )

            if len(trace_request.traces) > 1:
                return HTTPException(
                    status_code=400,
                    detail="Too many traces.",
                )

            spans = list(trace_request.traces.values())[0].spans

        elif trace_request.spans:
            spans = {span.span_id: span for span in trace_request.spans}

        else:
            return HTTPException(
                status_code=400,
                detail="Missing spans.",
            )

        if len(spans) == 0:
            return HTTPException(
                status_code=400,
                detail="Missing spans.",
            )

        root_spans = 0

        for span in spans.values():
            if span.parent_id is None:
                root_spans += 1

        if root_spans == 0:
            return HTTPException(
                status_code=400,
                detail="Missing root span.",
            )

        if root_spans > 1:
            return HTTPException(
                status_code=400,
                detail="Too many root spans.",
            )

        links = await self._upsert(
            project_id=UUID(request.state.project_id),
            spans=trace_request.spans,
            traces=trace_request.traces,
            strict=True,
            user_id=UUID(request.state.user_id),
        )

        link_response = OTelLinksResponse(
            version=self.VERSION,
            links=links,
            count=len(links),
        )

        return link_response

    @intercept_exceptions()
    @suppress_exceptions(default=OTelTracingResponse())
    async def fetch_trace(  # READ
        self,
        request: Request,
        trace_id: Union[str, int],
    ) -> OTelTracingResponse:
        try:
            trace_id = parse_trace_id_to_uuid(trace_id)

        except Exception as e:
            raise HTTPException(status_code=400, detail="Invalid trace_id.") from e

        spans = await self.service.read(
            project_id=UUID(request.state.project_id),
            trace_id=trace_id,
        )

        trace_response = OTelTracingResponse(
            version=self.VERSION,
            count=0,
        )

        if spans is not None:
            traces = parse_spans_into_response(
                spans,
                focus=Focus.TRACE,
                format=Format.AGENTA,
            )

            trace_response = OTelTracingResponse(
                version=self.VERSION,
                traces=traces,
                count=len(traces.values()),
            )

        return trace_response

    @intercept_exceptions()
    async def edit_trace(  # UPDATE
        self,
        request: Request,
        trace_request: OTelTracingRequest,
    ) -> OTelLinksResponse:
        spans = None

        if trace_request.traces:
            if len(trace_request.traces) == 0:
                return HTTPException(
                    status_code=400,
                    detail="Missing trace.",
                )

            if len(trace_request.traces) > 1:
                return HTTPException(
                    status_code=400,
                    detail="Too many traces.",
                )

            spans = list(trace_request.traces.values())[0].spans

        elif trace_request.spans:
            spans = {span.span_id: span for span in trace_request.spans}

        else:
            return HTTPException(
                status_code=400,
                detail="Missing spans.",
            )

        if len(spans) == 0:
            return HTTPException(
                status_code=400,
                detail="Missing spans.",
            )

        root_spans = 0

        for span in spans.values():
            if span.parent_id is None:
                root_spans += 1

        if root_spans == 0:
            return HTTPException(
                status_code=400,
                detail="Missing root span.",
            )

        if root_spans > 1:
            return HTTPException(
                status_code=400,
                detail="Too many root spans.",
            )

        links = await self._upsert(
            project_id=UUID(request.state.project_id),
            spans=trace_request.spans,
            traces=trace_request.traces,
            strict=False,
            user_id=UUID(request.state.user_id),
        )

        link_response = OTelLinksResponse(
            version=self.VERSION,
            links=links,
            count=len(links),
        )

        return link_response

    @intercept_exceptions()
    async def remove_trace(  # DELETE
        self,
        request: Request,
        trace_id: Union[str, int],
    ) -> OTelLinksResponse:
        try:
            trace_id = parse_trace_id_to_uuid(trace_id)

        except Exception as e:
            raise HTTPException(status_code=400, detail="Invalid trace_id.") from e

        links = await self.service.delete(
            project_id=UUID(request.state.project_id),
            trace_id=trace_id,
            user_id=UUID(request.state.user_id),
        )

        link_response = OTelLinksResponse(
            version=self.VERSION,
            links=links,
            count=len(links) if links else 0,
        )

        return link_response

    ### RPC ON SPANS

    @intercept_exceptions()
    async def ingest_spans(  # MUTATION
        self,
        request: Request,
        spans_request: OTelTracingRequest,
    ) -> OTelLinksResponse:
        links = await self._upsert(
            project_id=UUID(request.state.project_id),
            spans=spans_request.spans,
            traces=spans_request.traces,
            strict=True,
            user_id=UUID(request.state.user_id),
        )

        link_response = OTelLinksResponse(
            version=self.VERSION,
            links=links,
            count=len(links),
        )

        return link_response

    @intercept_exceptions()
    @suppress_exceptions(default=OTelTracingResponse())
    async def query_spans(  # QUERY
        self,
        request: Request,
        query: Optional[Query] = Depends(parse_query_request),
    ) -> OTelTracingResponse:
        body_json = None
        query_from_body = None

        try:
            body_json = await request.json()

            if body_json:
                query_from_body = parse_body_request(**body_json)

        except:  # pylint: disable=bare-except
            pass

        merged_query = merge_queries(query, query_from_body)

        try:
            span_dtos = await self.service.query(
                project_id=UUID(request.state.project_id),
                query=merged_query,
            )
        except FilteringException as e:
            raise HTTPException(
                status_code=400,
                detail=str(e),
            ) from e

        oldest = None
        newest = None

        for span in span_dtos:
            if oldest is None or span.start_time < oldest:
                oldest = span.start_time

            if newest is None or span.start_time > newest:
                newest = span.start_time

        _spans_or_traces = parse_spans_into_response(
            span_dtos,
            focus=query.formatting.focus,
            format=query.formatting.format,
        )

        spans: OTelFlatSpans = None
        traces: OTelTraceTree = None

        if isinstance(_spans_or_traces, list):
            spans = _spans_or_traces
            traces = None
            count = len(_spans_or_traces)
        elif isinstance(_spans_or_traces, dict):
            spans = None
            traces = _spans_or_traces
            count = len(_spans_or_traces.values())
        else:
            spans = None
            traces = None
            count = 0

        spans_response = OTelTracingResponse(
            version=self.VERSION,
            spans=spans,
            traces=traces,
            count=count,
            oldest=oldest,
            newest=newest,
        )

        return spans_response
