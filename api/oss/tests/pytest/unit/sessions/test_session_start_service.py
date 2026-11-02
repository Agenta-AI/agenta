import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest

from oss.tests.pytest.utils.principals import make_envelope
from oss.src.core.sessions.executions.dtos import (
    SessionExecutionSettlement,
    SessionExecutionState,
)
from oss.src.core.sessions.inputs.dtos import PendingInput, PendingInputState
from oss.src.core.sessions.starts.service import SessionStartsService
from oss.src.core.sessions.starts.types import SessionStartNotDurable
import oss.src
from oss.src.core.workflows.types import (
    WorkflowDetachedStartFailed,
    WorkflowDetachedStartNeverSent,
    WorkflowServiceUrlMissing,
)
from oss.src.core.access.dtos import Decision, DecisionReason
from oss.src.core.sharing.types import AdmissionDenied
from oss.tests.pytest.utils.sharing import NoopRunAdmission, RecordingRunAdmission


PROJECT_ID = uuid4()
USER_ID = uuid4()
WORKFLOW_ID = uuid4()
REVISION_ID = uuid4()
INPUT_ID = uuid4()


class _MemoryLock:
    def __init__(self):
        self.values = {}
        self.guard = asyncio.Lock()

    async def set(self, key, value, *, nx, ex):
        async with self.guard:
            if nx and key in self.values:
                return False
            self.values[key] = value
            return True

    async def eval(self, script, number_of_keys, key, token):
        async with self.guard:
            if self.values.get(key) == token:
                del self.values[key]
                return 1
            return 0


def _input(content):
    return PendingInput(
        id=INPUT_ID,
        project_id=PROJECT_ID,
        session_id="placeholder",
        content=content,
        position=1,
        state=PendingInputState.promoted,
        policy="queue",
        idempotency_key="load-1",
        request_fingerprint="fingerprint",
        promoted_execution_id="placeholder",
        created_at=datetime.now(timezone.utc),
    )


def _execution(session_id, execution_id):
    return SessionExecutionSettlement(
        project_id=PROJECT_ID,
        session_id=session_id,
        execution_id=execution_id,
        state=SessionExecutionState.running,
    )


def _service(
    *, inputs=None, executions=None, workflows=None, timeout=0, admission=None
):
    return SessionStartsService(
        run_admission=admission or NoopRunAdmission(),
        inputs_service=inputs or AsyncMock(),
        executions_dao=executions or AsyncMock(),
        workflows_service=workflows or AsyncMock(),
        lock_engine=_MemoryLock(),
        poll_timeout_seconds=timeout,
    )


ENVELOPE = make_envelope()


def _args():
    return {
        "project_id": PROJECT_ID,
        "user_id": USER_ID,
        "workflow_id": WORKFLOW_ID,
        "revision_id": REVISION_ID,
        "message": "Configure the agent.",
        "request_key": "load-1",
        "envelope": ENVELOPE,
    }


@pytest.mark.asyncio
async def test_start_once_returns_only_after_claim_and_execution_are_durable():
    inputs = AsyncMock()
    executions = AsyncMock()
    workflows = AsyncMock()

    async def claim(**kwargs):
        return _input(kwargs["content"]).model_copy(
            update={
                "session_id": kwargs["session_id"],
                "promoted_execution_id": kwargs["execution_id"],
            }
        )

    inputs.claim_for_execution.side_effect = claim
    executions.fetch_execution.side_effect = [
        None,
        _execution("stored-session", "stored-execution"),
    ]
    service = _service(inputs=inputs, executions=executions, workflows=workflows)

    result = await service.start_once(**_args())

    inputs.claim_for_execution.assert_awaited_once()
    assert executions.fetch_execution.await_count == 2
    assert result.input_id == INPUT_ID
    assert result.replayed is False
    invoke = workflows.invoke_workflow_detached.await_args.kwargs
    assert invoke["run_id"] == result.execution_id
    assert invoke["strict_start"] is True


