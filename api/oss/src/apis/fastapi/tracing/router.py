from typing import Optional, List, Tuple, Dict, Union
from uuid import UUID

from fastapi import APIRouter, Request, Depends, status, HTTPException

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions, suppress_exceptions
from oss.src.utils.caching import get_cache, set_cache, invalidate_cache

from oss.src.apis.fastapi.tracing.utils import (
    merge_queries,
    parse_query_from_params_request,
    parse_query_from_body_request,
    parse_trace_id_to_uuid,
    parse_spans_from_request,
    parse_spans_into_response,
    parse_analytics_from_params_request,
    parse_analytics_from_body_request,
    merge_analytics,
)
from oss.src.apis.fastapi.tracing.models import (
    OTelLinksResponse,
    OTelTracingRequest,
    OTelTracingResponse,
    OldAnalyticsResponse,
    AnalyticsResponse,
)
from oss.src.core.tracing.service import TracingService
from oss.src.core.tracing.utils import FilteringException

# TYPE_CHECKING to avoid circular import at runtime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from oss.src.tasks.asyncio.tracing.worker import TracingWorker
from oss.src.core.tracing.dtos import (
    OTelLink,
    OTelLinks,
    OTelSpan,
    OTelFlatSpans,
    OTelFlatSpan,
    OTelTraceTree,
    TracingQuery,
    Focus,
    Format,
    MetricType,
    MetricSpec,
)

log = get_module_logger(__name__)

if is_ee():
    from ee.src.utils.entitlements import check_entitlements, Counter


