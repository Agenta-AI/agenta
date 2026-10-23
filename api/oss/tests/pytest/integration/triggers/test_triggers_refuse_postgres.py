"""`TriggersDAO.refuse_delivery` and the pause writes, on the stack database (M2).

A refused delivery is one transaction: the delivery row (status failed, `error` the
message, `error_details` the agent-visible envelope) and the trigger paused
(`flags.is_active = false`, `meta.paused_reason`). A repeated event writes nothing.
"""

import uuid

import pytest
from sqlalchemy import text

import oss.src.models.db_models  # noqa: F401
from oss.src.core.access.principals import missing_principal_error
from oss.src.core.shared.dtos import Status
from oss.src.core.triggers.dtos import (
    TriggerDeliveryCreate,
    TriggerDeliveryData,
    TriggerScheduleCreate,
    TriggerScheduleData,
    TriggerSubscriptionCreate,
    TriggerSubscriptionData,
)
from oss.src.dbs.postgres.gateway.connections.dbes import ConnectionDBE  # noqa: F401
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.dbs.postgres.triggers.dao import TriggersDAO
from oss.tests.pytest.utils.principals import any_principal


pytestmark = pytest.mark.integration


@pytest.fixture
async def scope():
    engine = get_transactions_engine()
    ids = {name: uuid.uuid4() for name in ("user", "org", "ws", "project", "conn")}
    async with engine.session() as session:
        for statement, params in (
            (
                "INSERT INTO users (id, uid, username, email) "
                "VALUES (:id, :uid, 'trigger-refuse', :email)",
                {
                    "id": ids["user"],
                    "uid": str(ids["user"]),
                    "email": f"trigger-refuse-{ids['user'].hex[:8]}@example.com",
                },
            ),
            (
                "INSERT INTO organizations (id, name, owner_id) "
                "VALUES (:id, 'trigger-refuse', :owner)",
                {"id": ids["org"], "owner": ids["user"]},
            ),
            (
                "INSERT INTO workspaces (id, name, organization_id) "
                "VALUES (:id, 'trigger-refuse', :org)",
                {"id": ids["ws"], "org": ids["org"]},
            ),
            (
                "INSERT INTO projects (id, project_name, workspace_id, organization_id) "
                "VALUES (:id, 'trigger-refuse', :ws, :org)",
                {"id": ids["project"], "ws": ids["ws"], "org": ids["org"]},
            ),
            (
                "INSERT INTO gateway_connections "
                "(id, project_id, created_by_id, slug, provider_key, integration_key) "
                "VALUES (:id, :p, :u, 'trigger-refuse', 'composio', 'github')",
                {"id": ids["conn"], "p": ids["project"], "u": ids["user"]},
            ),
        ):
            await session.execute(text(statement), params)
        await session.commit()

    yield ids

    async with engine.session() as session:
        for table in (
            "trigger_deliveries",
            "session_streams",
            "trigger_subscriptions",
            "trigger_schedules",
            "gateway_connections",
        ):
            await session.execute(
                text(f"DELETE FROM {table} WHERE project_id = :p"),
                {"p": ids["project"]},
            )
        for table, key in (
            ("projects", "project"),
            ("workspaces", "ws"),
            ("organizations", "org"),
            ("users", "user"),
        ):
            await session.execute(
                text(f"DELETE FROM {table} WHERE id = :id"), {"id": ids[key]}
            )
        await session.commit()


async def _schedule(dao, scope, *, artifact_id=None):
    return await dao.create_schedule(
        project_id=scope["project"],
        principal=any_principal(),
        artifact_id=artifact_id,
        user_id=scope["user"],
        schedule=TriggerScheduleCreate(
            name="refuse",
            data=TriggerScheduleData(event_key="cron.tick", schedule="* * * * *"),
        ),
    )


async def _subscription(dao, scope, *, artifact_id=None):
    return await dao.create_subscription(
        project_id=scope["project"],
        principal=any_principal(),
        artifact_id=artifact_id,
        user_id=scope["user"],
        subscription=TriggerSubscriptionCreate(
            connection_id=scope["conn"],
            name="refuse",
            data=TriggerSubscriptionData(event_key="github.issue.opened"),
        ),
        trigger_id=f"ti_{uuid.uuid4().hex[:8]}",
    )


def _refused(*, schedule_id=None, subscription_id=None, event_id="event-1"):
    error = missing_principal_error()
    return TriggerDeliveryCreate(
        id=uuid.uuid4(),
        schedule_id=schedule_id,
        subscription_id=subscription_id,
        event_id=event_id,
        status=Status(code="403", message="failed"),
        data=TriggerDeliveryData(error=error.message, error_details=error),
    )