@pytest.mark.asyncio
async def test_replay_returns_existing_execution_without_invoking_again():
    inputs = AsyncMock()
    executions = AsyncMock()
    workflows = AsyncMock()

    async def claim(**kwargs):
        return _input(kwargs["content"]).model_copy(
            update={
                "session_id": kwargs["session_id"],
                "promoted_execution_id": kwargs["execution_id"],
            }
        )

    inputs.claim_for_execution.side_effect = claim
    executions.fetch_execution.side_effect = lambda **kwargs: _execution(
        kwargs["session_id"], kwargs["execution_id"]
    )
    service = _service(inputs=inputs, executions=executions, workflows=workflows)

    result = await service.start_once(**_args())

    workflows.invoke_workflow_detached.assert_not_awaited()
    assert result.replayed is True


class _ResolvingAdmission(RecordingRunAdmission):
    """Records the call and resolves the target onto the request, as
    `RunAdmission.admit_request` does (`resolve_request_target`)."""

    async def admit_request(self, **kwargs) -> None:
        await super().admit_request(**kwargs)
        kwargs["request"].data.revision = {"data": {"url": "http://resolved"}}


@pytest.mark.asyncio
async def test_the_admitted_request_is_invoked_and_the_input_stores_no_target():
    """The start is admitted before anything is claimed. The admission resolves the
    target on the request (`resolve_request_target`); the invoke sends that request,
    so `_prepare_invoke` does not resolve it again. The stored input keeps the
    references only (its content is taken before the admission; the claim's
    fingerprint makes the claimed content equal to it)."""

    inputs = AsyncMock()
    executions = AsyncMock()
    workflows = AsyncMock()
    claimed = {}

    async def claim(**kwargs):
        claimed.update(kwargs["content"])
        return _input(kwargs["content"])

    inputs.claim_for_execution.side_effect = claim
    executions.fetch_execution.side_effect = [
        None,
        _execution("stored-session", "stored-execution"),
    ]
    admission = _ResolvingAdmission()
    service = _service(
        inputs=inputs, executions=executions, workflows=workflows, admission=admission
    )

    await service.start_once(**_args())

    assert admission.methods() == ["admit_request"]
    admitted = admission.calls[0][1]
    assert admitted["boundary"] == "template_start"
    # The start checks the session its key names (an existing row is another
    # caller's start or chat with the same id).
    assert admitted["session_id"] == SessionStartsService.session_id_for(
        project_id=PROJECT_ID, request_key="load-1"
    )
    assert admitted["envelope"] == ENVELOPE
    request = workflows.invoke_workflow_detached.await_args.kwargs["request"]
    assert request is admitted["request"]
    assert request.data.revision == {"data": {"url": "http://resolved"}}
    assert request.data.inputs["messages"][0]["content"] == "Configure the agent."
    assert "revision" not in claimed["data"]


@pytest.mark.asyncio
async def test_template_start_checks_agent():
    """A start into an agent the principal may not run raises `AdmissionDenied` (403
    at the route) before any input is claimed or anything is invoked."""

    inputs = AsyncMock()
    workflows = AsyncMock()
    admission = RecordingRunAdmission(
        refuse=lambda method, kwargs: AdmissionDenied(
            decision=Decision(allowed=False, reason=DecisionReason.RESOURCE_DENIED),
            readable=False,
            boundary=kwargs["boundary"],
        )
    )
    service = _service(inputs=inputs, workflows=workflows, admission=admission)

    with pytest.raises(AdmissionDenied):
        await service.start_once(**_args())

    inputs.claim_for_execution.assert_not_awaited()
    workflows.invoke_workflow_detached.assert_not_awaited()


