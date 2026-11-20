"""Hidden schedules against Postgres.

Pins that every DAO read a public route uses leaves out a hidden schedule and its
delivery, that the fire path still finds it, that a repeat create with the same id
writes nothing, and that the hard delete removes the schedule with its deliveries and
does nothing the second time.
"""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from oss.tests.pytest.utils.principals import any_principal

import oss.src.models.db_models  # noqa: F401
from oss.src.core.access.dtos import RunAuthority, RunContext, RunEnvelope, RunOrigin
from oss.src.core.sessions.inputs.dtos import PendingInputKind
from oss.src.core.triggers.dtos import (
    TriggerDeliveryData,
    TriggerScheduleCreate,
    TriggerScheduleData,
    TriggerScheduleEdit,
    TriggerScheduleFlags,
    TriggerScheduleSessionInput,
)
from oss.src.dbs.postgres.gateway.connections.dbes import ConnectionDBE  # noqa: F401
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.dbs.postgres.triggers.dao import TriggersDAO


pytestmark = [pytest.mark.asyncio, pytest.mark.integration]

_RUN_AT = datetime(2001, 1, 1, 10, 30, tzinfo=timezone.utc)


async def test_a_hidden_schedule_is_out_of_every_public_read(trigger_scope):
    dao = TriggersDAO(engine=get_transactions_engine())
    project_id = trigger_scope["project_id"]
    user_id = trigger_scope["user_id"]
    schedule_id = uuid4()
    principal = any_principal()
    envelope = RunEnvelope(
        authority=RunAuthority(
            principal=principal, organization_id=uuid4(), project_id=project_id
        ),
        context=RunContext(origin=RunOrigin.SCHEDULE, origin_id=str(schedule_id)),
    )
    create = TriggerScheduleCreate(
        data=TriggerScheduleData(
            event_key="still_running",
            run_at=_RUN_AT,
            session_id="target-session",
            session_input=TriggerScheduleSessionInput(
                kind=PendingInputKind.child_update,
                content={"session_id": "target-session"},
            ),
        ),
        flags=TriggerScheduleFlags(is_active=True, is_hidden=True),
    )

    hidden = await dao.create_hidden_schedule(
        project_id=project_id,
        user_id=user_id,
        schedule_id=schedule_id,
        schedule=create,
        principal=principal,
        run_envelope=envelope,
    )
    assert hidden.id == schedule_id
    assert hidden.run_envelope == envelope
    assert hidden.principal == principal
    repeat = await dao.create_hidden_schedule(
        project_id=project_id,
        user_id=user_id,
        schedule_id=schedule_id,
        schedule=create,
        principal=principal,
        run_envelope=envelope,
    )
    assert repeat.id == schedule_id

    assert await dao.claim_schedule_delivery(
        project_id=project_id,
        user_id=user_id,
        delivery_id=uuid4(),
        schedule_id=schedule_id,
        event_id=f"{schedule_id}:2001-01-01T10:30:00+00:00",
        data=TriggerDeliveryData(session_id="target-session"),
    )

    assert schedule_id not in {
        s.id for s in await dao.query_schedules(project_id=project_id)
    }
    assert (
        await dao.fetch_schedule(project_id=project_id, schedule_id=schedule_id) is None
    )
    assert (
        await dao.fetch_schedule_including_deleted(
            project_id=project_id, schedule_id=schedule_id
        )
        is None
    )
    assert not await dao.delete_schedule(
        project_id=project_id, user_id=user_id, schedule_id=schedule_id
    )
    assert (
        await dao.edit_schedule(
            project_id=project_id,
            user_id=user_id,
            schedule=TriggerScheduleEdit(id=schedule_id, data=create.data),
        )
        is None
    )
    assert await dao.query_deliveries(project_id=project_id) == []
    assert (
        await dao.fetch_schedule_to_fire(project_id=project_id, schedule_id=schedule_id)
    ).id == schedule_id

    # Another project cannot remove it.
    assert (
        await dao.purge_hidden_schedule(project_id=uuid4(), schedule_id=schedule_id)
        is None
    )

    removed = await dao.purge_hidden_schedule(
        project_id=project_id, schedule_id=schedule_id
    )
    assert removed.id == schedule_id
    assert (
        await dao.purge_hidden_schedule(project_id=project_id, schedule_id=schedule_id)
        is None
    )
    assert (
        await dao.fetch_schedule_to_fire(project_id=project_id, schedule_id=schedule_id)
        is None
    )


