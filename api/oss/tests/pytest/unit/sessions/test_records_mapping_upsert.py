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


def test_turn_id_and_span_id_map_through_to_the_dbe():
    span_id = uuid5(_RECORDS_NS, "span")
    dbe = map_record_event_to_dbe(event=_event(turn_id="turn-1", span_id=span_id))
    assert dbe.turn_id == "turn-1"
    assert dbe.span_id == span_id


def test_turn_id_and_span_id_default_to_none():
    dbe = map_record_event_to_dbe(event=_event())
    assert dbe.turn_id is None
    assert dbe.span_id is None


class _FakeResult:
    def scalars(self):
        class _S:
            def first(_self):
                return None

        return _S()


class _FakeSession:
    def __init__(self):
        self.commit_calls = 0
        self.flush_calls = 0

    async def execute(self, stmt):
        return _FakeResult()

    async def commit(self):
        self.commit_calls += 1

    async def flush(self):
        self.flush_calls += 1


class _FakeEngine:
    def __init__(self):
        self.opened_sessions = []

    def session(self):
        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def _cm():
            fake = _FakeSession()
            self.opened_sessions.append(fake)
            yield fake

        return _cm()


def test_append_upserts_preserving_index():
    """The append statement must be an ON CONFLICT DO UPDATE on (project_id, record_id)
    that overwrites attributes but does not touch record_index."""
    from oss.src.dbs.postgres.sessions.records.dao import RecordsDAO

    captured = {}

    class _CapturingSession(_FakeSession):
        async def execute(self, stmt):
            captured["stmt"] = stmt
            return await super().execute(stmt)

    class _CapturingEngine(_FakeEngine):
        def session(self):
            from contextlib import asynccontextmanager

            @asynccontextmanager
            async def _cm():
                yield _CapturingSession()

            return _cm()

    import asyncio

    dao = RecordsDAO(engine=_CapturingEngine())
    asyncio.run(dao.append(event=_event()))

    compiled = str(captured["stmt"]).lower()
    assert "on conflict" in compiled
    assert "do update" in compiled
    # payload columns are overwritten; the ordinal is not in the update set.
    assert "attributes" in compiled
    assert "set record_index" not in compiled
    # turn_id/span_id ride the same upsert as the other payload columns.
    assert "turn_id" in compiled
    assert "span_id" in compiled


def test_append_commits_when_it_opens_its_own_session():
    from oss.src.dbs.postgres.sessions.records.dao import RecordsDAO
    import asyncio

    engine = _FakeEngine()
    dao = RecordsDAO(engine=engine)
    asyncio.run(dao.append(event=_event()))

    assert len(engine.opened_sessions) == 1
    assert engine.opened_sessions[0].commit_calls == 1


def test_append_does_not_commit_a_caller_supplied_session():
    """A caller threading its own session through owns the transaction boundary;
    append must flush (so the row is visible in-transaction) but never commit it."""
    from oss.src.dbs.postgres.sessions.records.dao import RecordsDAO
    import asyncio

    engine = _FakeEngine()
    dao = RecordsDAO(engine=engine)
    caller_session = _FakeSession()

    asyncio.run(dao.append(event=_event(), session=caller_session))

    assert caller_session.commit_calls == 0
    assert caller_session.flush_calls == 1
    assert engine.opened_sessions == []