@pytest.mark.asyncio
async def test_timeout_after_remote_acceptance_rechecks_durable_row():
    inputs = AsyncMock()
    executions = AsyncMock()
    workflows = AsyncMock()

    async def claim(**kwargs):
        return _input(kwargs["content"])

    inputs.claim_for_execution.side_effect = claim
    executions.fetch_execution.side_effect = [
        None,
        _execution("stored-session", "stored-execution"),
    ]
    workflows.invoke_workflow_detached.side_effect = httpx.ReadTimeout("lost response")
    service = _service(inputs=inputs, executions=executions, workflows=workflows)

    result = await service.start_once(**_args())

    assert result.replayed is False


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "start_error",
    [None, WorkflowDetachedStartFailed("rejected")],
)
async def test_missing_execution_row_fails_after_handshake_readback(start_error):
    inputs = AsyncMock()
    executions = AsyncMock()
    workflows = AsyncMock()

    async def claim(**kwargs):
        return _input(kwargs["content"])

    inputs.claim_for_execution.side_effect = claim
    executions.fetch_execution.return_value = None
    if start_error is not None:
        workflows.invoke_workflow_detached.side_effect = start_error
    service = _service(inputs=inputs, executions=executions, workflows=workflows)

    with pytest.raises(SessionStartNotDurable):
        await service.start_once(**_args())

    assert executions.fetch_execution.await_count == 2


@pytest.mark.asyncio
async def test_two_concurrent_same_key_starts_dispatch_once():
    row = {"value": None}
    invocation_count = 0

    class Inputs:
        async def claim_dispatch(self, **kwargs):
            return True

        async def claim_for_execution(self, **kwargs):
            return _input(kwargs["content"]).model_copy(
                update={
                    "session_id": kwargs["session_id"],
                    "promoted_execution_id": kwargs["execution_id"],
                }
            )

    class Executions:
        async def fetch_execution(self, **kwargs):
            return row["value"]

    class Workflows:
        async def invoke_workflow_detached(self, **kwargs):
            nonlocal invocation_count
            invocation_count += 1
            await asyncio.sleep(0.02)
            row["value"] = _execution(
                kwargs["request"].session_id,
                kwargs["run_id"],
            )

    service = SessionStartsService(
        run_admission=NoopRunAdmission(),
        inputs_service=Inputs(),
        executions_dao=Executions(),
        workflows_service=Workflows(),
        lock_engine=_MemoryLock(),
        poll_timeout_seconds=0.2,
    )

    first, second = await asyncio.gather(
        service.start_once(**_args()),
        service.start_once(**_args()),
    )

    assert invocation_count == 1
    assert {first.replayed, second.replayed} == {False, True}
    assert first.session_id == second.session_id
    assert first.execution_id == second.execution_id


@pytest.mark.asyncio
async def test_live_initial_heartbeat_prevents_duplicate_dispatch_without_settlement():
    inputs = AsyncMock()
    inputs.claim_for_execution.side_effect = lambda **kw: _input(kw["content"])
    executions = AsyncMock()
    executions.fetch_execution.return_value = None
    streams = AsyncMock()
    streams.get_by_session_id.return_value = None
    workflows = AsyncMock()

    async def invoke(**kw):
        streams.get_by_session_id.return_value = SimpleNamespace(turn_id=kw["run_id"])

    workflows.invoke_workflow_detached.side_effect = invoke
    service = SessionStartsService(
        run_admission=NoopRunAdmission(),
        inputs_service=inputs,
        executions_dao=executions,
        streams_dao=streams,
        workflows_service=workflows,
        lock_engine=_MemoryLock(),
        poll_timeout_seconds=0,
    )
    first, second = await asyncio.gather(
        service.start_once(**_args()), service.start_once(**_args())
    )
    workflows.invoke_workflow_detached.assert_awaited_once()
    assert first.execution_id == second.execution_id
    assert {first.replayed, second.replayed} == {False, True}


@pytest.mark.asyncio
async def test_unrelated_heartbeat_does_not_confirm_start():
    inputs = AsyncMock()
    inputs.claim_for_execution.side_effect = lambda **kw: _input(kw["content"])
    executions = AsyncMock()
    executions.fetch_execution.return_value = None
    streams = AsyncMock()
    streams.get_by_session_id.return_value = SimpleNamespace(
        turn_id="another-execution"
    )
    service = SessionStartsService(
        run_admission=NoopRunAdmission(),
        inputs_service=inputs,
        executions_dao=executions,
        streams_dao=streams,
        workflows_service=AsyncMock(),
        lock_engine=_MemoryLock(),
        poll_timeout_seconds=0,
    )
    with pytest.raises(SessionStartNotDurable):
        await service.start_once(**_args())


