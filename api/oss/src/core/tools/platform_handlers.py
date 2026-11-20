"""Server-side handlers for reserved ``tools.agenta.*`` tool calls.

Handler-mode platform ops route through ``POST /tools/call`` like gateway tools, but their
business logic runs behind a registered Python handler instead of a provider adapter. The
module enforces three constraints:

- Only call_refs in ``PLATFORM_TOOL_HANDLERS`` dispatch; anything else in the reserved
  namespace is a 404 (`PlatformToolHandlerNotFound`), never a fall-through to a provider.
- A handler may demand an extra permission for specific argument shapes (the elevation
  policy on its registration); the API boundary checks it via
  :func:`required_elevated_permission` before dispatching.
- ``test_run`` refuses recursion (a child test_run marked via ``x-agenta-run-kind``) and
  confines revision deltas to the ``parameters`` tree so a caller can never redirect the
  server-side child invoke (or its minted credentials) to another endpoint.

Contracts (``TestRun*``) live in ``core/tools/dtos.py``; exceptions in
``core/tools/exceptions.py``.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional, Sequence, Tuple
from uuid import UUID

import httpx
from pydantic import ValidationError

from agenta.sdk.agents.platform.op_catalog import (
    LIST_AGENTS_DEFAULT_LIMIT,
    LIST_AGENTS_MAX_LIMIT,
    LIST_SESSIONS_DEFAULT_LIMIT,
    LIST_SESSIONS_MAX_LIMIT,
    READ_SESSION_DEFAULT_LIMIT,
    READ_SESSION_MAX_LIMIT,
    READ_SPANS_DEFAULT_LIMIT,
    READ_SPANS_MAX_LIMIT,
)
from agenta.sdk.engines.tracing.propagation import inject
from agenta.sdk.models.workflows import WorkflowServiceStatus

from oss.src.core.access.dtos import (
    RequestAccess,
    RequestCredentialKind,
    RunEnvelope,
)
from oss.src.core.access.permissions.types import Permission
from oss.src.core.sharing.admission import (
    CHILD_RUN_BOUNDARY,
    RunAdmission,
    session_allowed,
)
from oss.src.core.sharing.dtos import (
    OWNERLESS_PROJECT_POLICY,
    AgentReadScope,
    Visibility,
)
from oss.src.core.sharing.service import get_sharing_service
from oss.src.core.sharing.widening import SharedItemReaders, is_wider
from oss.src.core.sessions.session_results import (
    ERROR_MESSAGE_MAX_CHARS,
    ExecutionEnding,
    SessionToolStatus,
    execution_ending,
    header_name,
    render_marked_form,
    turn_endings,
)
from oss.src.core.workflows.builder_agent import BUILDER_AGENT_NAME, BUILDER_AGENT_SLUG
from oss.src.core.workflows.static_catalog import BUILDER_AGENT_ID, is_builder_agent
from oss.src.dbs.redis.sessions.contract import validate_session_id
from oss.src.core.apps.handlers import (
    CREATE_APP_CALL_REF,
    CREATE_APP_DEFAULT_TIMEOUT_MS,
    CREATE_APP_TOOL_DEFINITION,
    LIST_STARTERS_CALL_REF,
    LIST_STARTERS_DEFAULT_TIMEOUT_MS,
    LIST_STARTERS_TOOL_DEFINITION,
    handle_create_app,
    handle_list_starters,
)
from oss.src.core.shared.dtos import Reference, Windowing
from oss.src.core.tools.dtos import (
    TestRunExpectations,
    TestRunRequest,
    TestRunResolved,
    AgentError,
    PlatformHandlerResult,
    TestRunResponse,
    TestRunToolDigest,
    TestRunVerdict,
)
from oss.src.core.tools.exceptions import (
    PlatformToolHandlerError,
    PlatformToolHandlerNotFound,
    PlatformToolHandlerRefused,
    PlatformToolHandlerUnavailable,
)
from oss.src.core.tracing.dtos import (
    Condition,
    Filtering,
    Formatting,
    Focus,
    TracingQuery,
)
from oss.src.core.tracing.service import TracingService
from oss.src.core.workflows.dtos import (
    CommitWarning,
    WorkflowRevisionCommit,
    WorkflowRevisionDelta,
    WorkflowServiceBatchResponse,
    WorkflowServiceRequest,
    WorkflowServiceRequestData,
)
from oss.src.core.gateways.dtos import no_cookie_jar
from oss.src.core.gateways.egress import EgressRefusedError
from oss.src.core.workflows.service import WorkflowsService
from oss.src.utils.env import env
from oss.src.utils.web_links import agent_page_url

AGENTA_TOOL_CALL_REF_PREFIX = "tools.agenta."
TEST_RUN_CALL_REF = "tools.agenta.test_run"
# The read is bounded work against one revision; the commit is one transaction. Neither
# needs test_run's budget, which exists because it invokes a child workflow.
READ_CONFIG_DEFAULT_TIMEOUT_MS = 15_000
COMMIT_REVISION_DEFAULT_TIMEOUT_MS = 30_000
READ_CONFIG_CALL_REF = "tools.agenta.read_config"
COMMIT_REVISION_CALL_REF = "tools.agenta.commit_revision"
TEST_RUN_DEFAULT_TIMEOUT_MS = 120_000
TEST_RUN_SERVER_TIMEOUT_CEILING_MS = 120_000
TEST_RUN_RECURSION_HEADER = "x-agenta-run-kind"
TEST_RUN_RECURSION_VALUE = "test"

# A test_run delta may only touch this subtree of the revision data. Everything else
# (``url``, ``uri``, ``headers``, ``script``) changes where or how the child invoke
# executes, which would let an EDIT_WORKFLOWS caller point the server-side POST at an
# arbitrary endpoint.
_DELTA_ALLOWED_ROOT = "parameters"


def is_reserved_agenta_call_ref(call_ref: str) -> bool:
    return call_ref.startswith(AGENTA_TOOL_CALL_REF_PREFIX)


# ---------------------------------------------------------------------------
# test_run — run the target workflow variant once, headlessly, and digest the
# outcome (parse -> resolve revision -> invoke child -> digest -> verdict).
# ---------------------------------------------------------------------------


async def handle_test_run(
    *,
    arguments: Any,
    headers: Any,
    project_id: UUID,
    user_id: UUID,
    workflows_service: Optional[WorkflowsService],
    tracing_service: Optional[TracingService],
    envelope: RunEnvelope,
    run_admission: RunAdmission,
    timeout_ms: int = TEST_RUN_DEFAULT_TIMEOUT_MS,
) -> PlatformHandlerResult:
    if _header_value(headers, TEST_RUN_RECURSION_HEADER) == TEST_RUN_RECURSION_VALUE:
        raise PlatformToolHandlerRefused(
            "test_run refused: recursive test runs are not allowed."
        )
    if workflows_service is None:
        raise PlatformToolHandlerUnavailable(
            "test_run is not enabled on this deployment: workflows service is missing."
        )

    request = _parse_test_run_arguments(arguments)
    workflow_request = await _build_test_workflow_request(
        workflows_service=workflows_service,
        project_id=project_id,
        request=request,
        envelope=envelope,
        run_admission=run_admission,
    )

    meta = dict(workflow_request.meta or {})
    # Recursion marker mechanism: the child invoke body carries meta.run_kind="test". The
    # runner-side 5b half forwards that run kind to `/tools/call` as x-agenta-run-kind, and this
    # handler refuses that marked request before any child invoke can start.
    meta["run_kind"] = TEST_RUN_RECURSION_VALUE
    workflow_request.meta = meta

    credentials, service_url = await workflows_service._prepare_invoke(
        project_id=project_id,
        user_id=user_id,
        request=workflow_request,
        envelope=envelope,
    )
    if not service_url:
        return _failed_response("Workflow revision has no runnable service URL.")

    effective_timeout_ms = min(timeout_ms, TEST_RUN_SERVER_TIMEOUT_CEILING_MS)
    response = await _invoke_child_workflow(
        workflows_service=workflows_service,
        service_url=service_url,
        credentials=credentials,
        request=workflow_request,
        timeout_ms=effective_timeout_ms,
    )

    return await _digest_test_run_response(
        response=response,
        tracing_service=tracing_service,
        project_id=project_id,
        expectations=request.expectations,
    )


def _header_value(headers: Any, name: str) -> Optional[str]:
    if headers is None:
        return None
    if hasattr(headers, "get"):
        value = headers.get(name) or headers.get(name.lower())
        return str(value).lower() if value is not None else None
    return None


def _parse_test_run_arguments(arguments: Any) -> TestRunRequest:
    if isinstance(arguments, str):
        try:
            arguments = json.loads(arguments)
        except json.JSONDecodeError as e:
            raise PlatformToolHandlerError(
                "test_run arguments must be valid JSON."
            ) from e
    if not isinstance(arguments, dict):
        raise PlatformToolHandlerError("test_run arguments must be a JSON object.")
    try:
        request = TestRunRequest.model_validate(arguments)
    except ValidationError as e:
        raise PlatformToolHandlerError(f"Invalid test_run arguments: {e}") from e
    if request.delta is not None:
        _validate_delta_scope(request.delta)
    return request


def _validate_delta_scope(delta: WorkflowRevisionDelta) -> None:
    out_of_scope = sorted(set(delta.set or {}) - {_DELTA_ALLOWED_ROOT})
    if out_of_scope:
        raise PlatformToolHandlerRefused(
            "test_run delta may only set the revision's "
            f"'{_DELTA_ALLOWED_ROOT}' tree (got: {', '.join(out_of_scope)})."
        )
    for path in delta.remove or []:
        if path != _DELTA_ALLOWED_ROOT and not path.startswith(
            f"{_DELTA_ALLOWED_ROOT}."
        ):
            raise PlatformToolHandlerRefused(
                "test_run delta may only remove paths under the revision's "
                f"'{_DELTA_ALLOWED_ROOT}' tree (got: {path})."
            )


async def _build_test_workflow_request(
    *,
    workflows_service: WorkflowsService,
    project_id: UUID,
    request: TestRunRequest,
    envelope: RunEnvelope,
    run_admission: RunAdmission,
) -> WorkflowServiceRequest:
    workflow_request = WorkflowServiceRequest(
        references={
            "workflow_variant": Reference(id=request.target.workflow_variant_id),
        },
        data=WorkflowServiceRequestData(inputs={"messages": request.inputs.messages}),
    )

    # Resolving the committed revision first (even with a delta) is the target validation:
    # a delta can only ever be applied on top of a variant that exists in THIS project.
    # The admission resolves it (once, left on the request) and refuses an agent the
    # parent's principal may not run (`AdmissionDenied`), before any delta is applied.
    await run_admission.admit_request(
        envelope=envelope,
        session_id=None,
        project_id=project_id,
        request=workflow_request,
        boundary=CHILD_RUN_BOUNDARY,
    )
    # A no-op once the admission resolved the request (it carries the revision).
    await workflows_service._ensure_request_revision(
        project_id=project_id,
        request=workflow_request,
    )
    if not workflow_request.data or not workflow_request.data.revision:
        raise PlatformToolHandlerError(
            "test_run could not resolve the target workflow variant revision."
        )

    if request.delta is not None:
        from oss.src.core.workflows.change_set import (
            PARAMETERS_ONLY,
            ChangeSetError,
            Reason,
        )

        # `test_run` previews an AGENT's delta, so it gets the agent's transformations.
        try:
            resolution = await workflows_service._resolve_revision_delta(
                project_id=project_id,
                workflow_revision_commit=WorkflowRevisionCommit(
                    workflow_variant_id=request.target.workflow_variant_id,
                    delta=request.delta,
                ),
                # The engine enforces the parameters-only scope for every delta form;
                # `_validate_delta_scope` only gives `set`/`remove` an earlier message.
                scope_policy=PARAMETERS_ONLY,
                # A test run applies the delta in memory and stores nothing, so it carries
                # no base revision id. Without this an ordered delta could never be
                # previewed: the commit path requires that id, and it exists to protect a
                # write.
                preview=True,
                agent_context=True,
            )
        except ChangeSetError as e:
            if e.reason != Reason.OUT_OF_SCOPE:
                raise
            raise PlatformToolHandlerRefused(
                f"test_run delta may only change the revision's "
                f"'{_DELTA_ALLOWED_ROOT}' tree: {e}"
            ) from e
        resolved = resolution.commit
        if resolved.data is None:
            raise PlatformToolHandlerError(
                "test_run could not resolve the revision delta."
            )
        workflow_request.data.revision = {"data": resolved.data.model_dump(mode="json")}

    return workflow_request


async def _invoke_child_workflow(
    *,
    workflows_service: WorkflowsService,
    service_url: str,
    credentials: str,
    request: WorkflowServiceRequest,
    timeout_ms: int,
) -> WorkflowServiceBatchResponse:
    payload = request.model_dump(mode="json", exclude_none=True)
    timeout_s = max(timeout_ms / 1000, 0.001)
    headers = inject(
        {
            "Authorization": credentials,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
    )
    try:
        target_url, target_headers, extensions = await WorkflowsService._open_service(
            url=f"{service_url}/invoke",
            headers=headers,
        )
    except EgressRefusedError as e:
        return WorkflowServiceBatchResponse(
            status=WorkflowServiceStatus(
                code=400,
                message=f"Workflow service URL was refused: {e.relay_detail}",
            )
        )
    try:
        # Redirects are never followed: a 3xx would re-point a credentialed request at a
        # host nothing checked.
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_s),
            follow_redirects=False,
            cookies=no_cookie_jar(),
        ) as client:
            raw_response = await client.post(
                target_url,
                json=payload,
                headers=target_headers,
                extensions=extensions,
            )
    except httpx.TimeoutException:
        return WorkflowServiceBatchResponse(
            status=WorkflowServiceStatus(
                code=504,
                message=f"test_run timed out after {timeout_ms}ms.",
            )
        )
    except httpx.HTTPError as e:
        return WorkflowServiceBatchResponse(
            status=WorkflowServiceStatus(
                code=502, message=f"test_run invoke failed: {e}"
            )
        )

    body = None
    try:
        parsed = raw_response.json()
        if isinstance(parsed, dict):
            body = parsed
    except Exception:
        body = None

    return workflows_service._coerce_invoke_response(response=raw_response, body=body)


async def _digest_test_run_response(
    *,
    response: WorkflowServiceBatchResponse,
    tracing_service: Optional[TracingService],
    project_id: UUID,
    expectations: Optional[TestRunExpectations],
) -> PlatformHandlerResult:
    status_code = response.status.code if response.status else None
    status_message = response.status.message if response.status else None
    if status_code is not None and (status_code < 200 or status_code >= 300):
        return _failed_response(
            status_message or f"Workflow service returned status {status_code}.",
            trace_id=response.trace_id,
        )

    outputs = response.data.outputs if response.data else None
    if not isinstance(outputs, dict):
        return _failed_response(
            "Workflow service response did not include output data."
        )

    messages = (
        outputs.get("messages") if isinstance(outputs.get("messages"), list) else []
    )
    tools = _tools_from_messages(messages)
    approvals = _approvals_from_pending_interaction(outputs.get("pending_interaction"))

    spans = await _query_trace_spans(
        tracing_service=tracing_service,
        project_id=project_id,
        trace_id=response.trace_id,
    )
    _merge_span_observations(tools, spans)
    resolved = _resolved_from_spans(spans)
    verdict, reason = _verdict(
        tools=tools,
        expectations=expectations,
        invoke_stop_reason=outputs.get("stop_reason"),
    )

    # A `failed` VERDICT is still a successful tool call: the run happened and produced a
    # judgement. Only a run that never completed is a failure (see `_failed_response`).
    return PlatformHandlerResult(
        content=TestRunResponse(
            output=_last_assistant_content(messages),
            tools=list(tools.values()),
            approvals=approvals,
            resolved=resolved,
            trace_id=response.trace_id,
            verdict=verdict,
            verdict_reason=reason,
        )
    )


def _failed_response(
    message: str, *, trace_id: Optional[str] = None
) -> PlatformHandlerResult:
    """A run that never produced a digestible child response.

    No service URL, a timeout, a non-2xx, or a malformed body. This is not a verdict about
    the agent's configuration, so it is reported as a failure rather than as a result whose
    verdict happens to be `failed`.

    It carries the same envelope as every other failure a model can see. It used to return
    a near-empty `TestRunResponse` with `infra_failure=True`, which meant an error status
    on this seam sometimes carried an envelope and sometimes carried a test-run object, so
    nothing downstream could parse an error without first knowing which op produced it.
    """
    return PlatformHandlerResult.failure(
        AgentError(
            code="test_run_incomplete",
            message=message,
            # The request was never digested, so the identical one can succeed.
            retryable=True,
            next_step="Run the test again.",
            details={"trace_id": trace_id} if trace_id else None,
        )
    )


# --- transcript digest -----------------------------------------------------


def _last_assistant_content(messages: List[Any]) -> str:
    for message in reversed(messages):
        if not isinstance(message, dict) or message.get("role") != "assistant":
            continue
        content = message.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = []
            for part in content:
                if isinstance(part, str):
                    parts.append(part)
                elif isinstance(part, dict) and isinstance(part.get("text"), str):
                    parts.append(part["text"])
            return "".join(parts)
        if content is not None:
            return str(content)
    return ""


def _tools_from_messages(messages: List[Any]) -> Dict[str, TestRunToolDigest]:
    by_call_id: Dict[str, TestRunToolDigest] = {}
    by_name: Dict[str, TestRunToolDigest] = {}
    for message in messages:
        if not isinstance(message, dict) or message.get("role") != "tool":
            continue
        call_id = message.get("tool_call_id") or message.get("toolCallId")
        name = message.get("tool_name") or message.get("toolName")
        if name:
            digest = by_name.setdefault(name, TestRunToolDigest(name=name))
            if call_id:
                by_call_id[str(call_id)] = digest
            _apply_tool_result(digest, message)
            continue
        if call_id and str(call_id) in by_call_id:
            _apply_tool_result(by_call_id[str(call_id)], message)
    return by_name


def _apply_tool_result(digest: TestRunToolDigest, message: Dict[str, Any]) -> None:
    """Flags only accumulate: a tool called twice keeps an earlier error even if a later
    call succeeds, so a real failure can never be masked within one run."""
    if not _has_tool_result_content(message):
        return
    digest.returned = True
    digest.error = digest.error or bool(
        message.get("is_error") or message.get("isError")
    )


def _has_tool_result_content(message: Dict[str, Any]) -> bool:
    if "is_error" in message or "isError" in message:
        return True
    return "content" in message and message.get("content") not in (None, "")


def _approvals_from_pending_interaction(interaction: Any) -> List[str]:
    if not isinstance(interaction, dict):
        return []
    tool = interaction.get("tool")
    payload = (
        interaction.get("payload")
        if isinstance(interaction.get("payload"), dict)
        else {}
    )
    tool_call = (
        payload.get("toolCall") if isinstance(payload.get("toolCall"), dict) else {}
    )
    tool = (
        tool
        or payload.get("toolName")
        or tool_call.get("name")
        or tool_call.get("toolName")
    )
    return [str(tool)] if tool else []


# --- span digest -----------------------------------------------------------


async def _query_trace_spans(
    *,
    tracing_service: Optional[TracingService],
    project_id: UUID,
    trace_id: Optional[str],
) -> List[Any]:
    if tracing_service is None or not trace_id:
        return []

    query = TracingQuery(
        formatting=Formatting(focus=Focus.SPAN),
        filtering=Filtering(conditions=[Condition(field="trace_id", value=trace_id)]),
        windowing=Windowing(limit=1000),
    )
    for attempt, delay in enumerate((0.0, 0.05, 0.2)):
        if delay:
            await asyncio.sleep(delay)
        spans = await tracing_service.query_spans(project_id=project_id, query=query)
        if spans or attempt == 2:
            return list(spans or [])
    return []


def _merge_span_observations(
    tools: Dict[str, TestRunToolDigest], spans: List[Any]
) -> None:
    for span in spans:
        name = _tool_name_from_span(span)
        if not name:
            continue
        digest = tools.setdefault(name, TestRunToolDigest(name=name))
        if _span_returned(span):
            digest.returned = True
        if _span_error(span):
            digest.error = True


def _tool_name_from_span(span: Any) -> Optional[str]:
    attrs = _span_attrs(span)
    for key in ("gen_ai.tool.name", "tool.name", "ag.tool.name"):
        value = attrs.get(key)
        if value:
            return str(value)
    for path in (
        ("ag", "data", "inputs", "name"),
        ("ag", "data", "inputs", "tool_name"),
        ("ag", "data", "outputs", "tool_name"),
    ):
        value = _get_path(attrs, path)
        if value:
            return str(value)
    span_type = getattr(span, "span_type", None)
    span_type_value = getattr(span_type, "value", span_type)
    span_name = getattr(span, "span_name", None)
    if span_type_value == "tool" and span_name:
        return str(span_name)
    return None


def _span_returned(span: Any) -> bool:
    attrs = _span_attrs(span)
    outputs = _get_path(attrs, ("ag", "data", "outputs"))
    if outputs is None:
        outputs = attrs.get("ag.data.outputs")
    return outputs not in (None, "") and not _span_error(span)


def _span_error(span: Any) -> bool:
    status = getattr(span, "status_code", None)
    status_value = getattr(status, "value", status)
    if status_value == "STATUS_CODE_ERROR":
        return True
    attrs = _span_attrs(span)
    return bool(attrs.get("error") or _get_path(attrs, ("ag", "exception")))


def _resolved_from_spans(spans: List[Any]) -> TestRunResolved:
    for span in spans:
        attrs = _span_attrs(span)
        resolved = (
            _get_path(attrs, ("ag", "meta", "resolved"))
            or _get_path(attrs, ("ag", "data", "outputs", "resolved"))
            or attrs.get("ag.meta.resolved")
        )
        if isinstance(resolved, dict):
            return TestRunResolved(
                harness=resolved.get("harness"),
                model=resolved.get("model"),
                provider=resolved.get("provider"),
                connection_mode=resolved.get("connection_mode")
                or resolved.get("connectionMode"),
            )
        flat = {
            "harness": attrs.get("ag.resolved.harness"),
            "model": attrs.get("ag.resolved.model"),
            "provider": attrs.get("ag.resolved.provider"),
            "connection_mode": attrs.get("ag.resolved.connection_mode")
            or attrs.get("ag.resolved.connectionMode"),
        }
        if any(flat.values()):
            return TestRunResolved(**flat)
    return TestRunResolved()


def _span_attrs(span: Any) -> Dict[str, Any]:
    attrs = getattr(span, "attributes", None)
    if isinstance(attrs, dict):
        return attrs
    if hasattr(attrs, "model_dump"):
        return attrs.model_dump(mode="json", exclude_none=True)
    return {}


def _get_path(data: Dict[str, Any], path: tuple[str, ...]) -> Any:
    node: Any = data
    for part in path:
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


# --- verdict ---------------------------------------------------------------


def _verdict(
    *,
    tools: Dict[str, TestRunToolDigest],
    expectations: Optional[TestRunExpectations],
    invoke_stop_reason: Optional[Any],
) -> tuple[TestRunVerdict, Optional[str]]:
    for tool in tools.values():
        if tool.error:
            return "failed", f"tool '{tool.name}' returned an error"
    terminal_tool = expectations.terminal_tool if expectations else None
    if not terminal_tool:
        return "unconfirmed", "no terminal_tool expectation provided"
    terminal = tools.get(terminal_tool)
    if terminal is None:
        return "incomplete", f"terminal tool '{terminal_tool}' never ran"
    if terminal.returned:
        return "pass", None
    if invoke_stop_reason == "paused":
        return (
            "unconfirmed",
            f"terminal tool '{terminal_tool}' is waiting for approval",
        )
    return (
        "unconfirmed",
        f"terminal tool '{terminal_tool}' ran but did not return output",
    )


# ---------------------------------------------------------------------------
# read_config / commit_revision — the agent's own configuration, in-process
# ---------------------------------------------------------------------------
#
# These ran as two public routes (`/workflows/revisions/read-config` and
# `/workflows/revisions/commit/agent`). Every detail of both was agent-shaped, there was no
# second consumer, and their agent-only behavior leaked onto the general commit path. They
# are handlers now, reached through the one `/tools/call` seam like `test_run`, so the
# public API carries no agent-specific surface and one error contract covers everything.


class _Refusal(Exception):
    """An expected refusal the model can act on, carried as the canonical envelope."""

    def __init__(self, error: AgentError) -> None:
        super().__init__(error.message)
        self.error = error


class _ArgumentsRefused(_Refusal):
    """The MODEL authored these arguments, so the model is the one who can fix them.

    Refusals split by WHO CAUSED THEM. A malformed argument object is model-caused and
    model-fixable, so it comes back as the canonical envelope over HTTP 200 and reaches the
    model. A missing context binding is OUR bug: the runner fills it, so it stays a non-2xx
    that the runner redacts. Telling a model to fix something it cannot reach spends its
    turn and teaches it nothing.
    """

    def __init__(self, message: str, *, next_step: str) -> None:
        super().__init__(
            AgentError(
                code="invalid_arguments",
                message=message,
                retryable=False,
                next_step=next_step,
            )
        )


def _parse_arguments(arguments: Any) -> Dict[str, Any]:
    if isinstance(arguments, str):
        try:
            arguments = json.loads(arguments)
        except json.JSONDecodeError as e:
            raise _ArgumentsRefused(
                f"arguments are not valid JSON: {e.msg}",
                next_step="Send the arguments as a JSON object.",
            ) from e
    if not isinstance(arguments, dict):
        raise _ArgumentsRefused(
            f"arguments must be a JSON object, not {type(arguments).__name__}.",
            next_step="Send the arguments as a JSON object.",
        )
    return arguments


def _bound_variant_id(arguments: Dict[str, Any], *, key: str) -> UUID:
    """The variant the run is bound to, filled server-side from run context.

    Fails CLOSED. The binding is what stops an agent editing a different variant, so a
    missing one is refused rather than defaulted: a handler that guessed here would be a
    handler that edits whatever it happens to find.
    """
    target = arguments.get(key)
    return _bound_uuid(
        target.get("workflow_variant_id") if isinstance(target, dict) else None,
        field=f"{key}.workflow_variant_id",
    )


def _bound_uuid(raw: Any, *, field: str) -> UUID:
    """An id the runner binds from run context. Missing or malformed is refused, never
    guessed: a handler acts only on what the run is bound to."""
    if not raw:
        raise PlatformToolHandlerRefused(
            f"{field} is bound from the run and was missing."
        )
    try:
        return UUID(str(raw))
    except ValueError as e:
        raise PlatformToolHandlerRefused(f"{field} is not a valid id.") from e


async def handle_read_config(
    *,
    arguments: Any,
    headers: Any = None,
    project_id: UUID,
    user_id: UUID,
    workflows_service: Optional[WorkflowsService],
    tracing_service: Optional[TracingService] = None,
    timeout_ms: int = READ_CONFIG_DEFAULT_TIMEOUT_MS,
) -> PlatformHandlerResult:
    from oss.src.core.workflows.read_config import ReadConfigError

    if workflows_service is None:
        raise PlatformToolHandlerRefused("read_config is unavailable.")

    try:
        parsed = _parse_arguments(arguments)
    except _ArgumentsRefused as e:
        return PlatformHandlerResult.failure(e.error)
    variant_id = _bound_variant_id(parsed, key="target")
    target = parsed.get("target") or {}

    try:
        outcome = await workflows_service.read_workflow_revision_config(
            project_id=project_id,
            workflow_variant_id=variant_id,
            path=target.get("path"),
            max_bytes=parsed.get("max_bytes"),
        )
    except ReadConfigError as e:
        return PlatformHandlerResult.failure(AgentError(**e.to_detail()))

    # Whether the RUN is a draft belongs to the run, not to the configuration, and not to
    # the request either: it is bound server-side from run context, so an agent cannot
    # assert it about itself. The read always answers from the stored head; on a draft run
    # that is not what is executing, and the warning says so, which is what keeps the read
    # and the commit agreeing (the commit applies to the head too).
    return PlatformHandlerResult(
        content=_read_config_response(
            outcome, is_draft=bool(target.get("run_is_draft"))
        )
    )


def _read_config_response(outcome: Any, *, is_draft: bool):
    """The read answer, shared by `read_config` and `read_agent_config`."""
    from oss.src.apis.fastapi.workflows.models import (
        ReadConfigResponse,
        ReadConfigRevision,
    )
    from oss.src.core.workflows.read_config import draft_warning

    revision = outcome.revision
    warnings = list(outcome.warnings)
    if is_draft:
        warnings.append(draft_warning(getattr(revision, "version", None)))
    return ReadConfigResponse(
        revision=ReadConfigRevision(
            id=str(revision.id),
            version=getattr(revision, "version", None),
            workflow_variant_id=str(getattr(revision, "variant_id", "") or "") or None,
            created_at=str(getattr(revision, "created_at", "") or "") or None,
        ),
        base_revision_id=str(revision.id),
        is_draft=is_draft,
        path=outcome.path,
        value=outcome.value,
        bytes=outcome.bytes,
        warnings=warnings or None,
    )


def _revision_summary(revision: Any) -> Optional[Dict[str, Any]]:
    """The revision an agent tool wrote (or, on `no_change`, the head it kept), in the
    `revision` shape `read_agent_config` answers with."""
    if revision is None:
        return None
    return {"id": str(revision.id), "version": getattr(revision, "version", None)}


def _commit_payload_refusal(error: Exception) -> AgentError:
    return AgentError(
        code="commit_payload_invalid",
        message=str(error),
        retryable=False,
        next_step="Correct the fields named above and send the commit again.",
    )


async def _commit_as_agent(
    *,
    workflows_service: WorkflowsService,
    project_id: UUID,
    user_id: UUID,
    commit: Any,
    attribution: Optional[str] = None,
    first_agent_owner_user_id: Optional[UUID] = None,
) -> Any:
    """Commit a change an agent authored, under the agent's scope and transformations.

    The one commit path for an agent, its own configuration or another agent's: the scope,
    the selector normalization, the build-kit rejection, the stale-base check and the derived
    message all apply. Every expected refusal is raised as the canonical envelope, a commit
    that reports success without a revision included.

    Enforcement happens inside the engine, through `scope_policy`, because the engine sees
    the RESULT of an operation. A check here would see only what the agent named, and an
    operation that writes an ancestor object can change a refused path without naming it.
    """
    from oss.src.core.embeds.exceptions import (
        EmbedReferenceInconsistentError,
        NonEmbeddableWorkflowReferenceError,
    )
    from oss.src.core.git.types import CommitLockTimeout, VariantNotFound
    from oss.src.core.workflows.change_set import AGENT_COMMIT_SCOPE, ChangeSetError
    from oss.src.core.workflows.service import RevisionConflictError
    from oss.src.core.workflows.types import (
        AgentDriveError,
        InvalidAgentConfigurationError,
        InvalidAgentConnectionError,
        InvalidAgentHarnessError,
        InvalidAgentInstructionsError,
        StaticWorkflowReadOnly,
        StaticWorkflowSlug,
    )

    try:
        outcome = await workflows_service.commit_workflow_revision_checked(
            project_id=project_id,
            user_id=user_id,
            workflow_revision_commit=commit,
            scope_policy=AGENT_COMMIT_SCOPE,
            # An agent's commit: selector normalization, the build-kit rejection and the
            # derived message all apply here and nowhere else.
            agent_context=True,
            attribution=attribution,
            first_agent_owner_user_id=first_agent_owner_user_id,
        )
    except (
        AgentDriveError,
        ChangeSetError,
        InvalidAgentConfigurationError,
        InvalidAgentConnectionError,
        InvalidAgentHarnessError,
        InvalidAgentInstructionsError,
        RevisionConflictError,
    ) as e:
        raise _Refusal(AgentError(**e.to_detail())) from e
    except CommitLockTimeout as e:
        raise _Refusal(
            AgentError(
                code="commit_lock_timeout",
                message=e.message,
                # The write never happened, so the identical call can win the lock next
                # time. One of the few genuinely replayable failures.
                retryable=True,
                next_step=(
                    "Wait for the commit in flight to finish, then send this commit again."
                ),
            )
        ) from e
    except VariantNotFound as e:
        raise _Refusal(
            AgentError(
                code="workflow_variant_not_found",
                message=e.message,
                retryable=False,
            )
        ) from e
    except NonEmbeddableWorkflowReferenceError as e:
        raise _Refusal(
            AgentError(
                code="non_embeddable_reference",
                message=str(e),
                retryable=False,
                next_step=(
                    "Remove the embedded reference to that workflow and send the commit "
                    "again."
                ),
            )
        ) from e
    except EmbedReferenceInconsistentError as e:
        raise _Refusal(
            AgentError(
                code="inconsistent_embed_reference",
                message=e.message,
                retryable=False,
                next_step=(
                    "Look up the workflow by its slug, then send the embed with that "
                    "workflow's own id, or with the slug alone."
                ),
                details={"slug": e.slug} if e.slug else {},
            )
        ) from e
    except StaticWorkflowReadOnly as e:
        raise _Refusal(
            AgentError(
                **{**e.to_detail(), "next_step": StaticWorkflowReadOnly.AGENT_NEXT_STEP}
            )
        ) from e
    except StaticWorkflowSlug as e:
        raise _Refusal(
            AgentError(
                code="static_workflow_slug",
                message=str(e),
                retryable=False,
            )
        ) from e
    if outcome.status == "committed" and not outcome.revision:
        # The write layer reported success and produced nothing. Not retryable and no next
        # step: retrying a write whose state is unknown invites a duplicate commit.
        raise _Refusal(
            AgentError(
                code="commit_failed",
                message="The commit did not produce a revision.",
                retryable=False,
            )
        )
    return outcome


async def handle_commit_revision(
    *,
    arguments: Any,
    headers: Any = None,
    project_id: UUID,
    user_id: UUID,
    workflows_service: Optional[WorkflowsService],
    tracing_service: Optional[TracingService] = None,
    timeout_ms: int = COMMIT_REVISION_DEFAULT_TIMEOUT_MS,
    first_agent_owner_user_id: Optional[UUID] = None,
) -> PlatformHandlerResult:
    """The agent's commit. Confined to `parameters.agent`, minus the platform-owned paths.

    `first_agent_owner_user_id` is the owner the ownership rule gives the calling run
    (CONTRACT section 7): it owns the artifact when this commit writes its first agent
    revision.

    The confinement is a property of THIS ENTRY POINT, not of anything in the request, and
    that is what makes it unforgeable: the agent never picks the call_ref (it comes from the
    server-side op catalog), the runner makes the call from outside the sandbox, and the
    sandbox holds no credential. There is no field an agent can set to widen its own scope.

    Enforcement still happens inside the engine, through `scope_policy`, because the engine
    sees the RESULT of an operation. A check here would see only what the agent named, and
    an operation that writes an ancestor object can change a refused path without naming it.
    """
    from oss.src.core.workflows.dtos import WorkflowRevisionCommit

    if workflows_service is None:
        raise PlatformToolHandlerRefused("commit_revision is unavailable.")

    try:
        parsed = _parse_arguments(arguments)
    except _ArgumentsRefused as e:
        return PlatformHandlerResult.failure(e.error)
    variant_id = _bound_variant_id(parsed, key="workflow_revision")
    payload = dict(parsed.get("workflow_revision") or {})
    # The bound variant is the ONLY variant of the commit: its alias is set to the same id,
    # so a caller cannot have one variant checked and another written.
    payload["workflow_variant_id"] = str(variant_id)
    payload["variant_id"] = str(variant_id)
    # The agent is the variant's own, never one the arguments name.
    payload.pop("workflow_id", None)
    payload.pop("artifact_id", None)
    variant = await workflows_service.fetch_workflow_variant(
        project_id=project_id,
        workflow_variant_ref=Reference(id=variant_id),
    )
    variant_artifact_id = (
        getattr(variant, "workflow_id", None) or getattr(variant, "artifact_id", None)
        if variant is not None
        else None
    )
    if variant_artifact_id is not None:
        payload["workflow_id"] = str(variant_artifact_id)
        payload["artifact_id"] = str(variant_artifact_id)

    # A whole configuration carries every field the scope exists to protect, so the shape
    # is refused rather than filtered. The agent's tool only ever sends a delta.
    if payload.get("delta") is None:
        return PlatformHandlerResult.failure(
            AgentError(
                code="full_data_not_committable",
                message=(
                    "This tool commits a change to your configuration, not a whole "
                    "configuration."
                ),
                retryable=False,
                next_step=(
                    "Send the change as `delta`, targeting the fields you want to alter."
                ),
            )
        )

    # `description` here is the PERSISTED revision description, which the model never sets.
    # It shares its name with the ephemeral per-call note the runner strips before dispatch,
    # so one arriving means the runner did not strip it; storing it would put an ephemeral
    # note into the audit trail.
    payload.pop("description", None)

    try:
        commit = WorkflowRevisionCommit(**payload)
    except Exception as e:
        return PlatformHandlerResult.failure(_commit_payload_refusal(e))

    try:
        outcome = await _commit_as_agent(
            workflows_service=workflows_service,
            project_id=project_id,
            user_id=user_id,
            commit=commit,
            first_agent_owner_user_id=first_agent_owner_user_id,
        )
    except _Refusal as e:
        return PlatformHandlerResult.failure(e.error)

    revision = outcome.revision
    return PlatformHandlerResult(
        content={
            "status": outcome.status,
            "workflow_revision": revision.model_dump(mode="json") if revision else None,
            "warnings": [w.model_dump(mode="json") for w in outcome.warnings],
        },
        # A commit event evicts the warm session, so `no_change` must identify nothing:
        # it stored nothing, and throwing the session away for it is the cost the whole
        # no-change answer exists to avoid.
        committed_revision=(
            {
                "variant_id": str(revision.workflow_variant_id or revision.variant_id),
                "revision_id": str(revision.id),
                "version": revision.version,
            }
            if outcome.status == "committed" and revision
            else None
        ),
    )


# ---------------------------------------------------------------------------
# list_agents / read_agent_config / create_agent / edit_agent_config: the
# OTHER agents in the caller's project
# ---------------------------------------------------------------------------
#
# The project comes from the run's credential (`project_id` here), never from an argument, so
# no call can see or touch another project. The caller and its session are bound from run
# context, never read from the model: the self check needs the caller, and the attribution
# every write appends to the target's history needs both. Edits go through the same commit
# path as the agent's own `commit_revision`, scope and stale-base check included.

LIST_AGENTS_CALL_REF = "tools.agenta.list_agents"
READ_AGENT_CONFIG_CALL_REF = "tools.agenta.read_agent_config"
CREATE_AGENT_CALL_REF = "tools.agenta.create_agent"
EDIT_AGENT_CONFIG_CALL_REF = "tools.agenta.edit_agent_config"
# Not a model tool: the runner calls it when the approval gate of one of the two writes
# above opens, and puts the answer on the approval card.
PREVIEW_AGENT_CHANGE_CALL_REF = "tools.agenta.preview_agent_change"
# The handlers only the runner calls. Every other handler backs an op of the SDK catalog.
RUNNER_ONLY_CALL_REFS = frozenset({PREVIEW_AGENT_CHANGE_CALL_REF})

_FIND_AGENT_STEP = (
    "Call list_agents and pass the agent's `slug` or `id` as `agent`, not its name."
)
_SET_INSTRUCTIONS_EXAMPLE = (
    '{"operation": "set", "target": ["parameters","agent","instructions","agents_md"], '
    '"value": "..."}'
)
_BOUND_FIELDS = frozenset({"caller_agent_id", "caller_session_id"})
# The keys a whole configuration arrives in. Sent instead of operations, they are refused
# with the same code as self-edit's whole-configuration refusal.
_CONFIGURATION_KEYS = frozenset({"data", "parameters"})


def _bound_caller(arguments: Dict[str, Any]) -> UUID:
    """The calling agent's artifact id, bound from the run."""
    return _bound_uuid(arguments.get("caller_agent_id"), field="caller_agent_id")


