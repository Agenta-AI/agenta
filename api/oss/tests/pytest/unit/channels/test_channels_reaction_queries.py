from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from oss.src.core.channels.dtos import ChannelInboxEventQuery, ChannelInboxTriggerQuery
from oss.src.dbs.postgres.channels.dao import ChannelsDAO
from oss.src.dbs.postgres.sessions.inputs.dao import SessionInputsDAO


@pytest.fixture
def query_engine():
    result = MagicMock()
    result.scalars.return_value.all.return_value = []
    result.scalar_one_or_none.return_value = None
    session = SimpleNamespace(execute=AsyncMock(return_value=result))

    @asynccontextmanager
    async def context():
        yield session

    return SimpleNamespace(session=context), session


async def test_event_id_lookup_keeps_project_and_connection_scope(query_engine):
    engine, session = query_engine
    project, connection, event = uuid4(), uuid4(), uuid4()
    assert (
        await ChannelsDAO(engine=engine).query_inbox_events(
            project_id=project,
            event=ChannelInboxEventQuery(id=event, connection_id=connection),
        )
        == []
    )
    params = session.execute.call_args.args[0].compile().params
    assert params == {
        "project_id_1": project,
        "id_1": event,
        "connection_id_1": connection,
    }


async def test_trigger_id_lookup_keeps_project_and_thread_scope(query_engine):
    engine, session = query_engine
    project, thread, trigger = uuid4(), uuid4(), uuid4()
    assert (
        await ChannelsDAO(engine=engine).query_inbox_triggers(
            project_id=project,
            trigger=ChannelInboxTriggerQuery(id=trigger, thread_id=thread),
        )
        == []
    )
    params = session.execute.call_args.args[0].compile().params
    assert params == {"project_id_1": project, "id_1": trigger, "thread_id_1": thread}


async def test_promoted_input_lookup_keeps_project_and_session_scope(query_engine):
    engine, session = query_engine
    project = uuid4()
    assert (
        await SessionInputsDAO(engine=engine).fetch_by_execution_id(
            project_id=project, session_id="session-1", execution_id="turn-1"
        )
        is None
    )
    params = session.execute.call_args.args[0].compile().params
    assert params == {
        "project_id_1": project,
        "session_id_1": "session-1",
        "promoted_execution_id_1": "turn-1",
    }