@pytest.mark.asyncio
async def test_delayed_acceptance_cannot_redispatch_even_after_service_restart():
    inputs = AsyncMock()
    inputs.claim_for_execution.side_effect = lambda **kw: _input(kw["content"])
    inputs.claim_dispatch.side_effect = [True, False, False]
    executions = AsyncMock()
    executions.fetch_execution.return_value = None
    workflows = AsyncMock()
    workflows.invoke_workflow_detached.side_effect = httpx.ReadTimeout(
        "ambiguous acceptance"
    )

    with pytest.raises(SessionStartNotDurable):
        await _service(
            inputs=inputs, executions=executions, workflows=workflows
        ).start_once(**_args())
    with pytest.raises(SessionStartNotDurable):
        await _service(
            inputs=inputs, executions=executions, workflows=workflows
        ).start_once(**_args())
    workflows.invoke_workflow_detached.assert_awaited_once()

    executions.fetch_execution.side_effect = [None, _execution("session", "execution")]
    replay = await _service(
        inputs=inputs, executions=executions, workflows=workflows
    ).start_once(**_args())
    assert replay.replayed is True
    workflows.invoke_workflow_detached.assert_awaited_once()


class _ClaimFlag:
    """The `dispatch_claimed` column as the real DAO writes it: two compare-and-set writers.

    Scripted `side_effect` booleans would let a retry dispatch whether or not the release
    happened, which is the half of this behaviour worth pinning.
    """

    def __init__(self, *, claimed: bool = False):
        self.claimed = claimed
        self.scopes = []

    async def claim_dispatch(self, **kwargs):
        self.scopes.append(("claim", kwargs))
        if self.claimed:
            return False
        self.claimed = True
        return True

    async def release_dispatch(self, **kwargs):
        self.scopes.append(("release", kwargs))
        if not self.claimed:
            return False
        self.claimed = False
        return True

    async def claim_for_execution(self, **kwargs):
        # The row holds `content` as JSON and the start path re-reads it from the row rather
        # than reusing the dict it passed in, so the double round-trips it the same way.
        # Handing the original object back would hide anything added on the way to storage.
        stored = json.loads(json.dumps(kwargs["content"]))
        return _input(stored).model_copy(
            update={
                "session_id": kwargs["session_id"],
                "promoted_execution_id": kwargs["execution_id"],
            }
        )


@pytest.mark.asyncio
async def test_never_sent_invoke_releases_the_claim_and_one_retry_dispatches_again():
    inputs = _ClaimFlag()
    executions = AsyncMock()
    executions.fetch_execution.return_value = None
    workflows = AsyncMock()
    workflows.invoke_workflow_detached.side_effect = [
        WorkflowDetachedStartNeverSent("Workflow service returned HTTP 404"),
        None,
    ]

    with pytest.raises(SessionStartNotDurable):
        await _service(
            inputs=inputs, executions=executions, workflows=workflows
        ).start_once(**_args())

    assert inputs.claimed is False
    # The release names the claim it is giving back, not just any row.
    claim_scope = next(scope for kind, scope in inputs.scopes if kind == "claim")
    release_scope = next(scope for kind, scope in inputs.scopes if kind == "release")
    assert release_scope == claim_scope

    executions.fetch_execution.side_effect = [None, _execution("session", "execution")]
    result = await _service(
        inputs=inputs, executions=executions, workflows=workflows
    ).start_once(**_args())

    assert result.replayed is False
    assert workflows.invoke_workflow_detached.await_count == 2
    assert [kind for kind, _ in inputs.scopes] == ["claim", "release", "claim"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "start_error",
    [
        # The two the workflows domain raises from the only scopes that can prove it: before a
        # request is built, and from the transport and response classification inside the start.
        WorkflowServiceUrlMissing(),
        WorkflowDetachedStartNeverSent("Workflow service returned HTTP 404"),
    ],
)
async def test_every_never_sent_failure_releases_the_claim(start_error):
    inputs = _ClaimFlag()
    executions = AsyncMock()
    executions.fetch_execution.return_value = None
    workflows = AsyncMock()
    workflows.invoke_workflow_detached.side_effect = start_error

    with pytest.raises(SessionStartNotDurable):
        await _service(
            inputs=inputs, executions=executions, workflows=workflows
        ).start_once(**_args())

    assert inputs.claimed is False