def _bound_session(arguments: Dict[str, Any]) -> str:
    """The run's session, bound from the run. The write tools are offered only to a run with a
    session, so a missing one is refused like a missing caller, not written as unknown."""
    session_id = arguments.get("caller_session_id")
    if not isinstance(session_id, str) or not session_id.strip():
        raise PlatformToolHandlerRefused(
            "caller_session_id is bound from the run and was missing."
        )
    return session_id.strip()


def _agent_refusal(code: str, message: str, next_step: str) -> _Refusal:
    return _Refusal(
        AgentError(code=code, message=message, retryable=False, next_step=next_step)
    )


def _not_found(raw: str) -> _Refusal:
    return _agent_refusal(
        "agent_not_found",
        f"No agent in this project has the slug or id '{raw}'.",
        _FIND_AGENT_STEP,
    )


# -- the calling run of a session op (design D31) ---------------------------------------

RUN_CREDENTIAL_REQUIRED = "run_credential_required"


@dataclass(frozen=True)
class SessionCaller:
    """The calling run of a session op, a drive op or `resolve_gate`, read from its
    run credential and from nowhere else. These ops bind no caller id, so nothing in
    the arguments can name another calling agent or session."""

    envelope: RunEnvelope
    # The calling session (the `run_session_id` claim). A target is a `session_id`.
    run_session_id: str
    # The calling agent (the `run_agent_id` claim; None when the run names no agent).
    run_agent_id: Optional[UUID]


