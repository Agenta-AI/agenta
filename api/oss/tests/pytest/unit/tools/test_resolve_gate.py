"""The server's answer at the approval gate of a session write (design D12, D34):
`resolve_gate` for the three call refs, with stub sessions and agents, and the real
`is_sent_by_person` over in-memory turn rows."""

import json
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from oss.src.apis.fastapi.tools.router import ToolsRouter
from oss.src.core.access.context import reset_request_access, set_request_access
from oss.src.core.access.dtos import RunContext, RunOrigin
from oss.src.core.access.permissions.types import Permission
from oss.src.core.sessions.executions.dtos import SessionExecutionSettlement
from oss.src.core.sessions.inputs.dtos import PendingInputKind
from oss.src.core.sessions.streams.dtos import SessionStream
from oss.src.core.sessions.types import SessionCallingSession, SessionReference
from oss.src.core.tools import gate as gate_module
from oss.src.core.tools import platform_handlers
from oss.src.core.tools.dtos import ToolCall, ToolCallData, ToolCallFunction
from oss.src.core.tools.gate import GateReader, resolve_gate, target_slug
from oss.src.core.tools.platform_handlers import (
    PLATFORM_TOOL_HANDLERS,
    RESOLVE_GATE_CALL_REF,
    RUN_CREDENTIAL_REQUIRED,
    RUNNER_ONLY_CALL_REFS,
    SessionCaller,
)
from oss.tests.pytest.utils.principals import make_envelope, make_request_access
from oss.tests.pytest.utils.sharing import NoopRunAdmission

START = "tools.agenta.start_session"
SEND = "tools.agenta.send_session_message"
CANCEL = "tools.agenta.cancel_session"

PROJECT_ID = uuid4()
USER_ID = uuid4()
CALLER_SESSION = "chief-of-staff-session"
CALLER_AGENT_ID = uuid4()
EMAIL_WRITER_ID = uuid4()
BLOG_WRITER_ID = uuid4()
SLUGS = {EMAIL_WRITER_ID: "email-writer", BLOG_WRITER_ID: "blog-writer"}


# --------------------------------------------------------------------------- #
# Stubs
# --------------------------------------------------------------------------- #
class _Streams:
    def __init__(self):
        self.rows = {}

    def add(self, session_id, *, turn_id=None, agent_id=None, calling=None):
        self.rows[session_id] = SessionStream(
            id=uuid4(),
            project_id=PROJECT_ID,
            session_id=session_id,
            turn_id=turn_id,
            references=(
                [SessionReference(key="workflow", id=agent_id)] if agent_id else None
            ),
            calling_session=(
                SessionCallingSession(
                    id=calling,
                    turn_id=str(uuid4()),
                    agent_id=CALLER_AGENT_ID,
                    revision_id=uuid4(),
                )
                if calling
                else None
            ),
        )

    async def get_by_session_id(self, *, project_id, session_id):
        if project_id != PROJECT_ID:
            return None
        return self.rows.get(session_id)


class _Executions:
    def __init__(self):
        self.rows = {}

    async def fetch_execution(self, *, project_id, session_id, execution_id, **_):
        return self.rows.get((session_id, execution_id))


class _Inputs:
    def __init__(self):
        self.kinds = {}

    async def fetch_by_execution_id(self, *, project_id, session_id, execution_id):
        kind = self.kinds.get(execution_id)
        return SimpleNamespace(kind=kind) if kind else None


class _Turns:
    def __init__(self):
        self.origins = {}

    async def find_turn(self, *, project_id, session_id, turn_id):
        if (session_id, turn_id) not in self.origins:
            return None
        return SimpleNamespace(
            context=RunContext(origin=self.origins[(session_id, turn_id)])
        )


class _Workflows:
    async def fetch_workflow(self, *, project_id, workflow_ref, include_archived):
        if project_id != PROJECT_ID:
            return None
        ids = {slug: agent_id for agent_id, slug in SLUGS.items()}
        if workflow_ref.id is not None:
            slug = SLUGS.get(workflow_ref.id)
            return SimpleNamespace(id=workflow_ref.id, slug=slug) if slug else None
        if workflow_ref.slug in ids:
            return SimpleNamespace(id=ids[workflow_ref.slug], slug=workflow_ref.slug)
        return None


