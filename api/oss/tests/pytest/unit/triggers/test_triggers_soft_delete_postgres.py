import uuid

import pytest
import pytest_asyncio
from sqlalchemy import text

import oss.src.dbs.postgres.shared.engine as engine_module
import oss.src.models.db_models  # noqa: F401
from oss.src.core.sessions.dtos import (
    SessionTriggerAttribution,
    SessionTriggerKind,
)
from oss.src.core.shared.dtos import Status
from oss.src.core.triggers.dtos import (
    TriggerDeliveryCreate,
    TriggerScheduleCreate,
    TriggerScheduleData,
    TriggerSubscriptionCreate,
    TriggerSubscriptionData,
)
from oss.src.dbs.postgres.sessions.streams.dao import SessionStreamsDAO
from oss.src.dbs.postgres.gateway.connections.dbes import ConnectionDBE  # noqa: F401
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.dbs.postgres.triggers.dao import TriggersDAO


pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


@pytest_asyncio.fixture(autouse=True)
async def _fresh_engine_per_test():
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


@pytest_asyncio.fixture
async def trigger_scope():
    engine = get_transactions_engine()
    user_id = uuid.uuid4()
    organization_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    project_id = uuid.uuid4()
    connection_id = uuid.uuid4()

    async with engine.session() as session:
        await session.execute(
            text(
                "INSERT INTO users (id, uid, username, email) "
                "VALUES (:id, :uid, :username, :email)"
            ),
            {
                "id": user_id,
                "uid": str(user_id),
                "username": "trigger-soft-delete-test",
                "email": f"trigger-soft-delete-{user_id.hex[:8]}@example.com",
            },
        )
        await session.execute(
            text(
                "INSERT INTO organizations (id, name, owner_id) "
                "VALUES (:id, :name, :owner_id)"
            ),
            {
                "id": organization_id,
                "name": "trigger-soft-delete-org",
                "owner_id": user_id,
            },
        )
        await session.execute(
            text(
                "INSERT INTO workspaces (id, name, organization_id) "
                "VALUES (:id, :name, :organization_id)"
            ),
            {
                "id": workspace_id,
                "name": "trigger-soft-delete-workspace",
                "organization_id": organization_id,
            },
        )
        await session.execute(
            text(
                "INSERT INTO projects "
                "(id, project_name, workspace_id, organization_id) "
                "VALUES (:id, :name, :workspace_id, :organization_id)"
            ),
            {
                "id": project_id,
                "name": "trigger-soft-delete-project",
                "workspace_id": workspace_id,
                "organization_id": organization_id,
            },
        )
        await session.execute(
            text(
                "INSERT INTO gateway_connections "
                "(id, project_id, created_by_id, slug, provider_key, integration_key) "
                "VALUES (:id, :project_id, :user_id, :slug, :provider_key, :integration_key)"
            ),
            {
                "id": connection_id,
                "project_id": project_id,
                "user_id": user_id,
                "slug": "trigger-soft-delete-connection",
                "provider_key": "composio",
                "integration_key": "github",
            },
        )
        await session.commit()

    yield {
        "project_id": project_id,
        "user_id": user_id,
        "connection_id": connection_id,
    }

    async with engine.session() as session:
        for table in (
            "trigger_deliveries",
            "session_streams",
            "trigger_subscriptions",
            "trigger_schedules",
            "gateway_connections",
        ):
            await session.execute(
                text(f"DELETE FROM {table} WHERE project_id = :project_id"),
                {"project_id": project_id},
            )
        await session.execute(
            text("DELETE FROM projects WHERE id = :id"), {"id": project_id}
        )
        await session.execute(
            text("DELETE FROM workspaces WHERE id = :id"), {"id": workspace_id}
        )
        await session.execute(
            text("DELETE FROM organizations WHERE id = :id"), {"id": organization_id}
        )
        await session.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
        await session.commit()


