"""The DAO reads and writes of the settle pass, on Postgres."""

import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import text

import oss.src.models.db_models  # noqa: F401
from oss.src.core.notifications.dtos import (
    NotificationDeliveryState,
    NotificationKind,
    NotificationState,
)
from oss.src.core.shared.dtos import Status
from oss.src.core.triggers.dtos import (
    TriggerDeliveryCreate,
    TriggerDeliveryData,
    TriggerDeliveryOutcome,
    TriggerScheduleCreate,
    TriggerScheduleData,
)
from oss.src.dbs.postgres.memberships.dao import MembershipsDAO
from oss.src.dbs.postgres.notifications.dao import NotificationsDAO
from oss.src.dbs.postgres.sessions.executions.dao import SessionExecutionsDAO
from oss.src.dbs.postgres.sessions.executions.dbes import SessionExecutionDBE
from oss.src.dbs.postgres.sessions.records.dao import RecordsDAO
from oss.src.dbs.postgres.sessions.records.dbes import RecordDBE
from oss.src.dbs.postgres.shared.engine import (
    get_analytics_engine,
    get_transactions_engine,
)
from oss.src.dbs.postgres.triggers.dao import TriggersDAO
from oss.tests.pytest.utils.principals import any_principal

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]

KEY = "automation:one"
T0 = datetime(2026, 11, 5, 10, 0, tzinfo=timezone.utc)


def _data(failed_at=T0):
    return {"failed_at": failed_at.isoformat(), "last_failed_at": failed_at.isoformat()}


async def _open(dao, project_id, user_ids, *, key=KEY, data=None):
    return await dao.open(
        project_id=project_id,
        kind=NotificationKind.AUTOMATION_FAILING,
        dedup_key=key,
        data=data or _data(),
        user_ids=user_ids,
    )


async def _rows(project_id, table):
    async with get_transactions_engine().session() as session:
        result = await session.execute(
            text(f"SELECT * FROM {table} WHERE project_id = :project_id"),
            {"project_id": project_id},
        )
        return result.mappings().all()


async def test_two_concurrent_opens_insert_one_row_and_one_set_of_deliveries(
    trigger_scope,
):
    dao = NotificationsDAO()
    project_id, user_id = trigger_scope["project_id"], trigger_scope["user_id"]

    results = await asyncio.gather(
        _open(dao, project_id, [user_id]),
        _open(dao, project_id, [user_id]),
    )

    assert sorted(results) == [False, True]
    assert len(await _rows(project_id, "notifications")) == 1
    assert len(await _rows(project_id, "notification_deliveries")) == 1


async def test_a_second_delivery_for_one_recipient_and_channel_fails(trigger_scope):
    dao = NotificationsDAO()

    with pytest.raises(Exception, match="uq_notification_deliveries"):
        await _open(
            dao,
            trigger_scope["project_id"],
            [trigger_scope["user_id"], trigger_scope["user_id"]],
        )


async def test_note_failure_counts_open_rows_and_never_moves_backwards(trigger_scope):
    dao = NotificationsDAO()
    project_id = trigger_scope["project_id"]

    assert (
        await dao.note_failure(project_id=project_id, dedup_key=KEY, started_at=T0) == 0
    )

    await _open(dao, project_id, [])
    newer = T0 + timedelta(minutes=5)
    assert (
        await dao.note_failure(project_id=project_id, dedup_key=KEY, started_at=newer)
        == 1
    )
    older = T0 - timedelta(minutes=5)
    assert (
        await dao.note_failure(project_id=project_id, dedup_key=KEY, started_at=older)
        == 1
    )

    [row] = await _rows(project_id, "notifications")
    assert row["data"]["last_failed_at"] == "2026-11-05T10:05:00+00:00"


