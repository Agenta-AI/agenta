"""The trigger DAO writes an edit's principal in the edit's own write (spec 3.8).

An edit with a `principal` stores it together with the configuration. A write without
one (pause, resume, delete, worker writes) keeps the stored principal.
"""

import uuid

import pytest

from oss.src.core.access.dtos import PrincipalKind, PrincipalRef
from oss.src.core.triggers.dtos import (
    TriggerScheduleCreate,
    TriggerScheduleData,
    TriggerScheduleEdit,
    TriggerScheduleFlags,
    TriggerSubscriptionCreate,
    TriggerSubscriptionData,
    TriggerSubscriptionEdit,
    TriggerSubscriptionFlags,
)
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.dbs.postgres.triggers.dao import TriggersDAO


pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


def _human():
    return PrincipalRef(kind=PrincipalKind.HUMAN, id=uuid.uuid4())


async def test_schedule_edit_writes_the_editor_with_the_configuration(trigger_scope):
    dao = TriggersDAO(engine=get_transactions_engine())
    project_id = trigger_scope["project_id"]
    user_id = trigger_scope["user_id"]
    owner, editor = _human(), _human()
    data = TriggerScheduleData(event_key="cron.tick", schedule="0 * * * *")
    schedule = await dao.create_schedule(
        project_id=project_id,
        user_id=user_id,
        schedule=TriggerScheduleCreate(name="nightly", data=data),
        principal=owner,
        artifact_id=None,
    )

    edited = await dao.edit_schedule(
        project_id=project_id,
        user_id=user_id,
        schedule=TriggerScheduleEdit(id=schedule.id, name="renamed", data=data),
        principal=editor,
    )
    assert edited.name == "renamed"
    assert edited.principal == editor

    paused = await dao.edit_schedule(
        project_id=project_id,
        user_id=user_id,
        schedule=TriggerScheduleEdit(
            id=schedule.id,
            name="renamed",
            data=data,
            flags=TriggerScheduleFlags(is_active=False),
        ),
    )
    assert paused.flags.is_active is False
    assert paused.principal == editor

    assert await dao.delete_schedule(
        project_id=project_id, user_id=user_id, schedule_id=schedule.id
    )
    deleted = await dao.fetch_schedule_including_deleted(
        project_id=project_id, schedule_id=schedule.id
    )
    assert deleted.principal == editor


async def test_subscription_edit_writes_the_editor_with_the_configuration(
    trigger_scope,
):
    dao = TriggersDAO(engine=get_transactions_engine())
    project_id = trigger_scope["project_id"]
    user_id = trigger_scope["user_id"]
    connection_id = trigger_scope["connection_id"]
    owner, editor = _human(), _human()
    data = TriggerSubscriptionData(event_key="GITHUB_ISSUE_EVENT")
    subscription = await dao.create_subscription(
        project_id=project_id,
        user_id=user_id,
        subscription=TriggerSubscriptionCreate(
            name="issues", connection_id=connection_id, data=data
        ),
        trigger_id=f"ti_{uuid.uuid4().hex[:8]}",
        principal=owner,
        artifact_id=None,
    )

    edited = await dao.edit_subscription(
        project_id=project_id,
        user_id=user_id,
        subscription=TriggerSubscriptionEdit(
            id=subscription.id,
            connection_id=connection_id,
            name="renamed",
            data=data,
        ),
        principal=editor,
    )
    assert edited.name == "renamed"
    assert edited.principal == editor

    paused = await dao.edit_subscription(
        project_id=project_id,
        user_id=user_id,
        subscription=TriggerSubscriptionEdit(
            id=subscription.id,
            connection_id=connection_id,
            name="renamed",
            data=data,
            flags=TriggerSubscriptionFlags(is_active=False),
        ),
    )
    assert paused.flags.is_active is False
    assert paused.principal == editor