async def test_the_hard_delete_never_removes_a_visible_schedule(trigger_scope):
    dao = TriggersDAO(engine=get_transactions_engine())
    project_id = trigger_scope["project_id"]
    visible = await dao.create_schedule(
        project_id=project_id,
        user_id=trigger_scope["user_id"],
        principal=any_principal(),
        artifact_id=None,
        schedule=TriggerScheduleCreate(
            data=TriggerScheduleData(event_key="timer.fire", run_at=_RUN_AT)
        ),
    )

    assert (
        await dao.purge_hidden_schedule(project_id=project_id, schedule_id=visible.id)
        is None
    )
    assert (
        await dao.fetch_schedule(project_id=project_id, schedule_id=visible.id)
    ).id == visible.id


async def _hidden(dao, *, project_id, user_id):
    schedule_id = uuid4()
    principal = any_principal()
    return await dao.create_hidden_schedule(
        project_id=project_id,
        user_id=user_id,
        schedule_id=schedule_id,
        schedule=TriggerScheduleCreate(
            data=TriggerScheduleData(
                event_key="still_running",
                run_at=_RUN_AT,
                session_id="target-session",
                session_input=TriggerScheduleSessionInput(
                    kind=PendingInputKind.child_update,
                    content={"session_id": "target-session"},
                ),
            ),
            flags=TriggerScheduleFlags(is_active=True, is_hidden=True),
        ),
        principal=principal,
        run_envelope=RunEnvelope(
            authority=RunAuthority(
                principal=principal, organization_id=uuid4(), project_id=project_id
            ),
            context=RunContext(origin=RunOrigin.SCHEDULE, origin_id=str(schedule_id)),
        ),
    )


async def _claim(dao, *, project_id, user_id, schedule_id):
    assert await dao.claim_schedule_delivery(
        project_id=project_id,
        user_id=user_id,
        delivery_id=uuid4(),
        schedule_id=schedule_id,
        event_id=f"{schedule_id}:2001-01-01T10:30:00+00:00",
        data=TriggerDeliveryData(session_id="target-session"),
    )


async def test_the_stale_purge_removes_only_hidden_schedules_that_fired(
    trigger_scope,
):
    dao = TriggersDAO(engine=get_transactions_engine())
    project_id = trigger_scope["project_id"]
    user_id = trigger_scope["user_id"]
    fired = await _hidden(dao, project_id=project_id, user_id=user_id)
    await _claim(dao, project_id=project_id, user_id=user_id, schedule_id=fired.id)
    never_fired = await _hidden(dao, project_id=project_id, user_id=user_id)
    visible = await dao.create_schedule(
        project_id=project_id,
        user_id=user_id,
        principal=any_principal(),
        artifact_id=None,
        schedule=TriggerScheduleCreate(
            data=TriggerScheduleData(event_key="timer.fire", run_at=_RUN_AT)
        ),
    )
    await _claim(dao, project_id=project_id, user_id=user_id, schedule_id=visible.id)

    # The first attempt is newer than the cutoff: nothing goes.
    assert (
        await dao.purge_stale_hidden_schedules(
            first_fired_before=datetime(2001, 1, 1, tzinfo=timezone.utc), limit=100
        )
        == []
    )

    removed = await dao.purge_stale_hidden_schedules(
        first_fired_before=datetime.now(timezone.utc) + timedelta(minutes=1),
        limit=100000,
    )
    removed_ids = {schedule.id for _, schedule in removed}
    assert fired.id in removed_ids
    assert never_fired.id not in removed_ids
    assert visible.id not in removed_ids
    assert (
        await dao.fetch_schedule_to_fire(project_id=project_id, schedule_id=fired.id)
        is None
    )
    assert (
        await dao.fetch_schedule_to_fire(
            project_id=project_id, schedule_id=never_fired.id
        )
    ).id == never_fired.id
    assert (
        await dao.fetch_schedule(project_id=project_id, schedule_id=visible.id)
    ).id == visible.id
