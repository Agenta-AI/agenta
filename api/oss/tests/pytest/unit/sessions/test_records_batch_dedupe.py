"""Unit tests for in-batch dedupe in the records DAO.

`append_many` sends one multi-row INSERT ... ON CONFLICT DO UPDATE. Postgres rejects
such a statement when two rows share the conflict key (project_id, record_id) —
"ON CONFLICT DO UPDATE command cannot affect row a second time" — and the runner
legitimately reuses a record_id within one flush window (partial tool_call frame,
then the completed one). The DAO must collapse duplicates into the end state that
sequential per-event upserts would have produced: first occurrence's insert-only
columns, last occurrence's upsert-updated columns.
"""

from uuid import NAMESPACE_DNS, UUID, uuid5

from oss.src.core.sessions.records.dtos import SessionRecordEvent
from oss.src.dbs.postgres.sessions.records.dao import RecordsDAO

_RECORDS_NS = uuid5(uuid5(NAMESPACE_DNS, "agenta"), "records")
_PROJECT = UUID("00000000-0000-0000-0000-0000000000aa")


def _event(**over):
    base = {
        "session_id": "sess-1",
        "project_id": _PROJECT,
        "record_index": 0,
        "record_type": "tool_call",
        "record_source": "agent",
        "attributes": {"type": "tool_call", "input": {}},
    }
    base.update(over)
    return SessionRecordEvent(**base)


def _values(events):
    return [RecordsDAO._values(event=e) for e in events]


def test_duplicate_record_id_collapses_to_one_row():
    stable = uuid5(_RECORDS_NS, "sess-1:call_1:tool_call")
    values = _values(
        [
            _event(record_id=stable, record_index=31, attributes={"input": {}}),
            _event(record_id=stable, record_index=32, attributes={"input": {"a": 1}}),
        ]
    )

    deduped = RecordsDAO._dedupe_values(values_list=values)

    assert len(deduped) == 1
    row = deduped[0]
    # Insert-only columns keep the first occurrence; upsert-updated columns take the last.
    assert row["record_index"] == 31
    assert row["attributes"] == {"input": {"a": 1}}


def test_distinct_record_ids_pass_through_in_order():
    ids = [uuid5(_RECORDS_NS, f"sess-1:call_{i}") for i in range(3)]
    values = _values(
        [_event(record_id=rid, record_index=i) for i, rid in enumerate(ids)]
    )

    deduped = RecordsDAO._dedupe_values(values_list=values)

    assert [row["record_id"] for row in deduped] == ids


def test_same_record_id_in_different_projects_is_not_collapsed():
    stable = uuid5(_RECORDS_NS, "sess-1:call_1:tool_call")
    other_project = UUID("00000000-0000-0000-0000-0000000000bb")
    values = _values(
        [
            _event(record_id=stable),
            _event(record_id=stable, project_id=other_project),
        ]
    )

    assert len(RecordsDAO._dedupe_values(values_list=values)) == 2