def _run_credential_required(message: str) -> _Refusal:
    return _Refusal(
        AgentError(code=RUN_CREDENTIAL_REQUIRED, message=message, retryable=False)
    )


async def session_caller_of(access: Optional[RequestAccess]) -> SessionCaller:
    """The one check every session op, drive op and `resolve_gate` passes before its
    handler runs. Refuses with `run_credential_required` unless the request carries a
    run credential with a `run_session_id` claim and the run authority may run that
    session now: the claim was checked at the mint, but a renewal copies it and a
    person can make the session private after the mint."""

    if (
        access is None
        or access.credential_kind != RequestCredentialKind.RUN_CREDENTIAL
        or access.envelope is None
        or not access.run_session_id
    ):
        raise _run_credential_required("Only an agent run can call session tools.")
    if not await session_allowed(
        envelope=access.envelope,
        session_id=access.run_session_id,
        action=Permission.RUN_SESSIONS,
    ):
        raise _run_credential_required(
            "This session is no longer open to the run's person."
        )
    return SessionCaller(
        envelope=access.envelope,
        run_session_id=access.run_session_id,
        run_agent_id=access.run_agent_id,
    )


async def caller_may(
    caller: SessionCaller, *, session_id: str, action: Permission
) -> bool:
    """Whether the caller's run authority has its own right on a target session:
    `VIEW_SESSIONS` to read, list or wait, `RUN_SESSIONS` to send or cancel. Checked
    for every target, whatever scope the op has."""

    if action not in (Permission.VIEW_SESSIONS, Permission.RUN_SESSIONS):
        raise ValueError(f"{action} is not a session target right.")
    return await session_allowed(
        envelope=caller.envelope, session_id=session_id, action=action
    )


def _reject_unknown_fields(
    arguments: Dict[str, Any], fields: Sequence[str], *, tool: str
) -> None:
    """One rule for every key the tool does not take, a forged `message` included.

    A key outside the schema would otherwise be dropped in silence and the call answered as a
    success: a top-level `instructions` would create the bare template, a `delta` copied from
    `commit_revision` would save nothing. A whole configuration keeps the code self-edit
    gives it.
    """
    unknown = sorted(set(arguments) - set(fields) - _BOUND_FIELDS)
    if not unknown:
        return
    names = ", ".join(f"`{key}`" for key in unknown)
    verb = "is not a field" if len(unknown) == 1 else "are not fields"
    listed = ", ".join(f"`{field}`" for field in fields[:-1]) + f" and `{fields[-1]}`"
    message = f"{names} {verb} of {tool}. Its fields are {listed}."
    next_step = (
        "Put every change in `operations`, at the top level, for example "
        f'"operations": [{_SET_INSTRUCTIONS_EXAMPLE}].'
    )
    if _CONFIGURATION_KEYS & set(unknown):
        raise _agent_refusal(
            "full_data_not_committable",
            f"{tool} saves a change to an agent's configuration, not a whole "
            f"configuration. {message}",
            next_step,
        )
    raise _ArgumentsRefused(message, next_step=next_step)


def _agent_reference(arguments: Dict[str, Any]) -> tuple[str, Reference]:
    raw = arguments.get("agent")
    if not isinstance(raw, str) or not raw.strip():
        raise _ArgumentsRefused(
            "`agent` is required: the slug or id of the agent.",
            next_step=_FIND_AGENT_STEP,
        )
    raw = raw.strip()
    try:
        return raw, Reference(id=UUID(raw))
    except ValueError:
        pass
    try:
        return raw, Reference(slug=raw)
    except ValidationError as e:
        # Most often the agent's NAME, which is not a slug.
        raise _not_found(raw) from e


async def _visible(
    *,
    workflows_service: WorkflowsService,
    project_id: UUID,
    read_scope: AgentReadScope,
    workflow_id: UUID,
) -> bool:
    """Whether the caller's read scope shows this agent: the rule `list_agents` applies."""
    return bool(
        await workflows_service.query_workflows(
            project_id=project_id,
            read_scope=read_scope,
            workflow_refs=[Reference(id=workflow_id)],
            include_archived=True,
        )
    )


async def _resolve_other_agent(
    *,
    workflows_service: WorkflowsService,
    project_id: UUID,
    read_scope: AgentReadScope,
    arguments: Dict[str, Any],
    caller_id: UUID,
    self_step: str,
) -> tuple[Any, Any]:
    """The named agent and its head, or a refusal the model can act on.

    The head is the latest revision of the oldest variant that is not archived, the rule
    `list_agents` applies. Refused: an unknown agent, a static platform workflow, the caller
    itself, an archived agent, and a workflow that is not an agent. The lookup is scoped to
    the caller's project, so an agent from another project is unknown. An agent the caller's
    read scope hides is unknown too, with the same answer. A static workflow is served from
    code with `is_static` set; a reserved slug the catalog does not hold is unknown.
    """
    raw, reference = _agent_reference(arguments)
    head = await workflows_service.fetch_workflow_revision(
        project_id=project_id,
        workflow_ref=reference,
        include_archived=False,
    )
    if head is not None and head.flags is not None and head.flags.is_static:
        raise _agent_refusal(
            "agent_is_static",
            f"'{raw}' is a built-in Agenta workflow, not an agent you can read or change.",
            _FIND_AGENT_STEP,
        )
    # An archived agent has no head, so the artifact is read with archived rows.
    workflow = await workflows_service.fetch_workflow(
        project_id=project_id,
        workflow_ref=(
            Reference(id=head.workflow_id)
            if head is not None and head.workflow_id is not None
            else reference
        ),
        include_archived=True,
    )
    if workflow is None:
        raise _not_found(raw)
    # Before the visibility check: a private agent on its owner's channel cannot see itself.
    # The answer names only what the model sent.
    if workflow.id == caller_id:
        raise _agent_refusal(
            "agent_is_self",
            f"'{raw}' is you. This tool works on other agents only.",
            self_step,
        )
    if not await _visible(
        workflows_service=workflows_service,
        project_id=project_id,
        read_scope=read_scope,
        workflow_id=workflow.id,
    ):
        raise _not_found(raw)
    if workflow.deleted_at is not None:
        raise _agent_refusal(
            "agent_is_archived",
            f"'{workflow.name or raw}' is archived. An archived agent cannot be read or "
            "changed.",
            "Pick an agent that is not archived: call list_agents.",
        )
    if head is None:
        raise _not_found(raw)
    if head.flags is None or not head.flags.is_agent:
        raise _agent_refusal(
            "workflow_is_not_agent",
            f"'{workflow.name or raw}' is a workflow, not an agent.",
            _FIND_AGENT_STEP,
        )
    return workflow, head


