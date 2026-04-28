from typing import Union
from uuid import UUID

from fastapi import APIRouter, Request, status, Response, HTTPException

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions, suppress_exceptions

from oss.src.core.tracing.service import SimpleTracesService

from oss.src.apis.fastapi.traces.models import (
    SimpleTraceCreateRequest,
    SimpleTraceEditRequest,
    SimpleTraceQueryRequest,
    SimpleTraceResponse,
    SimpleTracesResponse,
    SimpleTraceLinkResponse,
)

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION


log = get_module_logger(__name__)


class SimpleTracesRouter:
    def __init__(
        self,
        *,
        simple_traces_service: SimpleTracesService,
    ):
        self.simple_traces_service = simple_traces_service

        self.router = APIRouter()

        self.router.add_api_route(
            "/",
            self.create_trace,
            methods=["POST"],
            operation_id="create_simple_trace",
            status_code=status.HTTP_202_ACCEPTED,
            response_model=SimpleTraceResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{trace_id}",
            self.fetch_trace,
            methods=["GET"],
            operation_id="fetch_simple_trace",
            status_code=status.HTTP_200_OK,
            response_model=SimpleTraceResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{trace_id}",
            self.edit_trace,
            methods=["PATCH"],
            operation_id="edit_simple_trace",
            status_code=status.HTTP_200_OK,
            response_model=SimpleTraceResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{trace_id}",
            self.delete_trace,
            methods=["DELETE"],
            operation_id="delete_simple_trace",
            status_code=status.HTTP_200_OK,
            response_model=SimpleTraceLinkResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/query",
            self.query_traces,
            methods=["POST"],
            operation_id="query_simple_traces",
            status_code=status.HTTP_200_OK,
            response_model=SimpleTracesResponse,
            response_model_exclude_none=True,
        )

    @intercept_exceptions()
    async def create_trace(
        self,
        request: Request,
        *,
        trace_create_request: SimpleTraceCreateRequest,
    ) -> SimpleTraceResponse:
        """Create a single-span "simple" trace.

        This endpoint is a higher-level helper for the common case of
        recording one self-contained event — an evaluator output, a human
        annotation, a feedback entry, a manually-logged inference. It
        creates one span under a fresh `trace_id` and returns the resulting
        handle.

        ## When to use this vs. `/tracing/spans/ingest`

        - **Use this endpoint** when you have a single payload to record
          with no internal hierarchy: evaluation results, human feedback,
          manual annotations, or a standalone completion. It takes care of
          `trace_id`/`span_id` generation, attribute namespacing, and link
          wiring for you.
        - **Use `POST /tracing/spans/ingest`** when you need multi-span
          traces (e.g. an agent run with nested tool calls and LLM spans),
          precise control over IDs, timings, or parent/child relationships,
          or when forwarding traces from another OTel-compatible source.

        ## Request body

        Send a `trace` object with:

        - `origin` — who produced the trace (`human`, `auto`, `custom`).
        - `kind` — intent (`adhoc`, `eval`, `play`).
        - `channel` — transport that produced it (`sdk`, `api`, `web`, `otlp`).
        - `data` — required dict carrying the actual payload (inputs,
          outputs, or evaluator results).
        - `tags`, `meta` — optional free-form dicts for filtering and
          metadata.
        - `references` — optional links to Agenta entities (application,
          variant, revision, evaluator, testset, etc.).
        - `links` — optional OTel-style links to other traces/spans.

        Use `PATCH /preview/tracing/traces/{trace_id}` to update fields
        later, `GET` to fetch, and `DELETE` to remove. See
        [Tracing — References and links](/reference/api-guide/tracing#references-and-entity-linking)
        for when to use `references` vs. `links`.
        """
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        trace = await self.simple_traces_service.create(
            organization_id=UUID(request.state.organization_id),
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            trace_create=trace_create_request.trace,
        )

        return SimpleTraceResponse(
            count=1 if trace else 0,
            trace=trace,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=SimpleTraceResponse(), exclude=[HTTPException])
    async def fetch_trace(
        self,
        request: Request,
        *,
        trace_id: str,
    ) -> Union[Response, SimpleTraceResponse]:
        """Fetch a single "simple" trace by `trace_id`.

        Returns the high-level `SimpleTrace` view (origin, kind, channel,
        data, references, links) rather than the raw OTel span shape. Use
        this for evaluation results, feedback entries, and annotations
        created via `POST /simple/traces/`. For the span-level view of the
        same trace, call `GET /tracing/traces/{trace_id}`.
        """
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        trace = await self.simple_traces_service.fetch(
            project_id=UUID(request.state.project_id),
            trace_id=trace_id,
        )

        return SimpleTraceResponse(
            count=1 if trace else 0,
            trace=trace,
        )

    @intercept_exceptions()
    async def edit_trace(
        self,
        request: Request,
        *,
        trace_id: str,
        #
        trace_edit_request: SimpleTraceEditRequest,
    ) -> SimpleTraceResponse:
        """Update an existing "simple" trace.

        Supplied fields overwrite the existing trace. Fields not present
        in the request body are left unchanged. `data` is required (the
        payload being recorded); `tags`, `meta`, `references`, and
        `links` are optional.

        This endpoint is intended for annotations and feedback entries,
        where the `data.outputs` is the part that typically gets revised.
        For span-level edits, use `PUT /tracing/traces/{trace_id}`.
        """
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        trace = await self.simple_traces_service.edit(
            organization_id=UUID(request.state.organization_id),
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            trace_id=trace_id,
            #
            trace_edit=trace_edit_request.trace,
        )

        return SimpleTraceResponse(
            count=1 if trace else 0,
            trace=trace,
        )

    @intercept_exceptions()
    async def delete_trace(
        self,
        request: Request,
        *,
        trace_id: str,
    ) -> SimpleTraceLinkResponse:
        """Delete a "simple" trace.

        Removes the single-span trace created via
        `POST /simple/traces/`. Returns the `(trace_id, span_id)` pair
        that was removed, for logging or downstream cleanup. Use
        `DELETE /tracing/traces/{trace_id}` when operating on a
        multi-span trace.
        """
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        trace_link = await self.simple_traces_service.delete(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            trace_id=trace_id,
        )

        return SimpleTraceLinkResponse(
            count=1 if trace_link else 0,
            link=trace_link,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=SimpleTracesResponse(), exclude=[HTTPException])
    async def query_traces(
        self,
        request: Request,
        *,
        trace_query_request: SimpleTraceQueryRequest,
    ) -> SimpleTracesResponse:
        """Query "simple" traces.

        Filter annotations and feedback by `origin`, `kind`, `channel`,
        `tags`, `meta`, `references`, and `links`. The shape of the
        request body is described in the
        [Simple Endpoints](/reference/api-guide/simple-endpoints#query-traces)
        guide, including the distinction between filtering via
        `trace.links` (inbound links on the trace) and the top-level
        `links` (batch GET by the trace's own IDs).

        Use this endpoint when building feedback or annotation UIs.
        For span-level queries across all trace types, use
        `POST /tracing/spans/query`.
        """
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        traces = await self.simple_traces_service.query(
            project_id=UUID(request.state.project_id),
            #
            trace_query=trace_query_request.trace,
            trace_links=trace_query_request.links,
            windowing=trace_query_request.windowing,
        )

        return SimpleTracesResponse(
            count=len(traces),
            traces=traces,
        )