class _World:
    """'Chief of staff' runs in `CALLER_SESSION`; its current execution is `execution`."""

    def __init__(self):
        self.streams = _Streams()
        self.executions = _Executions()
        self.inputs = _Inputs()
        self.turns = _Turns()
        self.reader = GateReader(
            streams_dao=self.streams,
            executions_dao=self.executions,
            inputs_dao=self.inputs,
            turns_dao=self.turns,
            workflows_service=_Workflows(),
        )
        self.execution = str(uuid4())
        self.streams.add(CALLER_SESSION, turn_id=self.execution)
        self.turn(self.execution, RunOrigin.WEB)
        # The sessions and the agents the run authority may run.
        self.runnable = set()
        self.runnable_agents = set(SLUGS)
        self.caller = SessionCaller(
            envelope=make_envelope(project_id=PROJECT_ID, principal_id=USER_ID),
            run_session_id=CALLER_SESSION,
            run_agent_id=CALLER_AGENT_ID,
        )

    def turn(self, execution_id, origin, *, kind=None):
        self.turns.origins[(CALLER_SESSION, UUID(execution_id))] = origin
        if kind is not None:
            self.inputs.kinds[execution_id] = kind

    def child(self, session_id, agent_id, *, calling=CALLER_SESSION, runnable=True):
        self.streams.add(session_id, agent_id=agent_id, calling=calling)
        if runnable:
            self.runnable.add(session_id)
        return session_id

    async def answer(
        self,
        call_ref,
        call_arguments,
        *,
        configured="allow",
        targets=None,
        execution=None,
        **overrides,
    ):
        payload = {
            "call_ref": call_ref,
            "arguments": call_arguments,
            "execution_id": execution or self.execution,
            "configured_permission": configured,
            "target_permissions": targets or {},
            **overrides,
        }
        answer = await resolve_gate(
            caller=self.caller,
            project_id=PROJECT_ID,
            arguments=payload,
            reader=self.reader,
        )
        return answer.model_dump()


@pytest.fixture
def world(monkeypatch):
    world = _World()

    async def _caller_may(caller, *, session_id, action):
        assert caller is world.caller
        assert action == Permission.RUN_SESSIONS
        return session_id in world.runnable

    async def _may_run_agent(*, envelope, agent_id):
        assert envelope is world.caller.envelope
        return agent_id in world.runnable_agents

    monkeypatch.setattr(gate_module, "caller_may", _caller_may)
    monkeypatch.setattr(gate_module, "may_run_agent", _may_run_agent)
    return world


ALLOW = {"permission": "allow", "basis": "configured_permission"}
DENY = {"permission": "deny", "basis": "configured_permission"}
ASK = {"permission": "ask", "basis": None}


# --------------------------------------------------------------------------- #
# The permission per target
# --------------------------------------------------------------------------- #
async def test_an_allow_and_an_ask_entry_in_one_agent(world):
    """'Chief of staff' in mode `allow`: 'Email writer' asks, 'Blog writer' sets none."""
    targets = {"email-writer": "ask"}
    assert await world.answer(START, {"agent": "email-writer"}, targets=targets) == ASK
    assert await world.answer(START, {"agent": "blog-writer"}, targets=targets) == ALLOW


async def test_a_start_by_agent_id_reads_the_entry_by_slug(world):
    answer = await world.answer(
        START, {"agent": str(EMAIL_WRITER_ID)}, targets={"email-writer": "ask"}
    )
    assert answer == ASK
    assert (
        await target_slug(
            call_ref=START,
            arguments={"agent": str(EMAIL_WRITER_ID)},
            caller=world.caller,
            project_id=PROJECT_ID,
            reader=world.reader,
        )
        == "email-writer"
    )


