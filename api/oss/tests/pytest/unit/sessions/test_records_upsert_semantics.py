"""Characterization tests for what the records upsert keeps and what it discards (spike D).

The DAO writes every batch with ``ON CONFLICT (project_id, record_id) DO UPDATE``
(``api/oss/src/dbs/postgres/sessions/records/dao.py:123-136``). A repeated ``record_id``
therefore means two different things today: an exact delivery retry, and a progressive
update that carries a later payload for the same object. Immutable history
(``ON CONFLICT DO NOTHING``) is correct for the first and lossy for the second.

These tests pin the current end state, and each one says what must change when inserts
become immutable. The companion runner tests are in
``services/runner/tests/unit/record-id-semantics.test.ts``. The written analysis is
``docs/design/session-control-and-live-events/spike-d-stable-record-ids.md``.
"""

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List
from uuid import NAMESPACE_DNS, UUID, uuid4, uuid5

from oss.src.core.sessions.records.dtos import SessionRecord, SessionRecordEvent
from oss.src.dbs.postgres.sessions.records.dao import RecordsDAO
from oss.src.dbs.postgres.sessions.records.mappings import map_record_event_to_dbe
from oss.src.tasks.asyncio.sessions.interactions_dispatcher import build_wire_messages


_RECORDS_NS = uuid5(uuid5(NAMESPACE_DNS, "agenta"), "records")
_PROJECT = UUID("00000000-0000-0000-0000-0000000000aa")
_T0 = datetime(2026, 9, 2, 12, 0, 0, tzinfo=timezone.utc)


def _stable_id(session_id: str, call_id: str, record_type: str, turn_id: str) -> UUID:
    """The runner's uuid5 key (``services/runner/src/sessions/record-id.ts:41-50``)."""
    return uuid5(_RECORDS_NS, f"{session_id}:{call_id}:{record_type}:{turn_id}")


def _event(**over: Any) -> SessionRecordEvent:
    base: Dict[str, Any] = {
        "session_id": "sess-1",
        "project_id": _PROJECT,
        "record_index": 0,
        "timestamp": _T0,
        "record_type": "tool_call",
        "record_source": "agent",
        "attributes": {"type": "tool_call", "id": "call_a", "input": {}},
        "turn_id": "turn-1",
    }
    base.update(over)
    return SessionRecordEvent(**base)


def _values(events: List[SessionRecordEvent]) -> List[dict]:
    return [RecordsDAO._values(event=e) for e in events]


def _insert_only(values_list: List[dict]) -> List[dict]:
    """The immutable-history counterfactual: ``ON CONFLICT DO NOTHING``.

    First write per ``(project_id, record_id)`` wins and is never touched again.
    """
    kept: Dict[Any, dict] = {}
    for values in values_list:
        key = (values["project_id"], values["record_id"])
        kept.setdefault(key, values)
    return list(kept.values())


def _read_order(rows: List[dict]) -> List[dict]:
    """The order ``get_records`` returns (``dao.py:157-161``): timestamp, then ingest order."""
    ordered = sorted(enumerate(rows), key=lambda pair: (pair[1]["timestamp"], pair[0]))
    return [row for _, row in ordered]


def _as_records(rows: List[dict]) -> List[SessionRecord]:
    return [
        SessionRecord(
            record_id=row["record_id"],
            session_id=row["session_id"],
            project_id=row["project_id"],
            record_index=row.get("record_index"),
            timestamp=row.get("timestamp"),
            record_type=row.get("record_type"),
            record_source=row.get("record_source"),
            attributes=row.get("attributes"),
            turn_id=row.get("turn_id"),
        )
        for row in rows
    ]


# --------------------------------------------------------------------------------------
# What the upsert overwrites, and what it keeps
# --------------------------------------------------------------------------------------


def test_upsert_overwrites_exactly_six_columns():
    """The overwrite set is the contract every other test here depends on."""
    assert RecordsDAO._UPSERT_UPDATED_COLUMNS == (
        "record_type",
        "record_source",
        "timestamp",
        "attributes",
        "turn_id",
        "span_id",
    )
    # record_index, created_at and updated_at are absent on purpose: a repeat keeps the
    # first write's ordinal and ingest time, and leaves no audit trace at all.
    #
    # WHEN INSERTS BECOME IMMUTABLE: this tuple should disappear with the DO UPDATE clause.
    # If it survives as a narrower set, this test must be updated to the new set and the
    # reason recorded next to it.


