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
import json
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, List, Optional
from uuid import UUID

import httpx
from pydantic import ValidationError

from agenta.sdk.engines.tracing.propagation import inject
from agenta.sdk.models.workflows import WorkflowServiceStatus

from oss.src.core.access.permissions.types import Permission
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
    WorkflowRevisionCommit,
    WorkflowRevisionDelta,
    WorkflowServiceBatchResponse,
    WorkflowServiceRequest,
    WorkflowServiceRequestData,
)
from oss.src.core.workflows.service import WorkflowsService
from oss.src.utils.caching import invalidate_cache

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
) -> WorkflowServiceRequest:
    workflow_request = WorkflowServiceRequest(
        references={
            "workflow_variant": Reference(id=request.target.workflow_variant_id),
        },
        data=WorkflowServiceRequestData(inputs={"messages": request.inputs.messages}),
    )

    # Resolving the committed revision first (even with a delta) is the target validation:
    # a delta can only ever be applied on top of a variant that exists in THIS project.
    await workflows_service._ensure_request_revision(
        project_id=project_id,
        request=workflow_request,
    )
    if not workflow_request.data or not workflow_request.data.revision:
        raise PlatformToolHandlerError(
            "test_run could not resolve the target workflow variant revision."
        )

    if request.delta is not None:
        # `test_run` previews an AGENT's delta, so it gets the agent's transformations.
        resolution = await workflows_service._resolve_revision_delta(
            project_id=project_id,
            workflow_revision_commit=WorkflowRevisionCommit(
                workflow_variant_id=request.target.workflow_variant_id,
                delta=request.delta,
            ),
            # A test run applies the delta in memory and stores nothing, so it carries no
            # base revision id. Without this an ordered delta could never be previewed:
            # the commit path requires that id, and it exists to protect a write.
            preview=True,
            agent_context=True,
        )
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
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_s),
            follow_redirects=True,
        ) as client:
            raw_response = await client.post(
                f"{service_url}/invoke",
                json=payload,
                headers=headers,
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
    raw = target.get("workflow_variant_id") if isinstance(target, dict) else None
    if not raw:
        raise PlatformToolHandlerRefused(
            f"{key}.workflow_variant_id is bound from the run and was missing."
        )
    try:
        return UUID(str(raw))
    except ValueError as e:
        raise PlatformToolHandlerRefused(
            f"{key}.workflow_variant_id is not a valid id."
        ) from e


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
    from oss.src.core.workflows.read_config import ReadConfigError, draft_warning

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
    run_is_draft = bool(target.get("run_is_draft"))
    extra_warnings = (
        [draft_warning(getattr(outcome.revision, "version", None))]
        if run_is_draft
        else []
    )
    return PlatformHandlerResult(
        content=_read_config_response(
            outcome, is_draft=run_is_draft, extra_warnings=extra_warnings
        )
    )


def _read_config_response(outcome: Any, *, is_draft: bool, extra_warnings: list):
    """The read answer, shared by `read_config` and `read_agent_config`."""
    from oss.src.apis.fastapi.workflows.models import (
        ReadConfigResponse,
        ReadConfigRevision,
    )

    revision = outcome.revision
    warnings = list(outcome.warnings) + extra_warnings
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


def _full_data_refusal(message: str, *, change_field: str) -> AgentError:
    return AgentError(
        code="full_data_not_committable",
        message=message,
        retryable=False,
        next_step=(
            f"Send the change as `{change_field}`, targeting the fields you want to alter."
        ),
    )


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
) -> Any:
    """Commit a change an agent authored, under the agent's scope and transformations.

    The one commit path for an agent, its own configuration or another agent's: the scope,
    the selector normalization, the build-kit rejection, the stale-base check and the derived
    message all apply. Every expected refusal is raised as the canonical envelope.

    Enforcement happens inside the engine, through `scope_policy`, because the engine sees
    the RESULT of an operation. A check here would see only what the agent named, and an
    operation that writes an ancestor object can change a refused path without naming it.
    """
    from oss.src.core.embeds.exceptions import NonEmbeddableWorkflowReferenceError
    from oss.src.core.git.types import CommitLockTimeout, VariantNotFound
    from oss.src.core.workflows.change_set import AGENT_COMMIT_SCOPE, ChangeSetError
    from oss.src.core.workflows.service import RevisionConflictError
    from oss.src.core.workflows.types import (
        InvalidAgentHarnessError,
        InvalidAgentInstructionsError,
        StaticWorkflowSlug,
    )

    try:
        return await workflows_service.commit_workflow_revision_checked(
            project_id=project_id,
            user_id=user_id,
            workflow_revision_commit=commit,
            scope_policy=AGENT_COMMIT_SCOPE,
            # An agent's commit: selector normalization, the build-kit rejection and the
            # derived message all apply here and nowhere else.
            agent_context=True,
            attribution=attribution,
        )
    except (
        ChangeSetError,
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
    except StaticWorkflowSlug as e:
        raise _Refusal(
            AgentError(
                code="static_workflow_slug",
                message=str(e),
                retryable=False,
            )
        ) from e


async def handle_commit_revision(
    *,
    arguments: Any,
    headers: Any = None,
    project_id: UUID,
    user_id: UUID,
    workflows_service: Optional[WorkflowsService],
    tracing_service: Optional[TracingService] = None,
    timeout_ms: int = COMMIT_REVISION_DEFAULT_TIMEOUT_MS,
) -> PlatformHandlerResult:
    """The agent's commit. Confined to `parameters.agent`, minus the platform-owned paths.

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
    payload["workflow_variant_id"] = str(variant_id)

    # A whole configuration carries every field the scope exists to protect, so the shape
    # is refused rather than filtered. The agent's tool only ever sends a delta.
    if payload.get("delta") is None:
        return PlatformHandlerResult.failure(
            _full_data_refusal(
                "This tool commits a change to your configuration, not a whole "
                "configuration.",
                change_field="delta",
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
        )
    except _Refusal as e:
        return PlatformHandlerResult.failure(e.error)

    revision = outcome.revision
    if outcome.status == "committed" and not revision:
        # The write layer reported success and produced nothing. Not retryable and no next
        # step: retrying a write whose state is unknown invites a duplicate commit.
        return PlatformHandlerResult.failure(
            AgentError(
                code="commit_failed",
                message="The commit did not produce a revision.",
                retryable=False,
            )
        )

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
# list_agents / read_agent_config / create_agent / edit_agent_config — the
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
LIST_AGENTS_DEFAULT_LIMIT = 50
LIST_AGENTS_MAX_LIMIT = 100

_FIND_AGENT_STEP = "Call list_agents and pass one agent's `slug` or `id` as `agent`."
_SET_INSTRUCTIONS_EXAMPLE = (
    '{"operation": "set", "target": ["parameters","agent","instructions","agents_md"], '
    '"value": "..."}'
)
_BOUND_FIELDS = frozenset({"caller_agent_id", "caller_session_id"})
_CREATE_AGENT_FIELDS = frozenset({"name", "description", "operations"}) | _BOUND_FIELDS


def _bound_caller(arguments: Dict[str, Any]) -> UUID:
    """The calling agent's artifact id, bound from the run. Fails closed like the variant."""
    raw = arguments.get("caller_agent_id")
    if not raw:
        raise PlatformToolHandlerRefused(
            "caller_agent_id is bound from the run and was missing."
        )
    try:
        return UUID(str(raw))
    except ValueError as e:
        raise PlatformToolHandlerRefused("caller_agent_id is not a valid id.") from e


def _bound_session(arguments: Dict[str, Any]) -> Optional[str]:
    raw = arguments.get("caller_session_id")
    return str(raw) if raw else None


def _agent_refusal(code: str, message: str, next_step: str) -> _Refusal:
    return _Refusal(
        AgentError(code=code, message=message, retryable=False, next_step=next_step)
    )


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
        raise _agent_refusal(
            "agent_not_found",
            f"No agent in this project has the slug or id '{raw}'.",
            "Call list_agents and pass the agent's `slug` or `id`, not its name.",
        ) from e


async def _resolve_other_agent(
    *,
    workflows_service: WorkflowsService,
    project_id: UUID,
    arguments: Dict[str, Any],
    caller_id: UUID,
    self_step: str,
) -> tuple[Any, Any]:
    """The named agent and its latest revision, or a refusal the model can act on.

    Refused: an unknown name, a static platform workflow, the caller itself, an archived
    agent, and a workflow that is not an agent. The lookup is scoped to the caller's
    project, so an agent from another project is simply unknown.
    """
    from oss.src.core.workflows.types import is_static_workflow_slug

    raw, reference = _agent_reference(arguments)
    head = (
        None
        if is_static_workflow_slug(reference.slug)
        else await workflows_service.fetch_workflow_revision(
            project_id=project_id,
            workflow_ref=reference,
            include_archived=True,
        )
    )
    if is_static_workflow_slug(reference.slug) or (
        head is not None and head.flags is not None and head.flags.is_static
    ):
        raise _agent_refusal(
            "agent_is_static",
            f"'{raw}' is a built-in Agenta workflow, not an agent you can read or change.",
            _FIND_AGENT_STEP,
        )
    if head is None or head.workflow_id is None:
        raise _agent_refusal(
            "agent_not_found",
            f"No agent in this project has the slug or id '{raw}'.",
            _FIND_AGENT_STEP,
        )
    if head.workflow_id == caller_id:
        raise _agent_refusal(
            "agent_is_self",
            f"'{raw}' is you. This tool works on other agents only.",
            self_step,
        )
    workflow = await workflows_service.fetch_workflow(
        project_id=project_id,
        workflow_ref=Reference(id=head.workflow_id),
        include_archived=True,
    )
    if workflow is None:
        raise _agent_refusal(
            "agent_not_found",
            f"No agent in this project has the slug or id '{raw}'.",
            _FIND_AGENT_STEP,
        )
    if workflow.deleted_at is not None or head.deleted_at is not None:
        raise _agent_refusal(
            "agent_archived",
            f"'{workflow.name or raw}' is archived. An archived agent cannot be read or "
            "changed.",
            "Pick an agent that is not archived: call list_agents.",
        )
    if head.flags is None or not head.flags.is_agent:
        raise _agent_refusal(
            "not_an_agent",
            f"'{workflow.name or raw}' is a workflow, not an agent.",
            _FIND_AGENT_STEP,
        )
    return workflow, head


def _agent_summary(workflow: Any) -> Dict[str, Any]:
    return {"id": str(workflow.id), "slug": workflow.slug, "name": workflow.name}


async def _attribution(
    *,
    workflows_service: WorkflowsService,
    project_id: UUID,
    arguments: Dict[str, Any],
    caller_id: UUID,
) -> str:
    from oss.src.core.workflows.commit_support import agent_attribution

    caller = await workflows_service.fetch_workflow(
        project_id=project_id,
        workflow_ref=Reference(id=caller_id),
    )
    return agent_attribution(
        agent_id=str(caller_id),
        agent_name=caller.name if caller else None,
        session_id=_bound_session(arguments),
    )


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


async def handle_list_agents(
    *,
    arguments: Any,
    headers: Any = None,
    project_id: UUID,
    user_id: UUID,
    workflows_service: Optional[WorkflowsService],
    tracing_service: Optional[TracingService] = None,
    timeout_ms: int = READ_CONFIG_DEFAULT_TIMEOUT_MS,
) -> PlatformHandlerResult:
    """The agents in the caller's project, newest change first, one page at a time.

    Agents are the workflows whose latest revision is flagged `is_agent`; the head query
    filters on that flag in SQL, before pagination, so a page is never short. Static
    platform workflows are served from code and never stored, so they never appear.
    """
    from oss.src.core.workflows.dtos import (
        WorkflowRevisionQuery,
        WorkflowRevisionQueryFlags,
    )

    if workflows_service is None:
        raise PlatformToolHandlerRefused("list_agents is unavailable.")

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
                next_step="Omit `limit` to get 50 agents per page.",
            )
        cursor = parsed.get("cursor")
        try:
            cursor = UUID(str(cursor)) if cursor else None
        except ValueError as e:
            raise _ArgumentsRefused(
                "`cursor` is not a cursor this tool returned.",
                next_step="Pass the `next_cursor` of the previous page, or omit `cursor`.",
            ) from e
        include_archived = parsed.get("include_archived") is True
    except _Refusal as e:
        return PlatformHandlerResult.failure(e.error)

    heads = await workflows_service.query_workflow_head_revisions(
        project_id=project_id,
        workflow_revision_query=WorkflowRevisionQuery(
            flags=WorkflowRevisionQueryFlags(is_agent=True),
        ),
        include_archived=include_archived,
        windowing=Windowing(limit=limit, next=cursor),
    )

    artifact_ids = list(
        dict.fromkeys(head.workflow_id for head in heads if head.workflow_id)
    )
    workflows = (
        await workflows_service.query_workflows(
            project_id=project_id,
            workflow_refs=[Reference(id=artifact_id) for artifact_id in artifact_ids],
            include_archived=include_archived,
        )
        if artifact_ids
        else []
    )
    by_id = {workflow.id: workflow for workflow in workflows}

    agents: List[Dict[str, Any]] = []
    seen: set = set()
    for head in heads:
        workflow = by_id.get(head.workflow_id)
        # One row per agent: an agent with a second variant has a second head, and the
        # first one is the most recent change.
        if workflow is None or workflow.id in seen:
            continue
        seen.add(workflow.id)
        agent = {
            **_agent_summary(workflow),
            "description": workflow.description,
            "version": head.version,
            "updated_at": head.created_at.isoformat() if head.created_at else None,
        }
        if workflow.deleted_at is not None:
            agent["archived"] = True
        agents.append(agent)

    full_page = len(heads) == limit and heads[-1].id is not None
    return PlatformHandlerResult(
        content={
            "agents": agents,
            "next_cursor": str(heads[-1].id) if full_page else None,
        }
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
) -> PlatformHandlerResult:
    """Another agent's latest saved configuration, with the same answer `read_config` gives.

    There is no draft warning: that warning is about the CALLER's run, and this reads an
    agent that is not running here. It always answers from the stored head, which is what
    `edit_agent_config` edits.
    """
    from oss.src.core.workflows.read_config import ReadConfigError

    if workflows_service is None:
        raise PlatformToolHandlerRefused("read_agent_config is unavailable.")

    try:
        parsed = _parse_arguments(arguments)
        caller_id = _bound_caller(parsed)
        _, head = await _resolve_other_agent(
            workflows_service=workflows_service,
            project_id=project_id,
            arguments=parsed,
            caller_id=caller_id,
            self_step="To read your own configuration, use read_config.",
        )
        try:
            outcome = await workflows_service.read_workflow_revision_config(
                project_id=project_id,
                workflow_variant_id=head.workflow_variant_id,
                path=parsed.get("path"),
                max_bytes=parsed.get("max_bytes"),
            )
        except ReadConfigError as e:
            raise _Refusal(AgentError(**e.to_detail())) from e
    except _Refusal as e:
        return PlatformHandlerResult.failure(e.error)

    return PlatformHandlerResult(
        content=_read_config_response(outcome, is_draft=False, extra_warnings=[])
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
) -> PlatformHandlerResult:
    """Commit ordered operations to another agent's latest revision. Never deploys.

    The same commit as `commit_revision`: `AGENT_COMMIT_SCOPE`, the build-kit rejection, the
    stale-base check and the derived message. Only the target differs, and the message gains
    the attribution, because the owner of this history did not watch the change happen.
    """
    from oss.src.core.workflows.dtos import WorkflowRevisionCommit

    if workflows_service is None:
        raise PlatformToolHandlerRefused("edit_agent_config is unavailable.")

    try:
        parsed = _parse_arguments(arguments)
        caller_id = _bound_caller(parsed)
        if "operations" not in parsed and set(parsed) - _EDIT_AGENT_CONFIG_FIELDS:
            # A whole configuration, in whatever key the model chose. Refused, not filtered,
            # for the same reason `commit_revision` refuses one.
            raise _Refusal(
                _full_data_refusal(
                    "This tool saves a change to an agent's configuration, not a whole "
                    "configuration.",
                    change_field="operations",
                )
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
            arguments=parsed,
            caller_id=caller_id,
            self_step="To change your own configuration, use commit_revision.",
        )
        try:
            commit = WorkflowRevisionCommit(
                workflow_variant_id=head.workflow_variant_id,
                base_revision_id=base_revision_id,
                delta={"operations": operations},
            )
        except Exception as e:
            raise _Refusal(_commit_payload_refusal(e)) from e
        attribution = await _attribution(
            workflows_service=workflows_service,
            project_id=project_id,
            arguments=parsed,
            caller_id=caller_id,
        )
        outcome = await _commit_as_agent(
            workflows_service=workflows_service,
            project_id=project_id,
            user_id=user_id,
            commit=commit,
            attribution=attribution,
        )
    except _Refusal as e:
        return PlatformHandlerResult.failure(e.error)

    revision = outcome.revision
    if outcome.status == "committed" and not revision:
        return PlatformHandlerResult.failure(
            AgentError(
                code="commit_failed",
                message="The commit did not produce a revision.",
                retryable=False,
            )
        )
    if outcome.status == "committed":
        # The legacy caches the commit routes clear. No `committed_revision`: that signal
        # tells the CALLER's playground it committed itself, and this is another agent.
        await invalidate_cache(project_id=str(project_id))

    return PlatformHandlerResult(
        content={
            "status": outcome.status,
            "agent": _agent_summary(workflow),
            "version": revision.version if revision else None,
            "base_revision_id": str(revision.id) if revision else None,
            "message": revision.message if revision else None,
            "warnings": [w.model_dump(mode="json") for w in outcome.warnings],
        }
    )


