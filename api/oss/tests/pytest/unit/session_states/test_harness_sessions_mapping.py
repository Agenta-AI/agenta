"""Unit tests for the S2/S2b durable continuity state on session_states.

The continuity fields live inside the existing `data` JSON column (no dedicated columns),
typed as `SessionStateData`. Verifies:
  - dbe_to_dto hydrates the raw `data` dict into a SessionStateData with a
    Dict[str, HarnessSessionRecord];
  - a DBE with no `data` maps to None, not an empty model;
  - SessionStateUpsert carries `data` through model_dump(exclude_unset=True)
    (mirrors test_records_mapping_upsert.py's style: no DB, no live stack).
"""

from uuid import UUID

from oss.src.core.sessions.states.dtos import (
    HarnessSessionRecord,
    SessionStateData,
    SessionStateUpsert,
)
from oss.src.dbs.postgres.sessions.states.dbes import SessionStateDBE
from oss.src.dbs.postgres.sessions.states.mappings import dbe_to_dto


_PROJECT_ID = UUID("00000000-0000-0000-0000-0000000000aa")


def _dbe(**over):
    base = dict(
        project_id=_PROJECT_ID,
        session_id="sess-1",
        data=None,
        sandbox_id=None,
        flags=None,
        tags=None,
        meta=None,
    )
    base.update(over)
    return SessionStateDBE(**base)


def test_dbe_to_dto_hydrates_data_continuity_state():
    dbe = _dbe(
        data={
            "latest_agent_session_id": "agent-claude-2",
            "harness_sessions": {
                "claude": {
                    "agent_session_id": "agent-claude-2",
                    "turn_index": 2,
                },
                "pi": {
                    "agent_session_id": "agent-pi-1",
                    "turn_index": 1,
                },
            },
            "latest_turn_index": 2,
        },
    )

    dto = dbe_to_dto(dbe)

    assert dto.data is not None
    assert dto.data.latest_agent_session_id == "agent-claude-2"
    assert dto.data.latest_turn_index == 2
    assert dto.data.harness_sessions is not None
    assert set(dto.data.harness_sessions.keys()) == {"claude", "pi"}
    assert isinstance(dto.data.harness_sessions["claude"], HarnessSessionRecord)
    assert dto.data.harness_sessions["claude"].agent_session_id == "agent-claude-2"
    assert dto.data.harness_sessions["claude"].turn_index == 2
    assert dto.data.harness_sessions["pi"].agent_session_id == "agent-pi-1"
    assert dto.data.harness_sessions["pi"].turn_index == 1


def test_dbe_to_dto_no_data_maps_to_none():
    dbe = _dbe()

    dto = dbe_to_dto(dbe)

    assert dto.data is None


def test_dbe_to_dto_empty_data_column_maps_to_none():
    # JSON(none_as_null=True): an empty {} column value is falsy, so the mapping's
    # `if dbe.data else None` guard must resolve to None, not an empty model.
    dbe = _dbe(data={})

    dto = dbe_to_dto(dbe)

    assert dto.data is None


def test_session_state_upsert_carries_data_through_exclude_unset():
    upsert = SessionStateUpsert(
        data=SessionStateData(
            latest_agent_session_id="agent-claude-3",
            harness_sessions={
                "claude": HarnessSessionRecord(
                    agent_session_id="agent-claude-3", turn_index=3
                ),
            },
            latest_turn_index=3,
        ),
    )

    dumped = upsert.model_dump(exclude_unset=True)

    assert dumped == {
        "data": {
            "latest_agent_session_id": "agent-claude-3",
            "harness_sessions": {
                "claude": {
                    "agent_session_id": "agent-claude-3",
                    "turn_index": 3,
                },
            },
            "latest_turn_index": 3,
        },
    }


def test_session_state_upsert_unset_data_is_excluded():
    # A caller that only updates sandbox_id must not accidentally clear `data`:
    # exclude_unset=True means an untouched field is simply absent from the dump, not null.
    upsert = SessionStateUpsert(sandbox_id="sbx-1")

    dumped = upsert.model_dump(exclude_unset=True)

    assert dumped == {"sandbox_id": "sbx-1"}
    assert "data" not in dumped