class TracingRouter:
    def __init__(
        self,
        tracing_service: TracingService,
        tracing_worker: "TracingWorker",
    ):
        self.service = tracing_service
        self.worker = tracing_worker

        self.router = APIRouter()

        ### CRUD ON TRACES

        self.router.add_api_route(
            "/traces/",
            self.create_trace,
            methods=["POST"],
            operation_id="create_trace",
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
            "/traces/{trace_id}",
            self.edit_trace,
            methods=["PUT"],
            operation_id="edit_trace",
            status_code=status.HTTP_202_ACCEPTED,
            response_model=OTelLinksResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/traces/{trace_id}",
            self.delete_trace,
            methods=["DELETE"],
            operation_id="delete_trace",
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
            "/spans/query",
            self.query_spans,
            methods=["POST"],
            operation_id="query_spans_rpc",
            status_code=status.HTTP_200_OK,
            response_model=OTelTracingResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/spans/analytics",
            self.fetch_legacy_analytics,
            methods=["POST"],
            operation_id="fetch_analytics",
            status_code=status.HTTP_200_OK,
            response_model=OldAnalyticsResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/analytics/query",
            self.fetch_analytics,
            methods=["POST"],
            operation_id="fetch_new_analytics",
            status_code=status.HTTP_200_OK,
            response_model=AnalyticsResponse,
            response_model_exclude_none=True,
        )

    ### HELPERS

    async def _upsert(
        self,
        project_id: UUID,
        user_id: UUID,
        organization_id: UUID,
        #
        spans: Optional[OTelFlatSpans] = None,
        traces: Optional[OTelTraceTree] = None,
        sync: bool = False,
    ) -> OTelLinks:
        _spans: Dict[str, Union[OTelSpan, OTelFlatSpans]] = dict()

        if spans:
            _spans = {
                "spans": [
                    OTelFlatSpan(
                        **span.model_dump(
                            mode="json",
                            exclude_none=True,
                            exclude_unset=True,
                        )
                    )
                    for span in spans
                ]
            }
        elif traces:
            for spans_tree in traces.values():
                if spans_tree.spans:
                    for span in spans_tree.spans.values():
                        if not isinstance(span, list):
                            _spans[span.span_id] = OTelSpan(
                                **span.model_dump(
                                    mode="json",
                                    exclude_none=True,
                                    exclude_unset=True,
                                )
                            )

        span_dtos = parse_spans_from_request(_spans)

        if sync:
            # Synchronous path for low-volume, user-facing operations
            # (annotations, invocations) - check entitlements inline and write directly
            if is_ee():
                # Count root spans (traces) for entitlements check
                delta = sum(1 for span_dto in span_dtos if span_dto.parent_id is None)
                if delta > 0:
                    allowed, _, _ = await check_entitlements(  # type: ignore
                        organization_id=organization_id,
                        key=Counter.TRACES,  # type: ignore
                        delta=delta,
                        use_cache=False,  # Authoritative DB check
                    )
                    if not allowed:
                        raise HTTPException(
                            status_code=429,
                            detail="Trace quota exceeded for organization",
                        )

            # Write directly to database (synchronous)
            await self.service.create(
                project_id=project_id,
                user_id=user_id,
                span_dtos=span_dtos,
            )
        else:
            # Async path for high-volume operations (observability, evaluations)
            # Publish to Redis Streams for async processing with entitlements check
            await self.worker.publish_to_stream(
                organization_id=organization_id,
                project_id=project_id,
                user_id=user_id,
                span_dtos=span_dtos,
            )

        # Generate links from span_dtos to return to client
        links = [
            OTelLink(
                trace_id=str(span_dto.trace_id),
                span_id=str(span_dto.span_id),
            )
            for span_dto in span_dtos
        ]

        return links

    ### CRUD ON TRACES

    @intercept_exceptions()
    async def create_trace(  # CREATE
        self,
        request: Request,
        trace_request: OTelTracingRequest,
        sync: bool = False,
    ) -> OTelLinksResponse:
        spans = None

        if trace_request.traces:
            if len(trace_request.traces) == 0:
                raise HTTPException(
                    status_code=400,
                    detail="Missing trace",
                )

            if len(trace_request.traces) > 1:
                raise HTTPException(
                    status_code=400,
                    detail="Too many traces",
                )

            spans = list(trace_request.traces.values())[0].spans

        elif trace_request.spans:
            spans = {span.span_id: span for span in trace_request.spans}

        else:
            raise HTTPException(
                status_code=400,
                detail="Missing spans",
            )

        if not spans:
            raise HTTPException(
                status_code=400,
                detail="Missing spans",
            )

        root_spans = 0

        for span in spans.values():
            if not isinstance(span, list) and span.parent_id is None:
                root_spans += 1

        if root_spans == 0:
            raise HTTPException(
                status_code=400,
                detail="Missing root span",
            )

        if root_spans > 1:
            raise HTTPException(
                status_code=400,
                detail="Too many root spans",
            )

        links = await self._upsert(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            organization_id=UUID(request.state.organization_id),
            #
            spans=trace_request.spans,
            traces=trace_request.traces,
            sync=sync,
        )

        link_response = OTelLinksResponse(
            count=len(links),
            links=links,
        )

        return link_response

    @intercept_exceptions()
    @suppress_exceptions(default=OTelTracingResponse())
    async def fetch_trace(  # READ
        self,
        request: Request,
        trace_id: str,
    ) -> OTelTracingResponse:
        try:
            trace_id = parse_trace_id_to_uuid(trace_id)

        except Exception as e:
            raise HTTPException(status_code=400, detail="Invalid trace_id.") from e

        spans = await self.service.read(
            project_id=UUID(request.state.project_id),
            #
            trace_id=UUID(trace_id),
        )

        trace_response = OTelTracingResponse()

        if spans is not None:
            traces = parse_spans_into_response(
                spans,
                focus=Focus.TRACE,
                format=Format.AGENTA,
            )

            if not traces or isinstance(traces, list):
                return OTelTracingResponse()

            trace_response = OTelTracingResponse(
                count=len(traces.keys()),
                traces=traces,
            )

        return trace_response

    @intercept_exceptions()
    async def edit_trace(  # UPDATE
        self,
        request: Request,
        #
        trace_request: OTelTracingRequest,
        #
        trace_id: str,
        sync: bool = False,
    ) -> OTelLinksResponse:
        spans = None

        if trace_request.traces:
            if len(trace_request.traces) == 0:
                raise HTTPException(
                    status_code=400,
                    detail="Missing trace",
                )

            if len(trace_request.traces) > 1:
                raise HTTPException(
                    status_code=400,
                    detail="Too many traces",
                )

            spans = list(trace_request.traces.values())[0].spans

        elif trace_request.spans:
            spans = {span.span_id: span for span in trace_request.spans}

        else:
            raise HTTPException(
                status_code=400,
                detail="Missing spans",
            )

        if not spans:
            raise HTTPException(
                status_code=400,
                detail="Missing spans",
            )

        root_spans = 0

        for span in spans.values():
            if not isinstance(span, list) and span.parent_id is None:
                root_spans += 1

        if root_spans == 0:
            raise HTTPException(
                status_code=400,
                detail="Missing root span",
            )

        if root_spans > 1:
            raise HTTPException(
                status_code=400,
                detail="Too many root spans",
            )

        links = await self._upsert(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            organization_id=UUID(request.state.organization_id),
            #
            spans=trace_request.spans,
            traces=trace_request.traces,
            sync=sync,
        )

        link_response = OTelLinksResponse(
            count=len(links),
            links=links,
        )

        return link_response

    @intercept_exceptions()
    async def delete_trace(  # DELETE
        self,
        request: Request,
        trace_id: str,
    ) -> OTelLinksResponse:
        try:
            trace_id = parse_trace_id_to_uuid(trace_id)

        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail="Invalid trace_id",
            ) from e

        links = await self.service.delete(
            project_id=UUID(request.state.project_id),
            #
            trace_id=UUID(trace_id),
        )

        link_response = OTelLinksResponse(
            count=len(links),
            links=links,
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
            user_id=UUID(request.state.user_id),
            organization_id=UUID(request.state.organization_id),
            #
            spans=spans_request.spans,
            traces=spans_request.traces,
        )

        link_response = OTelLinksResponse(
            count=len(links),
            links=links,
        )

        return link_response

    @intercept_exceptions()
    @suppress_exceptions(default=OTelTracingResponse())
    async def query_spans(  # QUERY
        self,
        request: Request,
        query: Optional[TracingQuery] = Depends(parse_query_from_params_request),
    ) -> OTelTracingResponse:
        body_json = None
        query_from_body = None

        try:
            body_json = await request.json()

            if body_json:
                query_from_body = parse_query_from_body_request(**body_json)

        except:
            pass

        merged_query = merge_queries(query, query_from_body)

        try:
            span_dtos = await self.service.query(
                project_id=UUID(request.state.project_id),
                #
                query=merged_query,
            )
        except FilteringException as e:
            raise HTTPException(
                status_code=400,
                detail=str(e),
            ) from e

        spans_or_traces = parse_spans_into_response(
            span_dtos,
            focus=(merged_query.formatting.focus if merged_query.formatting else None)
            or Focus.TRACE,
            format=(merged_query.formatting.format if merged_query.formatting else None)
            or Format.AGENTA,
        )

        spans: Optional[OTelFlatSpans] = None
        traces: Optional[OTelTraceTree] = None

        if isinstance(spans_or_traces, list):
            count = len(spans_or_traces)
            spans = spans_or_traces
            traces = None
        elif isinstance(spans_or_traces, dict):
            count = len(spans_or_traces.values())
            spans = None
            traces = spans_or_traces
        else:
            count = 0
            spans = None
            traces = None

        spans_response = OTelTracingResponse(
            count=count,
            spans=spans,
            traces=traces,
        )

        return spans_response

    @intercept_exceptions()
    @suppress_exceptions(default=OldAnalyticsResponse())
    async def fetch_legacy_analytics(
        self,
        request: Request,
        query: Optional[TracingQuery] = Depends(parse_query_from_params_request),
    ) -> OldAnalyticsResponse:
        body_json = None
        query_from_body = None

        try:
            body_json = await request.json()

            if body_json:
                query_from_body = parse_query_from_body_request(
                    **body_json,
                )

        except:  # pylint: disable=bare-except
            pass

        merged_query = merge_queries(
            query,
            query_from_body,
        )

        # DEBUGGING
        # log.trace(merged_query.model_dump(mode="json", exclude_none=True))
        # ---------

        buckets = await self.service.legacy_analytics(
            project_id=UUID(request.state.project_id),
            query=merged_query,
        )

        # DEBUGGING
        # log.trace([b.model_dump(mode="json", exclude_none=True) for b in buckets])
        # ---------

        return OldAnalyticsResponse(
            count=len(buckets),
            buckets=buckets,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=AnalyticsResponse())
    async def fetch_analytics(
        self,
        request: Request,
        analytics: Tuple[Optional[TracingQuery], Optional[List[MetricSpec]]] = Depends(
            parse_analytics_from_params_request
        ),
    ) -> AnalyticsResponse:
        body_json = None
        analytics_from_body = (None, None)

        try:
            body_json = await request.json()

            if body_json:
                analytics_from_body = parse_analytics_from_body_request(
                    **body_json,
                )

        except:  # pylint: disable=bare-except
            pass

        (
            query,
            specs,
        ) = merge_analytics(
            analytics,
            analytics_from_body,
        )

        if not specs:
            specs = [
                MetricSpec(
                    type=MetricType.NUMERIC_CONTINUOUS,
                    path="attributes.ag.metrics.duration.cumulative",
                ),
                MetricSpec(
                    type=MetricType.NUMERIC_CONTINUOUS,
                    path="attributes.ag.metrics.errors.cumulative",
                ),
                MetricSpec(
                    type=MetricType.NUMERIC_CONTINUOUS,
                    path="attributes.ag.metrics.costs.cumulative.total",
                ),
                MetricSpec(
                    type=MetricType.NUMERIC_CONTINUOUS,
                    path="attributes.ag.metrics.tokens.cumulative.total",
                ),
                MetricSpec(
                    type=MetricType.CATEGORICAL_SINGLE,
                    path="attributes.ag.type.trace",
                ),
                MetricSpec(
                    type=MetricType.CATEGORICAL_SINGLE,
                    path="attributes.ag.type.span",
                ),
            ]

        buckets = await self.service.analytics(
            project_id=UUID(request.state.project_id),
            query=query,
            specs=specs,
        )

        return AnalyticsResponse(
            count=len(buckets),
            buckets=buckets,
            query=query,
            specs=specs,
        )
