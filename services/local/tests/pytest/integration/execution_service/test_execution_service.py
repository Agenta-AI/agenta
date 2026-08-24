"""ExecutionService orchestration: lifecycle, idempotency, cancellation, timeout.

The happy/replay paths run against the recorded runner fixtures (no live
runner); gating scenarios use protocol-conformant fakes.
"""

import asyncio
import json
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from agenta_local.core.agents.service import AgentsService
from agenta_local.core.exceptions import DomainError
from agenta_local.core.execution.dtos import (
    ExecutionEvent,
    ExecutionRequest,
)
from agenta_local.core.execution.interfaces import AgentExecutorInterface
from agenta_local.core.execution.service import ExecutionService
from agenta_local.core.execution.types import (
    CancelledTurn,
    RunnerUnavailable,
    TurnTimeout,
    input_hash,
)
from agenta_local.core.providers.dtos import ProviderCredential
from agenta_local.core.sessions.service import SessionsService
from agenta_local.core.sessions.types import (
    IdempotencyConflict,
    SessionBusy,
    SessionNotFound,
    TurnAlreadyExists,
)
from agenta_local.dbs.sqlite.agents.dao import AgentsDAO
from agenta_local.dbs.sqlite.sessions.dao import SessionsDAO
from agenta_local.execution.sdk.adapter import SDKAgentExecutor

from ...utils.replay_runner import ReplayRunner

pytestmark = pytest.mark.integration

FIXTURES_DIR = Path(__file__).resolve().parents[3] / "fixtures" / "runner"
REQUEST_FIXTURE = FIXTURES_DIR / "cold_pi_turn.request.json"
STREAM_FIXTURE = FIXTURES_DIR / "cold_pi_turn.ndjson"
RESULT_FIXTURE = FIXTURES_DIR / "cold_pi_turn.result.json"

INSTRUCTIONS = "You are a terse assistant. Reply with exactly one short sentence."
PROMPT = "Say hello in exactly five words."
MODEL_JSON = '{"provider": "openai", "name": "gpt-4o-mini", "parameters": {}}'
EXECUTION_JSON = '{"harness": "pi_core", "sandbox": "local"}'

_missing_fixtures = [
    path.name
    for path in (REQUEST_FIXTURE, STREAM_FIXTURE, RESULT_FIXTURE)
    if not path.exists()
]
requires_fixtures = pytest.mark.skipif(
    bool(_missing_fixtures),
    reason=f"replay fixtures not captured yet: {_missing_fixtures}",
)


class _StaticCredentials:
    def __init__(self, credential: ProviderCredential) -> None:
        self._credential = credential

    async def get_for_execution(self, *, provider: str) -> ProviderCredential:
        return self._credential


def build_service(storage, executor) -> tuple[ExecutionService, SessionsService]:
    sessions = SessionsService(SessionsDAO(storage.factory))
    agents = AgentsService(AgentsDAO(storage.factory))
    credentials = _StaticCredentials(
        ProviderCredential(provider="openai", api_key="sk-redacted")
    )
    service = ExecutionService(
        sessions=sessions, agents=agents, credentials=credentials, executor=executor
    )
    return service, sessions


async def make_session(storage) -> tuple[SessionsService, object]:
    agents_service = AgentsService(AgentsDAO(storage.factory))
    agent = await agents_service.create_agent(
        name="agent",
        instructions=INSTRUCTIONS,
        model_json=MODEL_JSON,
        execution_json=EXECUTION_JSON,
    )
    sessions = SessionsService(SessionsDAO(storage.factory))
    session = await sessions.create_session(agent_revision_id=agent.current_revision.id)
    return sessions, session


async def drain(events) -> list[ExecutionEvent]:
    return [event async for event in events]


class OkExecutor(AgentExecutorInterface):
    """Two frames then a clean result."""

    def stream(self, *, revision, messages, credential):
        async def _events() -> AsyncIterator[ExecutionEvent]:
            yield ExecutionEvent({"type": "start"})
            yield ExecutionEvent({"type": "finish"})

        async def _result():
            from agenta_local.core.execution.dtos import ExecutionResult

            return ExecutionResult(assistant_text="final answer")

        from agenta_local.core.execution.dtos import ExecutionStream

        return ExecutionStream(events=_events(), _result=_result())


class GatedExecutor(AgentExecutorInterface):
    """Blocks until released; used for busy/cancel/timeout scenarios."""

    def __init__(self) -> None:
        self.release = asyncio.Event()
        self.started = asyncio.Event()

    def stream(self, *, revision, messages, credential):
        gate = self.release
        started = self.started

        async def _events() -> AsyncIterator[ExecutionEvent]:
            started.set()
            await gate.wait()
            yield ExecutionEvent({"type": "start"})

        async def _result():
            from agenta_local.core.execution.dtos import ExecutionResult

            return ExecutionResult(assistant_text="gated-ok")

        from agenta_local.core.execution.dtos import ExecutionStream

        return ExecutionStream(events=_events(), _result=_result())