async def _row(table, trigger_id):
    async with get_transactions_engine().session() as session:
        return (
            (
                await session.execute(
                    text(f"SELECT flags, meta FROM {table} WHERE id = :id"),
                    {"id": trigger_id},
                )
            )
            .mappings()
            .one()
        )


async def _deliveries(scope):
    async with get_transactions_engine().session() as session:
        return (
            (
                await session.execute(
                    text(
                        "SELECT status, data FROM trigger_deliveries "
                        "WHERE project_id = :p"
                    ),
                    {"p": scope["project"]},
                )
            )
            .mappings()
            .all()
        )


async def test_refuse_delivery_records_and_pauses_a_schedule(scope):
    dao = TriggersDAO(engine=get_transactions_engine())
    schedule = await _schedule(dao, scope)

    delivery = await dao.refuse_delivery(
        project_id=scope["project"],
        user_id=scope["user"],
        delivery=_refused(schedule_id=schedule.id),
        reason="missing_principal",
    )

    assert delivery is not None
    row = await _row("trigger_schedules", schedule.id)
    assert row["flags"]["is_active"] is False
    assert row["meta"]["paused_reason"] == "missing_principal"


async def test_refuse_delivery_records_and_pauses_a_subscription(scope):
    dao = TriggersDAO(engine=get_transactions_engine())
    subscription = await _subscription(dao, scope)

    await dao.refuse_delivery(
        project_id=scope["project"],
        user_id=scope["user"],
        delivery=_refused(subscription_id=subscription.id),
        reason="access_denied",
    )

    row = await _row("trigger_subscriptions", subscription.id)
    assert row["flags"]["is_active"] is False
    assert row["meta"]["paused_reason"] == "access_denied"
    assert len(await _deliveries(scope)) == 1


async def test_refuse_delivery_keeps_event_dedup(scope):
    dao = TriggersDAO(engine=get_transactions_engine())
    schedule = await _schedule(dao, scope)
    for _ in range(2):
        await dao.refuse_delivery(
            project_id=scope["project"],
            user_id=scope["user"],
            delivery=_refused(schedule_id=schedule.id, event_id="same-event"),
            reason="missing_principal",
        )
    assert len(await _deliveries(scope)) == 1


async def test_refuse_delivery_with_null_flags_and_meta(scope):
    dao = TriggersDAO(engine=get_transactions_engine())
    schedule = await _schedule(dao, scope)
    async with get_transactions_engine().session() as session:
        await session.execute(
            text(
                "UPDATE trigger_schedules SET flags = NULL, meta = NULL WHERE id = :id"
            ),
            {"id": schedule.id},
        )
        await session.commit()

    await dao.refuse_delivery(
        project_id=scope["project"],
        user_id=scope["user"],
        delivery=_refused(schedule_id=schedule.id),
        reason="missing_principal",
    )

    row = await _row("trigger_schedules", schedule.id)
    assert row["flags"] == {"is_active": False}
    assert row["meta"] == {"paused_reason": "missing_principal"}


async def test_delivery_error_stays_a_string_for_old_readers(scope):
    dao = TriggersDAO(engine=get_transactions_engine())
    schedule = await _schedule(dao, scope)
    await dao.refuse_delivery(
        project_id=scope["project"],
        user_id=scope["user"],
        delivery=_refused(schedule_id=schedule.id),
        reason="missing_principal",
    )
    (stored,) = await _deliveries(scope)
    assert isinstance(stored["data"]["error"], str)
    assert stored["data"]["error"] == stored["data"]["error_details"]["message"]
    assert stored["data"]["error_details"]["code"] == "missing_principal"


async def test_pause_triggers_for_artifact_pauses_only_its_direct_targets(scope):
    dao = TriggersDAO(engine=get_transactions_engine())
    artifact_id = uuid.uuid4()
    direct = await _schedule(dao, scope, artifact_id=artifact_id)
    direct_sub = await _subscription(dao, scope, artifact_id=artifact_id)
    other = await _schedule(dao, scope, artifact_id=uuid.uuid4())
    environment_bound = await _schedule(dao, scope)

    paused = await dao.pause_triggers_for_artifact(
        project_id=scope["project"], artifact_id=artifact_id, reason="agent_deleted"
    )

    assert paused == 2
    assert (await _row("trigger_schedules", direct.id))["flags"]["is_active"] is False
    assert (await _row("trigger_subscriptions", direct_sub.id))["meta"][
        "paused_reason"
    ] == "agent_deleted"
    for untouched in (other, environment_bound):
        flags = (await _row("trigger_schedules", untouched.id))["flags"] or {}
        assert flags.get("is_active", True) is not False

    # Another project's call pauses nothing here.
    assert (
        await dao.pause_triggers_for_artifact(
            project_id=uuid.uuid4(), artifact_id=artifact_id, reason="agent_deleted"
        )
        == 0
    )
