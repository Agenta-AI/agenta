from typing import Optional, List, Tuple
from uuid import UUID

from fastapi import APIRouter, Query, Request, Depends, status, HTTPException, Body

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions, suppress_exceptions

from oss.src.apis.fastapi.tracing.utils import (
    parse_query_from_params_request,
    parse_query_from_body_request,
    parse_analytics_from_params_request,
    parse_analytics_from_body_request,
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
from oss.src.core.tracing.utils.parsing import parse_trace_id_to_uuid
from oss.src.core.tracing.utils.trees import (
    traces_to_trace_map,
)

# TYPE_CHECKING to avoid circular import at runtime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from oss.src.core.queries.service import QueriesService
from oss.src.core.tracing.dtos import (
    OTelLinks,
    OTelFlatSpans,
    Span,
    OTelTraceTree,
    TracingQuery,
    Focus,
    MetricSpec,
    QueryFocusConflictError,
    FilteringException,
)
from oss.src.core.shared.dtos import Link

log = get_module_logger(__name__)

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION


class TracingRouter:
    def __init__(
        self,
        tracing_service: TracingService,
    ):
        self.service = tracing_service

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

        links = await self.service.ingest_spans(
            organization_id=UUID(request.state.organization_id),
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
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

        merged_query = self.service.merge_queries(query, query_from_body)
        try:
            spans_or_traces = await self.service.query_spans_or_traces(
                project_id=UUID(request.state.project_id),
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

        query, specs = self.service.merge_analytics(
            analytics,
            analytics_from_body,
        )

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

        merged_query = self.service.merge_queries(
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
        try:
            links = await self.service.create_trace(
                organization_id=UUID(request.state.organization_id),
                project_id=UUID(request.state.project_id),
                user_id=UUID(request.state.user_id),
                spans=trace_request.spans,
                traces=trace_request.traces,
                sync=sync,
            )
        except ValueError as e:
            detail = str(e)
            status_code = 429 if "quota exceeded" in detail.lower() else 400
            raise HTTPException(status_code=status_code, detail=detail) from e

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
            trace = await self.service.fetch_trace(
                project_id=UUID(request.state.project_id),
                trace_id=trace_id,
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail="Invalid trace_id.") from e

        if not trace:
            return OTelTracingResponse()

        traces = traces_to_trace_map([trace])
        return OTelTracingResponse(
            count=len(traces.keys()),
            traces=traces,
        )

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

        try:
            extracted_spans = TracingService._extract_single_trace_spans(
                spans=trace_request.spans,
                traces=trace_request.traces,
            )
            payload_trace_ids = TracingService._extract_trace_ids_from_spans(
                extracted_spans
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

        if len(payload_trace_ids) != 1:
            raise HTTPException(
                status_code=400,
                detail="Trace payload must contain exactly one trace_id.",
            )

        try:
            normalized_path_trace_id = parse_trace_id_to_uuid(trace_id)
            normalized_payload_trace_id = parse_trace_id_to_uuid(payload_trace_ids[0])
        except (TypeError, ValueError) as e:
            raise HTTPException(
                status_code=400, detail="Invalid trace_id in path or payload."
            ) from e

        if normalized_path_trace_id != normalized_payload_trace_id:
            raise HTTPException(
                status_code=400,
                detail=f"Path trace_id '{trace_id}' does not match payload trace_id '{payload_trace_ids[0]}'.",
            )

        try:
            links = await self.service.edit_trace(
                organization_id=UUID(request.state.organization_id),
                project_id=UUID(request.state.project_id),
                user_id=UUID(request.state.user_id),
                spans=trace_request.spans,
                traces=trace_request.traces,
                sync=sync,
            )
        except ValueError as e:
            detail = str(e)
            status_code = 429 if "quota exceeded" in detail.lower() else 400
            raise HTTPException(status_code=status_code, detail=detail) from e
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
            links = await self.service.delete_trace(
                project_id=UUID(request.state.project_id),
                trace_id=trace_id,
            )
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail="Invalid trace_id",
            ) from e

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
        windowing = self.service.build_next_windowing(
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
        windowing = self.service.build_next_windowing(
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


class SpansRouter:
    def __init__(
        self,
        *,
        tracing_service: TracingService,
        queries_service: Optional["QueriesService"] = None,
    ):
        self.service = tracing_service
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

        try:
            links = await self.service.ingest_spans(
                project_id=UUID(request.state.project_id),
                user_id=UUID(request.state.user_id),
                organization_id=UUID(request.state.organization_id),
                spans=[span_request.span],
                sync=sync,
            )
        except ValueError as e:
            detail = str(e)
            status_code = 429 if "quota exceeded" in detail.lower() else 400
            raise HTTPException(status_code=status_code, detail=detail) from e

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

        try:
            links = await self.service.ingest_spans(
                project_id=UUID(request.state.project_id),
                user_id=UUID(request.state.user_id),
                organization_id=UUID(request.state.organization_id),
                spans=spans_request.spans,
            )
        except ValueError as e:
            detail = str(e)
            status_code = 429 if "quota exceeded" in detail.lower() else 400
            raise HTTPException(status_code=status_code, detail=detail) from e

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
        has_query_refs = bool(
            spans_query_request.query_ref
            or spans_query_request.query_variant_ref
            or spans_query_request.query_revision_ref
        )
        if has_query_refs:
            if is_ee():
                if not await check_action_access(  # type: ignore
                    user_uid=request.state.user_id,
                    project_id=request.state.project_id,
                    permission=Permission.VIEW_QUERIES,  # type: ignore
                ):
                    raise FORBIDDEN_EXCEPTION  # type: ignore

        try:
            query = await self.service.resolve_query_request(
                project_id=project_id,
                queries_service=self.queries_service,
                query_ref=spans_query_request.query_ref,
                query_variant_ref=spans_query_request.query_variant_ref,
                query_revision_ref=spans_query_request.query_revision_ref,
                filtering=spans_query_request.filtering,
                windowing=spans_query_request.windowing,
                default_focus=Focus.SPAN,
                conflict_focus=Focus.TRACE,
                conflict_detail=(
                    "Query revision formatting.focus=trace. "
                    "Use /preview/traces/query for this query revision."
                ),
            )
        except QueryFocusConflictError as e:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=e.detail,
            ) from e

        if query is None:
            return SpansResponse()

        try:
            spans = await self.service.query_spans(
                project_id=project_id,
                query=query,
            )
        except FilteringException as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

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

        try:
            spans = await self.service.fetch_spans(
                project_id=UUID(request.state.project_id),
                trace_ids=trace_id_values,
                span_ids=span_id_values,
            )
        except FilteringException as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

        return SpansResponse(
            count=len(spans),
            spans=spans,
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
            span = await self.service.fetch_span(
                project_id=UUID(request.state.project_id),
                trace_id=trace_id,
                span_id=span_id,
            )
        except FilteringException as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

        return SpanResponse(
            count=1 if span else 0,
            span=span,
        )


class TracesRouter:
    def __init__(
        self,
        *,
        tracing_service: TracingService,
        queries_service: Optional["QueriesService"] = None,
    ):
        self.service = tracing_service
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

    def _extract_trace_map(
        self, traces_request: TracesRequest
    ) -> Optional[OTelTraceTree]:
        if not traces_request.traces:
            return None
        return traces_to_trace_map(traces_request.traces)

    def _extract_single_trace_map(
        self, trace_request: TraceRequest
    ) -> Optional[OTelTraceTree]:
        if not trace_request.trace:
            return None
        return traces_to_trace_map([trace_request.trace])

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
        has_query_refs = bool(
            traces_query_request.query_ref
            or traces_query_request.query_variant_ref
            or traces_query_request.query_revision_ref
        )
        if has_query_refs:
            if is_ee():
                if not await check_action_access(  # type: ignore
                    user_uid=request.state.user_id,
                    project_id=request.state.project_id,
                    permission=Permission.VIEW_QUERIES,  # type: ignore
                ):
                    raise FORBIDDEN_EXCEPTION  # type: ignore

        try:
            query = await self.service.resolve_query_request(
                project_id=project_id,
                queries_service=self.queries_service,
                query_ref=traces_query_request.query_ref,
                query_variant_ref=traces_query_request.query_variant_ref,
                query_revision_ref=traces_query_request.query_revision_ref,
                filtering=traces_query_request.filtering,
                windowing=traces_query_request.windowing,
                default_focus=Focus.TRACE,
                conflict_focus=Focus.SPAN,
                conflict_detail=(
                    "Query revision formatting.focus=span. "
                    "Use /preview/spans/query for this query revision."
                ),
            )
        except QueryFocusConflictError as e:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=e.detail,
            ) from e

        if query is None:
            return TracesResponse()

        try:
            traces = await self.service.query_traces(
                project_id=project_id,
                query=query,
            )
        except FilteringException as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

        return TracesResponse(count=len(traces), traces=traces)

    @intercept_exceptions()
    async def create_trace(
        self,
        request: Request,
        trace_request: TraceRequest,
        sync: bool = True,
    ) -> TraceIdResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        traces = self._extract_single_trace_map(trace_request)
        if not traces:
            raise HTTPException(status_code=400, detail="Missing trace")

        try:
            links = await self.service.create_trace(
                project_id=UUID(request.state.project_id),
                user_id=UUID(request.state.user_id),
                organization_id=UUID(request.state.organization_id),
                traces=traces,
                sync=sync,
            )
        except ValueError as e:
            detail = str(e)
            status_code = 429 if "quota exceeded" in detail.lower() else 400
            raise HTTPException(status_code=status_code, detail=detail) from e

        trace_ids = self._trace_ids_from_links(links)
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

        try:
            links = await self.service.ingest_spans(
                project_id=UUID(request.state.project_id),
                user_id=UUID(request.state.user_id),
                organization_id=UUID(request.state.organization_id),
                traces=traces,
            )
        except ValueError as e:
            detail = str(e)
            status_code = 429 if "quota exceeded" in detail.lower() else 400
            raise HTTPException(status_code=status_code, detail=detail) from e

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
            traces_list = await self.service.fetch_traces(
                project_id=UUID(request.state.project_id),
                trace_ids=ids,
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail="Invalid trace_id.") from e

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
        if trace_id.lower() in {"query", "ingest"}:
            raise HTTPException(
                status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
                detail=f"GET /preview/traces/{trace_id} is not supported.",
            )

        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        try:
            trace = await self.service.fetch_trace(
                project_id=UUID(request.state.project_id),
                trace_id=trace_id,
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail="Invalid trace_id.") from e

        return TraceResponse(
            count=1 if trace else 0,
            trace=trace,
        )