async def test_resolve_with_a_start_time_compares_it_to_last_failed_at(trigger_scope):
    dao = NotificationsDAO()
    project_id = trigger_scope["project_id"]
    await _open(dao, project_id, [])

    older = T0 - timedelta(seconds=1)
    assert (
        await dao.resolve(project_id=project_id, dedup_key=KEY, started_at=older) == 0
    )
    assert await dao.resolve(project_id=project_id, dedup_key=KEY, started_at=T0) == 1
    assert await dao.resolve(project_id=project_id, dedup_key=KEY) == 0

    [row] = await _rows(project_id, "notifications")
    assert row["state"] == NotificationState.RESOLVED.value


async def test_a_new_notification_can_open_after_a_resolve(trigger_scope):
    dao = NotificationsDAO()
    project_id = trigger_scope["project_id"]
    await _open(dao, project_id, [])
    await dao.resolve(project_id=project_id, dedup_key=KEY)

    assert await _open(dao, project_id, []) is True


async def test_deliveries_are_read_with_their_notification_and_move_state(
    trigger_scope,
):
    dao = NotificationsDAO()
    project_id, user_id = trigger_scope["project_id"], trigger_scope["user_id"]
    await _open(dao, project_id, [user_id])

    pending = [
        row
        for row in await dao.query_created(limit=100)
        if row.project_id == project_id
    ]
    assert [row.user_id for row in pending] == [user_id]
    assert pending[0].notification_state == NotificationState.OPEN
    assert pending[0].data == _data()

    delivery_id = pending[0].id
    for _ in range(4):
        await dao.record_failure(
            project_id=project_id, delivery_id=delivery_id, max_attempts=5
        )
    [row] = await _rows(project_id, "notification_deliveries")
    assert (row["attempt_count"], row["state"]) == (4, "created")

    await dao.record_failure(
        project_id=project_id, delivery_id=delivery_id, max_attempts=5
    )
    [row] = await _rows(project_id, "notification_deliveries")
    assert (row["attempt_count"], row["state"]) == (
        5,
        NotificationDeliveryState.FAILED.value,
    )

    await dao.mark_sent(project_id=project_id, delivery_id=delivery_id)
    [row] = await _rows(project_id, "notification_deliveries")
    assert row["state"] == NotificationDeliveryState.FAILED.value
    assert row["sent_at"] is None


async def test_mark_sent_sets_the_time(trigger_scope):
    dao = NotificationsDAO()
    project_id, user_id = trigger_scope["project_id"], trigger_scope["user_id"]
    await _open(dao, project_id, [user_id])
    [row] = await _rows(project_id, "notification_deliveries")

    await dao.mark_sent(project_id=project_id, delivery_id=row["id"])

    [row] = await _rows(project_id, "notification_deliveries")
    assert row["state"] == NotificationDeliveryState.SENT.value
    assert row["sent_at"] is not None


async def _delivery(dao, scope, schedule, *, code, event_id, data=None):
    return await dao.write_delivery(
        project_id=scope["project_id"],
        user_id=scope["user_id"],
        delivery=TriggerDeliveryCreate(
            status=Status(code=code, message="x"),
            schedule_id=schedule.id,
            event_id=event_id,
            data=data,
        ),
    )


async def _schedule(dao, scope):
    return await dao.create_schedule(
        project_id=scope["project_id"],
        principal=any_principal(),
        artifact_id=None,
        user_id=scope["user_id"],
        schedule=TriggerScheduleCreate(
            name="Report",
            data=TriggerScheduleData(event_key="cron.tick", schedule="0 * * * *"),
        ),
    )


async def _unsettled_of(dao, project_id, *, before=None, limit=500):
    rows = await dao.query_unsettled_deliveries(before=before, limit=limit)
    return [row for row in rows if row.project_id == project_id]


