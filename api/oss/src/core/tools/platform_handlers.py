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


def _parse_arguments(arguments: Any) -> Dict[str, Any]:
    if isinstance(arguments, str):
        try:
            arguments = json.loads(arguments)
        except json.JSONDecodeError as e:
            raise PlatformToolHandlerRefused("arguments must be a JSON object.") from e
    if not isinstance(arguments, dict):
        raise PlatformToolHandlerRefused("arguments must be a JSON object.")
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
    from oss.src.apis.fastapi.workflows.models import (
        ReadConfigResponse,
        ReadConfigRevision,
    )
    from oss.src.core.workflows.read_config import ReadConfigError

    if workflows_service is None:
        raise PlatformToolHandlerRefused("read_config is unavailable.")

    parsed = _parse_arguments(arguments)
    variant_id = _bound_variant_id(parsed, key="target")
    target = parsed.get("target") or {}

    try:
        outcome = await workflows_service.read_workflow_revision_config(
            project_id=project_id,
            workflow_variant_id=variant_id,
            path=target.get("path"),
            max_bytes=parsed.get("max_bytes"),
            run_is_draft=target.get("run_is_draft"),
        )
    except ReadConfigError as e:
        return PlatformHandlerResult.failure(AgentError(**e.to_detail()))

    revision = outcome.revision
    return PlatformHandlerResult(
        content=ReadConfigResponse(
            revision=ReadConfigRevision(
                id=str(revision.id),
                version=getattr(revision, "version", None),
                workflow_variant_id=str(getattr(revision, "variant_id", "") or "")
                or None,
                created_at=str(getattr(revision, "created_at", "") or "") or None,
            ),
            base_revision_id=str(revision.id),
            is_draft=outcome.is_draft,
            path=outcome.path,
            value=outcome.value,
            bytes=outcome.bytes,
            warnings=outcome.warnings or None,
        )
    )


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
    from oss.src.core.embeds.exceptions import NonEmbeddableWorkflowReferenceError
    from oss.src.core.git.types import CommitLockTimeout, VariantNotFound
    from oss.src.core.workflows.change_set import AGENT_COMMIT_SCOPE, ChangeSetError
    from oss.src.core.workflows.dtos import WorkflowRevisionCommit
    from oss.src.core.workflows.service import RevisionConflictError
    from oss.src.core.workflows.types import StaticWorkflowSlug

    if workflows_service is None:
        raise PlatformToolHandlerRefused("commit_revision is unavailable.")

    parsed = _parse_arguments(arguments)
    variant_id = _bound_variant_id(parsed, key="workflow_revision")
    payload = dict(parsed.get("workflow_revision") or {})
    payload["workflow_variant_id"] = str(variant_id)

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
        return PlatformHandlerResult.failure(
            AgentError(
                code="commit_payload_invalid",
                message=str(e),
                retryable=False,
                next_step="Correct the fields named above and send the commit again.",
            )
        )

    try:
        outcome = await workflows_service.commit_workflow_revision_checked(
            project_id=project_id,
            user_id=user_id,
            workflow_revision_commit=commit,
            scope_policy=AGENT_COMMIT_SCOPE,
        )
    except ChangeSetError as e:
        return PlatformHandlerResult.failure(AgentError(**e.to_detail()))
    except RevisionConflictError as e:
        return PlatformHandlerResult.failure(AgentError(**e.to_detail()))
    except CommitLockTimeout as e:
        return PlatformHandlerResult.failure(
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
        )
    except VariantNotFound as e:
        return PlatformHandlerResult.failure(
            AgentError(
                code="workflow_variant_not_found",
                message=e.message,
                retryable=False,
            )
        )
    except NonEmbeddableWorkflowReferenceError as e:
        return PlatformHandlerResult.failure(
            AgentError(
                code="non_embeddable_reference",
                message=str(e),
                retryable=False,
                next_step=(
                    "Remove the embedded reference to that workflow and send the commit "
                    "again."
                ),
            )
        )
    except StaticWorkflowSlug as e:
        return PlatformHandlerResult.failure(
            AgentError(
                code="static_workflow_slug",
                message=str(e),
                retryable=False,
            )
        )

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
) -> PlatformHandlerResult:
    registration = PLATFORM_TOOL_HANDLERS.get(call_ref)
    if registration is None:
        raise PlatformToolHandlerNotFound(
            f"Unknown reserved Agenta tool handler: {call_ref}"
        )

    return await registration.handler(
        arguments=arguments,
        headers=headers,
        project_id=project_id,
        user_id=user_id,
        workflows_service=workflows_service,
        tracing_service=tracing_service,
        timeout_ms=registration.timeout_ms,
    )