async def test_a_deny_entry_refuses_a_start(world):
    answer = await world.answer(
        START, {"agent": "email-writer"}, targets={"email-writer": "deny"}
    )
    assert answer == DENY


async def test_a_deny_entry_set_after_the_child_started_refuses_the_send(world):
    child = world.child("email-child", EMAIL_WRITER_ID)
    assert await world.answer(SEND, {"session_id": child, "message": "Hi"}) == ALLOW
    # The author sets `deny` on the entry; the next run's spec carries it.
    answer = await world.answer(
        SEND, {"session_id": child, "message": "Hi"}, targets={"email-writer": "deny"}
    )
    assert answer == DENY


async def test_an_ask_tool_stays_ask_whatever_the_entry(world):
    answer = await world.answer(
        START,
        {"agent": "email-writer"},
        configured="ask",
        targets={"email-writer": "allow"},
    )
    assert answer == ASK


async def test_cancel_reads_the_configured_permission_only(world):
    child = world.child("email-child", EMAIL_WRITER_ID)
    targets = {"email-writer": "deny"}
    assert await world.answer(CANCEL, {"session_id": child}, targets=targets) == ALLOW
    assert await world.answer(CANCEL, {"session_id": child}, configured="ask") == ASK
    assert await world.answer(CANCEL, {"session_id": child}, configured="deny") == DENY


# --------------------------------------------------------------------------- #
# The execution and the person
# --------------------------------------------------------------------------- #
async def test_an_older_execution_gets_ask(world):
    older = str(uuid4())
    world.turn(older, RunOrigin.WEB)
    assert await world.answer(START, {"agent": "blog-writer"}, execution=older) == ASK
    # Even for a deny target: the answer is advice to the current execution only.
    answer = await world.answer(
        START,
        {"agent": "email-writer"},
        targets={"email-writer": "deny"},
        execution=older,
    )
    assert answer == ASK


async def test_the_builders_send_in_a_persons_turn_and_in_a_child_update_turn(world):
    """The builder has no entries; its configured permission comes from its tools."""
    child = world.child("test-session", EMAIL_WRITER_ID)
    arguments = {"session_id": child, "message": "Try again"}
    assert await world.answer(SEND, arguments) == ALLOW

    update = str(uuid4())
    world.turn(update, RunOrigin.WEB, kind=PendingInputKind.child_update)
    world.streams.rows[CALLER_SESSION].turn_id = update
    assert await world.answer(SEND, arguments, execution=update) == ASK


@pytest.mark.parametrize("origin", [RunOrigin.SCHEDULE, RunOrigin.SUBSCRIPTION])
async def test_a_schedule_or_subscription_turn_that_starts_a_session_gets_ask(
    world, origin
):
    world.turn(world.execution, origin)
    assert await world.answer(START, {"agent": "blog-writer"}) == ASK


async def test_a_deny_target_is_refused_in_a_turn_no_person_sent(world):
    world.turn(world.execution, RunOrigin.SUBSCRIPTION)
    answer = await world.answer(
        START, {"agent": "email-writer"}, targets={"email-writer": "deny"}
    )
    assert answer == DENY


async def test_cancel_in_a_child_update_turn_gets_ask(world):
    child = world.child("email-child", EMAIL_WRITER_ID)
    world.turn(world.execution, RunOrigin.WEB, kind=PendingInputKind.child_update)
    assert await world.answer(CANCEL, {"session_id": child}) == ASK


async def test_a_queued_child_update_after_a_persons_turn_gets_ask(world):
    """A child update that waited behind a person's turn is promoted into a new
    execution whose parent is that turn's execution. It is its own turn, not the
    person's, so its session writes ask."""
    persons_turn = world.execution
    promoted = str(uuid4())
    world.executions.rows[(CALLER_SESSION, promoted)] = SessionExecutionSettlement(
        project_id=PROJECT_ID,
        session_id=CALLER_SESSION,
        execution_id=promoted,
        parent_execution_id=persons_turn,
    )
    world.turn(promoted, RunOrigin.WEB, kind=PendingInputKind.child_update)
    world.streams.add(CALLER_SESSION, turn_id=promoted)
    assert await world.answer(START, {"agent": "blog-writer"}, execution=promoted) == (
        ASK
    )


