from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, Request

from oss.src.apis.fastapi.sessions.router import SessionsRootRouter
from oss.src.core.sessions.records.dtos import SessionRecordsReadState
from oss.src.core.sessions.streams.dtos import SessionStream
from oss.src.utils.env import env


def _request(project_id, user_id) -> Request:
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/sessions/session-1",
            "headers": [],
            "app": FastAPI(),
        }
    )
    request.state.project_id = str(project_id)
    request.state.user_id = str(user_id)
    return request


@pytest.mark.asyncio
async def test_snapshot_groups_session_execution_pending_and_read_watermark():
    project_id = uuid4()
    stream = SessionStream(
        id=uuid4(), project_id=project_id, session_id="session-1", name="Session"
    )
    streams = AsyncMock()
    streams.fetch.return_value = stream
    records = AsyncMock()
    records.get_read_state.return_value = SessionRecordsReadState(
        latest_sequence=7,
        history_complete=True,
    )
    interactions = AsyncMock()
    interactions.query_interactions.return_value = []
    turns = AsyncMock()
    turns.latest_turn.return_value = None
    router = SessionsRootRouter(
        sessions_service=AsyncMock(),
        streams_service=streams,
        records_service=records,
        interactions_service=interactions,
        turns_service=turns,
    )

    with (
        patch.object(env.sessions, "shared_reader", True),
        patch(
            "oss.src.apis.fastapi.sessions.router.check_action_access",
            new_callable=AsyncMock,
            return_value=True,
        ),
    ):
        snapshot = await router.get_session_snapshot(
            request=_request(project_id, uuid4()),
            session_id="session-1",
        )

    assert snapshot.session.session_id == "session-1"
    assert snapshot.execution is None
    assert snapshot.pending.inputs == []
    assert snapshot.pending.interactions == []
    assert snapshot.read.latest_sequence == 7
    assert snapshot.read.history_complete is True


@pytest.mark.asyncio
async def test_snapshot_forces_incomplete_when_stream_marker_is_present():
    project_id = uuid4()
    stream = SessionStream(id=uuid4(), project_id=project_id, session_id="session-1")
    object.__setattr__(stream, "history_incomplete", True)
    streams = AsyncMock()
    streams.fetch.return_value = stream
    records = AsyncMock()
    records.get_read_state.return_value = SessionRecordsReadState(
        latest_sequence=2,
        history_complete=True,
    )
    interactions = AsyncMock()
    interactions.query_interactions.return_value = []
    turns = AsyncMock()
    turns.latest_turn.return_value = None
    router = SessionsRootRouter(
        sessions_service=AsyncMock(),
        streams_service=streams,
        records_service=records,
        interactions_service=interactions,
        turns_service=turns,
    )

    with (
        patch.object(env.sessions, "shared_reader", True),
        patch(
            "oss.src.apis.fastapi.sessions.router.check_action_access",
            new_callable=AsyncMock,
            return_value=True,
        ),
    ):
        snapshot = await router.get_session_snapshot(
            request=_request(project_id, uuid4()), session_id="session-1"
        )

    assert snapshot.read.history_complete is False