async def _allowed_on_agent(
    *, project_id: UUID, agent_id: UUID, action: Permission
) -> bool:
    """The request principal's decision for `action` on one agent, the decision a route
    makes before a per-agent read or write. The project permission is checked before
    dispatch; this adds the agent's own policy. Without a request principal it is refused."""
    from oss.src.core.access.context import get_request_access
    from oss.src.core.access.dtos import ResourceKind, ResourceRef
    from oss.src.core.access.service import get_access_service

    access = get_request_access()
    if access is None:
        return False
    decision = await get_access_service().check_request(
        access=access,
        action=action,
        project_id=project_id,
        resource=ResourceRef(kind=ResourceKind.AGENT, id=str(agent_id)),
    )
    return decision.allowed


def _agent_summary(
    workflow: Any, *, project_id: UUID, workspace_id: Optional[UUID]
) -> Dict[str, Any]:
    """The agent as every answer names it. `name` comes first, because it is what the model
    tells the person; `id` and `slug` are tool arguments. `url` opens the agent in the web
    app, and is left out when this deployment cannot build one."""
    summary = {"name": workflow.name, "id": str(workflow.id), "slug": workflow.slug}
    url = agent_page_url(
        web_url=env.agenta.web_url,
        workspace_id=workspace_id,
        project_id=project_id,
        agent_id=workflow.id,
    )
    if url:
        summary["url"] = url
    return summary


async def _attribution(
    *,
    workflows_service: WorkflowsService,
    project_id: UUID,
    read_scope: AgentReadScope,
    caller_id: UUID,
    session_id: str,
) -> str:
    """The "by agent ..., session ..." clause of a write's commit message.

    The run binds the caller, but a direct `/tools/call` sets it, so the caller's name is
    written only when the caller's read scope shows that agent: a private agent's name never
    reaches the answer or the history of another agent. A caller the scope hides (a private
    agent on its owner's channel, whose read scope has no owner) is named by id only.
    """
    from oss.src.core.workflows.commit_support import agent_attribution

    # A static agent (the builder) has no row, and every project sees it.
    static = workflows_service.static_catalog
    if static is not None and static.is_static_id(caller_id):
        revision = static.retrieve_revision(id=caller_id)
        return agent_attribution(
            agent_id=str(caller_id),
            agent_name=revision.name if revision else None,
            session_id=session_id,
        )

    caller = await workflows_service.fetch_workflow(
        project_id=project_id,
        workflow_ref=Reference(id=caller_id),
    )
    visible = caller is not None and await _visible(
        workflows_service=workflows_service,
        project_id=project_id,
        read_scope=read_scope,
        workflow_id=caller_id,
    )
    return agent_attribution(
        agent_id=str(caller_id),
        agent_name=caller.name if visible else None,
        session_id=session_id,
    )


_TEMPLATE_INSTRUCTIONS_WARNING = CommitWarning(
    code="template_instructions",
    message=(
        "The new agent still has the template's placeholder instructions. To give it its "
        "job, call edit_agent_config with "
        f"{_SET_INSTRUCTIONS_EXAMPLE} and the base_revision_id above."
    ),
    target=["parameters", "agent", "instructions", "agents_md"],
)


def _sets_instructions(operations: Optional[list]) -> bool:
    """Whether any operation writes the instructions: at or under them, or through a block
    that holds them with a value that carries them (a `merge` of `parameters.agent` that
    adds only `skills` leaves the template's instructions)."""
    instructions = ["parameters", "agent", "instructions"]
    for operation in operations or []:
        target = operation.get("target") if isinstance(operation, dict) else None
        if not isinstance(target, list):
            continue
        if target[: len(instructions)] == instructions:
            return True
        if instructions[: len(target)] == target:
            value = operation.get("value")
            for key in instructions[len(target) :]:
                value = value.get(key) if isinstance(value, dict) else None
            if value is not None:
                return True
    return False


def _operations(arguments: Dict[str, Any], *, required: bool) -> Optional[list]:
    operations = arguments.get("operations")
    if operations is None and not required:
        return None
    if not isinstance(operations, list) or not operations:
        raise _ArgumentsRefused(
            "`operations` must be a non-empty list of operations.",
            next_step=(
                f"Send the change as `operations`, for example [{_SET_INSTRUCTIONS_EXAMPLE}]."
            ),
        )
    return operations


async def _default_heads(
    *,
    workflows_service: WorkflowsService,
    project_id: UUID,
    read_scope: AgentReadScope,
    workflows: Sequence[Any],
) -> Dict[UUID, Any]:
    """Each workflow's default-variant head, the revision read and edit act on, in two queries.

    The default variant is the oldest one that is not archived, and the head is its latest
    revision that is not archived: the rule `fetch_workflow_revision` applies when it is given
    only the workflow and no archived rows. An archived agent's variants and revisions are not
    archived with it, so the rule holds for it too.
    """
    from oss.src.core.git.dtos import RevisionGrouping

    variants = await workflows_service.query_workflow_variants(
        project_id=project_id,
        read_scope=read_scope,
        workflow_refs=[Reference(id=workflow.id) for workflow in workflows],
        include_archived=False,
    )
    default_variants: Dict[UUID, Any] = {}
    for variant in sorted(variants, key=lambda v: (v.created_at, v.id)):
        default_variants.setdefault(variant.workflow_id, variant)
    if not default_variants:
        return {}
    heads = await workflows_service.query_workflow_revisions(
        project_id=project_id,
        read_scope=read_scope,
        workflow_variant_refs=[
            Reference(id=variant.id) for variant in default_variants.values()
        ],
        include_archived=False,
        grouping=RevisionGrouping(by="variant", get="latest"),
    )
    return {head.workflow_id: head for head in heads}


async def handle_list_agents(
    *,
    arguments: Any,
    headers: Any = None,
    project_id: UUID,
    user_id: UUID,
    workflows_service: Optional[WorkflowsService],
    tracing_service: Optional[TracingService] = None,
    timeout_ms: int = READ_CONFIG_DEFAULT_TIMEOUT_MS,
    workspace_id: Optional[UUID] = None,
    agent_read_scope: Optional[AgentReadScope] = None,
) -> PlatformHandlerResult:
    """The agents in the caller's project, one page at a time, in a fixed order.

    `agent_read_scope` is the caller's read scope: the project-visible agents and, for a
    person, their own private agents. Without one, the list holds the project-visible
    agents only.

    One row per agent, from the head `read_agent_config` and `edit_agent_config` act on: the
    default variant's latest revision. The scan runs over the project's applications, in
    batches, and keeps the ones whose head is flagged `is_agent` today, until the page holds
    `limit` agents or the applications run out. `cursor` is the last application scanned.
    Static platform workflows are served from code and never stored, so they never appear.
    """
    from oss.src.core.workflows.dtos import WorkflowArtifactQueryFlags, WorkflowQuery

    if workflows_service is None:
        raise PlatformToolHandlerRefused("list_agents is unavailable.")
    read_scope = agent_read_scope or AgentReadScope(owner_user_id=None)

    try:
        parsed = _parse_arguments(arguments)
        limit = parsed.get("limit", LIST_AGENTS_DEFAULT_LIMIT)
        if (
            isinstance(limit, bool)
            or not isinstance(limit, int)
            or not 1 <= limit <= LIST_AGENTS_MAX_LIMIT
        ):
            raise _ArgumentsRefused(
                f"`limit` must be a whole number from 1 to {LIST_AGENTS_MAX_LIMIT}.",
                next_step=(
                    f"Omit `limit` to get {LIST_AGENTS_DEFAULT_LIMIT} agents per page."
                ),
            )
        cursor = parsed.get("cursor")
        try:
            cursor = UUID(str(cursor)) if cursor else None
        except ValueError as e:
            raise _ArgumentsRefused(
                "`cursor` is not a cursor this tool returned.",
                next_step="Pass the `cursor` of the previous page, or omit `cursor`.",
            ) from e
        include_archived = parsed.get("include_archived") is True
    except _Refusal as e:
        return PlatformHandlerResult.failure(e.error)

    agents: List[Dict[str, Any]] = []
    more = True
    while more and len(agents) < limit:
        batch = await workflows_service.query_workflows(
            project_id=project_id,
            read_scope=read_scope,
            workflow_query=WorkflowQuery(
                flags=WorkflowArtifactQueryFlags(is_application=True)
            ),
            include_archived=include_archived,
            windowing=Windowing(limit=LIST_AGENTS_MAX_LIMIT, next=cursor),
        )
        more = len(batch) == LIST_AGENTS_MAX_LIMIT
        heads = (
            await _default_heads(
                workflows_service=workflows_service,
                project_id=project_id,
                read_scope=read_scope,
                workflows=batch,
            )
            if batch
            else {}
        )
        for index, workflow in enumerate(batch):
            cursor = workflow.id
            head = heads.get(workflow.id)
            if head is None or head.flags is None or not head.flags.is_agent:
                continue
            agent = {
                **_agent_summary(
                    workflow, project_id=project_id, workspace_id=workspace_id
                ),
                "description": workflow.description,
                "revision": _revision_summary(head),
                "updated_at": head.created_at.isoformat() if head.created_at else None,
            }
            if workflow.deleted_at is not None:
                agent["is_archived"] = True
            agents.append(agent)
            if len(agents) == limit:
                # Stopped inside the batch: what is left of it is the next page.
                more = more or index < len(batch) - 1
                break

    return PlatformHandlerResult(
        content={"agents": agents, "cursor": str(cursor) if more else None}
    )


async def handle_read_agent_config(
    *,
    arguments: Any,
    headers: Any = None,
    project_id: UUID,
    user_id: UUID,
    workflows_service: Optional[WorkflowsService],
    tracing_service: Optional[TracingService] = None,
    timeout_ms: int = READ_CONFIG_DEFAULT_TIMEOUT_MS,
    workspace_id: Optional[UUID] = None,
    agent_read_scope: Optional[AgentReadScope] = None,
) -> PlatformHandlerResult:
    """Another agent's latest saved configuration, with the same answer `read_config` gives.

    There is no draft warning: that warning is about the CALLER's run, and this reads an
    agent that is not running here. It answers from the head the target resolution already
    loaded, which is what `edit_agent_config` edits.
    """
    from oss.src.core.workflows.read_config import ReadConfigError
    from oss.src.core.workflows.service import read_revision_config

    if workflows_service is None:
        raise PlatformToolHandlerRefused("read_agent_config is unavailable.")
    read_scope = agent_read_scope or AgentReadScope(owner_user_id=None)

    try:
        parsed = _parse_arguments(arguments)
        caller_id = _bound_caller(parsed)
        workflow, head = await _resolve_other_agent(
            workflows_service=workflows_service,
            project_id=project_id,
            read_scope=read_scope,
            arguments=parsed,
            caller_id=caller_id,
            self_step="To read your own configuration, use read_config.",
        )
        # A read the agent's own policy refuses answers like an agent that is not there.
        if not await _allowed_on_agent(
            project_id=project_id,
            agent_id=workflow.id,
            action=Permission.VIEW_WORKFLOWS,
        ):
            raise _not_found(parsed["agent"].strip())
        path, max_bytes = parsed.get("path"), parsed.get("max_bytes")
        if path is not None and not isinstance(path, list):
            raise _ArgumentsRefused(
                "`path` must be a list of segments.",
                next_step='Send `path` as a list, e.g. ["parameters","agent","llm"].',
            )
        if max_bytes is not None and (
            isinstance(max_bytes, bool) or not isinstance(max_bytes, int)
        ):
            raise _ArgumentsRefused(
                "`max_bytes` must be a whole number.",
                next_step="Send `max_bytes` as a number, or omit it.",
            )
        try:
            outcome = read_revision_config(head, path=path, max_bytes=max_bytes)
        except ReadConfigError as e:
            raise _Refusal(AgentError(**e.to_detail())) from e
    except _Refusal as e:
        return PlatformHandlerResult.failure(e.error)

    # The `read_config` answer, led by the agent it is about.
    return PlatformHandlerResult(
        content={
            "agent": _agent_summary(
                workflow, project_id=project_id, workspace_id=workspace_id
            ),
            **_read_config_response(outcome, is_draft=False).model_dump(
                mode="json", exclude_none=True
            ),
        }
    )


async def handle_edit_agent_config(
    *,
    arguments: Any,
    headers: Any = None,
    project_id: UUID,
    user_id: UUID,
    workflows_service: Optional[WorkflowsService],
    tracing_service: Optional[TracingService] = None,
    timeout_ms: int = COMMIT_REVISION_DEFAULT_TIMEOUT_MS,
    workspace_id: Optional[UUID] = None,
    agent_read_scope: Optional[AgentReadScope] = None,
) -> PlatformHandlerResult:
    """Commit ordered operations to another agent's latest revision. Never deploys.

    The same commit as `commit_revision`: `AGENT_COMMIT_SCOPE`, the build-kit rejection, the
    stale-base check and the derived message. Only the target differs, and the message gains
    the attribution, because the owner of this history did not watch the change happen.
    """
    from oss.src.core.workflows.dtos import WorkflowRevisionCommit

    if workflows_service is None:
        raise PlatformToolHandlerRefused("edit_agent_config is unavailable.")
    read_scope = agent_read_scope or AgentReadScope(owner_user_id=None)

    try:
        parsed = _parse_arguments(arguments)
        caller_id = _bound_caller(parsed)
        session_id = _bound_session(parsed)
        _reject_unknown_fields(
            parsed,
            ("agent", "base_revision_id", "operations"),
            tool="edit_agent_config",
        )
        operations = _operations(parsed, required=True)
        base_revision_id = parsed.get("base_revision_id")
        if not base_revision_id:
            raise _ArgumentsRefused(
                "`base_revision_id` is required.",
                next_step=(
                    "Call read_agent_config for this agent and pass the "
                    "`base_revision_id` it returns."
                ),
            )
        workflow, head = await _resolve_other_agent(
            workflows_service=workflows_service,
            project_id=project_id,
            read_scope=read_scope,
            arguments=parsed,
            caller_id=caller_id,
            self_step="To change your own configuration, use commit_revision.",
        )
        if not await _allowed_on_agent(
            project_id=project_id,
            agent_id=workflow.id,
            action=Permission.EDIT_WORKFLOWS,
        ):
            raise _agent_refusal(
                "access_denied",
                f"You may not change '{workflow.name or workflow.slug}'. Nothing was saved.",
                "Tell the person that they need the right to edit this agent. Do not "
                "retry.",
            )
        try:
            commit = WorkflowRevisionCommit(
                workflow_variant_id=head.workflow_variant_id,
                base_revision_id=base_revision_id,
                delta={"operations": operations},
            )
        except Exception as e:
            raise _Refusal(_commit_payload_refusal(e)) from e
        outcome = await _commit_as_agent(
            workflows_service=workflows_service,
            project_id=project_id,
            user_id=user_id,
            commit=commit,
            attribution=await _attribution(
                workflows_service=workflows_service,
                project_id=project_id,
                read_scope=read_scope,
                caller_id=caller_id,
                session_id=session_id,
            ),
        )
    except _Refusal as e:
        return PlatformHandlerResult.failure(e.error)

    revision = outcome.revision
    return PlatformHandlerResult(
        content={
            "status": outcome.status,
            "agent": _agent_summary(
                workflow, project_id=project_id, workspace_id=workspace_id
            ),
            "revision": _revision_summary(revision),
            # The base the next edit of this agent sends: the head after this call.
            "base_revision_id": str(revision.id) if revision else None,
            "message": revision.message if revision else None,
            "warnings": [w.model_dump(mode="json") for w in outcome.warnings],
        },
        # Not `committed_revision`: that signal tells the CALLER's playground it committed
        # itself, and this is another agent.
        committed_other_agent_revision=outcome.status == "committed",
    )