async def test_unsettled_deliveries_page_newest_first_and_skip_other_statuses(
    trigger_scope,
):
    dao = TriggersDAO()
    project_id = trigger_scope["project_id"]
    schedule = await _schedule(dao, trigger_scope)
    written = [
        await _delivery(dao, trigger_scope, schedule, code=code, event_id=event_id)
        for code, event_id in [
            ("202", "a"),
            ("500", "b"),
            ("102", "c"),
            ("409", "d"),
            ("200", "e"),
            ("400", "f"),
        ]
    ]
    async with get_transactions_engine().session() as session:
        for index, delivery in enumerate(written):
            await session.execute(
                text(
                    "UPDATE trigger_deliveries "
                    "SET created_at = now() - make_interval(mins => :age) "
                    "WHERE project_id = :project_id AND id = :id"
                ),
                {"age": 10 - index, "project_id": project_id, "id": delivery.id},
            )
        await session.commit()

    rows = await _unsettled_of(dao, project_id)
    assert [row.event_id for row in rows] == ["f", "b", "a"]

    first = await dao.query_unsettled_deliveries(before=None, limit=1)
    second = await dao.query_unsettled_deliveries(
        before=(first[-1].created_at, first[-1].id), limit=1
    )
    assert first[0].id != second[0].id
    assert (second[0].created_at, second[0].id) < (first[0].created_at, first[0].id)


async def test_a_delivery_older_than_24_hours_is_not_read(trigger_scope):
    dao = TriggersDAO()
    project_id = trigger_scope["project_id"]
    schedule = await _schedule(dao, trigger_scope)
    delivery = await _delivery(dao, trigger_scope, schedule, code="500", event_id="old")
    async with get_transactions_engine().session() as session:
        await session.execute(
            text(
                "UPDATE trigger_deliveries SET created_at = now() - interval '25 hours' "
                "WHERE project_id = :project_id AND id = :id"
            ),
            {"project_id": project_id, "id": delivery.id},
        )
        await session.commit()

    assert await _unsettled_of(dao, project_id) == []


async def test_the_pass_query_uses_the_partial_index(trigger_scope):
    async with get_transactions_engine().session() as session:
        await session.execute(text("SET LOCAL enable_seqscan = off"))
        plan = await session.execute(
            text(
                "EXPLAIN SELECT id FROM trigger_deliveries "
                "WHERE (trigger_deliveries.data->>'outcome') IS NULL "
                "AND (trigger_deliveries.status->>'code') IN "
                "('202','400','403','422','500') "
                "AND trigger_deliveries.created_at > now() - interval '24 hours' "
                "ORDER BY created_at DESC, id DESC LIMIT 500"
            )
        )
        lines = "\n".join(row[0] for row in plan)

    assert "ix_trigger_deliveries_unsettled_created_at_id" in lines


async def test_the_settle_write_keeps_data_and_status_and_runs_once(trigger_scope):
    dao = TriggersDAO()
    project_id = trigger_scope["project_id"]
    schedule = await _schedule(dao, trigger_scope)
    delivery = await _delivery(
        dao,
        trigger_scope,
        schedule,
        code="202",
        event_id="run",
        data=TriggerDeliveryData(session_id="session-1", result={"run_id": "turn-1"}),
    )

    async def write(status_code, outcome, reason_code=None):
        return await dao.settle_delivery(
            project_id=project_id,
            delivery_id=delivery.id,
            status_code=status_code,
            outcome=outcome,
            reason_code=reason_code,
        )

    assert await write("500", TriggerDeliveryOutcome.FAILED, "start_failed") is False
    assert await write("202", TriggerDeliveryOutcome.FAILED, "runner_error") is True
    assert await write("202", TriggerDeliveryOutcome.COMPLETED) is False

    stored = await dao.fetch_delivery(project_id=project_id, delivery_id=delivery.id)
    assert stored.status.code == "202"
    assert stored.data.session_id == "session-1"
    assert stored.data.outcome == TriggerDeliveryOutcome.FAILED
    assert stored.data.reason_code == "runner_error"
    assert await _unsettled_of(dao, project_id) == []