async def test_soft_delete_retains_schedule_and_delivery_until_explicit_purge(
    trigger_scope,
):
    engine = get_transactions_engine()
    dao = TriggersDAO(engine=engine)
    project_id = trigger_scope["project_id"]
    user_id = trigger_scope["user_id"]
    schedule = await dao.create_schedule(
        project_id=project_id,
        user_id=user_id,
        schedule=TriggerScheduleCreate(
            name="Historical schedule",
            data=TriggerScheduleData(event_key="cron.tick", schedule="* * * * *"),
        ),
    )
    delivery = await dao.write_delivery(
        project_id=project_id,
        user_id=user_id,
        delivery=TriggerDeliveryCreate(
            status=Status(code="200", message="success"),
            schedule_id=schedule.id,
            event_id="historical-event",
        ),
    )

    assert await dao.delete_schedule(
        project_id=project_id,
        user_id=user_id,
        schedule_id=schedule.id,
    )
    assert (
        await dao.fetch_schedule(project_id=project_id, schedule_id=schedule.id) is None
    )
    assert await dao.query_schedules(project_id=project_id) == []
    historical = await dao.fetch_schedule_including_deleted(
        project_id=project_id,
        schedule_id=schedule.id,
    )
    assert historical is not None
    assert historical.deleted_at is not None
    assert historical.deleted_by_id == user_id
    assert historical.updated_at is not None
    assert historical.updated_by_id == user_id
    assert (
        await dao.fetch_schedule_including_deleted(
            project_id=uuid.uuid4(),
            schedule_id=schedule.id,
        )
        is None
    )
    assert (
        await dao.fetch_delivery(project_id=project_id, delivery_id=delivery.id)
        is not None
    )

    assert await dao.purge_schedule(project_id=project_id, schedule_id=schedule.id)
    assert (
        await dao.fetch_schedule_including_deleted(
            project_id=project_id,
            schedule_id=schedule.id,
        )
        is None
    )
    assert (
        await dao.fetch_delivery(project_id=project_id, delivery_id=delivery.id) is None
    )