# The engine's next steps for these reasons send the model to read the stored configuration
# again. A create has nothing stored to read, so it is told to fix the operation instead.
_READ_AGAIN_REASONS = frozenset(
    {"target_not_found", "target_type_mismatch", "item_not_found", "text_not_found"}
)


def _create_refusal(error: AgentError) -> AgentError:
    """A refusal from the operations of a create: the engine's next step, said of a create."""
    index = (error.details or {}).get("operation_index")
    if error.code in _READ_AGAIN_REASONS or not error.next_step:
        fix = "the operations" if index is None else f"operation {index}"
        step = f"Fix {fix} as the message says, then call create_agent again."
    else:
        step = error.next_step
    return error.model_copy(update={"next_step": f"No agent was created. {step}"})


async def handle_create_agent(
    *,
    arguments: Any,
    headers: Any = None,
    project_id: UUID,
    user_id: UUID,
    workflows_service: Optional[WorkflowsService],
    tracing_service: Optional[TracingService] = None,
    timeout_ms: int = COMMIT_REVISION_DEFAULT_TIMEOUT_MS,
    workspace_id: Optional[UUID] = None,
    first_agent_owner_user_id: Optional[UUID] = None,
    agent_read_scope: Optional[AgentReadScope] = None,
) -> PlatformHandlerResult:
    """A new agent from the "New agent" template, with the caller's operations applied.

    `first_agent_owner_user_id` is the owner the ownership rule gives the calling run, as
    for `commit_revision`: it owns the new agent.

    The service owns the composition (template, operations, slug, flags, first message) and
    the idempotent writes, keyed by the session and the arguments, so a retry of a create
    that stopped part of the way finishes the same agent. This handler reads the arguments,
    names the creator, and turns each failure into a refusal the model can act on.
    """
    from oss.src.core.embeds.exceptions import (
        EmbedReferenceInconsistentError,
        NonEmbeddableWorkflowReferenceError,
    )
    from oss.src.core.shared.exceptions import EntityCreationConflict
    from oss.src.core.workflows.change_set import ChangeSetError
    from oss.src.core.workflows.service import SimpleWorkflowsService
    from oss.src.core.workflows.types import (
        AgentDriveError,
        AgentReferenceUnresolved,
        InvalidAgentConfigurationError,
        InvalidAgentConnectionError,
        InvalidAgentHarnessError,
        InvalidAgentInstructionsError,
    )

    if workflows_service is None:
        raise PlatformToolHandlerRefused("create_agent is unavailable.")
    read_scope = agent_read_scope or AgentReadScope(owner_user_id=None)

    try:
        parsed = _parse_arguments(arguments)
        caller_id = _bound_caller(parsed)
        session_id = _bound_session(parsed)
        _reject_unknown_fields(
            parsed,
            ("name", "description", "visibility", "operations"),
            tool="create_agent",
        )
        name = parsed.get("name")
        if not isinstance(name, str) or not name.strip():
            raise _ArgumentsRefused(
                "`name` is required.",
                next_step='Send the new agent\'s name as `name`, e.g. "Invoice helper".',
            )
        description = parsed.get("description")
        if description is not None and not isinstance(description, str):
            raise _ArgumentsRefused(
                "`description` must be text.",
                next_step="Send one short sentence, or omit `description`.",
            )
        raw_visibility = parsed.get("visibility")
        try:
            visibility = (
                Visibility.PRIVATE
                if raw_visibility is None
                else Visibility(raw_visibility)
            )
        except ValueError as e:
            raise _ArgumentsRefused(
                "`visibility` must be `private` or `project`.",
                next_step=(
                    "Send `private` for an agent only the person sees, or `project` for "
                    "an agent the whole project sees."
                ),
            ) from e
        if visibility == Visibility.PRIVATE and first_agent_owner_user_id is None:
            # A run with no person (an API key) cannot own an agent, and an agent
            # with no owner is visible to the project. Refused, so a private request
            # never makes a project-visible agent.
            raise _ArgumentsRefused(
                "This run has no person to own a private agent. No agent was created.",
                next_step=(
                    "Send `visibility: project` to create an agent the whole project "
                    "sees, or create it from a chat with a person."
                ),
            )
        operations = _operations(parsed, required=False)
        attribution = await _attribution(
            workflows_service=workflows_service,
            project_id=project_id,
            read_scope=read_scope,
            caller_id=caller_id,
            session_id=session_id,
        )
        try:
            result = await SimpleWorkflowsService(
                workflows_service=workflows_service
            ).create_agent(
                project_id=project_id,
                user_id=user_id,
                name=name.strip(),
                description=description,
                visibility=visibility,
                operations=operations,
                message=f"Created {attribution}",
                session_id=session_id,
                read_scope=read_scope,
                first_agent_owner_user_id=first_agent_owner_user_id,
            )
        except AgentReferenceUnresolved as e:
            # The retry key names an agent this person can no longer see, or an archived
            # one: nothing about it is read, written or named.
            raise _agent_refusal(
                "create_conflict",
                "No agent was created: an earlier call with these arguments made an agent "
                "that is archived or that you can no longer see.",
                "Call create_agent again with a different name.",
            ) from e
        except EmbedReferenceInconsistentError as e:
            raise _agent_refusal(
                "inconsistent_embed_reference",
                e.message,
                "No agent was created. Look up the workflow by its slug, then send the "
                "embed with that workflow's own id, or with the slug alone.",
            ) from e
        except ValidationError as e:
            raise _Refusal(_create_refusal(_commit_payload_refusal(e))) from e
        except (
            AgentDriveError,
            ChangeSetError,
            InvalidAgentConfigurationError,
            InvalidAgentConnectionError,
            InvalidAgentHarnessError,
            InvalidAgentInstructionsError,
        ) as e:
            raise _Refusal(_create_refusal(AgentError(**e.to_detail()))) from e
        except NonEmbeddableWorkflowReferenceError as e:
            raise _agent_refusal(
                "non_embeddable_reference",
                str(e),
                "Remove the embedded reference to that workflow, then call create_agent "
                "again.",
            ) from e
        except EntityCreationConflict as e:
            # A write stopped part of the way. Every write is keyed by the session and the
            # arguments, so the same call finishes this agent rather than making another.
            raise _Refusal(
                AgentError(
                    code="create_failed",
                    message="The agent could not be created: a write stopped part of the way.",
                    retryable=True,
                    next_step=(
                        "Call create_agent again with the same arguments; it finishes the "
                        "same agent."
                    ),
                )
            ) from e
    except _Refusal as e:
        return PlatformHandlerResult.failure(e.error)

    created, warnings = result.workflow, list(result.warnings)
    if not _sets_instructions(operations):
        warnings.append(_TEMPLATE_INSTRUCTIONS_WARNING)
    return PlatformHandlerResult(
        content={
            "status": "created",
            "agent": _agent_summary(
                created, project_id=project_id, workspace_id=workspace_id
            ),
            "visibility": result.visibility.value,
            "revision": _revision_summary(result.revision),
            # The base the next edit of this agent sends.
            "base_revision_id": str(
                result.head.id if result.head else created.revision_id
            ),
            "message": result.message,
            "warnings": [w.model_dump(mode="json") for w in warnings],
        },
        committed_other_agent_revision=True,
    )


async def handle_preview_agent_change(
    *,
    arguments: Any,
    headers: Any = None,
    project_id: UUID,
    user_id: UUID,
    workflows_service: Optional[WorkflowsService],
    tracing_service: Optional[TracingService] = None,
    timeout_ms: int = READ_CONFIG_DEFAULT_TIMEOUT_MS,
    workspace_id: Optional[UUID] = None,
    agent_read_scope: Optional[AgentReadScope] = None,
) -> PlatformHandlerResult:
    """What a waiting `edit_agent_config` or `create_agent` call would change, saving nothing.

    Arguments: `call_ref` (of the waiting call) and `arguments` (its arguments, with the
    runner's bindings). The engine runs the operations the way the save would, on the
    base the call names (an edit) or on the new agent template (a create), and the answer is
    the preview of `change_preview.py`. An edit reads the target agent, so it needs the right
    to read it, like `read_agent_config`. A change set the engine refuses is a preview with
    `applies: false` (`applies` covers the change-set engine only: the save's later checks,
    such as the embed and runtime checks, can still refuse it); any other refusal (no such agent, a base that is not the head) is the
    canonical envelope, and the card then shows the proposed values alone.
    """
    from oss.src.core.workflows.change_preview import (
        build_change_preview,
        failed_change_preview,
    )
    from oss.src.core.workflows.change_set import AGENT_COMMIT_SCOPE, ChangeSetError
    from oss.src.core.workflows.commit_support import normalize_operations
    from oss.src.core.workflows.dtos import WorkflowRevisionCommit
    from oss.src.core.workflows.new_agent import new_agent_revision_data
    from oss.src.core.workflows.service import (
        RevisionConflictError,
        SimpleWorkflowsService,
    )

    if workflows_service is None:
        raise PlatformToolHandlerRefused("preview_agent_change is unavailable.")
    read_scope = agent_read_scope or AgentReadScope(owner_user_id=None)

    try:
        parsed = _parse_arguments(arguments)
        call_ref = parsed.get("call_ref")
        call = _parse_arguments(parsed.get("arguments"))
        if call_ref not in (EDIT_AGENT_CONFIG_CALL_REF, CREATE_AGENT_CALL_REF):
            raise _ArgumentsRefused(
                f"`call_ref` must be {EDIT_AGENT_CONFIG_CALL_REF} or "
                f"{CREATE_AGENT_CALL_REF}.",
                next_step="Send the call ref of the waiting call as `call_ref`.",
            )
        operations = _operations(call, required=call_ref == EDIT_AGENT_CONFIG_CALL_REF)
        operations = normalize_operations(operations or [])[0]
        base_revision = None
        try:
            if call_ref == CREATE_AGENT_CALL_REF:
                base = new_agent_revision_data()
                result, _, _ = SimpleWorkflowsService(
                    workflows_service=workflows_service
                ).compose_new_agent(operations)
            else:
                workflow, head = await _resolve_other_agent(
                    workflows_service=workflows_service,
                    project_id=project_id,
                    read_scope=read_scope,
                    arguments=call,
                    caller_id=_bound_caller(call),
                    self_step="To change your own configuration, use commit_revision.",
                )
                if not await _allowed_on_agent(
                    project_id=project_id,
                    agent_id=workflow.id,
                    action=Permission.VIEW_WORKFLOWS,
                ):
                    raise _not_found(call["agent"].strip())
                resolution = await workflows_service._resolve_revision_delta(
                    project_id=project_id,
                    workflow_revision_commit=WorkflowRevisionCommit(
                        workflow_variant_id=head.workflow_variant_id,
                        base_revision_id=call.get("base_revision_id"),
                        delta={"operations": operations},
                    ),
                    scope_policy=AGENT_COMMIT_SCOPE,
                    agent_context=True,
                )
                base_revision = resolution.head
                base = (
                    base_revision.data.model_dump(mode="json", exclude_none=True)
                    if base_revision and base_revision.data
                    else {}
                )
                result = resolution.commit.data.model_dump(
                    mode="json", exclude_none=True
                )
        except ChangeSetError as e:
            return PlatformHandlerResult(
                content=failed_change_preview(operations=operations, error=e)
            )
        except RevisionConflictError as e:
            raise _Refusal(AgentError(**e.to_detail())) from e
    except _Refusal as e:
        return PlatformHandlerResult.failure(e.error)

    return PlatformHandlerResult(
        content=build_change_preview(
            base=base,
            result=result,
            operations=operations,
            base_revision=_revision_summary(base_revision),
        )
    )


# ---------------------------------------------------------------------------
# list_sessions / read_session / read_session_spans: other sessions, read only
# ---------------------------------------------------------------------------
#
# The calling agent and the calling session come from the run credential (`session_caller`)
# and from nowhere else; the ops bind no caller id. One function, `session_scope_for`, sets
# which sessions the caller may list and read, and the model's filters only narrow it. Every
# target is checked again for the run authority's own `VIEW_SESSIONS`. A source that fewer
# people can read than the calling session is refused (`sharing_would_widen`) or left out of
# a list, because its text would land in the calling session's transcript. Every result that
# carries another session's text is the marked form of design D33, with that text inside
# delimited fields, and no result names an execution id.

LIST_SESSIONS_CALL_REF = "tools.agenta.list_sessions"
READ_SESSION_CALL_REF = "tools.agenta.read_session"
READ_SESSION_SPANS_CALL_REF = "tools.agenta.read_session_spans"
SESSION_READ_DEFAULT_TIMEOUT_MS = 15_000

SESSION_NOT_FOUND = "session_not_found"
SHARING_WOULD_WIDEN = "sharing_would_widen"
TURN_NOT_FOUND = "turn_not_found"

# The newest turns `read_session` lists; `totals` always covers every turn.
READ_SESSION_TURNS_LIMIT = 20
# Cuts of one step, as in the result file (design D8).
STEP_MESSAGE_MAX_CHARS = 8_000
STEP_INPUT_MAX_CHARS = 4_096
STEP_OUTPUT_MAX_CHARS = 16_384
# The runner cuts a tool result at 100 KB for the model (`services/runner/src/tools/
# callback.ts`). A read stops adding steps or spans below that, so the cursor it returns
# points at the first one left out and nothing is lost to the runner's cut.
SESSION_READ_BUDGET_BYTES = 80_000

_LIST_SESSIONS_FIELDS = (
    "agent",
    "origins",
    "calling_agent_id",
    "calling_session_id",
    "is_running",
    "search",
    "created_after",
    "created_before",
    "cursor",
    "limit",
)
_READ_SESSION_FIELDS = ("session_id", "cursor", "limit")
_READ_SESSION_SPANS_FIELDS = ("session_id", "turn_id", "cursor", "limit")

_READ_NOT_FOUND_STEP = "Check the id with `list_sessions`."
_READ_WIDEN_STEP = (
    "Ask the person to open the source in a session that only they can see."
)


@dataclass(frozen=True)
class SessionScope:
    """Which sessions a caller may list and read (design D23). The builder: every
    session its run authority can see (`calling_agent_ids` None). Any other agent: the
    sessions whose `calling_session.agent_id` is that agent, wherever they were started."""

    calling_agent_ids: Optional[frozenset]

    def admits(self, stream: Any) -> bool:
        if self.calling_agent_ids is None:
            return True
        calling = getattr(stream, "calling_session", None)
        return calling is not None and calling.agent_id in self.calling_agent_ids

    def narrowed(self, requested: Optional[UUID]) -> Optional[List[UUID]]:
        """The `calling_session.agent_ids` filter of a list: the forced scope and the
        model's filter together. An empty list matches nothing."""
        if self.calling_agent_ids is None:
            return [requested] if requested is not None else None
        if requested is None:
            return sorted(self.calling_agent_ids, key=str)
        return [requested] if requested in self.calling_agent_ids else []


