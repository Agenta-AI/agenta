"""The due query of one-time schedules against Postgres.

Pins that the event id that the SQL renders for "already fired" equals the event id
that the service builds, so a fired schedule stops being due, and that a retryable
delivery leaves it due.
"""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from oss.tests.pytest.utils.principals import any_principal

import oss.src.models.db_models  # noqa: F401
from oss.src.core.shared.dtos import Status
from oss.src.core.triggers.dtos import (
    TRIGGER_DELIVERY_RETRYABLE_STATUS_CODE,
    TriggerDeliveryCreate,
    TriggerScheduleCreate,
    TriggerScheduleData,
)
from oss.src.core.triggers.service import _one_time_run_at_text
from oss.src.dbs.postgres.gateway.connections.dbes import ConnectionDBE  # noqa: F401
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.dbs.postgres.triggers.dao import TriggersDAO


pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


async def _due_ids(dao, *, due_by):
    return {
        s.id
        for _, s in await dao.fetch_due_one_time_schedules(due_by=due_by, limit=100000)
    }


async def test_a_fired_schedule_is_not_due_and_a_retryable_one_is(trigger_scope):
    dao = TriggersDAO(engine=get_transactions_engine())
    project_id = trigger_scope["project_id"]
    user_id = trigger_scope["user_id"]
    run_at = datetime(2001, 1, 1, 10, 30, tzinfo=timezone.utc)

    schedule = await dao.create_schedule(
        project_id=project_id,
        principal=any_principal(),
        artifact_id=None,
        user_id=user_id,
        schedule=TriggerScheduleCreate(
            name="One-time schedule",
            data=TriggerScheduleData(event_key="timer.fire", run_at=run_at),
        ),
    )

    assert schedule.id not in await _due_ids(dao, due_by=run_at - timedelta(minutes=1))
    assert schedule.id in await _due_ids(dao, due_by=run_at)

    event_id = f"{schedule.id}:{_one_time_run_at_text(run_at)}"
    await dao.write_delivery(
        project_id=project_id,
        user_id=user_id,
        delivery=TriggerDeliveryCreate(
            status=Status(code=TRIGGER_DELIVERY_RETRYABLE_STATUS_CODE, message="retry"),
            schedule_id=schedule.id,
            event_id=event_id,
        ),
    )
    assert schedule.id in await _due_ids(dao, due_by=run_at)

    async with get_transactions_engine().session() as session:
        await session.execute(
            text(
                'UPDATE trigger_deliveries SET status = \'{"code": "200"}\' '
                "WHERE project_id = :project_id AND schedule_id = :schedule_id"
            ),
            {"project_id": project_id, "schedule_id": schedule.id},
        )
        await session.commit()
    assert schedule.id not in await _due_ids(dao, due_by=run_at)