def test_a_progressive_tool_call_repeat_repairs_the_arguments_but_moves_the_row():
    """The interleaved / TTL case from the runner: empty args, then the real args."""
    stable = _stable_id("sess-1", "call_a", "tool_call", "turn-1")
    other = _stable_id("sess-1", "call_b", "tool_call", "turn-1")
    values = _values(
        [
            _event(record_id=stable, record_index=0, timestamp=_T0),
            _event(
                record_id=other,
                record_index=1,
                timestamp=_T0 + timedelta(milliseconds=5),
                attributes={
                    "type": "tool_call",
                    "id": "call_b",
                    "input": {"path": "/y"},
                },
            ),
            _event(
                record_id=stable,
                record_index=2,
                timestamp=_T0 + timedelta(milliseconds=9),
                attributes={
                    "type": "tool_call",
                    "id": "call_a",
                    "input": {"command": "ls -la"},
                },
            ),
        ]
    )

    upserted = _read_order(RecordsDAO._dedupe_values(values_list=values))
    assert len(upserted) == 2
    by_id = {row["record_id"]: row for row in upserted}
    # The arguments are repaired.
    assert by_id[stable]["attributes"]["input"] == {"command": "ls -la"}
    # The ordinal is NOT: it keeps the first write's index, which now disagrees with the
    # timestamp the same repeat moved forward.
    assert by_id[stable]["record_index"] == 0
    assert by_id[stable]["timestamp"] == _T0 + timedelta(milliseconds=9)
    # Consequence: the repaired row sorts after the call that flushed it. The transcript
    # shows call_b before call_a even though call_a was announced first.
    assert [row["attributes"]["id"] for row in upserted] == ["call_b", "call_a"]

    insert_only = _read_order(_insert_only(values))
    # Immutable insert keeps the right order and the WRONG payload: an empty input for a
    # command that really ran.
    assert [row["attributes"]["id"] for row in insert_only] == ["call_a", "call_b"]
    assert insert_only[0]["attributes"]["input"] == {}

    # WHEN INSERTS BECOME IMMUTABLE: the producer must stop sending this repeat (hold the
    # open tool slot until the call closes), or send the later snapshot as its own event id
    # that readers fold by ``attributes.id``. Update the ``insert_only`` assertion to the
    # repaired arguments once that lands. The upsert's timestamp move is a separate live
    # defect that immutability fixes for free.


def test_a_repeated_tool_result_keeps_the_last_output_today():
    stable = _stable_id("sess-1", "call_a", "tool_result", "turn-1")
    values = _values(
        [
            _event(
                record_id=stable,
                record_type="tool_result",
                record_index=1,
                timestamp=_T0,
                attributes={"type": "tool_result", "id": "call_a", "output": ""},
            ),
            _event(
                record_id=stable,
                record_type="tool_result",
                record_index=2,
                timestamp=_T0 + timedelta(milliseconds=4),
                attributes={
                    "type": "tool_result",
                    "id": "call_a",
                    "output": "exit 0\n42 files",
                },
            ),
        ]
    )

    upserted = RecordsDAO._dedupe_values(values_list=values)
    assert len(upserted) == 1
    assert upserted[0]["attributes"]["output"] == "exit 0\n42 files"

    insert_only = _insert_only(values)
    assert len(insert_only) == 1
    # Immutable insert pins the result to the empty first snapshot.
    assert insert_only[0]["attributes"]["output"] == ""

    # WHEN INSERTS BECOME IMMUTABLE: the runner must emit exactly one durable tool_result
    # per call per turn. Change the ``insert_only`` expectation to the final output then.


def test_a_resume_in_a_later_turn_appends_instead_of_overwriting():
    """The turn id is part of the uuid5 key, so a resume can never overwrite history."""
    turn_one = _stable_id("sess-1", "gate-9", "interaction_response", "turn-1")
    turn_two = _stable_id("sess-1", "gate-9", "interaction_response", "turn-2")
    assert turn_one != turn_two

    answer = {
        "type": "interaction_response",
        "id": "gate-9",
        "kind": "user_approval",
        "payload": {"toolCallId": "call_9", "approved": True},
    }
    values = _values(
        [
            _event(
                record_id=turn_one,
                record_type="interaction_response",
                turn_id="turn-1",
                timestamp=_T0,
                attributes=answer,
            ),
            _event(
                record_id=turn_two,
                record_type="interaction_response",
                turn_id="turn-2",
                timestamp=_T0 + timedelta(seconds=30),
                attributes=answer,
            ),
        ]
    )

    # Both policies store two rows for one logical answer. Immutability neither creates nor
    # removes this duplicate.
    assert len(RecordsDAO._dedupe_values(values_list=values)) == 2
    assert len(_insert_only(values)) == 2

    # WHEN INSERTS BECOME IMMUTABLE: unchanged. The duplicate becomes visible in a replay
    # cursor, so a reader must fold interaction answers by ``attributes.id``.


