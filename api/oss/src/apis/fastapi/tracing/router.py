from typing import Optional, List, Tuple, Dict, Union
from uuid import UUID
from datetime import datetime

from fastapi import APIRouter, Request, Depends, status, HTTPException

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
    OTelTracingRequest,
    OTelTracingResponse,
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
from oss.src.core.shared.dtos import Windowing

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