def session_scope_for(caller: SessionCaller) -> SessionScope:
    """The one function that sets the list and read scope of the session tools."""

    if is_builder_agent(caller.agent_id):
        return SessionScope(calling_agent_ids=None)
    # A run that names no agent (an inline configuration) created no session.
    return SessionScope(
        calling_agent_ids=(
            frozenset({caller.agent_id}) if caller.agent_id is not None else frozenset()
        )
    )


def _session_not_found() -> _Refusal:
    return _agent_refusal(
        SESSION_NOT_FOUND,
        "No session with this id is visible to this agent.",
        _READ_NOT_FOUND_STEP,
    )


def _sharing_would_widen_read() -> _Refusal:
    return _agent_refusal(
        SHARING_WOULD_WIDEN,
        "Fewer people can read that session than this one, so its text would reach "
        "people who cannot read it.",
        _READ_WIDEN_STEP,
    )


def _turn_not_found() -> _Refusal:
    return _agent_refusal(
        TURN_NOT_FOUND,
        "That session has no turn with this `turn_id`.",
        "Take the `turn_id` from `read_session`.",
    )


def _refuse_unknown_arguments(
    arguments: Dict[str, Any], fields: Sequence[str], *, tool: str
) -> None:
    unknown = sorted(set(arguments) - set(fields))
    if unknown:
        names = ", ".join(f"`{key}`" for key in unknown)
        listed = ", ".join(f"`{field}`" for field in fields)
        raise _ArgumentsRefused(
            f"{names} {'is not a field' if len(unknown) == 1 else 'are not fields'} "
            f"of {tool}. Its fields are {listed}.",
            next_step=f"Call {tool} again with only its own fields.",
        )


def _session_id_argument(arguments: Dict[str, Any]) -> str:
    raw = arguments.get("session_id")
    if not isinstance(raw, str) or not raw.strip():
        raise _ArgumentsRefused(
            "`session_id` is required: the id of the session to read.",
            next_step=_READ_NOT_FOUND_STEP,
        )
    session_id = raw.strip()
    if not validate_session_id(session_id):
        raise _session_not_found()
    return session_id


def _limit_argument(arguments: Dict[str, Any], *, default: int, maximum: int) -> int:
    limit = arguments.get("limit", default)
    if (
        isinstance(limit, bool)
        or not isinstance(limit, int)
        or not 1 <= limit <= maximum
    ):
        raise _ArgumentsRefused(
            f"`limit` must be a whole number from 1 to {maximum}.",
            next_step=f"Omit `limit` to get {default} per page.",
        )
    return limit


def _invalid_cursor() -> _ArgumentsRefused:
    return _ArgumentsRefused(
        "`cursor` is not a cursor this tool returned.",
        next_step="Pass the `cursor` of the previous result, or omit `cursor`.",
    )


def _encode_windowing_cursor(windowing: Windowing) -> str:
    payload = {
        "next": str(windowing.next) if windowing.next else None,
        "newest": windowing.newest.isoformat() if windowing.newest else None,
        "oldest": windowing.oldest.isoformat() if windowing.oldest else None,
    }
    raw = json.dumps({k: v for k, v in payload.items() if v is not None})
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def _decode_windowing_cursor(cursor: Any) -> Dict[str, Any]:
    if not isinstance(cursor, str) or not cursor or len(cursor) > 512:
        raise _invalid_cursor()
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode()).decode())
        if not isinstance(payload, dict) or not payload.get("next"):
            raise ValueError("no next")
        return {
            "next": UUID(str(payload["next"])),
            "newest": (
                datetime.fromisoformat(payload["newest"])
                if payload.get("newest")
                else None
            ),
            "oldest": (
                datetime.fromisoformat(payload["oldest"])
                if payload.get("oldest")
                else None
            ),
        }
    except (ValueError, TypeError, UnicodeDecodeError, binascii.Error) as e:
        raise _invalid_cursor() from e


def _datetime_argument(arguments: Dict[str, Any], field: str) -> Optional[datetime]:
    raw = arguments.get(field)
    if raw is None:
        return None
    try:
        value = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError as e:
        raise _ArgumentsRefused(
            f"`{field}` must be a date and time in ISO 8601 form.",
            next_step=f"Send `{field}` like 2026-11-20T09:00:00Z.",
        ) from e
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _check_project(caller: SessionCaller, project_id: UUID) -> None:
    """Every read stays in the project of the run credential."""
    if caller.envelope.authority.project_id != project_id:
        raise _run_credential_required("Only an agent run can call session tools.")


async def _calling_readers(
    *, caller: SessionCaller, project_id: UUID
) -> SharedItemReaders:
    """Who can read the calling session. A calling session with no row reads as the
    widest item, so every private source is refused, never let through."""
    readers = await get_sharing_service().session_readers(
        project_id=project_id, session_id=caller.session_id
    )
    if readers is None:
        return SharedItemReaders(policy=OWNERLESS_PROJECT_POLICY, is_channel=True)
    return readers


async def _source_would_widen(
    *, project_id: UUID, calling: SharedItemReaders, session_id: str
) -> bool:
    """`is_wider(calling session, source)`: whether the source's text would reach
    people who cannot read the source. A source with no row is refused."""
    source = await get_sharing_service().session_readers(
        project_id=project_id, session_id=session_id
    )
    return source is None or is_wider(calling, source)


async def _readable_source(
    *,
    caller: SessionCaller,
    project_id: UUID,
    sessions_service: Any,
    session_id: str,
) -> Any:
    """The source session of a read, after the checks of design D23 in their order: a
    session outside the scope, unknown, or hidden from the run authority answers
    `session_not_found`, so the error never says that a hidden session exists; then a
    source that fewer people can read than the calling session answers
    `sharing_would_widen`."""

    if not await caller_may(
        caller, session_id=session_id, action=Permission.VIEW_SESSIONS
    ):
        raise _session_not_found()
    stream = await sessions_service.streams_service.fetch(
        project_id=project_id, session_id=session_id
    )
    if stream is None or not session_scope_for(caller).admits(stream):
        raise _session_not_found()
    if await _source_would_widen(
        project_id=project_id,
        calling=await _calling_readers(caller=caller, project_id=project_id),
        session_id=session_id,
    ):
        raise _sharing_would_widen_read()
    return stream


# -- the session's agent and origin ---------------------------------------------------------


def _reference_of(references: Optional[Sequence[Any]], key: str) -> Optional[Any]:
    for reference in references or ():
        if getattr(reference, "key", None) == key and getattr(reference, "id", None):
            return reference
    return None


def _agent_reference_of(references: Optional[Sequence[Any]]) -> Optional[Any]:
    return _reference_of(references, "workflow") or _reference_of(
        references, "application"
    )


async def _agent_names(
    *,
    workflows_service: Optional[WorkflowsService],
    project_id: UUID,
    caller: SessionCaller,
    agent_ids: Sequence[UUID],
) -> Dict[UUID, str]:
    """The names of the agents the run authority can see, one query for a page. An agent
    it cannot see gets no name."""

    names: Dict[UUID, str] = {}
    wanted = []
    for agent_id in dict.fromkeys(agent_ids):
        if is_builder_agent(agent_id):
            names[agent_id] = BUILDER_AGENT_NAME
        else:
            wanted.append(agent_id)
    if not wanted or workflows_service is None:
        return names
    read_scope = await get_sharing_service().agent_read_scope(
        principal=caller.envelope.authority.principal
    )
    workflows = await workflows_service.query_workflows(
        project_id=project_id,
        read_scope=read_scope,
        workflow_refs=[Reference(id=agent_id) for agent_id in wanted],
        include_archived=True,
    )
    for workflow in workflows:
        if workflow.id is not None and workflow.name:
            names[workflow.id] = workflow.name
    return names


def _agent_entry(
    references: Optional[Sequence[Any]], names: Dict[UUID, str]
) -> Optional[Dict[str, Any]]:
    reference = _agent_reference_of(references)
    if reference is None:
        return None
    entry = {"id": str(reference.id), "slug": reference.slug, "name": None}
    entry["name"] = names.get(reference.id)
    return {key: value for key, value in entry.items() if value is not None}


def _origin_entry(stream: Any) -> Dict[str, Any]:
    """The session origin with its object (design D22)."""
    origin = getattr(stream, "origin", None)
    entry: Dict[str, Any] = {
        "origin": (origin.value if origin is not None else "manual"),
    }
    calling = getattr(stream, "calling_session", None)
    if calling is not None:
        entry["calling_session"] = {
            "id": calling.id,
            "turn_id": calling.turn_id,
            "agent_id": str(calling.agent_id),
            "revision_id": str(calling.revision_id),
        }
    trigger = getattr(stream, "trigger", None)
    if trigger is not None:
        entry["trigger"] = {"id": str(trigger.id), "kind": trigger.kind.value}
    return entry


def _newest_status(
    *,
    stream: Any,
    ending: Optional[ExecutionEnding],
    waiting_for: Sequence[Dict[str, Any]],
) -> Optional[SessionToolStatus]:
    """The status of a session's newest turn: paused while it waits for a person,
    running while it runs or before its newest execution wrote its ending."""
    if waiting_for:
        return SessionToolStatus.paused
    if stream.flags.is_running or ending is None:
        return SessionToolStatus.running
    return ending.status


def _json_line(value: Dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


def _cut(text: Any, limit: int) -> Tuple[Optional[str], bool]:
    if text is None:
        return None, False
    if not isinstance(text, str):
        text = _json_line(text) if isinstance(text, (dict, list)) else str(text)
    if len(text) <= limit:
        return text, False
    return text[:limit], True


# -- list_sessions ----------------------------------------------------------------------


async def handle_list_sessions(
    *,
    arguments: Any,
    headers: Any = None,
    project_id: UUID,
    user_id: UUID,
    workflows_service: Optional[WorkflowsService],
    tracing_service: Optional[TracingService] = None,
    timeout_ms: int = SESSION_READ_DEFAULT_TIMEOUT_MS,
    session_caller: SessionCaller,
    sessions_service: Any,
) -> PlatformHandlerResult:
    """The sessions in the caller's scope that its run authority can see, newest first,
    one page at a time. A session that fewer people can read than the calling session
    is left out of the page."""

    from oss.src.core.sessions.dtos import (  # noqa: PLC0415
        SessionExpansion,
        SessionQuery,
        SessionQueryOptions,
    )
    from oss.src.core.sessions.streams.dtos import (  # noqa: PLC0415
        SessionStreamQueryFlags,
    )
    from oss.src.core.sessions.types import (  # noqa: PLC0415
        SessionCallingSessionQuery,
        SessionOrigin,
        SessionReference,
    )

    if sessions_service is None:
        raise PlatformToolHandlerRefused("list_sessions is unavailable.")
    caller = session_caller
    try:
        _check_project(caller, project_id)
        parsed = _parse_arguments(arguments)
        _refuse_unknown_arguments(parsed, _LIST_SESSIONS_FIELDS, tool="list_sessions")
        limit = _limit_argument(
            parsed, default=LIST_SESSIONS_DEFAULT_LIMIT, maximum=LIST_SESSIONS_MAX_LIMIT
        )

        turn_references = None
        if parsed.get("agent") is not None:
            raw, reference = _agent_reference(parsed)
            agent_id = await _visible_agent_id(
                workflows_service=workflows_service,
                project_id=project_id,
                caller=caller,
                reference=reference,
            )
            if agent_id is None:
                raise _not_found(raw)
            turn_references = [SessionReference(id=agent_id)]

        origins = parsed.get("origins")
        if origins is not None:
            try:
                origins = [SessionOrigin(value) for value in origins]
            except (TypeError, ValueError) as e:
                raise _ArgumentsRefused(
                    "`origins` must be a list of session origins.",
                    next_step=(
                        "Use the values manual, trigger, channel, api and "
                        "calling_session."
                    ),
                ) from e

        calling_agent_id = parsed.get("calling_agent_id")
        if calling_agent_id is not None:
            try:
                calling_agent_id = UUID(str(calling_agent_id))
            except ValueError as e:
                raise _ArgumentsRefused(
                    "`calling_agent_id` must be an agent id.",
                    next_step="Pass the `id` of the agent from `list_agents`.",
                ) from e
        calling_session_id = parsed.get("calling_session_id")
        if calling_session_id is not None and not (
            isinstance(calling_session_id, str)
            and validate_session_id(calling_session_id)
        ):
            raise _ArgumentsRefused(
                "`calling_session_id` must be a session id.",
                next_step="Pass a `session_id` that `list_sessions` returned.",
            )
        is_running = parsed.get("is_running")
        if is_running is not None and not isinstance(is_running, bool):
            raise _ArgumentsRefused(
                "`is_running` must be true or false.",
                next_step="Send `is_running` as a boolean, or omit it.",
            )
        search = parsed.get("search")
        if search is not None and not isinstance(search, str):
            raise _ArgumentsRefused(
                "`search` must be text.", next_step="Send `search` as a string."
            )

        windowing = Windowing(
            limit=limit,
            newest=_datetime_argument(parsed, "created_before"),
            oldest=_datetime_argument(parsed, "created_after"),
        )
        if parsed.get("cursor") is not None:
            cursor = _decode_windowing_cursor(parsed["cursor"])
            windowing = Windowing(
                limit=limit,
                next=cursor["next"],
                newest=cursor["newest"],
                oldest=cursor["oldest"],
            )
            if windowing.newest is None:
                raise _invalid_cursor()
    except _Refusal as e:
        return PlatformHandlerResult.failure(e.error)

    agent_ids = session_scope_for(caller).narrowed(calling_agent_id)
    if agent_ids is not None and not agent_ids:
        return PlatformHandlerResult(content=_render_session_list([], cursor=None))

    sharing = get_sharing_service()
    page = await sessions_service.query_sessions_page(
        project_id=project_id,
        read_scope=await sharing.session_read_scope(
            project_id=project_id, principal=caller.envelope.authority.principal
        ),
        query=SessionQuery(
            turn_references=turn_references,
            search=search.strip() or None if search else None,
            flags=(
                SessionStreamQueryFlags(is_running=is_running)
                if is_running is not None
                else None
            ),
            origins=origins,
            calling_session=(
                SessionCallingSessionQuery(
                    ids=[calling_session_id] if calling_session_id else None,
                    agent_ids=agent_ids,
                )
                if calling_session_id or agent_ids is not None
                else None
            ),
        ),
        options=SessionQueryOptions(expand=[SessionExpansion.last_message]),
        windowing=windowing,
    )
    sessions = list(page.sessions)
    next_cursor = None
    if len(sessions) >= limit and sessions:
        last = sessions[-1]
        activity = last.updated_at or last.created_at
        if last.id is not None and activity is not None:
            next_cursor = _encode_windowing_cursor(
                Windowing(next=last.id, newest=activity, oldest=windowing.oldest)
            )

    calling = await _calling_readers(caller=caller, project_id=project_id)
    kept = []
    for stream in sessions:
        if await _source_would_widen(
            project_id=project_id, calling=calling, session_id=stream.session_id
        ):
            continue
        kept.append(stream)

    endings = await asyncio.gather(
        *(
            _newest_ending(
                sessions_service=sessions_service,
                project_id=project_id,
                session_id=stream.session_id,
            )
            for stream in kept
        )
    )
    names = await _agent_names(
        workflows_service=workflows_service,
        project_id=project_id,
        caller=caller,
        agent_ids=[
            reference.id
            for reference in (_agent_reference_of(stream.references) for stream in kept)
            if reference is not None
        ],
    )
    items = []
    for stream, ending in zip(kept, endings):
        preview = getattr(stream, "last_message", None)
        status = _newest_status(stream=stream, ending=ending, waiting_for=())
        item = {
            "session_id": stream.session_id,
            "name": stream.name,
            "agent": _agent_entry(stream.references, names),
            **_origin_entry(stream),
            "status": status.value if status else None,
            "last_message": preview.text if preview is not None else None,
        }
        items.append({key: value for key, value in item.items() if value is not None})
    return PlatformHandlerResult(
        content=_render_session_list(items, cursor=next_cursor)
    )


def _render_session_list(items: List[Dict[str, Any]], *, cursor: Optional[str]) -> str:
    return render_marked_form(
        subject="List of sessions",
        lines=[("count", len(items)), ("cursor", cursor)],
        fields=[("sessions", "\n".join(_json_line(item) for item in items))],
    )


async def _visible_agent_id(
    *,
    workflows_service: Optional[WorkflowsService],
    project_id: UUID,
    caller: SessionCaller,
    reference: Reference,
) -> Optional[UUID]:
    """The id of the agent a `list_sessions` filter names, when the run authority can
    see it."""
    if reference.slug == BUILDER_AGENT_SLUG or is_builder_agent(reference.id):
        return BUILDER_AGENT_ID
    if workflows_service is None:
        return None
    workflows = await workflows_service.query_workflows(
        project_id=project_id,
        read_scope=await get_sharing_service().agent_read_scope(
            principal=caller.envelope.authority.principal
        ),
        workflow_refs=[reference],
        include_archived=True,
    )
    return workflows[0].id if workflows else None


async def _newest_ending(
    *, sessions_service: Any, project_id: UUID, session_id: str
) -> Optional[ExecutionEnding]:
    """The ending of the session's newest execution, from its ending records."""
    records_service = sessions_service.records_service
    if records_service is None:
        return None
    records = await records_service.get_ending_records(
        project_id=project_id, session_id=session_id
    )
    if not records:
        return None
    newest = records[-1].turn_id
    done = None
    error = None
    for record in records:
        if record.turn_id != newest:
            continue
        if record.record_type == "done":
            done = record.attributes or {}
        else:
            error = record.attributes or {}
    return execution_ending(done=done, error=error)


# -- read_session -------------------------------------------------------------------------


def _waiting_for(interactions: Sequence[Any]) -> List[Dict[str, Any]]:
    entries = []
    for interaction in interactions:
        request = interaction.data.request if interaction.data else None
        entry = {
            "interaction_id": str(interaction.id) if interaction.id else None,
            "kind": interaction.kind.value,
            "tool": request.tool if request is not None else None,
        }
        entries.append({key: value for key, value in entry.items() if value})
    return entries


def _usage_entry(turn: Any) -> Dict[str, Any]:
    usage = turn.usage
    return {
        "input_tokens": usage.input_tokens if usage else None,
        "output_tokens": usage.output_tokens if usage else None,
        "total_tokens": usage.total_tokens if usage else None,
        "cost": usage.cost if usage else None,
    }


def _totals(turns: Sequence[Any]) -> Dict[str, Any]:
    """Summed at read time over every turn. A turn with no value for a field is left
    out of that field's sum; a field no turn has stays null, never zero."""
    totals: Dict[str, Any] = {"turn_count": len(turns)}
    for field in ("input_tokens", "output_tokens", "total_tokens", "cost"):
        values = [
            getattr(turn.usage, field)
            for turn in turns
            if turn.usage is not None and getattr(turn.usage, field) is not None
        ]
        totals[field] = sum(values) if values else None
    return totals


def _revision_entry(references: Optional[Sequence[Any]]) -> Optional[Dict[str, Any]]:
    reference = _reference_of(references, "workflow_revision") or _reference_of(
        references, "application_revision"
    )
    if reference is None:
        return None
    entry = {"id": str(reference.id), "version": reference.version}
    return {key: value for key, value in entry.items() if value is not None}


def _turn_entry(
    turn: Any, *, ending: Optional[ExecutionEnding], status: Any
) -> Dict[str, Any]:
    context = turn.context
    entry = {
        "turn_id": str(turn.turn_id) if turn.turn_id else None,
        "turn_index": turn.turn_index,
        "revision": _revision_entry(turn.references),
        "start_time": turn.start_time.isoformat() if turn.start_time else None,
        "end_time": turn.end_time.isoformat() if turn.end_time else None,
        "status": status.value if status is not None else None,
        "stop_reason": ending.stop_reason if ending else None,
        "cancelled_by": (
            ending.cancelled_by.value if ending and ending.cancelled_by else None
        ),
        "error": ending.error if ending else None,
        **_usage_entry(turn),
        "trace_id": str(turn.trace_id) if turn.trace_id else None,
        "origin": context.origin.value if context is not None else None,
        "sender": (
            {"user_id": str(turn.sender.user_id)}
            if turn.sender is not None and turn.sender.user_id is not None
            else None
        ),
    }
    # Usage stays in the entry as null when unknown: null is not zero.
    return {
        key: value
        for key, value in entry.items()
        if value is not None
        or key in ("input_tokens", "output_tokens", "total_tokens", "cost")
    }


def _message_text(attributes: Dict[str, Any]) -> str:
    text = attributes.get("text")
    if isinstance(text, str):
        return text
    content = attributes.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            block["text"]
            for block in content
            if isinstance(block, dict) and isinstance(block.get("text"), str)
        )
    return ""


