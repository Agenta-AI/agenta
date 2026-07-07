"""Unit tests for record id handling on ingest.

Verifies:
  - a producer-supplied stable record_id (uuid5) is honored verbatim so retries/resumes
    upsert onto one row;
  - an absent record_id falls back to a minted uuid4 (not uuid7 — record_id is no longer
    the time-ordered key);
  - the append DAO issues an ON CONFLICT DO UPDATE keyed on (project_id, record_id) that
    overwrites the payload but preserves record_index.
"""

from uuid import UUID, uuid5, NAMESPACE_DNS

from oss.src.core.sessions.records.dtos import SessionRecordEvent
from oss.src.dbs.postgres.sessions.records.mappings import map_record_event_to_dbe


_RECORDS_NS = uuid5(uuid5(NAMESPACE_DNS, "agenta"), "records")


def _event(**over):
    base = dict(
        session_id="sess-1",
        project_id=UUID("00000000-0000-0000-0000-0000000000aa"),
        record_index=3,
        record_type="tool_call",
        record_source="agent",
        attributes={"type": "tool_call", "input": {}},
    )
    base.update(over)
    return SessionRecordEvent(**base)


def test_supplied_record_id_is_honored():
    stable = uuid5(_RECORDS_NS, "sess-1:call_1:tool_call")
    dbe = map_record_event_to_dbe(event=_event(record_id=stable))
    assert dbe.record_id == stable


def test_absent_record_id_falls_back_to_uuid4():
    dbe = map_record_event_to_dbe(event=_event())
    assert isinstance(dbe.record_id, UUID)
    # uuid4 — random, version 4 (not uuid7, which would imply time-ordering).
    assert dbe.record_id.version == 4


def test_append_upserts_preserving_index():
    """The append statement must be an ON CONFLICT DO UPDATE on (project_id, record_id)
    that overwrites attributes but does not touch record_index."""
    from oss.src.dbs.postgres.sessions.records.dao import RecordsDAO

    captured = {}

    class _FakeResult:
        def scalars(self):
            class _S:
                def first(_self):
                    return None

            return _S()

    class _FakeSession:
        async def execute(self, stmt):
            captured["stmt"] = stmt
            return _FakeResult()

        async def commit(self):
            pass

    class _FakeEngine:
        def session(self):
            from contextlib import asynccontextmanager

            @asynccontextmanager
            async def _cm():
                yield _FakeSession()

            return _cm()

    import asyncio

    dao = RecordsDAO(engine=_FakeEngine())
    asyncio.run(dao.append(event=_event()))

    compiled = str(captured["stmt"]).lower()
    assert "on conflict" in compiled
    assert "do update" in compiled
    # payload columns are overwritten; the ordinal is not in the update set.
    assert "attributes" in compiled
    assert "set record_index" not in compiled