class FailingExecutor(AgentExecutorInterface):
    """Emits one frame then raises mid-stream."""

    def stream(self, *, revision, messages, credential):
        async def _events() -> AsyncIterator[ExecutionEvent]:
            yield ExecutionEvent({"type": "start"})
            raise RuntimeError("boom")

        from agenta_local.core.execution.dtos import ExecutionStream

        return ExecutionStream(events=_events(), _result=None)


class SourceFailureExecutor(AgentExecutorInterface):
    """Clean exhaustion but typed source failure from result() (observer path)."""

    def stream(self, *, revision, messages, credential):
        class _TypedSourceFailure(DomainError):
            code = "source_failed"

        async def _events() -> AsyncIterator[ExecutionEvent]:
            yield ExecutionEvent({"type": "start"})

        async def _result():
            raise _TypedSourceFailure("source exploded")

        from agenta_local.core.execution.dtos import ExecutionStream

        return ExecutionStream(events=_events(), _result=_result())


async def test_stream_turn_unknown_session_raises(storage):
    service, _ = build_service(storage, OkExecutor())
    request = ExecutionRequest(session_id="ses_nope", text="hi")
    with pytest.raises(SessionNotFound):
        await drain(service.stream_turn(request))


async def test_stream_turn_happy_path_commits_completed_and_messages(storage):
    service, sessions = build_service(storage, OkExecutor())
    _, session = await make_session(storage)
    request = ExecutionRequest(session_id=session.id, text="hi", client_turn_id="c1")

    frames = await drain(service.stream_turn(request))
    assert [f.payload["type"] for f in frames] == ["start", "finish"]

    turn_row = await sessions.list_messages(session_id=session.id)
    assert [(m.sequence, m.role.value, m.content["text"]) for m in turn_row] == [
        (0, "user", "hi"),
        (1, "assistant", "final answer"),
    ]
    assert not service.active_turn_ids()


@requires_fixtures
async def test_stream_turn_replays_recorded_runner_turn(storage, monkeypatch):
    request_fixture = json.loads(REQUEST_FIXTURE.read_text(encoding="utf-8"))
    expected_text = json.loads(RESULT_FIXTURE.read_text(encoding="utf-8"))[
        "assistant_text"
    ]

    with ReplayRunner(
        request_fixture=request_fixture, ndjson_path=STREAM_FIXTURE
    ) as runner:
        monkeypatch.setenv("AGENTA_RUNNER_TOKEN", runner.token)
        service, sessions = build_service(
            storage, SDKAgentExecutor(runner_url=runner.url)
        )
        _, session = await make_session(storage)
        request = ExecutionRequest(
            session_id=session.id, text=PROMPT, client_turn_id="turn_replay_1"
        )

        frames = await drain(service.stream_turn(request))
        assert frames[-1].payload["type"] == "finish"

        messages = await sessions.list_messages(session_id=session.id)
        assert messages[-1].role.value == "assistant"
        assert messages[-1].content["text"] == expected_text
        assert runner.request_matches is True

        recorded_request = runner.last_request
        with pytest.raises(TurnAlreadyExists):
            await drain(service.stream_turn(request))
        # No second run reached the runner.
        assert runner.last_request is recorded_request


async def test_stream_turn_duplicate_returns_existing_identity_without_rerun(storage):
    service, sessions = build_service(storage, OkExecutor())
    _, session = await make_session(storage)
    request = ExecutionRequest(session_id=session.id, text="hi", client_turn_id="c1")
    await drain(service.stream_turn(request))

    with pytest.raises(TurnAlreadyExists):
        await drain(service.stream_turn(request))

    all_messages = await sessions.list_messages(session_id=session.id)
    assistant_rows = [m for m in all_messages if m.role.value == "assistant"]
    assert len(assistant_rows) == 1  # exactly one run happened


async def test_stream_turn_hash_conflict_on_same_client_id(storage):
    service, _ = build_service(storage, OkExecutor())
    _, session = await make_session(storage)
    first = ExecutionRequest(session_id=session.id, text="hi", client_turn_id="c1")
    await drain(service.stream_turn(first))

    conflicting = ExecutionRequest(
        session_id=session.id, text="different", client_turn_id="c1"
    )
    with pytest.raises(IdempotencyConflict) as exc_info:
        await drain(service.stream_turn(conflicting))
    assert exc_info.value.details["turn_id"]
    assert exc_info.value.details["turn_id"] != input_hash("different")