def _step_of(record: Any, *, turn_id: Optional[str]) -> Optional[Dict[str, Any]]:
    """One record as one step, cut as in the result file. The record's execution id
    never goes out; the step names its turn."""
    attributes = record.attributes or {}
    kind = record.record_type
    step: Dict[str, Any] = {"step": kind, "turn_id": turn_id}
    if kind == "message":
        text, cut = _cut(_message_text(attributes), STEP_MESSAGE_MAX_CHARS)
        step.update(
            role="assistant"
            if record.record_source == "agent"
            else record.record_source,
            text=text,
            is_truncated=cut or None,
        )
    elif kind == "tool_call":
        raw_input = attributes.get("rawInput")
        text, cut = _cut(
            raw_input if raw_input is not None else attributes.get("input"),
            STEP_INPUT_MAX_CHARS,
        )
        step.update(
            tool=attributes.get("name"),
            tool_call_id=attributes.get("id"),
            input=text,
            is_truncated=cut or None,
        )
    elif kind == "tool_result":
        text, cut = _cut(
            attributes.get("output", attributes.get("data")), STEP_OUTPUT_MAX_CHARS
        )
        step.update(
            tool_call_id=attributes.get("id"),
            output=text,
            is_error=bool(attributes.get("isError")) or None,
            is_truncated=cut or None,
        )
    elif kind in ("interaction_request", "interaction_response"):
        step.update(kind=attributes.get("kind"))
    elif kind == "error":
        message, _ = _cut(attributes.get("message"), ERROR_MESSAGE_MAX_CHARS)
        step.update(code=attributes.get("code"), message=message)
    elif kind == "done":
        step.update(stop_reason=attributes.get("stopReason"))
    else:
        return None  # thoughts, usage, data: not steps
    return {key: value for key, value in step.items() if value is not None}


def _cursor_offset(arguments: Dict[str, Any]) -> int:
    raw = arguments.get("cursor")
    if raw is None:
        return 0
    try:
        offset = int(str(raw))
    except ValueError as e:
        raise _invalid_cursor() from e
    if offset < 0:
        raise _invalid_cursor()
    return offset


async def handle_read_session(
    *,
    arguments: Any,
    headers: Any = None,
    project_id: UUID,
    user_id: UUID,
    workflows_service: Optional[WorkflowsService],
    tracing_service: Optional[TracingService] = None,
    timeout_ms: int = SESSION_READ_DEFAULT_TIMEOUT_MS,
    session_caller: SessionCaller,
    sessions_service: Any,
) -> PlatformHandlerResult:
    """One session: its provenance, the status of its newest turn and what it waits
    for, `totals` summed over every turn, the newest turns, and the steps after
    `cursor`. It reads a running session too; the records are stored as the turn runs."""

    from oss.src.core.sessions.interactions.dtos import (  # noqa: PLC0415
        SessionInteractionQuery,
        SessionInteractionStatus,
    )
    from oss.src.core.sessions.turns.dtos import SessionTurnQuery  # noqa: PLC0415

    if sessions_service is None or sessions_service.records_service is None:
        raise PlatformToolHandlerRefused("read_session is unavailable.")
    caller = session_caller
    try:
        _check_project(caller, project_id)
        parsed = _parse_arguments(arguments)
        _refuse_unknown_arguments(parsed, _READ_SESSION_FIELDS, tool="read_session")
        session_id = _session_id_argument(parsed)
        limit = _limit_argument(
            parsed, default=READ_SESSION_DEFAULT_LIMIT, maximum=READ_SESSION_MAX_LIMIT
        )
        offset = _cursor_offset(parsed)
        stream = await _readable_source(
            caller=caller,
            project_id=project_id,
            sessions_service=sessions_service,
            session_id=session_id,
        )
    except _Refusal as e:
        return PlatformHandlerResult.failure(e.error)

    records_service = sessions_service.records_service
    turns = sorted(
        await sessions_service.turns_service.query_turns(
            project_id=project_id, query=SessionTurnQuery(session_id=session_id)
        ),
        key=lambda turn: turn.turn_index,
    )
    turn_ids = [str(turn.turn_id) for turn in turns if turn.turn_id]
    endings, turn_of = turn_endings(
        turn_ids=turn_ids,
        ending_records=await records_service.get_ending_records(
            project_id=project_id, session_id=session_id
        ),
    )
    waiting_for = _waiting_for(
        await sessions_service.interactions_service.query_interactions(
            project_id=project_id,
            query=SessionInteractionQuery(
                session_id=session_id, status=SessionInteractionStatus.pending
            ),
        )
    )

    newest = turns[-1] if turns else None
    newest_id = str(newest.turn_id) if newest and newest.turn_id else None
    newest_ending = endings.get(newest_id) if newest_id else None
    newest_status = (
        _newest_status(stream=stream, ending=newest_ending, waiting_for=waiting_for)
        if newest is not None
        else None
    )
    listed = turns[-READ_SESSION_TURNS_LIMIT:]
    turn_entries = [
        _turn_entry(
            turn,
            ending=endings.get(str(turn.turn_id)) if turn.turn_id else None,
            status=(
                newest_status
                if turn is newest
                else (
                    endings[str(turn.turn_id)].status
                    if turn.turn_id and endings.get(str(turn.turn_id))
                    else None
                )
            ),
        )
        for turn in reversed(listed)
    ]

    def turn_of_record(execution_id: Optional[str]) -> Optional[str]:
        if not execution_id:
            return None
        if execution_id in turn_of:
            return turn_of[execution_id]
        if execution_id in turn_ids:
            return execution_id
        # The newest execution, which has written no ending yet.
        return newest_id if execution_id == stream.turn_id else None

    read_state = await records_service.get_read_state(
        project_id=project_id, session_id=session_id
    )
    page = await records_service.get_records_page(
        project_id=project_id,
        session_id=session_id,
        offset=offset,
        limit=limit,
        through_sequence=read_state.latest_sequence,
    )
    steps: List[str] = []
    used = 0
    consumed = 0
    for record in page.records:
        step = _step_of(record, turn_id=turn_of_record(record.turn_id))
        if step is not None:
            line = _json_line(step)
            size = len(line.encode()) + 1
            if steps and used + size > SESSION_READ_BUDGET_BYTES:
                break
            steps.append(line)
            used += size
        consumed += 1
    has_more = consumed < len(page.records) or page.next_offset is not None

    names = await _agent_names(
        workflows_service=workflows_service,
        project_id=project_id,
        caller=caller,
        agent_ids=[
            reference.id
            for reference in [_agent_reference_of(stream.references)]
            if reference is not None
        ],
    )
    agent = _agent_entry(stream.references, names)
    session_entry = {
        "session_id": session_id,
        "name": stream.name,
        "agent": agent,
        **_origin_entry(stream),
    }
    revision = _revision_entry(newest.references) if newest else None
    text = render_marked_form(
        subject=(
            f"Read of session {session_id} "
            f"({header_name((agent or {}).get('name') or (agent or {}).get('slug'))})"
        ),
        lines=[
            ("status", newest_status),
            ("turn_id", newest_id),
            (
                "revision",
                (
                    f"{revision.get('version')} ({revision['id']})"
                    if revision and revision.get("version")
                    else (revision or {}).get("id")
                ),
            ),
            (
                "cancelled_by",
                newest_ending.cancelled_by
                if newest_status == SessionToolStatus.cancelled and newest_ending
                else None,
            ),
            (
                "error.code",
                newest_ending.error["code"]
                if newest_ending
                and newest_ending.error
                and newest_status in (SessionToolStatus.failed, SessionToolStatus.lost)
                else None,
            ),
            ("waiting_for", waiting_for or None),
            ("totals", _totals(turns)),
            ("is_turn_list_truncated", len(turns) > READ_SESSION_TURNS_LIMIT),
            ("cursor", str(offset + consumed)),
            ("has_more_steps", has_more),
        ],
        fields=[
            (
                "session",
                _json_line({k: v for k, v in session_entry.items() if v is not None}),
            ),
            ("turns", "\n".join(_json_line(entry) for entry in turn_entries)),
            (
                "error.message",
                newest_ending.error["message"]
                if newest_ending
                and newest_ending.error
                and newest_status in (SessionToolStatus.failed, SessionToolStatus.lost)
                else None,
            ),
            ("steps", "\n".join(steps)),
        ],
    )
    return PlatformHandlerResult(content=text)


# -- read_session_spans -----------------------------------------------------------------


def _span_metric(span: Any, metric: str, key: str) -> Optional[float]:
    node = _span_attrs(span)
    for part in ("ag", "metrics", metric, "incremental", key):
        if not isinstance(node, dict):
            return None
        node = node.get(part)
    return (
        node if isinstance(node, (int, float)) and not isinstance(node, bool) else None
    )


def _span_entry(span: Any) -> Dict[str, Any]:
    status = getattr(span.status_code, "value", span.status_code)
    span_type = getattr(span.span_type, "value", span.span_type)
    name, _ = _cut(span.span_name, 200)
    error, _ = _cut(span.status_message, ERROR_MESSAGE_MAX_CHARS)

    def _time(value: Any) -> Optional[str]:
        return value.isoformat() if isinstance(value, datetime) else value

    def _int(value: Optional[float]) -> Optional[int]:
        return int(value) if value is not None else None

    entry = {
        "span_id": span.span_id,
        "parent_id": span.parent_id,
        "name": name,
        "type": span_type,
        "status": {
            "STATUS_CODE_OK": "ok",
            "STATUS_CODE_ERROR": "error",
        }.get(status, "unset"),
        "start_time": _time(span.start_time),
        "end_time": _time(span.end_time),
        "input_tokens": _int(_span_metric(span, "tokens", "prompt")),
        "output_tokens": _int(_span_metric(span, "tokens", "completion")),
        "total_tokens": _int(_span_metric(span, "tokens", "total")),
        "cost": _span_metric(span, "costs", "total"),
        "error": error if status == "STATUS_CODE_ERROR" else None,
    }
    return {key: value for key, value in entry.items() if value is not None}


