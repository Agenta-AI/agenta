from contextlib import asynccontextmanager
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from oss.src.core.sessions.inputs.dtos import PendingInput, PendingInputState
from oss.src.core.sessions.inputs.service import SessionInputsService
from oss.src.core.sessions.inputs.types import (
    SessionInputBusy,
    SessionInputIdempotencyConflict,
)
from oss.src.utils.env import env


class MemoryInputsDAO:
    def __init__(self):
        self.items = []

    @asynccontextmanager
    async def transaction(self):
        yield self

    async def fetch_by_idempotency_key(self, **kwargs):
        return next(
            (
                item
                for item in self.items
                if item.project_id == kwargs["project_id"]
                and item.session_id == kwargs["session_id"]
                and item.idempotency_key == kwargs["idempotency_key"]
            ),
            None,
        )

    async def create_input(self, *, user_id, pending_input, prioritize=False, **_kwargs):
        item = PendingInput(
            id=uuid4(),
            created_at=datetime.now(timezone.utc),
            created_by_id=user_id,
            position=(-1 if prioritize else len(self.items) + 1),
            state=PendingInputState.pending,
            **pending_input.model_dump(),
        )
        self.items.append(item)
        return item

    async def list_pending(self, *, project_id, session_id):
        return sorted(
            [
                item
                for item in self.items
                if item.project_id == project_id
                and item.session_id == session_id
                and item.state == PendingInputState.pending
            ],
            key=lambda item: item.position,
        )

    async def fetch_input(self, *, project_id, session_id, input_id):
        return next(
            (
                item
                for item in self.items
                if item.project_id == project_id
                and item.session_id == session_id
                and item.id == input_id
            ),
            None,
        )

    async def remove_pending(self, *, project_id, session_id, input_id, **_kwargs):
        item = await self.fetch_input(
            project_id=project_id, session_id=session_id, input_id=input_id
        )
        if item is None or item.state != PendingInputState.pending:
            return None
        item.state = PendingInputState.removed
        return item


class Streams:
    def __init__(self, *, running=True):
        self.running = running

    async def fetch_header(self, **_kwargs):
        return SimpleNamespace(
            flags=SimpleNamespace(is_running=self.running), turn_id="execution-1"
        )


@pytest.mark.asyncio
async def test_busy_queue_is_rejected_when_switch_is_off(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "queue", False)
    service = SessionInputsService(inputs_dao=MemoryInputsDAO(), streams_service=Streams())

    with pytest.raises(SessionInputBusy):
        await service.admit(
            project_id=uuid4(),
            user_id=uuid4(),
            session_id="session-1",
            content={"message": "later"},
            policy="queue",
            idempotency_key="key-1",
        )


@pytest.mark.asyncio
async def test_busy_queue_is_durable_and_removable(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    project_id = uuid4()
    user_id = uuid4()
    dao = MemoryInputsDAO()
    service = SessionInputsService(inputs_dao=dao, streams_service=Streams())

    admitted = await service.admit(
        project_id=project_id,
        user_id=user_id,
        session_id="session-1",
        content={"message": "later"},
        policy="queue",
        idempotency_key="key-1",
    )

    assert admitted.action == "pending"
    assert admitted.input is not None
    assert await service.list_pending(project_id=project_id, session_id="session-1") == [
        admitted.input
    ]
    removed = await service.remove(
        project_id=project_id,
        user_id=user_id,
        session_id="session-1",
        input_id=admitted.input.id,
    )
    assert removed.state == PendingInputState.removed
    assert await service.list_pending(project_id=project_id, session_id="session-1") == []


@pytest.mark.asyncio
async def test_idle_input_executes_without_being_queued(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    dao = MemoryInputsDAO()
    service = SessionInputsService(
        inputs_dao=dao, streams_service=Streams(running=False)
    )

    admitted = await service.admit(
        project_id=uuid4(),
        user_id=uuid4(),
        session_id="session-1",
        content={"message": "now"},
        policy="queue",
        idempotency_key="key-1",
    )

    assert admitted.action == "execute"
    assert dao.items == []


@pytest.mark.asyncio
async def test_queue_idempotency_returns_same_input_and_rejects_conflicting_reuse(
    monkeypatch,
):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    project_id = uuid4()
    service = SessionInputsService(
        inputs_dao=MemoryInputsDAO(), streams_service=Streams()
    )
    kwargs = {
        "project_id": project_id,
        "user_id": uuid4(),
        "session_id": "session-1",
        "content": {"message": "later"},
        "policy": "queue",
        "idempotency_key": "key-1",
    }

    first = await service.admit(**kwargs)
    retry = await service.admit(**kwargs)
    assert retry.input.id == first.input.id

    with pytest.raises(SessionInputIdempotencyConflict):
        await service.admit(**{**kwargs, "content": {"message": "different"}})


@pytest.mark.asyncio
async def test_steer_is_saved_ahead_of_queued_input(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    monkeypatch.setattr(env.agenta.sessions, "steer", True)
    project_id = uuid4()
    dao = MemoryInputsDAO()
    service = SessionInputsService(inputs_dao=dao, streams_service=Streams())

    queued = await service.admit(
        project_id=project_id,
        user_id=uuid4(),
        session_id="session-1",
        content={"message": "later"},
        policy="queue",
        idempotency_key="queue-1",
    )
    steered = await service.admit(
        project_id=project_id,
        user_id=uuid4(),
        session_id="session-1",
        content={"message": "now"},
        policy="steer",
        idempotency_key="steer-1",
    )

    pending = await service.list_pending(
        project_id=project_id, session_id="session-1"
    )
    assert [item.id for item in pending] == [steered.input.id, queued.input.id]
    assert steered.execution_id == "execution-1"