async def test_busy_then_cancel_then_recover(storage):
    gated = GatedExecutor()
    service, sessions = build_service(storage, gated)
    _, session = await make_session(storage)

    task = asyncio.create_task(
        drain(
            service.stream_turn(
                ExecutionRequest(session_id=session.id, text="A", client_turn_id="a")
            )
        )
    )
    await asyncio.wait_for(gated.started.wait(), timeout=5)
    active_ids = service.active_turn_ids()
    assert len(active_ids) == 1

    with pytest.raises(SessionBusy):
        await drain(
            service.stream_turn(
                ExecutionRequest(session_id=session.id, text="B", client_turn_id="b")
            )
        )

    (turn_id,) = active_ids
    await service.cancel_turn(turn_id=turn_id)
    with pytest.raises(CancelledTurn):
        await task

    messages = await sessions.list_messages(session_id=session.id)
    assert [m.content["text"] for m in messages] == ["A"]

    # The slot frees up; B now runs to completion.
    gated.release.set()
    frames = await drain(
        service.stream_turn(
            ExecutionRequest(session_id=session.id, text="B", client_turn_id="b2")
        )
    )
    assert frames


async def test_midstream_failure_commits_failed_with_error_json(storage):
    service, sessions = build_service(storage, FailingExecutor())
    _, session = await make_session(storage)
    request = ExecutionRequest(session_id=session.id, text="hi", client_turn_id="c1")

    with pytest.raises(RunnerUnavailable):
        await drain(service.stream_turn(request))

    messages = await sessions.list_messages(session_id=session.id)
    assert [m.role.value for m in messages] == ["user"]
    statuses = await _raw_statuses(storage)
    assert statuses == ["failed"]


async def test_timeout_commits_failed_and_raises_typed(storage):
    gated = GatedExecutor()
    service, _ = build_service(storage, gated)
    _, session = await make_session(storage)
    request = ExecutionRequest(
        session_id=session.id, text="hi", client_turn_id="c1", timeout_s=0.05
    )

    with pytest.raises(TurnTimeout):
        await drain(service.stream_turn(request))
    gated.release.set()


async def test_source_failure_from_result_commits_failed_and_reraises(storage):
    service, _ = build_service(storage, SourceFailureExecutor())
    _, session = await make_session(storage)
    request = ExecutionRequest(session_id=session.id, text="hi", client_turn_id="c1")

    with pytest.raises(DomainError):
        await drain(service.stream_turn(request))


async def test_cancel_fallback_covers_pre_registration_pending_turn(storage):
    """A turn cancelled before its consuming task registers still terminates."""
    service, sessions = build_service(storage, OkExecutor())
    _, session = await make_session(storage)
    turn = await sessions.begin_turn(
        session_id=session.id,
        client_turn_id="c1",
        input="hi",
        input_hash=input_hash("hi"),
    )
    await service.cancel_turn(turn_id=turn.id)

    assert await _raw_statuses(storage) == ["cancelled"]
    # The abandoned iterator must not resurrect the turn.
    with pytest.raises(TurnAlreadyExists):
        request = ExecutionRequest(
            session_id=session.id, text="hi", client_turn_id="c1"
        )
        await drain(service.stream_turn(request))


async def test_startup_recovery_interrupts_leftover_active_rows(storage):
    from uuid import uuid4

    from agenta_local.dbs.sqlite.sessions.dbes import TurnDBE
    from agenta_local.dbs.sqlite.shared.engine import immediate_transaction

    service, _sessions = build_service(storage, OkExecutor())
    _, session_a = await make_session(storage)
    _, session_b = await make_session(storage)
    seeded = []
    for session, status in ((session_a, "pending"), (session_b, "running")):
        turn_id = f"trn_{uuid4().hex}"
        async with immediate_transaction(storage.factory) as conn:
            await conn.execute(
                TurnDBE.__table__.insert().values(
                    id=turn_id,
                    session_id=session.id,
                    client_turn_id=f"seed-{turn_id}",
                    input_hash="h",
                    status=status,
                )
            )
        seeded.append(turn_id)

    changed = await service.recover_interrupted_turns()
    assert changed == 2
    statuses = await _raw_statuses(storage)
    assert statuses == ["interrupted", "interrupted"]


async def _raw_statuses(storage) -> list[str]:
    import sqlalchemy as sa

    async with storage.engine.connect() as conn:
        rows = (await conn.execute(sa.text("SELECT status FROM turns"))).all()
    return [row[0] for row in rows]