@pytest.mark.asyncio
async def test_a_durable_run_keeps_the_claim_even_when_the_invoke_raised():
    """The release must follow the durability read, not replace it.

    A never-sent error and a settled execution can both be true: the service answered a retry
    and this attempt lost the race. Releasing before reading would hand the claim back on a run
    that is already alive.
    """
    inputs = _ClaimFlag()
    executions = AsyncMock()
    executions.fetch_execution.side_effect = [
        None,
        _execution("session", "execution"),
    ]
    workflows = AsyncMock()
    workflows.invoke_workflow_detached.side_effect = WorkflowDetachedStartNeverSent(
        "Workflow service returned HTTP 404"
    )

    result = await _service(
        inputs=inputs, executions=executions, workflows=workflows
    ).start_once(**_args())

    assert result.replayed is False
    assert inputs.claimed is True
    assert [kind for kind, _ in inputs.scopes] == ["claim"]


@pytest.mark.asyncio
async def test_a_failing_release_still_raises_the_start_error():
    inputs = AsyncMock()
    inputs.claim_for_execution.side_effect = lambda **kw: _input(kw["content"])
    inputs.claim_dispatch.return_value = True
    inputs.release_dispatch.side_effect = RuntimeError("the database went away")
    executions = AsyncMock()
    executions.fetch_execution.return_value = None
    workflows = AsyncMock()
    workflows.invoke_workflow_detached.side_effect = WorkflowDetachedStartNeverSent(
        "Workflow service returned HTTP 404"
    )

    with pytest.raises(SessionStartNotDurable):
        await _service(
            inputs=inputs, executions=executions, workflows=workflows
        ).start_once(**_args())


@pytest.mark.asyncio
async def test_a_cancelled_invoke_keeps_the_claim():
    """A cancel can land with the request on the wire, so it is ambiguous, never never-sent."""
    inputs = _ClaimFlag()
    executions = AsyncMock()
    executions.fetch_execution.return_value = None
    workflows = AsyncMock()
    workflows.invoke_workflow_detached.side_effect = asyncio.CancelledError()

    with pytest.raises(asyncio.CancelledError):
        await _service(
            inputs=inputs, executions=executions, workflows=workflows
        ).start_once(**_args())

    assert inputs.claimed is True
    assert [kind for kind, _ in inputs.scopes] == ["claim"]


def test_release_dispatch_has_exactly_one_call_site():
    """At-most-once rests on one releaser that is the claim holder, which no SQL enforces.

    A second call site would release a claim it does not hold. If this fails, read the
    invariant comment on `SessionInputsDAO.release_dispatch` before adding one.
    """
    root = Path(oss.src.__file__).parent
    call_sites = [
        str(path.relative_to(root))
        for path in sorted(root.rglob("*.py"))
        for line in path.read_text().splitlines()
        if ".release_dispatch(" in line
    ]

    # The service that forwards to the DAO, and the one flow that holds the claim. Nothing else.
    assert call_sites == [
        "core/sessions/inputs/service.py",
        "core/sessions/starts/service.py",
    ], call_sites


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "start_error",
    [
        httpx.ReadTimeout("the response was lost after the service was reached"),
        httpx.WriteError("the body was part-way sent"),
        WorkflowDetachedStartFailed("Workflow service returned HTTP 502"),
        # A bare transport error reaching this layer is NOT proof. The detached start classifies
        # the ones it can, so an unclassified one came from a redirect hop or from outside the
        # send, and a redirect means an intermediary already answered the POST. Every type the
        # transport can prove never-sent is listed, so re-broadening the caller-facing set to
        # any of them fails here rather than shipping quietly.
        httpx.ConnectError("connection refused on a redirect hop"),
        httpx.ConnectTimeout("a later hop never connected"),
        httpx.PoolTimeout("no connection was acquired for a later hop"),
        httpx.UnsupportedProtocol("a later hop named an unknown scheme"),
        httpx.InvalidURL("a later hop named an unusable url"),
    ],
)
async def test_ambiguous_invoke_failure_keeps_the_claim(start_error):
    inputs = AsyncMock()
    inputs.claim_for_execution.side_effect = lambda **kw: _input(kw["content"])
    inputs.claim_dispatch.side_effect = [True]
    executions = AsyncMock()
    executions.fetch_execution.return_value = None
    workflows = AsyncMock()
    workflows.invoke_workflow_detached.side_effect = start_error

    with pytest.raises(SessionStartNotDurable):
        await _service(
            inputs=inputs, executions=executions, workflows=workflows
        ).start_once(**_args())

    inputs.release_dispatch.assert_not_awaited()


