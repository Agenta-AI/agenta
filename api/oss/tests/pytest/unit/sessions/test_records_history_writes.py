import uuid
import os
from datetime import datetime, timedelta, timezone

import pytest

import oss.src.dbs.postgres.shared.engine as engine_module
from oss.src.core.sessions.records.dtos import SessionRecordEvent
from oss.src.core.sessions.records.types import RecordContentConflict
from oss.src.dbs.postgres.sessions.records.dao import RecordsDAO
from oss.src.dbs.postgres.shared.engine import get_analytics_engine
from oss.src.utils.env import env


def _event(*, record_id, timestamp, attributes):
    return SessionRecordEvent(
        project_id=uuid.uuid4(),
        session_id="sess-history",
        record_id=record_id,
        record_index=0,
        timestamp=timestamp,
        record_type="message",
        record_source="agent",
        attributes=attributes,
        turn_id="turn-1",
    )


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    engine_module._analytics_engine = None
    yield
    if engine_module._analytics_engine is not None:
        await engine_module._analytics_engine.close()
        engine_module._analytics_engine = None


def test_history_writes_default_to_the_legacy_upsert_path(monkeypatch):
    monkeypatch.setattr(env.sessions, "history_writes", False)
    first = RecordsDAO._values(
        event=_event(
            record_id=uuid.uuid4(),
            timestamp=datetime.now(timezone.utc),
            attributes={"type": "message", "text": "first"},
        )
    )
    second = {**first, "attributes": {"type": "message", "text": "second"}}

    deduped = RecordsDAO._dedupe_values(values_list=[first, second])

    assert deduped[0]["attributes"]["text"] == "second"


def test_exact_in_batch_retry_keeps_the_first_checkpoint():
    record_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    first = RecordsDAO._values(
        event=_event(
            record_id=record_id,
            timestamp=now,
            attributes={"type": "message", "text": "same"},
        )
    )
    second = {
        **first,
        "record_index": 99,
        "timestamp": now + timedelta(seconds=1),
    }

    deduped, conflicts = RecordsDAO._dedupe_immutable_values(
        values_list=[first, second]
    )

    assert deduped == [first]
    assert conflicts == []


def test_conflicting_in_batch_retry_is_reported_without_dropping_the_first():
    record_id = uuid.uuid4()
    first = RecordsDAO._values(
        event=_event(
            record_id=record_id,
            timestamp=datetime.now(timezone.utc),
            attributes={"type": "message", "text": "first"},
        )
    )
    second = {**first, "attributes": {"type": "message", "text": "different"}}

    deduped, conflicts = RecordsDAO._dedupe_immutable_values(
        values_list=[first, second]
    )

    assert deduped == [first]
    assert conflicts == [record_id]


def test_producer_id_only_replaces_the_legacy_uuid_when_history_writes_are_on(
    monkeypatch,
):
    producer_id = uuid.uuid4()
    event = _event(
        record_id=None,
        timestamp=datetime.now(timezone.utc),
        attributes={"type": "message", "text": "stable"},
    ).model_copy(update={"producer_id": producer_id})

    monkeypatch.setattr(env.sessions, "history_writes", False)
    legacy = RecordsDAO._values(event=event)
    monkeypatch.setattr(env.sessions, "history_writes", True)
    immutable = RecordsDAO._values(event=event)

    assert legacy["record_id"] != producer_id
    assert immutable["record_id"] == producer_id


def test_record_content_conflict_is_agent_actionable():
    record_id = uuid.uuid4()
    conflict = RecordContentConflict(
        [
            RecordsDAO._conflict_details(
                RecordsDAO._values(
                    event=_event(
                        record_id=record_id,
                        timestamp=datetime.now(timezone.utc),
                        attributes={"type": "message", "text": "changed"},
                    )
                )
            )
        ]
    )

    assert conflict.to_detail() == {
        "code": "record_conflict",
        "message": "A stable record ID already exists with different content.",
        "retryable": False,
        "next_step": "Use a new record ID or resend the original content unchanged.",
        "details": {"record_ids": [str(record_id)]},
    }


@pytest.mark.asyncio
@pytest.mark.integration
@pytest.mark.skipif(
    not os.getenv("POSTGRES_URI_CORE"),
    reason="POSTGRES_URI_CORE is required for the live record-conflict test",
)
async def test_database_accepts_exact_retry_and_rejects_changed_content(monkeypatch):
    monkeypatch.setattr(env.sessions, "history_writes", True)
    project_id = uuid.uuid4()
    record_id = uuid.uuid4()
    timestamp = datetime.now(timezone.utc)
    first = SessionRecordEvent(
        project_id=project_id,
        session_id=f"history-write-{uuid.uuid4().hex[:8]}",
        record_id=record_id,
        record_index=0,
        timestamp=timestamp,
        record_type="message",
        record_source="agent",
        attributes={"type": "message", "text": "stable"},
        turn_id="turn-1",
    )
    exact_retry = first.model_copy(
        update={"record_index": 1, "timestamp": timestamp + timedelta(seconds=1)}
    )
    conflict = first.model_copy(
        update={"attributes": {"type": "message", "text": "changed"}}
    )
    dao = RecordsDAO(engine=get_analytics_engine())

    created = await dao.append(event=first)
    retried = await dao.append(event=exact_retry)
    with pytest.raises(RecordContentConflict):
        await dao.append(event=conflict)
    valid = first.model_copy(
        update={
            "record_id": uuid.uuid4(),
            "record_index": 2,
            "attributes": {"type": "message", "text": "valid batch peer"},
        }
    )
    batch_result = await dao.append_many(events=[conflict, valid])
    stored = await dao.get_event(project_id=project_id, record_id=record_id)
    stored_valid = await dao.get_event(project_id=project_id, record_id=valid.record_id)

    assert created is not None
    assert retried is not None
    assert retried.record_index == 0
    assert retried.timestamp == timestamp
    assert stored is not None
    assert stored.attributes == {"type": "message", "text": "stable"}
    assert batch_result.conflicting_record_ids == [record_id]
    assert [record.record_id for record in batch_result.records] == [valid.record_id]
    assert stored_valid is not None
    assert stored_valid.attributes == {"type": "message", "text": "valid batch peer"}