def test_a_terminal_event_carries_no_stable_id_so_a_retry_duplicates_it():
    """`done` sends no record_id, so the API mints a fresh uuid4 per ingest."""
    first = map_record_event_to_dbe(
        event=_event(
            record_id=None,
            record_type="done",
            attributes={"type": "done", "stopReason": "end_turn"},
        )
    )
    second = map_record_event_to_dbe(
        event=_event(
            record_id=None,
            record_type="done",
            attributes={"type": "done", "stopReason": "end_turn"},
        )
    )
    assert first.record_id != second.record_id
    assert first.record_id.version == 4

    # WHEN INSERTS BECOME IMMUTABLE: this is the gap immutability alone does not close. A
    # lost ingest response still duplicates the terminal fact, because the producer never
    # gave it an id to deduplicate on. Give every durable event a producer-generated stable
    # id before its first send, then assert equality here instead.


# --------------------------------------------------------------------------------------
# What the reconstructed conversation looks like after each policy
# --------------------------------------------------------------------------------------


def test_wire_message_reconstruction_loses_the_tool_arguments_under_immutable_insert():
    """`build_wire_messages` is what an out-of-band approval resume sends to the harness."""
    call_id = _stable_id("sess-1", "call_a", "tool_call", "turn-1")
    result_id = _stable_id("sess-1", "call_a", "tool_result", "turn-1")
    values = _values(
        [
            _event(
                record_id=None,
                record_type="message",
                record_source="user",
                record_index=0,
                timestamp=_T0,
                attributes={"type": "message", "text": "list the files"},
            ),
            _event(
                record_id=call_id,
                record_index=1,
                timestamp=_T0 + timedelta(milliseconds=2),
            ),
            _event(
                record_id=call_id,
                record_index=2,
                timestamp=_T0 + timedelta(milliseconds=6),
                attributes={
                    "type": "tool_call",
                    "id": "call_a",
                    "name": "bash",
                    "input": {"command": "ls -la"},
                },
            ),
            _event(
                record_id=result_id,
                record_type="tool_result",
                record_index=3,
                timestamp=_T0 + timedelta(milliseconds=9),
                attributes={
                    "type": "tool_result",
                    "id": "call_a",
                    "output": "42 files",
                },
            ),
        ]
    )

    upserted = build_wire_messages(
        _as_records(_read_order(RecordsDAO._dedupe_values(values_list=values)))
    )
    assert upserted[0] == {"role": "user", "content": "list the files"}
    call_block = next(
        block for block in upserted[1]["content"] if block["type"] == "tool_call"
    )
    assert call_block["input"] == {"command": "ls -la"}

    immutable = build_wire_messages(_as_records(_read_order(_insert_only(values))))
    call_block = next(
        block for block in immutable[1]["content"] if block["type"] == "tool_call"
    )
    # The harness would be told the agent called bash with no arguments.
    assert call_block["input"] == {}

    # WHEN INSERTS BECOME IMMUTABLE: both branches must produce the real arguments. This
    # test is the acceptance check for the producer fix.


def test_dedupe_preserves_the_row_the_first_write_created():
    """A repeat must not resurrect a row identity, only its payload."""
    stable = _stable_id("sess-1", "call_a", "tool_call", "turn-1")
    values = _values(
        [
            _event(record_id=stable, record_index=7, session_id="sess-1"),
            _event(record_id=stable, record_index=9, session_id="sess-1"),
        ]
    )
    deduped = RecordsDAO._dedupe_values(values_list=values)
    assert len(deduped) == 1
    assert deduped[0]["record_id"] == stable
    assert deduped[0]["record_index"] == 7
    assert deduped[0]["session_id"] == "sess-1"

    # WHEN INSERTS BECOME IMMUTABLE: ``_dedupe_values`` can collapse to "keep the first
    # occurrence" and drop the merge of the overwrite columns entirely. Update the payload
    # expectations here at the same time.


def test_a_record_id_is_unrelated_to_time_so_it_cannot_be_a_replay_cursor():
    """Both id families in use are unordered; only `timestamp` orders a read."""
    minted = map_record_event_to_dbe(event=_event(record_id=None)).record_id
    assert minted.version == 4
    stable = _stable_id("sess-1", "call_a", "tool_call", "turn-1")
    assert stable.version == 5
    # A uuid4 and a uuid5 sort by their random or hashed bytes, never by production order.
    # This is why the query orders by (timestamp, created_at, record_index) and why the
    # frontend comments claiming a "uuid7 id" order are wrong
    # (``web/packages/agenta-chat/src/assets/transcriptToMessages.ts:30``,
    # ``web/packages/agenta-entities/src/session/api/api.ts:61``).
    assert uuid4().version == 4

    # WHEN INSERTS BECOME IMMUTABLE: a cursor column has to be added. record_id cannot
    # become one without rewriting every existing row.
