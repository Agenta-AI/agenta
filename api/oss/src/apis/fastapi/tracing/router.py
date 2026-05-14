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
    TraceIdResponse,
    TraceIdsResponse,
    OTelTracingRequest,
    TraceRequest,
    TracesRequest,
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
from oss.src.core.tracing.utils.trees import traces_to_trace_map

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
    from ee.src.utils.entitlements import check_entitlements, Counter


class TracingRouter:
    def __init__(
        self,
        tracing_service: TracingService,
    ):
        self.service = tracing_service

        self.router = APIRouter()
        self.legacy_router = APIRouter()

        ### SPANS

        self.router.add_api_route(
            "/spans/ingest",
            self.ingest_spans,
            methods=["POST"],
            operation_id="ingest_spans",
            status_code=status.HTTP_202_ACCEPTED,
            response_model=OTelLinksResponse,
            response_model_exclude_none=True,
            deprecated=True,
        )

        self.router.add_api_route(
            "/spans/query",
            self.query_spans,
            methods=["POST"],
            operation_id="query_spans_rpc",
            status_code=status.HTTP_200_OK,
            response_model=OTelTracingResponse,
            response_model_exclude_none=True,
            deprecated=True,
        )

        self.legacy_router.add_api_route(
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
            operation_id="query_analytics",
            status_code=status.HTTP_200_OK,
            response_model=AnalyticsResponse,
            response_model_exclude_none=True,
            deprecated=True,
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
            deprecated=True,
        )

        self.router.add_api_route(
            "/traces/{trace_id}",
            self.fetch_trace,
            methods=["GET"],
            operation_id="fetch_trace_tracing",
            status_code=status.HTTP_200_OK,
            response_model=OTelTracingResponse,
            response_model_exclude_none=True,
            deprecated=True,
        )

        self.router.add_api_route(
            "/traces/{trace_id}",
            self.edit_trace,
            methods=["PUT"],
            operation_id="edit_trace_tracing",
            status_code=status.HTTP_202_ACCEPTED,
            response_model=OTelLinksResponse,
            response_model_exclude_none=True,
            deprecated=True,
        )

        self.router.add_api_route(
            "/traces/{trace_id}",
            self.delete_trace,
            methods=["DELETE"],
            operation_id="delete_trace_tracing",
            status_code=status.HTTP_202_ACCEPTED,
            response_model=OTelLinksResponse,
            response_model_exclude_none=True,
            deprecated=True,
        )

        ## SESSIONS & USERS

        self.router.add_api_route(
            "/sessions/query",
            self.list_sessions,
            methods=["POST"],
            operation_id="query_sessions",
            status_code=status.HTTP_200_OK,
            response_model=SessionIdsResponse,
            response_model_exclude_none=True,
            deprecated=True,
        )

        self.router.add_api_route(
            "/users/query",
            self.list_users,
            methods=["POST"],
            operation_id="query_users",
            status_code=status.HTTP_200_OK,
            response_model=UserIdsResponse,
            response_model_exclude_none=True,
            deprecated=True,
        )

    ## SPANS

    @intercept_exceptions()
    async def ingest_spans(  # MUTATION
        self,
        request: Request,
        spans_request: OTelTracingRequest,
    ) -> OTelLinksResponse:
        """Ingest spans into the tracing backend.

        Use this endpoint to write full OpenTelemetry-style spans — including
        multi-span hierarchies (parent → child → grandchild), attributes,
        references, events and links. For simple single-span annotations or
        evaluator outputs, prefer `POST /preview/tracing/traces/`
        (`create_simple_trace`) — it's a higher-level helper on top of this
        endpoint.

        ## Request body

        Provide exactly one of:

        - `spans`: a flat list of spans. Parent/child relationships are
          expressed via `parent_id` on each span.
        - `traces`: a nested tree keyed by `trace_id` then by span name,
          where each node may contain a `spans` dict of its children. The
          query endpoint (`POST /tracing/spans/query`) returns this shape.

        Each span requires `trace_id`, `span_id`, `start_time`, `end_time`.
        `trace_id` must be a 32-char hex UUID, `span_id` a 16-char hex.
        Attributes follow the Agenta convention under the `ag` namespace
        (`ag.type`, `ag.data`, `ag.metrics`, `ag.references`) and may be
        submitted either as a flat dotted map (OTel wire format) or as a
        nested object — both are accepted.

        ## Response

        Returns `202 Accepted` with the links (`trace_id` + `span_id`) for
        the spans that were parsed into the ingest stream. See
        [Tracing — Async write
        contract](/reference/api-guide/tracing#async-write-contract-202)
        for what `count < N submitted` means.

        ## Example

        ```json
        {
          "spans": [
            {
              "trace_id": "f5a2efb40895881e938e2ebc070beca8",
              "span_id": "15f3df0731995245",
              "span_name": "completion_v0",
              "span_type": "workflow",
              "span_kind": "SPAN_KIND_SERVER",
              "start_time": "2026-04-16T18:18:18.491929Z",
              "end_time": "2026-04-16T18:18:20.415372Z",
              "attributes": {
                "ag.type.trace": "invocation",
                "ag.type.span": "workflow",
                "ag.data.inputs.country": "France",
                "ag.data.outputs": "Paris"
              }
            }
          ]
        }
        ```
        """
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

            try:
                delta = (
                    len(spans_request.traces)
                    if spans_request.traces
                    else sum(
                        1 for s in (spans_request.spans or []) if s.parent_id is None
                    )
                )
                if delta > 0:
                    allowed, _, _ = await check_entitlements(  # type: ignore
                        organization_id=UUID(request.state.organization_id),
                        key=Counter.TRACES,  # type: ignore
                        delta=delta,
                        use_cache=True,
                    )
                    if not allowed:
                        raise HTTPException(
                            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            detail="You have reached your monthly quota limit.",
                        )
            except HTTPException:
                raise
            except Exception:
                log.warning("[tracing] Soft quota check failed", exc_info=True)

        dropped: OTelLinks = []

        links = await self.service.ingest_spans(
            organization_id=UUID(request.state.organization_id),
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            spans=spans_request.spans,
            traces=spans_request.traces,
            dropped=dropped,
        )

        link_response = OTelLinksResponse(
            count=len(links) + len(dropped),
            links=links,
            dropped=dropped or None,
        )

        return link_response

    @intercept_exceptions()
    @suppress_exceptions(default=OTelTracingResponse(), exclude=[HTTPException])
    async def query_spans(  # QUERY
        self,
        request: Request,
        query: Optional[TracingQuery] = Depends(parse_query_from_params_request),
    ) -> OTelTracingResponse:
        """Query spans and traces in the tracing backend.

        Use `focus` in the request body to control the response shape:

        - `"trace"` (default): returns a nested `traces` tree keyed by
          `trace_id` then by span name. Children hang off their parent's
          `spans` field. Best for rendering a trace waterfall.
        - `"span"`: returns a flat `spans` list. Best for paginating or
          filtering across all spans regardless of hierarchy.

        Use `oldest` / `newest` (unix seconds) to window the query and
        `limit` to cap the number of traces/spans returned.

        The response preserves the Agenta `ag.*` attribute namespace and
        includes computed metrics (`ag.metrics.duration`, `ag.metrics.tokens`,
        `ag.metrics.costs`) on each span. The `traces` tree returned here is
        the same shape that `POST /tracing/spans/ingest` accepts as its
        `traces` field.
        """
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
        """Aggregate span metrics into time buckets.

        Runs filtering and windowing identical to `POST /tracing/spans/query`,
        then bucketizes the matched spans by time and computes one or more
        metric summaries per bucket. Use this to build charts of latency,
        cost, token usage, or custom numeric and categorical attributes.

        ## Request body

        - `filtering` — same shape as the query endpoint, scoped to the spans
          that contribute to the analytics.
        - `windowing` — `oldest`/`newest` for the time range and `interval`
          for bucket width (in seconds).
        - `specs` — a list of `MetricSpec` entries describing which
          attributes to summarize and how. Each spec declares a `type`
          (`numeric/continuous`, `numeric/discrete`, `binary`,
          `categorical/single`, `categorical/multiple`, `string`, `json`,
          or `*` for auto) and a dotted `path` into the span (for example
          `attributes.ag.metrics.costs.cumulative.total`).

        ## Response

        Buckets are returned in chronological order. Each bucket carries a
        `metrics` dict keyed by spec path. See [Tracing — the ag.*
        namespace](/reference/api-guide/tracing#the-ag-attribute-namespace)
        for the cumulative/incremental metric layout on each span.
        """
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
        """Aggregate span metrics using the fixed legacy schema.

        Returns time-bucketed aggregates with a fixed set of fields
        (`count`, `duration`, `costs`, `tokens`) split into `total` and
        `errors`. The shape predates `specs`-driven analytics and is kept
        for the existing observability dashboards that consume it.

        New integrations should prefer `POST /tracing/analytics/query`,
        which accepts `specs` and can summarize arbitrary span attributes,
        not just the four fixed metrics.
        """
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
    ) -> OTelLinksResponse:
        """Create a trace from one or more spans.

        This is the single-trace counterpart to `POST /tracing/spans/ingest`.
        Accepts the same `OTelTracingRequest` body (either `spans` flat list
        or `traces` nested tree) but requires all spans to share a single
        `trace_id`.

        Returns `202 Accepted` with the links for the spans that entered
        the ingest stream. See [Tracing — Async write
        contract](/reference/api-guide/tracing#async-write-contract-202).

        Most callers should prefer `POST /tracing/spans/ingest` (no
        single-trace restriction) or `POST /simple/traces/` (helper for a
        one-span payload).
        """
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

            try:
                allowed, _, _ = await check_entitlements(  # type: ignore
                    organization_id=UUID(request.state.organization_id),
                    key=Counter.TRACES,  # type: ignore
                    delta=1,
                    use_cache=True,
                )
                if not allowed:
                    raise HTTPException(
                        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                        detail="You have reached your monthly quota limit.",
                    )
            except HTTPException:
                raise
            except Exception:
                log.warning("[tracing] Soft quota check failed", exc_info=True)

        try:
            links = await self.service.create_trace(
                organization_id=UUID(request.state.organization_id),
                project_id=UUID(request.state.project_id),
                user_id=UUID(request.state.user_id),
                spans=trace_request.spans,
                traces=trace_request.traces,
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
        """Fetch a single trace by `trace_id`.

        Returns the trace as a `traces` map keyed by `trace_id` → span
        name. The response is empty when the trace is not in the current
        project. `trace_id` must be a 32-char hex UUID; any other format
        returns `400`.

        For flat-list retrieval across many traces, use
        `POST /tracing/spans/query` with `focus="span"`.
        """
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
        except TypeError as e:
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
    ) -> OTelLinksResponse:
        """Replace the spans of an existing trace.

        The path `trace_id` must match the `trace_id` in the payload.
        Mismatches return `400`. The payload must contain exactly one
        trace; submitting spans from more than one trace returns `400`.

        Edit is implemented as a re-ingest: the new spans are written
        through the same stream as `POST /tracing/spans/ingest`, and the
        `202 Accepted` response reports how many spans entered the stream.
        The worker reconciles the trace asynchronously.
        """
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

            try:
                allowed, _, _ = await check_entitlements(  # type: ignore
                    organization_id=UUID(request.state.organization_id),
                    key=Counter.TRACES,  # type: ignore
                    delta=1,
                    use_cache=True,
                )
                if not allowed:
                    raise HTTPException(
                        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                        detail="You have reached your monthly quota limit.",
                    )
            except HTTPException:
                raise
            except Exception:
                log.warning("[tracing] Soft quota check failed", exc_info=True)

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
        """Delete a trace and all its spans.

        Removes every span that shares this `trace_id` within the project.
        Returns `202 Accepted` with the links for the spans that were
        marked for deletion. `trace_id` must be a 32-char hex UUID.

        Deletion is not reversible. For soft-removal semantics on a
        single-trace simple annotation, prefer
        `DELETE /simple/traces/{trace_id}`.
        """
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
        except TypeError as e:
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
        """List distinct session IDs from span attributes.

        Returns the distinct values of `ag.session.id` across spans in the
        current project, in a windowed, cursor-paginated form. Use this to
        drive a session-picker UI before drilling into the spans of each
        session.

        The `realtime` flag controls the cursor field:

        - `false` or unset — paginate by a stable `first_active` cursor
          (safe to iterate under heavy write load).
        - `true` — paginate by `last_active`, reflecting ongoing activity
          but less stable between pages.

        The response includes a `windowing` cursor; pass it as `windowing.next`
        on the next call to continue.
        """
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
        """List distinct user IDs from span attributes.

        Returns the distinct values of `ag.user.id` across spans in the
        current project. Same pagination and `realtime` semantics as
        `POST /tracing/sessions/query`; pass the returned `windowing.next`
        cursor on subsequent calls.
        """
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
            "/analytics/query",
            self.query_analytics,
            methods=["POST"],
            operation_id="query_spans_analytics",
            status_code=status.HTTP_200_OK,
            response_model=AnalyticsResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/sessions/query",
            self.query_sessions,
            methods=["POST"],
            operation_id="query_spans_sessions",
            status_code=status.HTTP_200_OK,
            response_model=SessionIdsResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/users/query",
            self.query_users,
            methods=["POST"],
            operation_id="query_spans_users",
            status_code=status.HTTP_200_OK,
            response_model=UserIdsResponse,
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
    @suppress_exceptions(default=SpansResponse(), exclude=[HTTPException])
    async def query_spans(
        self,
        request: Request,
        spans_query_request: SpansQueryRequest = Body(
            default_factory=SpansQueryRequest
        ),
    ) -> SpansResponse:
        """Query spans as a flat list.

        Thin wrapper over the shared span-query backend that forces
        `focus = "span"`. Use this when you want a paged list of spans
        regardless of trace hierarchy — for example, to surface all LLM
        calls across traces or to stream spans into an external system.

        ## Request body

        - `filtering` — span-level conditions (fields on `Span` and
          `attributes` paths).
        - `windowing` — cursor pagination and time range (see
          [Query Pattern](/reference/api-guide/query-pattern#windowing)).
        - `query_ref`, `query_variant_ref`, `query_revision_ref` — resolve
          filtering and windowing from a saved query revision. If the
          revision's stored `formatting.focus` is `trace`, this endpoint
          returns `409` — call `POST /traces/query` for that revision.

        ## Response

        Returns `{count, spans}`. For the nested per-trace shape, call
        `POST /traces/query` or `POST /tracing/spans/query` with
        `focus="trace"` instead.
        """
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
                    "Use /traces/query for this query revision."
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
        """Fetch spans by known IDs.

        Point lookup endpoint. At least one of `trace_id` or `span_id`
        must be present. Both accept either repeated query params
        (`?trace_id=a&trace_id=b`) or a comma-separated single param
        (`?trace_ids=a,b`); results are deduplicated.

        Returns `400` when neither IDs nor trace IDs are supplied.
        For filter-based retrieval, use `POST /spans/query`.
        """
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
        """Fetch a single span by `trace_id` + `span_id`.

        Returns `{count: 1, span}` when found and `{count: 0}` otherwise.
        Both IDs are required path parameters. Use this to drill in on one
        span from a trace waterfall without pulling the full tree.
        """
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

    @intercept_exceptions()
    @suppress_exceptions(default=AnalyticsResponse(), exclude=[HTTPException])
    async def query_analytics(
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

        analytics_from_body = (None, None)
        try:
            body_json = await request.json()
            if body_json:
                analytics_from_body = parse_analytics_from_body_request(**body_json)
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
    @suppress_exceptions(default=SessionIdsResponse(), exclude=[HTTPException])
    async def query_sessions(
        self,
        request: Request,
        sessions_query_request: SessionsQueryRequest,
    ) -> SessionIdsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        session_ids, activity_cursor = await self.service.sessions(
            project_id=request.state.project_id,
            realtime=sessions_query_request.realtime,
            windowing=sessions_query_request.windowing,
        )
        windowing = self.service.build_next_windowing(
            input_windowing=sessions_query_request.windowing,
            result_ids=session_ids,
            activity_cursor=activity_cursor,
        )
        return SessionIdsResponse(
            count=len(session_ids) if session_ids else 0,
            session_ids=session_ids,
            windowing=windowing,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=UserIdsResponse(), exclude=[HTTPException])
    async def query_users(
        self,
        request: Request,
        users_query_request: UsersQueryRequest,
    ) -> UserIdsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        user_ids, activity_cursor = await self.service.users(
            project_id=request.state.project_id,
            realtime=users_query_request.realtime,
            windowing=users_query_request.windowing,
        )
        windowing = self.service.build_next_windowing(
            input_windowing=users_query_request.windowing,
            result_ids=user_ids,
            activity_cursor=activity_cursor,
        )
        return UserIdsResponse(
            count=len(user_ids) if user_ids else 0,
            user_ids=user_ids,
            windowing=windowing,
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
        self.deprecated_router = APIRouter()

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

        self.deprecated_router.add_api_route(
            "/ingest",
            self.ingest_traces,
            methods=["POST"],
            operation_id="ingest_traces",
            status_code=status.HTTP_202_ACCEPTED,
            response_model=TraceIdsResponse,
            response_model_exclude_none=True,
            deprecated=True,
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
            status_code=status.HTTP_202_ACCEPTED,
            response_model=TraceIdResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{trace_id}",
            self.edit_trace,
            methods=["PUT"],
            operation_id="edit_trace",
            status_code=status.HTTP_202_ACCEPTED,
            response_model=TraceIdResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{trace_id}",
            self.delete_trace,
            methods=["DELETE"],
            operation_id="delete_trace",
            status_code=status.HTTP_202_ACCEPTED,
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
        """Query traces as a list of canonical `Trace` records.

        Thin wrapper over the shared span-query backend that forces
        `focus = "trace"` and returns the list-shaped `Traces` payload
        (one entry per trace, each with its nested `spans` tree). Use this
        to build a table of runs, where each row is a trace.

        ## Request body

        - `filtering` — span-level conditions, same dialect as
          `POST /spans/query`. A trace matches when any of its spans
          matches.
        - `windowing` — cursor pagination and time range.
        - `query_ref`, `query_variant_ref`, `query_revision_ref` — resolve
          filters and windowing from a saved query revision. If the
          revision's stored `formatting.focus` is `span`, this endpoint
          returns `409` — call `POST /spans/query` instead.

        ## Response

        Returns `{count, traces: [...]}`. For the per-trace map shape
        keyed by `trace_id`, call `POST /tracing/spans/query` with
        `focus="trace"`.
        """
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
                    "Use /spans/query for this query revision."
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
    ) -> TraceIdResponse:
        """Create a single trace from the canonical `Trace` shape.

        Accepts one trace (`trace_id` plus a nested `spans` tree) and
        returns the resulting `trace_id`. The payload is internally
        normalized into the same ingest pipeline as
        `POST /tracing/spans/ingest`.

        Returns `202 Accepted`. The async write contract applies — see
        [Tracing — Async write
        contract](/reference/api-guide/tracing#async-write-contract-202).

        Use this when you want to operate on whole traces in the
        list-shaped `Trace` payload. For flat-list ingestion or multiple
        traces in one call, use `POST /traces/ingest` (plural).
        """
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

            try:
                allowed, _, _ = await check_entitlements(  # type: ignore
                    organization_id=UUID(request.state.organization_id),
                    key=Counter.TRACES,  # type: ignore
                    delta=1,
                    use_cache=True,
                )
                if not allowed:
                    raise HTTPException(
                        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                        detail="You have reached your monthly quota limit.",
                    )
            except HTTPException:
                raise
            except Exception:
                log.warning("[tracing] Soft quota check failed", exc_info=True)

        traces = self._extract_single_trace_map(trace_request)
        if not traces:
            raise HTTPException(status_code=400, detail="Missing trace")

        try:
            links = await self.service.create_trace(
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
        """Ingest a batch of traces in the canonical `Traces` list shape.

        Accepts a list of trace records (each `trace_id` plus nested
        `spans`). Internally normalized into the same pipeline as
        `POST /tracing/spans/ingest`. Use this when you already hold
        data in the `Traces` list shape — for example, replaying traces
        from another environment.

        Returns `202 Accepted` with the list of accepted `trace_ids`. See
        [Tracing — Async write
        contract](/reference/api-guide/tracing#async-write-contract-202)
        for what `count` means here.
        """
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

            try:
                delta = len(traces_request.traces) if traces_request.traces else 0
                if delta > 0:
                    allowed, _, _ = await check_entitlements(  # type: ignore
                        organization_id=UUID(request.state.organization_id),
                        key=Counter.TRACES,  # type: ignore
                        delta=delta,
                        use_cache=True,
                    )
                    if not allowed:
                        raise HTTPException(
                            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            detail="You have reached your monthly quota limit.",
                        )
            except HTTPException:
                raise
            except Exception:
                log.warning("[tracing] Soft quota check failed", exc_info=True)

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
    async def edit_trace(  # UPDATE
        self,
        request: Request,
        trace_request: TraceRequest,
        trace_id: str,
    ) -> TraceIdResponse:
        """Replace a trace's spans using the canonical `Trace` shape.

        Path `trace_id` must match the `trace_id` inside the payload's
        `trace.trace_id`. Mismatches return `400`. The payload must
        describe exactly one trace.

        Edit re-ingests the spans through the same stream as
        `POST /tracing/spans/ingest`. Returns `202 Accepted` once the
        spans are queued. The worker reconciles the trace asynchronously.
        """
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

            try:
                allowed, _, _ = await check_entitlements(  # type: ignore
                    organization_id=UUID(request.state.organization_id),
                    key=Counter.TRACES,  # type: ignore
                    delta=1,
                    use_cache=True,
                )
                if not allowed:
                    raise HTTPException(
                        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                        detail="You have reached your monthly quota limit.",
                    )
            except HTTPException:
                raise
            except Exception:
                log.warning("[tracing] Soft quota check failed", exc_info=True)

        traces = self._extract_single_trace_map(trace_request)
        if not traces:
            raise HTTPException(status_code=400, detail="Missing trace")

        if len(traces) != 1:
            raise HTTPException(
                status_code=400,
                detail="Trace payload must contain exactly one trace_id.",
            )

        try:
            normalized_path_trace_id = parse_trace_id_to_uuid(trace_id)
            normalized_payload_trace_id = parse_trace_id_to_uuid(list(traces.keys())[0])
        except (TypeError, ValueError) as e:
            raise HTTPException(
                status_code=400, detail="Invalid trace_id in path or payload."
            ) from e

        if normalized_path_trace_id != normalized_payload_trace_id:
            raise HTTPException(
                status_code=400,
                detail=f"Path trace_id '{trace_id}' does not match payload trace_id.",
            )

        try:
            links = await self.service.edit_trace(
                organization_id=UUID(request.state.organization_id),
                project_id=UUID(request.state.project_id),
                user_id=UUID(request.state.user_id),
                traces=traces,
            )
        except ValueError as e:
            detail = str(e)
            status_code = 429 if "quota exceeded" in detail.lower() else 400
            raise HTTPException(status_code=status_code, detail=detail) from e

        trace_ids = self._trace_ids_from_links(links)
        trace_id_out = trace_ids[0] if trace_ids else None
        return TraceIdResponse(
            count=1 if trace_id_out else 0,
            trace_id=trace_id_out,
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
        """Fetch multiple traces by known IDs.

        Point lookup endpoint. Accepts either repeated query params
        (`?trace_id=a&trace_id=b`) or a comma-separated single param
        (`?trace_ids=a,b`). Results are deduplicated. Returns `400` when
        no IDs are supplied. Use `POST /traces/query` for filter-based
        retrieval.
        """
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
        except TypeError as e:
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
        """Fetch a single trace by `trace_id` in the canonical `Trace` shape.

        Returns `{count: 1, trace}` when found and `{count: 0}` otherwise.
        `trace_id` must be a 32-char hex UUID; any other format returns
        `400`. The reserved path segments `query` and `ingest` return
        `405` to disambiguate from the sibling query/ingest endpoints.
        """
        if trace_id.lower() in {"query", "ingest"}:
            raise HTTPException(
                status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
                detail=f"GET /traces/{trace_id} is not supported.",
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
        except TypeError as e:
            raise HTTPException(status_code=400, detail="Invalid trace_id.") from e

        return TraceResponse(
            count=1 if trace else 0,
            trace=trace,
        )

    @intercept_exceptions()
    async def delete_trace(  # DELETE
        self,
        request: Request,
        trace_id: str,
    ) -> TraceIdResponse:
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
        except TypeError as e:
            raise HTTPException(
                status_code=400,
                detail="Invalid trace_id",
            ) from e

        trace_ids = self._trace_ids_from_links(links)
        trace_id_out = trace_ids[0] if trace_ids else None
        return TraceIdResponse(
            count=1 if trace_id_out else 0,
            trace_id=trace_id_out,
        )
