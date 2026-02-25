from typing import Optional, List, Tuple, Dict, Union
from uuid import UUID
from datetime import datetime

from fastapi import APIRouter, Query, Request, Depends, status, HTTPException, Body

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions, suppress_exceptions

from oss.src.core.tracing.dtos import ListOperator, ComparisonOperator, Condition

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
    LinkResponse,
    LinksResponse,
    TraceIdResponse,
    TraceIdsResponse,
    OTelTracingRequest,
    TraceRequest,
    TracesRequest,
    SpanRequest,
    SpansRequest,
    OTelTracingResponse,
    TraceResponse,
    TracesResponse,
    SpanResponse,
    SpansResponse,
    TracesQueryRequest,
    SpansQueryRequest,
    OldAnalyticsResponse,
    AnalyticsResponse,
    SessionsQueryRequest,
    SessionIdsResponse,
    UsersQueryRequest,
    UserIdsResponse,
)
from oss.src.core.tracing.service import TracingService
from oss.src.core.tracing.utils import (
    FilteringException,
    calculate_and_propagate_metrics,
)

# TYPE_CHECKING to avoid circular import at runtime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from oss.src.tasks.asyncio.tracing.worker import TracingWorker
    from oss.src.core.queries.service import QueriesService
from oss.src.core.tracing.dtos import (
    OTelLink,
    OTelLinks,
    OTelSpan,
    OTelSpansTree,
    OTelFlatSpans,
    OTelFlatSpan,
    Span,
    OTelTraceTree,
    TracingQuery,
    Formatting,
    Filtering,
    Focus,
    Format,
    LogicalOperator,
    MetricType,
    MetricSpec,
)
from oss.src.core.shared.dtos import Windowing, Trace, Link

log = get_module_logger(__name__)

if is_ee():
    from ee.src.utils.entitlements import check_entitlements, Counter
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION


class TracingRouter:
    def __init__(
        self,
        tracing_service: TracingService,
        tracing_worker: "TracingWorker",
    ):
        self.service = tracing_service
        self.worker = tracing_worker

        self.router = APIRouter()

        ### SPANS

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
            operation_id="fetch_legacy_analytics",
            status_code=status.HTTP_200_OK,
            response_model=OldAnalyticsResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/analytics/query",
            self.fetch_analytics,
            methods=["POST"],
            operation_id="fetch_analytics",
            status_code=status.HTTP_200_OK,
            response_model=AnalyticsResponse,
            response_model_exclude_none=True,
        )

        ### TRACES

        self.router.add_api_route(
            "/traces/",
            self.create_trace,
            methods=["POST"],
            operation_id="create_trace_tracing",
            status_code=status.HTTP_202_ACCEPTED,
            response_model=OTelLinksResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/traces/{trace_id}",
            self.fetch_trace,
            methods=["GET"],
            operation_id="fetch_trace_tracing",
            status_code=status.HTTP_200_OK,
            response_model=OTelTracingResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/traces/{trace_id}",
            self.edit_trace,
            methods=["PUT"],
            operation_id="edit_trace_tracing",
            status_code=status.HTTP_202_ACCEPTED,
            response_model=OTelLinksResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/traces/{trace_id}",
            self.delete_trace,
            methods=["DELETE"],
            operation_id="delete_trace_tracing",
            status_code=status.HTTP_202_ACCEPTED,
            response_model=OTelLinksResponse,
            response_model_exclude_none=True,
        )

        ## SESSIONS & USERS

        self.router.add_api_route(
            "/sessions/query",
            self.list_sessions,
            methods=["POST"],
            operation_id="list_sessions",
            status_code=status.HTTP_200_OK,
            response_model=SessionIdsResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/users/query",
            self.list_users,
            methods=["POST"],
            operation_id="list_users",
            status_code=status.HTTP_200_OK,
            response_model=UserIdsResponse,
            response_model_exclude_none=True,
        )

    ## SPANS

    @intercept_exceptions()
    async def ingest_spans(  # MUTATION
        self,
        request: Request,
        spans_request: OTelTracingRequest,
    ) -> OTelLinksResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

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
    @suppress_exceptions(default=OTelTracingResponse(), exclude=[HTTPException])
    async def query_spans(  # QUERY
        self,
        request: Request,
        query: Optional[TracingQuery] = Depends(parse_query_from_params_request),
    ) -> OTelTracingResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        body_json = None
        query_from_body = None

        try:
            body_json = await request.json()

            if body_json:
                query_from_body = parse_query_from_body_request(**body_json)

        except Exception:
            pass

        merged_query = merge_queries(query, query_from_body)

        # Optimize: detect simple trace_id queries and use fetch() instead
        trace_ids = self._extract_trace_ids_from_query(merged_query)

        if trace_ids is not None:
            span_dtos = await self.service.fetch(
                project_id=UUID(request.state.project_id),
                trace_ids=trace_ids,
            )
        else:
            try:
                span_dtos = await self.service.query(
                    project_id=UUID(request.state.project_id),
                    #
                    query=merged_query,
                )
            except FilteringException as e:
                log.error(
                    "Error in filtering conditions while querying spans",
                    exc_info=True,
                )
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

    def _extract_trace_ids_from_query(
        self, query: TracingQuery
    ) -> Optional[List[UUID]]:
        """
        Detect if query is a simple trace_id filter and extract trace IDs.
        Returns trace_ids if query can be optimized to use fetch(), else None.
        """
        if not query.filtering or not query.filtering.conditions:
            return None

        if len(query.filtering.conditions) != 1:
            return None

        condition = query.filtering.conditions[0]

        if not isinstance(condition, Condition):
            return None

        if condition.field != "trace_id":
            return None

        if condition.operator not in [ComparisonOperator.IS, ListOperator.IN]:
            return None

        # Extract trace IDs from value
        try:
            if isinstance(condition.value, list):
                # IN operator with list of trace_ids
                return [UUID(str(tid)) for tid in condition.value]
            else:
                # IS operator with single trace_id
                return [UUID(str(condition.value))]
        except (ValueError, TypeError):
            # Invalid UUID format
            return None

    @intercept_exceptions()
    @suppress_exceptions(default=AnalyticsResponse(), exclude=[HTTPException])
    async def fetch_analytics(
        self,
        request: Request,
        analytics: Tuple[Optional[TracingQuery], Optional[List[MetricSpec]]] = Depends(
            parse_analytics_from_params_request
        ),
    ) -> AnalyticsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        body_json = None
        analytics_from_body = (None, None)

        try:
            body_json = await request.json()

            if body_json:
                analytics_from_body = parse_analytics_from_body_request(
                    **body_json,
                )

        except Exception:  # pylint: disable=bare-except
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

    @intercept_exceptions()
    @suppress_exceptions(default=OldAnalyticsResponse(), exclude=[HTTPException])
    async def fetch_legacy_analytics(
        self,
        request: Request,
        query: Optional[TracingQuery] = Depends(parse_query_from_params_request),
    ) -> OldAnalyticsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        body_json = None
        query_from_body = None

        try:
            body_json = await request.json()

            if body_json:
                query_from_body = parse_query_from_body_request(
                    **body_json,
                )

        except Exception:  # pylint: disable=bare-except
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

        # Calculate and propagate costs/tokens BEFORE batching
        # This ensures complete trace trees for proper metric propagation
        span_dtos = calculate_and_propagate_metrics(span_dtos)

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
            await self.service.ingest(
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

    ## TRACES

    @intercept_exceptions()
    async def create_trace(  # CREATE
        self,
        request: Request,
        trace_request: OTelTracingRequest,
        sync: bool = True,
    ) -> OTelLinksResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

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
    @suppress_exceptions(default=OTelTracingResponse(), exclude=[HTTPException])
    async def fetch_trace(  # READ
        self,
        request: Request,
        trace_id: str,
    ) -> OTelTracingResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        try:
            trace_id = parse_trace_id_to_uuid(trace_id)

        except Exception as e:
            raise HTTPException(status_code=400, detail="Invalid trace_id.") from e

        spans = await self.service.fetch(
            project_id=UUID(request.state.project_id),
            #
            trace_ids=[UUID(trace_id)],
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
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

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

        try:
            links = await self._upsert(
                project_id=UUID(request.state.project_id),
                user_id=UUID(request.state.user_id),
                organization_id=UUID(request.state.organization_id),
                #
                spans=trace_request.spans,
                traces=trace_request.traces,
                sync=sync,
            )
        except Exception as e:
            log.error(f"Error editing trace {trace_id}: {e}", exc_info=True)
            raise

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
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

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
            trace_ids=[UUID(trace_id)],
        )

        link_response = OTelLinksResponse(
            count=len(links),
            links=links,
        )

        return link_response

    ## SESSIONS & USERS

    @intercept_exceptions()
    @suppress_exceptions(default=SessionIdsResponse(), exclude=[HTTPException])
    async def list_sessions(
        self,
        request: Request,
        sessions_query_request: SessionsQueryRequest,
    ):
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        session_ids, activity_cursor = await self.service.sessions(
            project_id=request.state.project_id,
            #
            realtime=sessions_query_request.realtime,
            #
            windowing=sessions_query_request.windowing,
        )

        # Compute next windowing cursor for time-based pagination
        windowing = self._compute_next_windowing(
            input_windowing=sessions_query_request.windowing,
            result_ids=session_ids,
            activity_cursor=activity_cursor,
        )

        session_ids_response = SessionIdsResponse(
            count=len(session_ids) if session_ids else 0,
            session_ids=session_ids,
            windowing=windowing,
        )

        return session_ids_response

    @intercept_exceptions()
    @suppress_exceptions(default=UserIdsResponse(), exclude=[HTTPException])
    async def list_users(
        self,
        request: Request,
        users_query_request: UsersQueryRequest,
    ):
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        user_ids, activity_cursor = await self.service.users(
            project_id=request.state.project_id,
            #
            realtime=users_query_request.realtime,
            #
            windowing=users_query_request.windowing,
        )

        # Compute next windowing cursor for time-based pagination
        windowing = self._compute_next_windowing(
            input_windowing=users_query_request.windowing,
            result_ids=user_ids,
            activity_cursor=activity_cursor,
        )

        user_ids_response = UserIdsResponse(
            count=len(user_ids) if user_ids else 0,
            user_ids=user_ids,
            windowing=windowing,
        )

        return user_ids_response

    def _compute_next_windowing(
        self,
        *,
        input_windowing: Optional[Windowing],
        result_ids: List[str],
        activity_cursor: Optional[datetime],
    ) -> Optional[Windowing]:
        """
        Compute next windowing cursor for time-based pagination.

        Args:
            input_windowing: The windowing parameters from the request
            result_ids: The list of IDs returned from the query
            activity_cursor: The activity timestamp (first_active or last_active)

        Returns:
            Windowing object for the next page, or None if no more pages
        """
        # Only compute cursor if we have all required conditions
        if not (
            input_windowing
            and input_windowing.limit
            and result_ids
            and len(result_ids) >= input_windowing.limit
            and activity_cursor
        ):
            return None

        # Determine order direction
        order_direction = (
            input_windowing.order.lower() if input_windowing.order else "descending"
        )

        # Move cursor based on order direction:
        # DESC (default): newest moves backward, oldest stays fixed
        # ASC: oldest moves forward, newest stays fixed
        if order_direction == "ascending":
            # ASC: Move oldest forward, keep newest fixed
            return Windowing(
                newest=input_windowing.newest,
                oldest=activity_cursor,
                limit=input_windowing.limit,
                order=input_windowing.order,
            )
        else:
            # DESC: Move newest backward, keep oldest fixed
            return Windowing(
                newest=activity_cursor,
                oldest=input_windowing.oldest,
                limit=input_windowing.limit,
                order=input_windowing.order,
            )


class SpansRouter:
    def __init__(
        self,
        *,
        tracing_router: TracingRouter,
        queries_service: Optional["QueriesService"] = None,
    ):
        self.tracing_router = tracing_router
        self.queries_service = queries_service
        self.router = APIRouter()

        # SPANS ----------------------------------------------------------------

        self.router.add_api_route(
            "/",
            self.fetch_spans,
            methods=["GET"],
            operation_id="fetch_spans",
            status_code=status.HTTP_200_OK,
            response_model=SpansResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/query",
            self.query_spans,
            methods=["POST"],
            operation_id="query_spans",
            status_code=status.HTTP_200_OK,
            response_model=SpansResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/ingest",
            self.ingest_spans,
            methods=["POST"],
            operation_id="ingest_spans",
            status_code=status.HTTP_202_ACCEPTED,
            response_model=LinksResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{trace_id}/{span_id}",
            self.fetch_span,
            methods=["GET"],
            operation_id="fetch_span",
            status_code=status.HTTP_200_OK,
            response_model=SpanResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/",
            self.create_span,
            methods=["POST"],
            operation_id="create_span",
            status_code=status.HTTP_201_CREATED,
            response_model=LinkResponse,
            response_model_exclude_none=True,
        )

    @staticmethod
    def _span_from_list(spans: Optional[List[Span]], span_id: str) -> Optional[Span]:
        for span in spans or []:
            if span and span.span_id == span_id:
                return span
        return None

    @staticmethod
    def _spans_from_list(
        spans: Optional[List[Span]],
        span_ids: Optional[List[str]] = None,
    ) -> List[Span]:
        if not spans:
            return []
        if not span_ids:
            return spans
        span_id_set = set(span_ids)
        return [span for span in spans if span and span.span_id in span_id_set]

    @staticmethod
    def _ids_from_query_params(
        values: Optional[List[str]],
        csv_values: Optional[str],
    ) -> List[str]:
        ids: List[str] = list(values or [])
        if csv_values:
            ids.extend(i.strip() for i in csv_values.split(",") if i.strip())
        return ids

    @staticmethod
    def _spans_from_parse_response(
        spans_or_traces: Optional[Union[OTelFlatSpans, OTelTraceTree]],
    ) -> List[Span]:
        if isinstance(spans_or_traces, list):
            return spans_or_traces
        return []

    @staticmethod
    def _links_from_otel_links(otel_links: Optional[OTelLinks]) -> List[Link]:
        links: List[Link] = []
        seen = set()
        for otel_link in otel_links or []:
            pair = (str(otel_link.trace_id), str(otel_link.span_id))
            if pair in seen:
                continue
            seen.add(pair)
            links.append(
                Link(
                    trace_id=pair[0],
                    span_id=pair[1],
                )
            )
        return links

    @intercept_exceptions()
    async def create_span(
        self,
        request: Request,
        span_request: SpanRequest,
        sync: bool = True,
    ) -> LinkResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if not span_request.span:
            raise HTTPException(status_code=400, detail="Missing span")

        links = await self.tracing_router._upsert(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            organization_id=UUID(request.state.organization_id),
            #
            spans=[span_request.span],
            sync=sync,
        )

        normalized_links = self._links_from_otel_links(links)
        link = normalized_links[0] if normalized_links else None
        return LinkResponse(
            count=1 if link else 0,
            link=link,
        )

    @intercept_exceptions()
    async def ingest_spans(
        self,
        request: Request,
        spans_request: SpansRequest,
    ) -> LinksResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if not spans_request.spans:
            raise HTTPException(status_code=400, detail="Missing spans")

        links = await self.tracing_router._upsert(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            organization_id=UUID(request.state.organization_id),
            #
            spans=spans_request.spans,
        )

        normalized_links = self._links_from_otel_links(links)
        return LinksResponse(
            count=len(normalized_links),
            links=normalized_links,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=SpansResponse(), exclude=[HTTPException])
    async def query_spans(
        self,
        request: Request,
        spans_query_request: SpansQueryRequest = Body(
            default_factory=SpansQueryRequest
        ),
    ) -> SpansResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        project_id = UUID(request.state.project_id)
        query_ref = spans_query_request.query_ref
        query_variant_ref = spans_query_request.query_variant_ref
        query_revision_ref = spans_query_request.query_revision_ref

        if query_ref or query_variant_ref or query_revision_ref:
            if not self.queries_service:
                return SpansResponse()

            if is_ee():
                if not await check_action_access(  # type: ignore
                    user_uid=request.state.user_id,
                    project_id=request.state.project_id,
                    permission=Permission.VIEW_QUERIES,  # type: ignore
                ):
                    raise FORBIDDEN_EXCEPTION  # type: ignore

            query_revision = await self.queries_service.fetch_query_revision(
                project_id=project_id,
                query_ref=query_ref,
                query_variant_ref=query_variant_ref,
                query_revision_ref=query_revision_ref,
            )

            if not query_revision or not query_revision.data:
                return SpansResponse()

            stored_formatting = query_revision.data.formatting
            formatting = (
                stored_formatting.model_copy(
                    update={
                        "focus": stored_formatting.focus or Focus.SPAN,
                        "format": stored_formatting.format or Format.AGENTA,
                    }
                )
                if stored_formatting
                else Formatting(focus=Focus.SPAN, format=Format.AGENTA)
            )

            if formatting.focus == Focus.TRACE:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "Query revision formatting.focus=trace. "
                        "Use /preview/traces/query for this query revision."
                    ),
                )

            stored_windowing = query_revision.data.windowing
            request_windowing = spans_query_request.windowing
            if stored_windowing:
                merged_windowing = stored_windowing.model_copy()
                updates: Dict[str, Union[str, int, UUID]] = {}
                if request_windowing and request_windowing.limit is not None:
                    updates["limit"] = request_windowing.limit
                if request_windowing and request_windowing.next is not None:
                    updates["next"] = request_windowing.next
                if updates:
                    merged_windowing = merged_windowing.model_copy(update=updates)
            else:
                merged_windowing = request_windowing

            query = TracingQuery(
                formatting=formatting,
                filtering=query_revision.data.filtering,
                windowing=merged_windowing,
            )
        else:
            query = TracingQuery(
                formatting={"focus": Focus.SPAN, "format": Format.AGENTA},
                filtering=spans_query_request.filtering,
                windowing=spans_query_request.windowing,
            )

        try:
            span_dtos = await self.tracing_router.service.query(
                project_id=project_id,
                query=query,
            )
        except FilteringException as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

        spans_or_traces = parse_spans_into_response(
            span_dtos,
            focus=(query.formatting.focus if query.formatting else None) or Focus.SPAN,
            format=(query.formatting.format if query.formatting else None)
            or Format.AGENTA,
        )
        spans = self._spans_from_parse_response(spans_or_traces)

        return SpansResponse(
            count=len(spans),
            spans=spans,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=SpansResponse(), exclude=[HTTPException])
    async def fetch_spans(
        self,
        request: Request,
        *,
        trace_id: Optional[List[str]] = Query(default=None),
        trace_ids: Optional[str] = Query(default=None),
        span_id: Optional[List[str]] = Query(default=None),
        span_ids: Optional[str] = Query(default=None),
    ) -> SpansResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        trace_id_values = self._ids_from_query_params(trace_id, trace_ids)
        span_id_values = self._ids_from_query_params(span_id, span_ids)

        if not trace_id_values and not span_id_values:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "At least one trace_id or span_id query parameter is required."
                ),
            )

        spans_or_traces: Optional[Union[OTelFlatSpans, OTelTraceTree]] = None

        if trace_id_values:
            try:
                uuid_ids = [
                    UUID(parse_trace_id_to_uuid(tid)) for tid in trace_id_values
                ]
            except Exception as e:
                raise HTTPException(status_code=400, detail="Invalid trace_id.") from e

            span_dtos = await self.tracing_router.service.fetch(
                project_id=UUID(request.state.project_id),
                trace_ids=uuid_ids,
            )

            spans_or_traces = parse_spans_into_response(
                span_dtos,
                focus=Focus.SPAN,
                format=Format.AGENTA,
            )

        else:
            filtering = Filtering(
                operator=LogicalOperator.AND,
                conditions=[
                    Condition(
                        field="span_id",
                        value=(
                            span_id_values[0]
                            if len(span_id_values) == 1
                            else span_id_values
                        ),
                        operator=(
                            ComparisonOperator.IS
                            if len(span_id_values) == 1
                            else ListOperator.IN
                        ),
                    )
                ],
            )

            query = TracingQuery(
                formatting={"focus": Focus.SPAN, "format": Format.AGENTA},
                filtering=filtering,
            )

            try:
                span_dtos = await self.tracing_router.service.query(
                    project_id=UUID(request.state.project_id),
                    query=query,
                )
            except FilteringException as e:
                raise HTTPException(status_code=400, detail=str(e)) from e

            spans_or_traces = parse_spans_into_response(
                span_dtos,
                focus=Focus.SPAN,
                format=Format.AGENTA,
            )

        spans = self._spans_from_parse_response(spans_or_traces)
        filtered_spans = self._spans_from_list(spans, span_id_values)

        return SpansResponse(
            count=len(filtered_spans),
            spans=filtered_spans,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=SpanResponse(), exclude=[HTTPException])
    async def fetch_span(
        self,
        request: Request,
        *,
        trace_id: str,
        span_id: str,
    ) -> SpanResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        try:
            trace_uuid = UUID(parse_trace_id_to_uuid(trace_id))
        except Exception as e:
            raise HTTPException(status_code=400, detail="Invalid trace_id.") from e

        span_dtos = await self.tracing_router.service.fetch(
            project_id=UUID(request.state.project_id),
            trace_ids=[trace_uuid],
        )

        spans_or_traces: Optional[Union[OTelFlatSpans, OTelTraceTree]] = (
            parse_spans_into_response(
                span_dtos,
                focus=Focus.SPAN,
                format=Format.AGENTA,
            )
        )

        spans = self._spans_from_parse_response(spans_or_traces)
        matching_spans = self._spans_from_list(spans, span_ids=[span_id])

        span = matching_spans[0] if matching_spans else None

        return SpanResponse(
            count=1 if span else 0,
            span=span,
        )