async def test_an_approval_continuation_of_a_persons_turn_keeps_it(world):
    # The paused execution settled, so it has a row; the continuation names it.
    world.executions.rows[(CALLER_SESSION, world.execution)] = (
        SessionExecutionSettlement(
            project_id=PROJECT_ID,
            session_id=CALLER_SESSION,
            execution_id=world.execution,
        )
    )
    continuation = str(uuid4())
    world.executions.rows[(CALLER_SESSION, continuation)] = SessionExecutionSettlement(
        project_id=PROJECT_ID,
        session_id=CALLER_SESSION,
        execution_id=continuation,
        parent_execution_id=world.execution,
        source_interaction_id=uuid4(),
    )
    world.streams.add(CALLER_SESSION, turn_id=continuation)
    assert (
        await world.answer(START, {"agent": "blog-writer"}, execution=continuation)
        == ALLOW
    )


async def test_an_api_key_turn_counts_as_sent_by_a_person(world):
    world.turn(world.execution, RunOrigin.API)
    assert await world.answer(START, {"agent": "blog-writer"}) == ALLOW


# --------------------------------------------------------------------------- #
# Targets the server cannot resolve, and faults
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "arguments",
    [{}, {"agent": ""}, {"agent": "not a slug"}, {"agent": "unknown-agent"}],
)
async def test_a_start_target_that_is_not_found_gets_ask(world, arguments):
    assert await world.answer(START, arguments) == ASK


async def test_a_hidden_agent_reads_as_an_unknown_one(world):
    """An agent the run authority may not run answers like one that does not exist, so
    a `deny` guess cannot tell that a private agent is there."""
    world.runnable_agents.discard(EMAIL_WRITER_ID)
    for agent in ("email-writer", str(EMAIL_WRITER_ID)):
        answer = await world.answer(
            START, {"agent": agent}, configured="deny", targets={"email-writer": "deny"}
        )
        assert answer == await world.answer(
            START, {"agent": "unknown-agent"}, configured="deny"
        )
        assert answer == ASK
    child = world.child("email-child", EMAIL_WRITER_ID)
    assert await world.answer(SEND, {"session_id": child}) == ASK


async def test_a_send_to_a_session_that_is_not_a_child_gets_ask(world):
    other = world.child("other-session", EMAIL_WRITER_ID, calling="another-session")
    assert await world.answer(SEND, {"session_id": other}) == ASK
    orphan = world.child("orphan-session", EMAIL_WRITER_ID, calling=None)
    assert await world.answer(SEND, {"session_id": orphan}) == ASK
    assert await world.answer(SEND, {"session_id": "no-such-session"}) == ASK
    assert await world.answer(SEND, {}) == ASK


async def test_a_send_to_a_child_the_person_cannot_run_gets_ask(world):
    child = world.child("private-child", BLOG_WRITER_ID, runnable=False)
    assert await world.answer(SEND, {"session_id": child}) == ASK


async def test_a_send_to_a_child_with_no_agent_reference_gets_ask(world):
    child = world.child("new-child", None)
    assert await world.answer(SEND, {"session_id": child}) == ASK


@pytest.mark.parametrize(
    "call_ref", ["tools.agenta.commit_revision", "tools.agenta.resolve_gate", ""]
)
async def test_another_call_ref_gets_ask(world, call_ref):
    assert await world.answer(call_ref, {"agent": "blog-writer"}) == ASK


@pytest.mark.parametrize(
    "overrides",
    [
        {"configured_permission": None},
        {"configured_permission": "allow_reads"},
        {"target_permissions": {"blog-writer": "maybe"}},
        {"execution_id": ""},
        {"arguments": "not an object"},
        {"caller_session_id": "another-session"},
    ],
)
async def test_a_malformed_request_gets_ask(world, overrides):
    assert await world.answer(START, {"agent": "blog-writer"}, **overrides) == ASK


