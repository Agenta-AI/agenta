"""WP7 (W7.1/E6): the command discriminator is `data.inputs` present-or-not x `force`,
not `prompt`.

Pins the matrix in `SessionStreamsService.command()` against the renamed
`SessionStreamCommandRequest.data` field (a `WorkflowServiceRequestData`, so the shape
aligns with `WorkflowInvokeRequest.data.inputs` rather than a bespoke string):

  data.inputs present + no force -> send   (409 if alive)
  data.inputs present + force    -> steer  (cancel holder, start new)
  no data.inputs + no force      -> cancel (cancel holder, run nothing)
  no data.inputs + force         -> attach (steal attached, watch)

Also covers: an empty-dict `inputs` (falsy) is treated as "no inputs", same as a missing
`data`, matching the old `prompt` field's "blank string == no prompt" rule.
"""

from typing import Optional
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio

from agenta.sdk.models.workflows import WorkflowServiceRequestData

from oss.src.core.sessions.streams.dtos import (
    CommandMode,
    SessionStream,
    SessionStreamCommandRequest,
)
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sessions.streams.types import SessionTurnInUse

from unit.sessions.test_project_scoped_locks import _FakeRedis


_PROJECT = uuid4()
_USER = uuid4()


class _FakeStreamsDAO:
    def __init__(self, existing: Optional[SessionStream] = None):
        self.row = existing

    async def get_by_session_id(self, *, project_id: UUID, session_id: str):
        return self.row

    async def create(self, *, project_id, user_id, stream):
        self.row = SessionStream(
            id=uuid4(),
            project_id=project_id,
            session_id=stream.session_id,
            flags=stream.flags,
            turn_id=stream.turn_id,
        )
        return self.row

    async def update(self, *, project_id, user_id, session_id, stream):
        prior = self.row
        self.row = SessionStream(
            id=prior.id if prior else uuid4(),
            project_id=project_id,
            session_id=session_id,
            flags=stream.flags
            if stream.flags is not None
            else (prior.flags if prior else None),
            turn_id=stream.turn_id
            if stream.turn_id is not None
            else (prior.turn_id if prior else None),
        )
        return self.row

    async def delete_by_session_id(self, *, project_id, session_id):
        return True


@pytest_asyncio.fixture
async def lock_engine():
    from oss.src.dbs.redis.shared.engine import LockEngine

    eng = LockEngine()
    with patch.object(eng, "_client", return_value=_FakeRedis()):
        yield eng


def _service(lock_engine, dao=None):
    return SessionStreamsService(
        streams_dao=dao or _FakeStreamsDAO(), lock_engine=lock_engine
    )


def _session_id() -> str:
    return f"session_{uuid4().hex[:12]}"


@pytest.mark.asyncio
async def test_inputs_present_no_force_is_send(lock_engine):
    svc = _service(lock_engine)
    session_id = _session_id()

    result = await svc.command(
        project_id=_PROJECT,
        user_id=_USER,
        request=SessionStreamCommandRequest(
            session_id=session_id,
            data=WorkflowServiceRequestData(inputs={"messages": ["hi"]}),
            force=False,
        ),
    )

    assert result.mode == CommandMode.send
    assert result.turn_id is not None


@pytest.mark.asyncio
async def test_inputs_present_and_force_is_steer(lock_engine):
    svc = _service(lock_engine)
    session_id = _session_id()

    # Establish a holder first (a send), then steer over it.
    await svc.command(
        project_id=_PROJECT,
        user_id=_USER,
        request=SessionStreamCommandRequest(
            session_id=session_id,
            data=WorkflowServiceRequestData(inputs={"messages": ["first"]}),
            force=False,
        ),
    )

    result = await svc.command(
        project_id=_PROJECT,
        user_id=_USER,
        request=SessionStreamCommandRequest(
            session_id=session_id,
            data=WorkflowServiceRequestData(inputs={"messages": ["steer"]}),
            force=True,
        ),
    )

    assert result.mode == CommandMode.steer
    assert result.turn_id is not None


@pytest.mark.asyncio
async def test_no_inputs_no_force_is_cancel(lock_engine):
    svc = _service(lock_engine)
    session_id = _session_id()

    result = await svc.command(
        project_id=_PROJECT,
        user_id=_USER,
        request=SessionStreamCommandRequest(
            session_id=session_id, data=None, force=False
        ),
    )

    assert result.mode == CommandMode.cancel


@pytest.mark.asyncio
async def test_no_inputs_and_force_is_attach(lock_engine):
    svc = _service(lock_engine)
    session_id = _session_id()

    result = await svc.command(
        project_id=_PROJECT,
        user_id=_USER,
        request=SessionStreamCommandRequest(
            session_id=session_id, data=None, force=True
        ),
    )

    assert result.mode == CommandMode.attach
    assert result.watcher_id is not None


@pytest.mark.asyncio
async def test_empty_inputs_dict_counts_as_no_inputs(lock_engine):
    """An empty `inputs={}` is falsy, matching the old prompt field's blank-string rule."""
    svc = _service(lock_engine)
    session_id = _session_id()

    result = await svc.command(
        project_id=_PROJECT,
        user_id=_USER,
        request=SessionStreamCommandRequest(
            session_id=session_id,
            data=WorkflowServiceRequestData(inputs={}),
            force=False,
        ),
    )

    assert result.mode == CommandMode.cancel


@pytest.mark.asyncio
async def test_data_present_but_inputs_none_counts_as_no_inputs(lock_engine):
    """`data` set but `data.inputs` unset (None) is still "no inputs"."""
    svc = _service(lock_engine)
    session_id = _session_id()

    result = await svc.command(
        project_id=_PROJECT,
        user_id=_USER,
        request=SessionStreamCommandRequest(
            session_id=session_id,
            data=WorkflowServiceRequestData(),
            force=True,
        ),
    )

    assert result.mode == CommandMode.attach


@pytest.mark.asyncio
async def test_send_with_inputs_409s_when_already_alive(lock_engine):
    svc = _service(lock_engine)
    session_id = _session_id()

    await svc.command(
        project_id=_PROJECT,
        user_id=_USER,
        request=SessionStreamCommandRequest(
            session_id=session_id,
            data=WorkflowServiceRequestData(inputs={"messages": ["first"]}),
            force=False,
        ),
    )

    with pytest.raises(SessionTurnInUse):
        await svc.command(
            project_id=_PROJECT,
            user_id=_USER,
            request=SessionStreamCommandRequest(
                session_id=session_id,
                data=WorkflowServiceRequestData(inputs={"messages": ["second"]}),
                force=False,
            ),
        )