async def handle_read_session_spans(
    *,
    arguments: Any,
    headers: Any = None,
    project_id: UUID,
    user_id: UUID,
    workflows_service: Optional[WorkflowsService],
    tracing_service: Optional[TracingService] = None,
    timeout_ms: int = SESSION_READ_DEFAULT_TIMEOUT_MS,
    session_caller: SessionCaller,
    sessions_service: Any,
) -> PlatformHandlerResult:
    """The spans of one turn of a session, newest first, one page at a time, with the
    scope of `read_session`. Spans land when the turn's trace completes, so a running
    turn answers `is_pending` and no spans."""

    from oss.src.core.sessions.turns.dtos import SessionTurnQuery  # noqa: PLC0415

    if sessions_service is None or tracing_service is None:
        raise PlatformToolHandlerRefused("read_session_spans is unavailable.")
    caller = session_caller
    try:
        _check_project(caller, project_id)
        parsed = _parse_arguments(arguments)
        _refuse_unknown_arguments(
            parsed, _READ_SESSION_SPANS_FIELDS, tool="read_session_spans"
        )
        session_id = _session_id_argument(parsed)
        raw_turn_id = parsed.get("turn_id")
        if not isinstance(raw_turn_id, str) or not raw_turn_id.strip():
            raise _ArgumentsRefused(
                "`turn_id` is required: the turn whose spans to read.",
                next_step="Take the `turn_id` from `read_session`.",
            )
        turn_id = raw_turn_id.strip()
        limit = _limit_argument(
            parsed, default=READ_SPANS_DEFAULT_LIMIT, maximum=READ_SPANS_MAX_LIMIT
        )
        cursor = (
            _decode_windowing_cursor(parsed["cursor"])
            if parsed.get("cursor") is not None
            else None
        )
        stream = await _readable_source(
            caller=caller,
            project_id=project_id,
            sessions_service=sessions_service,
            session_id=session_id,
        )
        turns = sorted(
            await sessions_service.turns_service.query_turns(
                project_id=project_id, query=SessionTurnQuery(session_id=session_id)
            ),
            key=lambda turn: turn.turn_index,
        )
        turn = next(
            (item for item in turns if item.turn_id and str(item.turn_id) == turn_id),
            None,
        )
        if turn is None:
            raise _turn_not_found()
    except _Refusal as e:
        return PlatformHandlerResult.failure(e.error)

    subject = f"Spans of turn {turn_id} of session {session_id}"
    if turn is turns[-1] and stream.flags.is_running:
        return PlatformHandlerResult(
            content=render_marked_form(
                subject=subject,
                lines=[
                    ("turn_id", turn_id),
                    ("is_pending", True),
                    (
                        "note",
                        "The turn still runs. Its spans arrive when the turn ends; "
                        "read them again then.",
                    ),
                ],
            )
        )

    async def page(size: int) -> Tuple[List[Any], Optional[Windowing]]:
        spans, next_windowing = await tracing_service.query_spans_page(
            project_id=project_id,
            query=TracingQuery(
                formatting=Formatting(focus=Focus.SPAN),
                filtering=Filtering(
                    conditions=[
                        Condition(field="session_id", value=session_id),
                        Condition(field="turn_id", value=turn_id),
                    ]
                ),
                windowing=Windowing(
                    limit=size,
                    next=cursor["next"] if cursor else None,
                    newest=cursor["newest"] if cursor else None,
                    oldest=cursor["oldest"] if cursor else None,
                ),
            ),
        )
        return list(spans or []), next_windowing

    spans, next_windowing = await page(limit)
    lines = [_json_line(_span_entry(span)) for span in spans]
    fits = 0
    used = 0
    for line in lines:
        used += len(line.encode()) + 1
        if fits and used > SESSION_READ_BUDGET_BYTES:
            break
        fits += 1
    if fits < len(lines):
        # Read the page again at the size that fits, so the cursor the span query
        # returns starts at the first span left out.
        spans, next_windowing = await page(fits)
        lines = [_json_line(_span_entry(span)) for span in spans]

    note = None
    if not spans and cursor is None:
        note = (
            "No span of this session carries this turn_id. A turn stored before spans "
            "carried turn ids cannot be read by turn."
        )
    return PlatformHandlerResult(
        content=render_marked_form(
            subject=subject,
            lines=[
                ("turn_id", turn_id),
                ("is_pending", False),
                ("count", len(spans)),
                (
                    "cursor",
                    _encode_windowing_cursor(next_windowing)
                    if next_windowing is not None and next_windowing.next
                    else None,
                ),
                ("note", note),
            ],
            fields=[("spans", "\n".join(lines))],
        )
    )


# ---------------------------------------------------------------------------
# Registry — the only handlers a reserved call_ref can reach, plus their
# per-handler policy (timeout budget, elevation). The API boundary consults
# ``required_elevated_permission`` before ``dispatch_platform_tool_handler``.
# ---------------------------------------------------------------------------

PlatformToolHandler = Callable[..., Awaitable[TestRunResponse]]


def _arguments_include_delta(arguments: Any) -> bool:
    if isinstance(arguments, str):
        try:
            arguments = json.loads(arguments)
        except json.JSONDecodeError:
            return False
    return isinstance(arguments, dict) and arguments.get("delta") is not None


@dataclass(frozen=True)
class PlatformToolHandlerRegistration:
    call_ref: str
    timeout_ms: int
    handler: PlatformToolHandler
    # Elevation policy: when ``requires_elevation(arguments)`` is true the caller must
    # also hold ``elevated_permission`` (checked at the API boundary, before dispatch).
    elevated_permission: Optional[Permission] = None
    requires_elevation: Optional[Callable[[Any], bool]] = None
    # Drive-backed handlers take the router's MountsService as `mounts_service`.
    needs_mounts: bool = False
    # Handlers that start a child run take its run envelope as `envelope`.
    needs_envelope: bool = False
    # Handlers that commit a revision take the calling run's agent owner as
    # `first_agent_owner_user_id`.
    needs_agent_owner: bool = False
    # Handlers that link to a page of the web app take the caller's `workspace_id`.
    needs_workspace: bool = False
    # Handlers that show or name an agent take the caller's `agent_read_scope`: they answer
    # only about agents it shows.
    needs_agent_read_scope: bool = False
    # Session ops, drive ops and `resolve_gate` take the calling run as `session_caller`
    # (`session_caller_of`); without one the call answers `run_credential_required`.
    needs_session_caller: bool = False
    # Handlers that read sessions take the router's SessionsService as `sessions_service`.
    needs_sessions: bool = False


PLATFORM_TOOL_HANDLERS: Dict[str, PlatformToolHandlerRegistration] = {
    TEST_RUN_CALL_REF: PlatformToolHandlerRegistration(
        call_ref=TEST_RUN_CALL_REF,
        timeout_ms=TEST_RUN_DEFAULT_TIMEOUT_MS,
        handler=handle_test_run,
        needs_envelope=True,
        # An in-memory delta edits the (uncommitted) revision, so it needs the same
        # permission as committing one.
        elevated_permission=Permission.EDIT_WORKFLOWS,
        requires_elevation=_arguments_include_delta,
    ),
    # Both are UNCONDITIONALLY elevated: `requires_elevation` is left unset, which the
    # boundary reads as "always". This is a deliberate change from the routes these
    # replace, and it is a tightening rather than a loosening: the routes required
    # VIEW_WORKFLOWS and EDIT_WORKFLOWS on their own, and RUN_TOOLS alone never reached
    # them. Keeping the requirement means a caller who can run tools still cannot read or
    # rewrite a configuration without the permission that governs configurations.
    READ_CONFIG_CALL_REF: PlatformToolHandlerRegistration(
        call_ref=READ_CONFIG_CALL_REF,
        timeout_ms=READ_CONFIG_DEFAULT_TIMEOUT_MS,
        handler=handle_read_config,
        elevated_permission=Permission.VIEW_WORKFLOWS,
    ),
    COMMIT_REVISION_CALL_REF: PlatformToolHandlerRegistration(
        call_ref=COMMIT_REVISION_CALL_REF,
        timeout_ms=COMMIT_REVISION_DEFAULT_TIMEOUT_MS,
        handler=handle_commit_revision,
        elevated_permission=Permission.EDIT_WORKFLOWS,
        needs_agent_owner=True,
    ),
    # Other agents in the project. The same permissions as the self pair: reading a
    # configuration needs VIEW_WORKFLOWS, writing one EDIT_WORKFLOWS, and RUN_TOOLS alone
    # reaches neither.
    LIST_AGENTS_CALL_REF: PlatformToolHandlerRegistration(
        call_ref=LIST_AGENTS_CALL_REF,
        timeout_ms=READ_CONFIG_DEFAULT_TIMEOUT_MS,
        handler=handle_list_agents,
        elevated_permission=Permission.VIEW_WORKFLOWS,
        needs_workspace=True,
        needs_agent_read_scope=True,
    ),
    READ_AGENT_CONFIG_CALL_REF: PlatformToolHandlerRegistration(
        call_ref=READ_AGENT_CONFIG_CALL_REF,
        timeout_ms=READ_CONFIG_DEFAULT_TIMEOUT_MS,
        handler=handle_read_agent_config,
        elevated_permission=Permission.VIEW_WORKFLOWS,
        needs_workspace=True,
        needs_agent_read_scope=True,
    ),
    CREATE_AGENT_CALL_REF: PlatformToolHandlerRegistration(
        call_ref=CREATE_AGENT_CALL_REF,
        timeout_ms=COMMIT_REVISION_DEFAULT_TIMEOUT_MS,
        handler=handle_create_agent,
        elevated_permission=Permission.EDIT_WORKFLOWS,
        needs_workspace=True,
        needs_agent_read_scope=True,
        needs_agent_owner=True,
    ),
    EDIT_AGENT_CONFIG_CALL_REF: PlatformToolHandlerRegistration(
        call_ref=EDIT_AGENT_CONFIG_CALL_REF,
        timeout_ms=COMMIT_REVISION_DEFAULT_TIMEOUT_MS,
        handler=handle_edit_agent_config,
        elevated_permission=Permission.EDIT_WORKFLOWS,
        needs_workspace=True,
        needs_agent_read_scope=True,
    ),
    # Reads the target like `read_agent_config` and writes nothing.
    PREVIEW_AGENT_CHANGE_CALL_REF: PlatformToolHandlerRegistration(
        call_ref=PREVIEW_AGENT_CHANGE_CALL_REF,
        timeout_ms=READ_CONFIG_DEFAULT_TIMEOUT_MS,
        handler=handle_preview_agent_change,
        elevated_permission=Permission.VIEW_WORKFLOWS,
        needs_agent_read_scope=True,
    ),
    # Agent HTML apps. Both touch the session's drive, so they demand what the mount routes
    # demand for the same act: writing a file needs EDIT_MOUNTS, reading one VIEW_MOUNTS.
    # RUN_TOOLS alone is not enough; an EE annotator holds it without EDIT_MOUNTS.
    CREATE_APP_CALL_REF: PlatformToolHandlerRegistration(
        call_ref=CREATE_APP_CALL_REF,
        timeout_ms=CREATE_APP_DEFAULT_TIMEOUT_MS,
        handler=handle_create_app,
        needs_mounts=True,
        elevated_permission=Permission.EDIT_MOUNTS,
    ),
    LIST_STARTERS_CALL_REF: PlatformToolHandlerRegistration(
        call_ref=LIST_STARTERS_CALL_REF,
        timeout_ms=LIST_STARTERS_DEFAULT_TIMEOUT_MS,
        handler=handle_list_starters,
        needs_mounts=True,
        elevated_permission=Permission.VIEW_MOUNTS,
    ),
    # Session reads. They demand what the session list and read routes demand,
    # VIEW_SESSIONS, and each target session is checked again for its own right.
    LIST_SESSIONS_CALL_REF: PlatformToolHandlerRegistration(
        call_ref=LIST_SESSIONS_CALL_REF,
        timeout_ms=SESSION_READ_DEFAULT_TIMEOUT_MS,
        handler=handle_list_sessions,
        elevated_permission=Permission.VIEW_SESSIONS,
        needs_session_caller=True,
        needs_sessions=True,
    ),
    READ_SESSION_CALL_REF: PlatformToolHandlerRegistration(
        call_ref=READ_SESSION_CALL_REF,
        timeout_ms=SESSION_READ_DEFAULT_TIMEOUT_MS,
        handler=handle_read_session,
        elevated_permission=Permission.VIEW_SESSIONS,
        needs_session_caller=True,
        needs_sessions=True,
    ),
    READ_SESSION_SPANS_CALL_REF: PlatformToolHandlerRegistration(
        call_ref=READ_SESSION_SPANS_CALL_REF,
        timeout_ms=SESSION_READ_DEFAULT_TIMEOUT_MS,
        handler=handle_read_session_spans,
        elevated_permission=Permission.VIEW_SESSIONS,
        needs_session_caller=True,
        needs_sessions=True,
    ),
}

# Model-facing definitions (name, description, JSON schema, context bindings, read_only) for
# the handlers whose op catalog entry is authored here rather than in the SDK. The SDK's
# ``PLATFORM_OPS`` entry for each must be a copy of this dict; ``read_only`` follows the
# catalog's convention (a read hint for the runner's ``allow_reads`` policy).
PLATFORM_TOOL_DEFINITIONS: Dict[str, Dict[str, Any]] = {
    CREATE_APP_CALL_REF: CREATE_APP_TOOL_DEFINITION,
    LIST_STARTERS_CALL_REF: LIST_STARTERS_TOOL_DEFINITION,
}


def required_envelope(*, call_ref: str) -> bool:
    """Whether this handler starts a run (and so is rechecked as a child run)."""
    registration = PLATFORM_TOOL_HANDLERS.get(call_ref)
    return bool(registration and registration.needs_envelope)


def required_agent_owner(*, call_ref: str) -> bool:
    """Whether this handler commits a revision (and so takes the calling run's agent
    owner)."""
    registration = PLATFORM_TOOL_HANDLERS.get(call_ref)
    return bool(registration and registration.needs_agent_owner)


def required_agent_read_scope(*, call_ref: str) -> bool:
    """Whether this handler shows or names agents (and so takes the caller's read scope)."""
    registration = PLATFORM_TOOL_HANDLERS.get(call_ref)
    return bool(registration and registration.needs_agent_read_scope)


def required_elevated_permission(
    *,
    call_ref: str,
    arguments: Any,
) -> Optional[Permission]:
    """The extra permission the caller must hold for this call, or ``None``.

    Unknown call_refs return ``None``; dispatch will reject them with a 404 anyway."""
    registration = PLATFORM_TOOL_HANDLERS.get(call_ref)
    if registration is None or registration.elevated_permission is None:
        return None
    if registration.requires_elevation is None or registration.requires_elevation(
        arguments
    ):
        return registration.elevated_permission
    return None


async def dispatch_platform_tool_handler(
    *,
    call_ref: str,
    arguments: Any,
    headers: Any,
    project_id: UUID,
    user_id: UUID,
    workflows_service: Optional[WorkflowsService],
    tracing_service: Optional[TracingService],
    run_admission: RunAdmission,
    mounts_service: Any = None,
    envelope: Optional[RunEnvelope] = None,
    agent_owner_user_id: Optional[UUID] = None,
    workspace_id: Optional[UUID] = None,
    agent_read_scope: Optional[AgentReadScope] = None,
    access: Optional[RequestAccess] = None,
    sessions_service: Any = None,
) -> PlatformHandlerResult:
    registration = PLATFORM_TOOL_HANDLERS.get(call_ref)
    if registration is None:
        raise PlatformToolHandlerNotFound(
            f"Unknown reserved Agenta tool handler: {call_ref}"
        )

    extra: Dict[str, Any] = (
        {"mounts_service": mounts_service} if registration.needs_mounts else {}
    )
    if registration.needs_agent_owner:
        extra["first_agent_owner_user_id"] = agent_owner_user_id
    if registration.needs_envelope:
        if envelope is None:
            raise PlatformToolHandlerRefused(
                "This tool starts a run and needs a run credential."
            )
        extra["envelope"] = envelope
        # A handler that starts a run admits it.
        extra["run_admission"] = run_admission
    if registration.needs_workspace:
        extra["workspace_id"] = workspace_id
    if registration.needs_agent_read_scope:
        extra["agent_read_scope"] = agent_read_scope
    if registration.needs_session_caller:
        try:
            extra["session_caller"] = await session_caller_of(access)
        except _Refusal as e:
            return PlatformHandlerResult.failure(e.error)
    if registration.needs_sessions:
        extra["sessions_service"] = sessions_service
    return await registration.handler(
        arguments=arguments,
        headers=headers,
        project_id=project_id,
        user_id=user_id,
        workflows_service=workflows_service,
        tracing_service=tracing_service,
        timeout_ms=registration.timeout_ms,
        **extra,
    )