@pytest.mark.asyncio
async def test_concurrent_retries_after_a_release_dispatch_exactly_once():
    claimed = {"value": False}
    row = {"value": None}
    invocations = 0

    class Inputs:
        async def claim_for_execution(self, **kwargs):
            return _input(kwargs["content"]).model_copy(
                update={
                    "session_id": kwargs["session_id"],
                    "promoted_execution_id": kwargs["execution_id"],
                }
            )

        async def claim_dispatch(self, **kwargs):
            if claimed["value"]:
                return False
            claimed["value"] = True
            return True

        async def release_dispatch(self, **kwargs):
            claimed["value"] = False
            return True

    class Executions:
        async def fetch_execution(self, **kwargs):
            return row["value"]

    class Workflows:
        def __init__(self, unreachable):
            self.unreachable = unreachable

        async def invoke_workflow_detached(self, **kwargs):
            nonlocal invocations
            invocations += 1
            if self.unreachable:
                raise WorkflowDetachedStartNeverSent(
                    "Workflow service returned HTTP 404"
                )
            await asyncio.sleep(0.02)
            row["value"] = _execution(kwargs["request"].session_id, kwargs["run_id"])

    inputs = Inputs()
    lock = _MemoryLock()

    def _start(*, unreachable):
        return SessionStartsService(
            run_admission=NoopRunAdmission(),
            inputs_service=inputs,
            executions_dao=Executions(),
            workflows_service=Workflows(unreachable),
            lock_engine=lock,
            poll_timeout_seconds=0.2,
        ).start_once(**_args())

    with pytest.raises(SessionStartNotDurable):
        await _start(unreachable=True)
    assert claimed["value"] is False

    first, second = await asyncio.gather(
        _start(unreachable=False),
        _start(unreachable=False),
    )

    assert invocations == 2
    assert {first.replayed, second.replayed} == {False, True}
    assert first.execution_id == second.execution_id


@pytest.mark.asyncio
async def test_the_first_turn_request_never_asks_for_session_admission():
    """`on_busy` must stay unset on this path. See `SessionStartsService._request`.

    With it set, the workflow service admits the input through the API and answers a lost
    admission response with a bare 503, which `detached_start_never_sent` reads as proof that
    nothing was dispatched. The API may hold a committed pending-input row at that moment, so
    the release would be wrong and the retry would run the turn twice.
    """
    inputs = _ClaimFlag()
    executions = AsyncMock()
    executions.fetch_execution.side_effect = [None, _execution("session", "execution")]
    workflows = AsyncMock()

    await _service(
        inputs=inputs, executions=executions, workflows=workflows
    ).start_once(**_args())

    # Three points on the same path: what the builder produces, what survives the row's JSON
    # round trip, and what is finally sent. `on_busy` must be absent at each.
    built = SessionStartsService._request(
        session_id="session-1",
        workflow_id=WORKFLOW_ID,
        revision_id=REVISION_ID,
        message="Configure the agent.",
    )
    assert built.on_busy is None
    assert "on_busy" not in built.model_dump(mode="json", exclude_none=True)

    sent = workflows.invoke_workflow_detached.await_args.kwargs["request"]
    assert sent.on_busy is None
    assert "on_busy" not in sent.model_dump(mode="json", exclude_none=True)