_EDIT_AGENT_CONFIG_FIELDS = (
    frozenset({"agent", "base_revision_id", "operations"}) | _BOUND_FIELDS
)


def _create_refusal(error: AgentError) -> AgentError:
    """A refusal from the operations of a create, pointed at the create.

    The shared next step speaks of a configuration to read again. Here nothing exists yet,
    so the way forward is to fix the operation and send the create again.
    """
    index = (error.details or {}).get("operation_index")
    fix = "the operations" if index is None else f"operation {index}"
    return error.model_copy(
        update={
            "next_step": (
                f"No agent was created. Fix {fix} as the message says, then call "
                "create_agent again."
            )
        }
    )


async def handle_create_agent(
    *,
    arguments: Any,
    headers: Any = None,
    project_id: UUID,
    user_id: UUID,
    workflows_service: Optional[WorkflowsService],
    tracing_service: Optional[TracingService] = None,
    timeout_ms: int = COMMIT_REVISION_DEFAULT_TIMEOUT_MS,
) -> PlatformHandlerResult:
    """A new agent from the "New agent" template, with the caller's operations applied.

    The service owns the composition (template, operations, slug, flags, first message) and
    the cleanup of a create that stops part of the way. This handler reads the arguments,
    names the creator, and turns each failure into a refusal the model can act on.
    """
    from oss.src.core.embeds.exceptions import NonEmbeddableWorkflowReferenceError
    from oss.src.core.workflows.change_set import ChangeSetError
    from oss.src.core.workflows.service import SimpleWorkflowsService
    from oss.src.core.workflows.types import (
        AgentCreationFailed,
        InvalidAgentInstructionsError,
    )

    if workflows_service is None:
        raise PlatformToolHandlerRefused("create_agent is unavailable.")

    try:
        parsed = _parse_arguments(arguments)
        caller_id = _bound_caller(parsed)
        unknown = sorted(set(parsed) - _CREATE_AGENT_FIELDS)
        if unknown:
            # A top-level `instructions` or `model` would otherwise be dropped in silence and
            # the agent created from the bare template, with a success answer.
            raise _ArgumentsRefused(
                f"{', '.join(f'`{key}`' for key in unknown)} "
                f"{'is not a field' if len(unknown) == 1 else 'are not fields'} of "
                "create_agent. Its fields are `name`, `description` and `operations`.",
                next_step=(
                    "Put every change to the new agent in `operations`, for example "
                    f'"operations": [{_SET_INSTRUCTIONS_EXAMPLE}].'
                ),
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
        operations = _operations(parsed, required=False)
        attribution = await _attribution(
            workflows_service=workflows_service,
            project_id=project_id,
            arguments=parsed,
            caller_id=caller_id,
        )
        try:
            created, message, warnings = await SimpleWorkflowsService(
                workflows_service=workflows_service
            ).create_agent(
                project_id=project_id,
                user_id=user_id,
                name=name.strip(),
                description=description,
                operations=operations,
                message=f"Created {attribution}",
            )
        except ValidationError as e:
            raise _Refusal(_create_refusal(_commit_payload_refusal(e))) from e
        except (ChangeSetError, InvalidAgentInstructionsError) as e:
            raise _Refusal(_create_refusal(AgentError(**e.to_detail()))) from e
        except NonEmbeddableWorkflowReferenceError as e:
            raise _Refusal(
                AgentError(
                    code="non_embeddable_reference",
                    message=str(e),
                    retryable=False,
                    next_step=(
                        "Remove the embedded reference to that workflow, then call "
                        "create_agent again."
                    ),
                )
            ) from e
        except AgentCreationFailed as e:
            # Not retryable: part of the agent may exist, and the same call would make a
            # second one.
            raise _Refusal(
                AgentError(
                    code="create_failed",
                    message=e.message,
                    retryable=False,
                    next_step=(
                        "Call list_agents to see whether the agent exists before you "
                        "create it again."
                    ),
                )
            ) from e
    except _Refusal as e:
        return PlatformHandlerResult.failure(e.error)

    await invalidate_cache(project_id=str(project_id))
    return PlatformHandlerResult(
        content={
            "status": "created",
            "agent": _agent_summary(created),
            "base_revision_id": str(created.revision_id),
            "message": message,
            "warnings": [w.model_dump(mode="json") for w in warnings],
        }
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


PLATFORM_TOOL_HANDLERS: Dict[str, PlatformToolHandlerRegistration] = {
    TEST_RUN_CALL_REF: PlatformToolHandlerRegistration(
        call_ref=TEST_RUN_CALL_REF,
        timeout_ms=TEST_RUN_DEFAULT_TIMEOUT_MS,
        handler=handle_test_run,
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
    ),
    # Other agents in the project. The same permissions as the self pair: reading a
    # configuration needs VIEW_WORKFLOWS, writing one EDIT_WORKFLOWS, and RUN_TOOLS alone
    # reaches neither.
    LIST_AGENTS_CALL_REF: PlatformToolHandlerRegistration(
        call_ref=LIST_AGENTS_CALL_REF,
        timeout_ms=READ_CONFIG_DEFAULT_TIMEOUT_MS,
        handler=handle_list_agents,
        elevated_permission=Permission.VIEW_WORKFLOWS,
    ),
    READ_AGENT_CONFIG_CALL_REF: PlatformToolHandlerRegistration(
        call_ref=READ_AGENT_CONFIG_CALL_REF,
        timeout_ms=READ_CONFIG_DEFAULT_TIMEOUT_MS,
        handler=handle_read_agent_config,
        elevated_permission=Permission.VIEW_WORKFLOWS,
    ),
    CREATE_AGENT_CALL_REF: PlatformToolHandlerRegistration(
        call_ref=CREATE_AGENT_CALL_REF,
        timeout_ms=COMMIT_REVISION_DEFAULT_TIMEOUT_MS,
        handler=handle_create_agent,
        elevated_permission=Permission.EDIT_WORKFLOWS,
    ),
    EDIT_AGENT_CONFIG_CALL_REF: PlatformToolHandlerRegistration(
        call_ref=EDIT_AGENT_CONFIG_CALL_REF,
        timeout_ms=COMMIT_REVISION_DEFAULT_TIMEOUT_MS,
        handler=handle_edit_agent_config,
        elevated_permission=Permission.EDIT_WORKFLOWS,
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
}

# Model-facing definitions (name, description, JSON schema, context bindings, read_only) for
# the handlers whose op catalog entry is authored here rather than in the SDK. The SDK's
# ``PLATFORM_OPS`` entry for each must be a copy of this dict; ``read_only`` follows the
# catalog's convention (a read hint for the runner's ``allow_reads`` policy).
PLATFORM_TOOL_DEFINITIONS: Dict[str, Dict[str, Any]] = {
    CREATE_APP_CALL_REF: CREATE_APP_TOOL_DEFINITION,
    LIST_STARTERS_CALL_REF: LIST_STARTERS_TOOL_DEFINITION,
}


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
    mounts_service: Any = None,
) -> PlatformHandlerResult:
    registration = PLATFORM_TOOL_HANDLERS.get(call_ref)
    if registration is None:
        raise PlatformToolHandlerNotFound(
            f"Unknown reserved Agenta tool handler: {call_ref}"
        )

    extra: Dict[str, Any] = (
        {"mounts_service": mounts_service} if registration.needs_mounts else {}
    )
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