async def test_soft_delete_retains_subscription_and_delivery_until_explicit_purge(
    trigger_scope,
):
    engine = get_transactions_engine()
    dao = TriggersDAO(engine=engine)
    project_id = trigger_scope["project_id"]
    user_id = trigger_scope["user_id"]
    subscription = await dao.create_subscription(
        project_id=project_id,
        user_id=user_id,
        subscription=TriggerSubscriptionCreate(
            connection_id=trigger_scope["connection_id"],
            name="Historical subscription",
            data=TriggerSubscriptionData(event_key="github.issue.opened"),
        ),
        trigger_id="ti_historical",
    )
    delivery = await dao.write_delivery(
        project_id=project_id,
        user_id=user_id,
        delivery=TriggerDeliveryCreate(
            status=Status(code="200", message="success"),
            subscription_id=subscription.id,
            event_id="historical-subscription-event",
        ),
    )
    lifecycle_checked_delivery = await dao.write_subscription_delivery_if_live(
        project_id=project_id,
        user_id=user_id,
        delivery=TriggerDeliveryCreate(
            status=Status(code="409", message="failed"),
            subscription_id=subscription.id,
            event_id="live-lifecycle-checked-event",
        ),
    )
    assert lifecycle_checked_delivery is not None

    assert await dao.delete_subscription(
        project_id=project_id,
        user_id=user_id,
        subscription_id=subscription.id,
    )
    assert (
        await dao.fetch_subscription(
            project_id=project_id,
            subscription_id=subscription.id,
        )
        is None
    )
    assert await dao.query_subscriptions(project_id=project_id) == []
    assert (
        await dao.fetch_subscription_by_trigger_id(
            project_id=project_id,
            trigger_id="ti_historical",
        )
        is None
    )
    assert (
        await dao.get_project_and_subscription_by_trigger_id(trigger_id="ti_historical")
        is None
    )
    historical = await dao.fetch_subscription_including_deleted(
        project_id=project_id,
        subscription_id=subscription.id,
    )
    assert historical is not None
    assert historical.deleted_at is not None
    assert historical.deleted_by_id == user_id
    assert (
        await dao.fetch_subscription_including_deleted(
            project_id=uuid.uuid4(),
            subscription_id=subscription.id,
        )
        is None
    )
    assert (
        await dao.fetch_delivery(
            project_id=project_id,
            delivery_id=delivery.id,
        )
        is not None
    )
    assert (
        await dao.write_subscription_delivery_if_live(
            project_id=project_id,
            user_id=user_id,
            delivery=TriggerDeliveryCreate(
                status=Status(code="409", message="failed"),
                subscription_id=subscription.id,
                event_id="post-delete-lifecycle-checked-event",
            ),
        )
        is None
    )
    blocked_delivery_id = uuid.uuid4()
    assert (
        await SessionStreamsDAO(engine=engine).claim_trigger_delivery(
            project_id=project_id,
            user_id=user_id,
            event_id="blocked-subscription-event",
            session_id=uuid.uuid4().hex,
            attribution=SessionTriggerAttribution(
                configuration_id=subscription.id,
                kind=SessionTriggerKind.subscription,
                delivery_id=blocked_delivery_id,
            ),
        )
        is False
    )
    assert (
        await dao.fetch_delivery(
            project_id=project_id,
            delivery_id=blocked_delivery_id,
        )
        is None
    )

    assert await dao.purge_subscription(
        project_id=project_id,
        subscription_id=subscription.id,
    )
    assert (
        await dao.fetch_subscription_including_deleted(
            project_id=project_id,
            subscription_id=subscription.id,
        )
        is None
    )
    assert (
        await dao.fetch_delivery(project_id=project_id, delivery_id=delivery.id) is None
    )
    assert (
        await dao.fetch_delivery(
            project_id=project_id,
            delivery_id=lifecycle_checked_delivery.id,
        )
        is None
    )


@pytest.mark.parametrize("soft_deleted", [False, True])
async def test_atomic_claim_rejects_disabled_or_deleted_schedule(
    trigger_scope, soft_deleted
):
    engine = get_transactions_engine()
    triggers_dao = TriggersDAO(engine=engine)
    streams_dao = SessionStreamsDAO(engine=engine)
    project_id = trigger_scope["project_id"]
    user_id = trigger_scope["user_id"]
    schedule = await triggers_dao.create_schedule(
        project_id=project_id,
        user_id=user_id,
        schedule=TriggerScheduleCreate(
            data=TriggerScheduleData(event_key="cron.tick", schedule="* * * * *"),
        ),
    )
    if soft_deleted:
        await triggers_dao.delete_schedule(
            project_id=project_id,
            user_id=user_id,
            schedule_id=schedule.id,
        )
    else:
        async with engine.session() as session:
            await session.execute(
                text(
                    "UPDATE trigger_schedules SET flags = CAST(:flags AS jsonb) "
                    "WHERE project_id = :project_id AND id = :schedule_id"
                ),
                {
                    "flags": '{"is_active": false}',
                    "project_id": project_id,
                    "schedule_id": schedule.id,
                },
            )
            await session.commit()

    delivery_id = uuid.uuid4()
    claimed = await streams_dao.claim_trigger_delivery(
        project_id=project_id,
        user_id=user_id,
        event_id="blocked-event",
        session_id=uuid.uuid4().hex,
        attribution=SessionTriggerAttribution(
            configuration_id=schedule.id,
            kind=SessionTriggerKind.schedule,
            delivery_id=delivery_id,
        ),
    )

    assert claimed is False
    assert (
        await triggers_dao.fetch_delivery(
            project_id=project_id,
            delivery_id=delivery_id,
        )
        is None
    )