async def test_query_settled_returns_a_first_turn(trigger_scope):
    project_id = trigger_scope["project_id"]
    async with get_transactions_engine().session() as session:
        session.add(
            SessionExecutionDBE(
                project_id=project_id,
                session_id="session-1",
                execution_id="turn-1",
                terminal_outcome="failed",
                error={"code": "access_denied"},
                settled_at=T0,
            )
        )
        session.add(
            SessionExecutionDBE(
                project_id=project_id,
                session_id="session-1",
                execution_id="turn-2",
            )
        )
        await session.commit()

    settled = await SessionExecutionsDAO().query_settled(
        project_id=project_id,
        keys=[("session-1", "turn-1"), ("session-1", "turn-2")],
    )

    assert list(settled) == [("session-1", "turn-1")]
    assert settled[("session-1", "turn-1")].error == {"code": "access_denied"}


async def _record(project_id, turn_id, index, record_type, attributes, **columns):
    async with get_analytics_engine().session() as session:
        session.add(
            RecordDBE(
                project_id=project_id,
                session_id="session-1",
                turn_id=turn_id,
                record_id=uuid4(),
                record_index=index,
                record_type=record_type,
                record_source="agent",
                timestamp=T0 + timedelta(seconds=index),
                attributes=attributes,
                **columns,
            )
        )
        await session.commit()


@pytest_asyncio.fixture
async def records_scope():
    project_id = uuid4()
    yield project_id
    async with get_analytics_engine().session() as session:
        await session.execute(
            text("DELETE FROM records WHERE project_id = :project_id"),
            {"project_id": project_id},
        )
        await session.commit()


async def test_turn_signals_skip_codeless_quarantined_and_deleted_records(
    records_scope,
):
    project_id = records_scope
    await _record(project_id, "t1", 1, "error", {"type": "error", "code": "older"})
    await _record(
        project_id,
        "t1",
        2,
        "error",
        {
            "type": "error",
            "code": "credential_delivery_failed",
            "message": "The credential was not delivered.",
        },
    )
    await _record(project_id, "t1", 3, "error", {"type": "error", "message": "no code"})
    await _record(
        project_id,
        "t1",
        4,
        "error",
        {"type": "error", "code": "quarantined"},
        quarantined_at=T0,
    )
    await _record(
        project_id,
        "t1",
        5,
        "error",
        {"type": "error", "code": "deleted"},
        deleted_at=T0,
    )
    await _record(project_id, "t1", 6, "done", {"type": "done", "stopReason": "paused"})
    await _record(project_id, "t1", 7, "done", {"type": "done", "stopReason": "error"})
    await _record(project_id, "t2", 8, "done", {"type": "done"})
    await _record(project_id, "t3", 9, "message", {"type": "message"})

    signals = await RecordsDAO().turn_signals(
        project_id=project_id,
        keys=[("session-1", "t1"), ("session-1", "t2"), ("session-1", "t3")],
    )

    assert {key: value.model_dump() for key, value in signals.items()} == {
        ("session-1", "t1"): {
            "stop_reason": "error",
            "error_code": "credential_delivery_failed",
            "error_message": "The credential was not delivered.",
        },
        ("session-1", "t2"): {
            "stop_reason": None,
            "error_code": None,
            "error_message": None,
        },
    }


async def test_member_emails_and_the_project_summary(trigger_scope):
    dao = MembershipsDAO(engine=get_transactions_engine())
    project_id, user_id = trigger_scope["project_id"], trigger_scope["user_id"]

    emails = await dao.fetch_member_emails(user_ids=[user_id, uuid4()])
    summary = await dao.fetch_project_summary(project_id=project_id)

    assert list(emails) == [user_id]
    assert emails[user_id].startswith("trigger-test-")
    assert summary.project_name == "trigger-test-project"
    assert summary.organization_owner_id == user_id
    assert await dao.fetch_project_summary(project_id=uuid4()) is None