async def test_a_calling_session_with_no_row_gets_ask(world):
    del world.streams.rows[CALLER_SESSION]
    assert await world.answer(START, {"agent": "blog-writer"}) == ASK


async def test_a_fault_gets_ask(world):
    async def _broken(**_kwargs):
        raise RuntimeError("database is down")

    world.reader.agent_slug = _broken
    assert await world.answer(START, {"agent": "blog-writer"}) == ASK


async def test_a_json_string_request_is_read(world):
    payload = json.dumps(
        {
            "call_ref": START,
            "arguments": {"agent": "blog-writer"},
            "execution_id": world.execution,
            "configured_permission": "allow",
            "target_permissions": {},
        }
    )
    answer = await resolve_gate(
        caller=world.caller,
        project_id=PROJECT_ID,
        arguments=payload,
        reader=world.reader,
    )
    assert answer.model_dump() == ALLOW


# --------------------------------------------------------------------------- #
# The op
# --------------------------------------------------------------------------- #
def test_the_op_is_runner_only_and_needs_the_run_credential():
    assert RESOLVE_GATE_CALL_REF in RUNNER_ONLY_CALL_REFS
    registration = PLATFORM_TOOL_HANDLERS[RESOLVE_GATE_CALL_REF]
    assert registration.needs_session_caller
    assert registration.needs_gate_reader


async def _tools_call(world, access, arguments):
    router = ToolsRouter(
        run_admission=NoopRunAdmission(),
        tools_service=SimpleNamespace(),
        gate_reader=world.reader,
    )
    request = SimpleNamespace(
        state=SimpleNamespace(
            project_id=str(PROJECT_ID),
            user_id=str(USER_ID),
            run_envelope=access.envelope,
        ),
        headers={},
    )
    body = ToolCall(
        data=ToolCallData(
            id="resolve-gate-call_1",
            function=ToolCallFunction(name=RESOLVE_GATE_CALL_REF, arguments=arguments),
        )
    )
    token = set_request_access(access)
    try:
        return await router.call_tool(request, body=body)
    finally:
        reset_request_access(token)


def _access(world, kind, session_id=None):
    access = make_request_access(envelope=world.caller.envelope, credential_kind=kind)
    return access.model_copy(
        update={"run_session_id": session_id, "run_agent_id": CALLER_AGENT_ID}
    )


@pytest.fixture
def through_tools_call(world, monkeypatch):
    async def _allow(**_kwargs):
        return True

    async def _session_allowed(*, envelope, session_id, action):
        return session_id == CALLER_SESSION

    monkeypatch.setattr("oss.src.apis.fastapi.tools.router.check_action_access", _allow)
    monkeypatch.setattr(platform_handlers, "session_allowed", _session_allowed)
    return world


def _request(world):
    return {
        "call_ref": START,
        "arguments": {"agent": "blog-writer", "message": "Draft it"},
        "execution_id": world.execution,
        "configured_permission": "allow",
        "target_permissions": {"email-writer": "ask"},
    }


@pytest.mark.parametrize("kind", ["bearer_session", "api_key"])
async def test_tools_call_without_a_run_credential_answers_run_credential_required(
    through_tools_call, kind
):
    world = through_tools_call
    response = await _tools_call(
        world, _access(world, kind, CALLER_SESSION), _request(world)
    )
    assert response.call.status.code == "STATUS_CODE_ERROR"
    assert json.loads(response.call.data.content)["code"] == RUN_CREDENTIAL_REQUIRED


async def test_tools_call_with_the_run_credential_answers_the_wire_shape(
    through_tools_call,
):
    world = through_tools_call
    response = await _tools_call(
        world, _access(world, "run_credential", CALLER_SESSION), _request(world)
    )
    assert response.call.status.code == "STATUS_CODE_OK"
    assert json.loads(response.call.data.content) == ALLOW

    ask = {**_request(world), "arguments": {"agent": "email-writer"}}
    response = await _tools_call(
        world, _access(world, "run_credential", CALLER_SESSION), ask
    )
    assert json.loads(response.call.data.content) == ASK