@pytest.mark.asyncio
async def test_template_start_is_rechecked_before_any_claim(monkeypatch):
    import oss.src.core.access.service as access_module
    from oss.src.core.access.types import AccessDenied
    from oss.tests.pytest.utils.principals import DenyingAccessService

    monkeypatch.setattr(access_module, "_access_service", DenyingAccessService())
    inputs = AsyncMock()
    service = _service(inputs=inputs, executions=AsyncMock(), workflows=AsyncMock())
    with pytest.raises(AccessDenied):
        await service.start_once(**_args())
    inputs.claim_for_execution.assert_not_awaited()


def _start_with_streams(streams, events):
    inputs = AsyncMock()
    executions = AsyncMock()
    workflows = AsyncMock()

    async def claim(**kwargs):
        return _input(kwargs["content"]).model_copy(
            update={
                "session_id": kwargs["session_id"],
                "promoted_execution_id": kwargs["execution_id"],
            }
        )

    async def invoke(**kwargs):
        events.append("invoke")

    inputs.claim_for_execution.side_effect = claim
    executions.fetch_execution.side_effect = [None, _execution("s", "e")]
    workflows.invoke_workflow_detached.side_effect = invoke
    streams.get_by_session_id.return_value = None
    return SessionStartsService(
        run_admission=NoopRunAdmission(),
        inputs_service=inputs,
        executions_dao=executions,
        workflows_service=workflows,
        lock_engine=_MemoryLock(),
        streams_dao=streams,
        poll_timeout_seconds=0,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("raced", [False, True])
async def test_start_creates_the_session_row_with_its_policy_before_the_invoke(raced):
    """The first session gets the start's policy (the load's requested visibility):
    the row is created before the invoke, so the first heartbeat finds it and never
    writes its own default. A row another first touch created is kept."""
    from oss.src.core.sessions.streams.types import SessionStreamAlreadyExists
    from oss.src.core.sharing.dtos import AccessPolicy, Visibility

    events = []
    streams = AsyncMock()

    async def create(**kwargs):
        events.append("create")
        if raced:
            raise SessionStreamAlreadyExists("s")

    streams.create.side_effect = create
    policy = AccessPolicy(visibility=Visibility.PROJECT, owner_user_id=USER_ID)

    result = await _start_with_streams(streams, events).start_once(
        **_args(), access=policy
    )

    assert events == ["create", "invoke"]
    kwargs = streams.create.await_args.kwargs
    assert kwargs["project_id"] == PROJECT_ID
    assert kwargs["stream"].session_id == result.session_id
    assert kwargs["stream"].access == policy
    assert result.replayed is False


@pytest.mark.asyncio
async def test_start_without_a_policy_creates_no_row():
    events = []
    streams = AsyncMock()
    await _start_with_streams(streams, events).start_once(**_args())
    streams.create.assert_not_awaited()
    assert events == ["invoke"]


@pytest.mark.asyncio
async def test_a_failed_session_row_create_holds_no_claim_and_a_retry_dispatches():
    """The session row is created before the one-shot dispatch claim. A database failure
    on that create leaves the claim free, so a retry with the same key can still invoke."""
    from oss.src.core.sharing.dtos import AccessPolicy, Visibility

    inputs = _ClaimFlag()
    executions = AsyncMock()
    executions.fetch_execution.return_value = None
    workflows = AsyncMock()
    streams = AsyncMock()
    streams.create.side_effect = [RuntimeError("database is down"), None]
    policy = AccessPolicy(visibility=Visibility.PROJECT, owner_user_id=USER_ID)

    def service():
        return SessionStartsService(
            run_admission=NoopRunAdmission(),
            inputs_service=inputs,
            executions_dao=executions,
            workflows_service=workflows,
            lock_engine=_MemoryLock(),
            streams_dao=streams,
            poll_timeout_seconds=0,
        )

    with pytest.raises(RuntimeError):
        await service().start_once(**_args(), access=policy)

    assert inputs.claimed is False
    assert [kind for kind, _ in inputs.scopes] == []
    workflows.invoke_workflow_detached.assert_not_awaited()

    executions.fetch_execution.side_effect = [None, _execution("session", "execution")]
    result = await service().start_once(**_args(), access=policy)

    assert result.replayed is False
    assert [kind for kind, _ in inputs.scopes] == ["claim"]
    workflows.invoke_workflow_detached.assert_awaited_once()


def _refusing_session_admission(session_id):
    def refuse(method, kwargs):
        if method == "admit" and kwargs.get("session_id") == session_id:
            return AdmissionDenied(
                decision=Decision(allowed=False, reason=DecisionReason.RESOURCE_DENIED),
                readable=False,
                boundary=kwargs["boundary"],
            )
        return None

    return RecordingRunAdmission(refuse=refuse)


@pytest.mark.asyncio
async def test_a_start_whose_row_was_created_concurrently_checks_it_before_any_claim():
    """Codex spec check finding 3: the admission saw no row, then another caller's start
    with the same key created the session first. The winning row is checked before
    anything is claimed or dispatched."""
    from oss.src.core.sessions.streams.types import SessionStreamAlreadyExists
    from oss.src.core.sharing.dtos import AccessPolicy, Visibility

    session_id = SessionStartsService.session_id_for(
        project_id=PROJECT_ID, request_key="load-1"
    )
    streams = AsyncMock()
    streams.create.side_effect = SessionStreamAlreadyExists(session_id)
    inputs = AsyncMock()
    workflows = AsyncMock()
    admission = _refusing_session_admission(session_id)
    service = SessionStartsService(
        run_admission=admission,
        inputs_service=inputs,
        executions_dao=AsyncMock(),
        workflows_service=workflows,
        lock_engine=_MemoryLock(),
        streams_dao=streams,
        poll_timeout_seconds=0,
    )
    policy = AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=USER_ID)

    with pytest.raises(AdmissionDenied):
        await service.start_once(**_args(), access=policy)

    assert admission.methods() == ["admit_request", "admit"]
    assert admission.calls[1][1]["session_id"] == session_id
    inputs.claim_for_execution.assert_not_awaited()
    inputs.claim_dispatch.assert_not_awaited()
    workflows.invoke_workflow_detached.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_start_on_a_channel_thread_s_id_claims_nothing():
    """A channel thread names the start's session id: only that channel's run creates
    the row, so the insert refuses (`SessionIdTombstoned`, answered as a hidden
    session) and nothing is claimed or dispatched."""
    from oss.src.core.sessions.streams.types import SessionIdTombstoned
    from oss.src.core.sharing.dtos import AccessPolicy, Visibility

    session_id = SessionStartsService.session_id_for(
        project_id=PROJECT_ID, request_key="load-1"
    )
    streams = AsyncMock()
    streams.create.side_effect = SessionIdTombstoned(session_id=session_id)
    inputs = AsyncMock()
    workflows = AsyncMock()
    service = SessionStartsService(
        run_admission=RecordingRunAdmission(),
        inputs_service=inputs,
        executions_dao=AsyncMock(),
        workflows_service=workflows,
        lock_engine=_MemoryLock(),
        streams_dao=streams,
        poll_timeout_seconds=0,
    )
    policy = AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=USER_ID)

    with pytest.raises(SessionIdTombstoned):
        await service.start_once(**_args(), access=policy)

    inputs.claim_for_execution.assert_not_awaited()
    inputs.claim_dispatch.assert_not_awaited()
    workflows.invoke_workflow_detached.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_retry_into_a_session_the_caller_cannot_send_to_claims_nothing():
    """A retry with the same key from a caller who may not run the existing session is
    refused by the first admission (it names the session), before any claim."""

    session_id = SessionStartsService.session_id_for(
        project_id=PROJECT_ID, request_key="load-1"
    )

    def refuse(method, kwargs):
        if method == "admit_request" and kwargs.get("session_id") == session_id:
            return AdmissionDenied(
                decision=Decision(allowed=False, reason=DecisionReason.RESOURCE_DENIED),
                readable=True,
                boundary=kwargs["boundary"],
            )
        return None

    inputs = AsyncMock()
    workflows = AsyncMock()
    service = _service(
        inputs=inputs,
        workflows=workflows,
        admission=RecordingRunAdmission(refuse=refuse),
    )
    with pytest.raises(AdmissionDenied):
        await service.start_once(**_args())
    inputs.claim_for_execution.assert_not_awaited()
    workflows.invoke_workflow_detached.assert_not_awaited()
