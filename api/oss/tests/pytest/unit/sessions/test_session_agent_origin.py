from uuid import uuid4

from oss.src.core.sessions.streams.dtos import SessionStreamCreate
from oss.src.core.sessions.types import SessionOrigin
from oss.src.dbs.postgres.sessions.streams.mappings import (
    decode_session_attribution,
    map_stream_dbe_to_dto,
    map_stream_dto_to_dbe_create,
)


def test_agent_origin_round_trips_without_exposing_reserved_tags():
    row = map_stream_dto_to_dbe_create(
        project_id=uuid4(),
        user_id=None,
        stream=SessionStreamCreate(
            session_id="agent-test",
            origin=SessionOrigin.agent,
            tags={"custom": "kept"},
            name="Test session",
        ),
    )
    row.id = uuid4()
    assert row.tags == {"ag.origin": "agent", "custom": "kept", "ag.name.rev": 1}
    result = map_stream_dbe_to_dto(stream_dbe=row)
    assert result.origin == SessionOrigin.agent
    assert result.tags == {"custom": "kept"}


def test_untagged_sessions_remain_manual():
    row = map_stream_dto_to_dbe_create(
        project_id=uuid4(),
        user_id=uuid4(),
        stream=SessionStreamCreate(session_id="human-session"),
    )
    assert decode_session_attribution(row.tags) == (SessionOrigin.manual, None, None)