class TracesRouter:
    def __init__(
        self,
        *,
        tracing_router: TracingRouter,
        queries_service: Optional["QueriesService"] = None,
    ):
        self.tracing_router = tracing_router
        self.queries_service = queries_service
        self.router = APIRouter()

        # TRACES ---------------------------------------------------------------

        self.router.add_api_route(
            "/",
            self.fetch_traces,
            methods=["GET"],
            operation_id="fetch_traces",
            status_code=status.HTTP_200_OK,
            response_model=TracesResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/query",
            self.query_traces,
            methods=["POST"],
            operation_id="query_traces",
            status_code=status.HTTP_200_OK,
            response_model=TracesResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/ingest",
            self.ingest_traces,
            methods=["POST"],
            operation_id="ingest_traces",
            status_code=status.HTTP_202_ACCEPTED,
            response_model=TraceIdsResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{trace_id}",
            self.fetch_trace,
            methods=["GET"],
            operation_id="fetch_trace",
            status_code=status.HTTP_200_OK,
            response_model=TraceResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/",
            self.create_trace,
            methods=["POST"],
            operation_id="create_trace",
            status_code=status.HTTP_201_CREATED,
            response_model=TraceIdResponse,
            response_model_exclude_none=True,
        )

    @staticmethod
    def _trace_map_to_traces(trace_map: OTelTraceTree) -> List["Trace"]:
        traces: List[Trace] = []
        for tid, spans_tree in trace_map.items():
            if isinstance(spans_tree, dict):
                spans = spans_tree.get("spans")
            else:
                spans = spans_tree.spans
            traces.append(Trace(trace_id=str(tid), spans=spans))
        return traces

    @staticmethod
    def _traces_to_trace_map(traces: List["Trace"]) -> OTelTraceTree:
        trace_map: OTelTraceTree = {}
        for trace in traces:
            if not trace.trace_id:
                raise HTTPException(status_code=400, detail="Missing trace_id")
            trace_map[str(trace.trace_id)] = OTelSpansTree(spans=trace.spans)
        return trace_map

    def _extract_trace_map(
        self, traces_request: TracesRequest
    ) -> Optional[OTelTraceTree]:
        return (
            self._traces_to_trace_map(traces_request.traces)
            if traces_request.traces
            else None
        )

    def _extract_single_trace_map(
        self, trace_request: TraceRequest
    ) -> Optional[OTelTraceTree]:
        if not trace_request.trace:
            return None
        return self._traces_to_trace_map([trace_request.trace])

    @staticmethod
    def _trace_ids_from_links(links: Optional[OTelLinks]) -> List[str]:
        trace_ids: List[str] = []
        seen = set()
        for link in links or []:
            tid = str(link.trace_id)
            if tid not in seen:
                seen.add(tid)
                trace_ids.append(tid)
        return trace_ids

    # TRACES -------------------------------------------------------------------

    @intercept_exceptions()
    @suppress_exceptions(default=TracesResponse(), exclude=[HTTPException])
    async def query_traces(  # QUERY
        self,
        request: Request,
        traces_query_request: TracesQueryRequest = Body(
            default_factory=TracesQueryRequest
        ),
    ) -> TracesResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        project_id = UUID(request.state.project_id)

        # Resolve query revision ref if provided
        query_ref = traces_query_request.query_ref
        query_variant_ref = traces_query_request.query_variant_ref
        query_revision_ref = traces_query_request.query_revision_ref

        if (
            query_ref or query_variant_ref or query_revision_ref
        ) and self.queries_service:
            if is_ee():
                if not await check_action_access(  # type: ignore
                    user_uid=request.state.user_id,
                    project_id=request.state.project_id,
                    permission=Permission.VIEW_QUERIES,  # type: ignore
                ):
                    raise FORBIDDEN_EXCEPTION  # type: ignore

            query_revision = await self.queries_service.fetch_query_revision(
                project_id=project_id,
                #
                query_ref=query_ref,
                query_variant_ref=query_variant_ref,
                query_revision_ref=query_revision_ref,
            )

            if not query_revision or not query_revision.data:
                return TracesResponse()

            stored_formatting = query_revision.data.formatting
            formatting = (
                stored_formatting.model_copy(
                    update={
                        "focus": stored_formatting.focus or Focus.TRACE,
                        "format": stored_formatting.format or Format.AGENTA,
                    }
                )
                if stored_formatting
                else Formatting(focus=Focus.TRACE, format=Format.AGENTA)
            )

            if formatting.focus == Focus.SPAN:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "Query revision formatting.focus=span. "
                        "Use /preview/spans/query for this query revision."
                    ),
                )

            stored_windowing = query_revision.data.windowing

            # Let request pagination (next, limit) override stored pagination.
            request_windowing = traces_query_request.windowing

            if stored_windowing:
                merged_windowing = stored_windowing.model_copy()
                updates: Dict[str, Union[str, int, UUID]] = {}
                if request_windowing and request_windowing.limit is not None:
                    updates["limit"] = request_windowing.limit
                if request_windowing and request_windowing.next is not None:
                    updates["next"] = request_windowing.next
                if updates:
                    merged_windowing = merged_windowing.model_copy(update=updates)
            else:
                merged_windowing = request_windowing

            tracing_query = TracingQuery(
                formatting=formatting,
                filtering=query_revision.data.filtering,
                windowing=merged_windowing,
            )

            try:
                span_dtos = await self.tracing_router.service.query(
                    project_id=project_id,
                    query=tracing_query,
                )
            except FilteringException as e:
                raise HTTPException(status_code=400, detail=str(e)) from e

            spans_or_traces = parse_spans_into_response(
                span_dtos,
                focus=(
                    tracing_query.formatting.focus if tracing_query.formatting else None
                )
                or Focus.TRACE,
                format=(
                    tracing_query.formatting.format
                    if tracing_query.formatting
                    else None
                )
                or Format.AGENTA,
            )

            if isinstance(spans_or_traces, dict):
                traces = self._trace_map_to_traces(spans_or_traces)
                return TracesResponse(count=len(traces), traces=traces)
            return TracesResponse()

        # No refs — execute trace query directly, always returning Agenta trace trees.
        merged_query = TracingQuery(
            filtering=traces_query_request.filtering,
            windowing=traces_query_request.windowing,
        )

        merged_query = TracingQuery(
            formatting={"focus": Focus.TRACE, "format": Format.AGENTA},
            filtering=merged_query.filtering,
            windowing=merged_query.windowing,
        )

        try:
            span_dtos = await self.tracing_router.service.query(
                project_id=project_id,
                query=merged_query,
            )
        except FilteringException as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

        spans_or_traces = parse_spans_into_response(
            span_dtos,
            focus=Focus.TRACE,
            format=Format.AGENTA,
        )

        if isinstance(spans_or_traces, dict):
            traces = self._trace_map_to_traces(spans_or_traces)
            return TracesResponse(count=len(traces), traces=traces)

        return TracesResponse()

    @intercept_exceptions()
    async def create_trace(
        self,
        request: Request,
        trace_request: TraceRequest,
        sync: bool = True,
    ) -> TraceIdResponse:
        traces = self._extract_single_trace_map(trace_request)
        if not traces:
            raise HTTPException(status_code=400, detail="Missing trace")

        # Reuse legacy create flow after adapting request shape, preserving
        # existing validation semantics (missing spans, root span checks, etc.).
        legacy_request = OTelTracingRequest(traces=traces)
        links_response = await self.tracing_router.create_trace(
            request=request,
            trace_request=legacy_request,
            sync=sync,
        )
        trace_ids = self._trace_ids_from_links(links_response.links)
        trace_id = trace_ids[0] if trace_ids else None
        return TraceIdResponse(
            count=1 if trace_id else 0,
            trace_id=trace_id,
        )

    @intercept_exceptions()
    async def ingest_traces(  # MUTATION
        self,
        request: Request,
        traces_request: TracesRequest,
    ) -> TraceIdsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        traces = self._extract_trace_map(traces_request)
        if not traces:
            raise HTTPException(status_code=400, detail="Missing traces")

        links = await self.tracing_router._upsert(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            organization_id=UUID(request.state.organization_id),
            #
            traces=traces,
        )

        trace_ids = self._trace_ids_from_links(links)
        return TraceIdsResponse(
            count=len(trace_ids),
            trace_ids=trace_ids,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=TracesResponse(), exclude=[HTTPException])
    async def fetch_traces(
        self,
        request: Request,
        *,
        trace_id: Optional[List[str]] = Query(default=None),
        trace_ids: Optional[str] = Query(default=None),
    ) -> TracesResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        ids: List[str] = list(trace_id or [])
        if trace_ids:
            ids.extend(i.strip() for i in trace_ids.split(",") if i.strip())

        if not ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="At least one trace_id query parameter is required.",
            )

        try:
            uuid_ids = [UUID(parse_trace_id_to_uuid(tid)) for tid in ids]
        except Exception as e:
            raise HTTPException(status_code=400, detail="Invalid trace_id.") from e

        spans = await self.tracing_router.service.fetch(
            project_id=UUID(request.state.project_id),
            #
            trace_ids=uuid_ids,
        )

        if spans is None:
            return TracesResponse()

        traces = parse_spans_into_response(
            spans,
            focus=Focus.TRACE,
            format=Format.AGENTA,
        )

        if not traces or isinstance(traces, list):
            return TracesResponse()

        traces_list = self._trace_map_to_traces(traces)
        return TracesResponse(
            count=len(traces_list),
            traces=traces_list,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=TraceResponse(), exclude=[HTTPException])
    async def fetch_trace(
        self,
        request: Request,
        *,
        trace_id: str,
    ) -> TraceResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        try:
            trace_uuid = UUID(parse_trace_id_to_uuid(trace_id))
        except Exception as e:
            raise HTTPException(status_code=400, detail="Invalid trace_id.") from e

        spans = await self.tracing_router.service.fetch(
            project_id=UUID(request.state.project_id),
            #
            trace_ids=[trace_uuid],
        )

        if spans is None:
            return TraceResponse()

        traces = parse_spans_into_response(
            spans,
            focus=Focus.TRACE,
            format=Format.AGENTA,
        )

        if not traces or isinstance(traces, list):
            return TraceResponse()

        trace_tree = traces.get(str(trace_uuid))
        if not trace_tree:
            return TraceResponse()

        if isinstance(trace_tree, dict):
            spans = trace_tree.get("spans")
        else:
            spans = trace_tree.spans

        from oss.src.core.shared.dtos import Trace

        return TraceResponse(
            count=1,
            trace=Trace(trace_id=str(trace_uuid), spans=spans),
        )
