"""`oss000000047` `_backfill`, on temp-table shadows of the tables it touches.

The backfill walks whole tables. Running it on the shared tables of the stack, even in a
rolled-back transaction, would lock rows that parallel tests write. So each test copies
the shape of the six tables into temp tables (`pg_temp` is searched first, so the
revision's unqualified names hit the copies), seeds rows there, runs `_backfill` with a
batch size of 2, and rolls back. The stack database must be at `oss000000046` or later.
"""

import json
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.tests.pytest.utils.membership_seed import load_revision_module


pytestmark = pytest.mark.integration

REVISION = "oss000000047_backfill_run_principal.py"

_SHADOWED = (
    "trigger_schedules",
    "trigger_subscriptions",
    "evaluation_runs",
    "workflow_artifacts",
    "workflow_variants",
    "workflow_revisions",
)


@asynccontextmanager
async def shadowed():
    engine = get_transactions_engine()
    inner = getattr(engine, "_engine", engine)
    async with inner.connect() as connection:
        transaction = await connection.begin()
        try:
            for table in _SHADOWED:
                await connection.execute(
                    text(
                        f"CREATE TEMP TABLE {table} "
                        f"(LIKE public.{table} INCLUDING DEFAULTS) ON COMMIT DROP"
                    )
                )
            yield connection
        finally:
            await transaction.rollback()


async def _backfill(connection, *, batch_size=2):
    module = load_revision_module(REVISION)
    return await connection.run_sync(
        lambda sync: module._backfill(sync, batch_size=batch_size)
    )


async def _schedule(
    connection,
    *,
    project_id: UUID,
    references=None,
    created_by_id=None,
    flags="__default__",
    meta=None,
    deleted=False,
):
    schedule_id = uuid4()
    data = {"event_key": "cron", "schedule": "* * * * *"}
    if references is not None:
        data["references"] = references
    await connection.execute(
        text(
            "INSERT INTO trigger_schedules (project_id, id, name, data, flags, meta, "
            "created_by_id, deleted_at) VALUES (:p, :id, 's', CAST(:data AS json), "
            "CAST(:flags AS jsonb), CAST(:meta AS json), :u, "
            "CASE WHEN :deleted THEN now() END)"
        ),
        {
            "p": project_id,
            "id": schedule_id,
            "data": json.dumps(data),
            "flags": (
                json.dumps({"is_active": True}) if flags == "__default__" else flags
            ),
            "meta": meta,
            "u": created_by_id,
            "deleted": deleted,
        },
    )
    return schedule_id


async def _subscription(connection, *, project_id, references=None, created_by_id=None):
    subscription_id = uuid4()
    data = {"event_key": "e"}
    if references is not None:
        data["references"] = references
    await connection.execute(
        text(
            "INSERT INTO trigger_subscriptions (project_id, id, connection_id, name, "
            "data, flags, created_by_id) VALUES (:p, :id, :c, 's', "
            "CAST(:data AS json), '{\"is_active\": true}'::jsonb, :u)"
        ),
        {
            "p": project_id,
            "id": subscription_id,
            "c": uuid4(),
            "data": json.dumps(data),
            "u": created_by_id,
        },
    )
    return subscription_id


async def _evaluation_run(connection, *, project_id, created_by_id):
    run_id = uuid4()
    await connection.execute(
        text(
            "INSERT INTO evaluation_runs (project_id, id, created_by_id, status) "
            "VALUES (:p, :id, :u, 'pending')"
        ),
        {"p": project_id, "id": run_id, "u": created_by_id},
    )
    return run_id


async def _workflow(connection, *, project_id):
    artifact_id, variant_id, revision_id = uuid4(), uuid4(), uuid4()
    slug = f"agent-{artifact_id.hex[:8]}"
    await connection.execute(
        text(
            "INSERT INTO workflow_artifacts (project_id, id, slug) VALUES (:p, :a, :s)"
        ),
        {"p": project_id, "a": artifact_id, "s": slug},
    )
    await connection.execute(
        text(
            "INSERT INTO workflow_variants (project_id, artifact_id, id, slug) "
            "VALUES (:p, :a, :v, :s)"
        ),
        {"p": project_id, "a": artifact_id, "v": variant_id, "s": f"{slug}.default"},
    )
    await connection.execute(
        text(
            "INSERT INTO workflow_revisions (project_id, artifact_id, variant_id, id, "
            "slug, author) VALUES (:p, :a, :v, :r, :s, :p)"
        ),
        {
            "p": project_id,
            "a": artifact_id,
            "v": variant_id,
            "r": revision_id,
            "s": f"{slug}.r1",
        },
    )
    return {
        "artifact_id": artifact_id,
        "variant_id": variant_id,
        "revision_id": revision_id,
        "slug": slug,
        "variant_slug": f"{slug}.default",
    }


async def _row(connection, table, row_id):
    return (
        (
            await connection.execute(
                text(
                    f"SELECT principal_kind, principal_id, artifact_id, flags, "
                    f"meta::jsonb AS meta FROM {table} WHERE id = :id"
                ),
                {"id": row_id},
            )
        )
        .mappings()
        .first()
    )


async def test_schedule_bound_by_variant():
    async with shadowed() as connection:
        project_id = uuid4()
        workflow = await _workflow(connection, project_id=project_id)
        schedule = await _schedule(
            connection,
            project_id=project_id,
            created_by_id=uuid4(),
            references={"application_variant": {"id": str(workflow["variant_id"])}},
        )
        await _backfill(connection)
        row = await _row(connection, "trigger_schedules", schedule)
        assert row["artifact_id"] == workflow["artifact_id"]


@pytest.mark.parametrize(
    "references",
    [
        lambda w: {"workflow": {"id": str(w["artifact_id"])}},
        lambda w: {"application": {"slug": w["slug"]}},
        lambda w: {"evaluator_variant": {"slug": w["variant_slug"]}},
        lambda w: {"workflow_revision": {"id": str(w["revision_id"])}},
    ],
)
async def test_backfill_by_id_slug_and_revision(references):
    async with shadowed() as connection:
        project_id = uuid4()
        workflow = await _workflow(connection, project_id=project_id)
        schedule = await _schedule(
            connection,
            project_id=project_id,
            created_by_id=uuid4(),
            references=references(workflow),
        )
        subscription = await _subscription(
            connection,
            project_id=project_id,
            created_by_id=uuid4(),
            references=references(workflow),
        )
        await _backfill(connection)
        for table, row_id in (
            ("trigger_schedules", schedule),
            ("trigger_subscriptions", subscription),
        ):
            row = await _row(connection, table, row_id)
            assert row["artifact_id"] == workflow["artifact_id"], table


async def test_environment_reference_wins_over_an_application_reference():
    async with shadowed() as connection:
        project_id = uuid4()
        workflow = await _workflow(connection, project_id=project_id)
        schedule = await _schedule(
            connection,
            project_id=project_id,
            created_by_id=uuid4(),
            references={
                "environment": {"slug": "production"},
                "application": {"id": str(workflow["artifact_id"])},
            },
        )
        other = await _schedule(
            connection,
            project_id=project_id,
            created_by_id=uuid4(),
            references={
                "environment_revision": {"id": str(uuid4())},
                "workflow": {"id": str(workflow["artifact_id"])},
            },
        )
        await _backfill(connection)
        for row_id in (schedule, other):
            row = await _row(connection, "trigger_schedules", row_id)
            assert row["artifact_id"] is None
            assert row["flags"]["is_active"] is True


async def test_foreign_project_id_is_not_matched():
    async with shadowed() as connection:
        project_id, foreign_project_id = uuid4(), uuid4()
        foreign = await _workflow(connection, project_id=foreign_project_id)
        schedule = await _schedule(
            connection,
            project_id=project_id,
            created_by_id=uuid4(),
            references={"application": {"id": str(foreign["artifact_id"])}},
        )
        await _backfill(connection)
        row = await _row(connection, "trigger_schedules", schedule)
        assert row["artifact_id"] is None


async def test_backfill_sets_human_created_by():
    async with shadowed() as connection:
        project_id, creator = uuid4(), uuid4()
        schedule = await _schedule(
            connection, project_id=project_id, created_by_id=creator
        )
        subscription = await _subscription(
            connection, project_id=project_id, created_by_id=creator
        )
        run = await _evaluation_run(
            connection, project_id=project_id, created_by_id=creator
        )
        counts = await _backfill(connection)
        assert counts["principals"] == 3
        for table, row_id in (
            ("trigger_schedules", schedule),
            ("trigger_subscriptions", subscription),
        ):
            row = await _row(connection, table, row_id)
            assert (row["principal_kind"], row["principal_id"]) == ("human", creator)
        run_row = (
            await connection.execute(
                text(
                    "SELECT principal_kind, principal_id FROM evaluation_runs "
                    "WHERE id = :id"
                ),
                {"id": run},
            )
        ).first()
        assert tuple(run_row) == ("human", creator)


async def test_creator_not_in_users_is_backfilled_as_today():
    async with shadowed() as connection:
        ghost = uuid4()  # no users row
        schedule = await _schedule(connection, project_id=uuid4(), created_by_id=ghost)
        await _backfill(connection)
        row = await _row(connection, "trigger_schedules", schedule)
        assert (row["principal_kind"], row["principal_id"]) == ("human", ghost)
        assert row["flags"]["is_active"] is True


async def test_null_creator_paused():
    async with shadowed() as connection:
        schedule = await _schedule(
            connection, project_id=uuid4(), created_by_id=None, flags=None, meta=None
        )
        counts = await _backfill(connection)
        assert counts["paused"] == 1
        row = await _row(connection, "trigger_schedules", schedule)
        assert row["principal_id"] is None
        assert row["flags"] == {"is_active": False}
        assert row["meta"] == {"paused_reason": "missing_principal"}


async def test_deleted_trigger_is_not_paused():
    async with shadowed() as connection:
        schedule = await _schedule(
            connection, project_id=uuid4(), created_by_id=None, deleted=True
        )
        counts = await _backfill(connection)
        assert counts["paused"] == 0
        row = await _row(connection, "trigger_schedules", schedule)
        assert row["flags"] == {"is_active": True}


async def test_backfill_is_idempotent():
    async with shadowed() as connection:
        project_id = uuid4()
        workflow = await _workflow(connection, project_id=project_id)
        await _schedule(
            connection,
            project_id=project_id,
            created_by_id=uuid4(),
            references={"workflow": {"id": str(workflow["artifact_id"])}},
        )
        await _schedule(connection, project_id=project_id, created_by_id=None)
        await _evaluation_run(connection, project_id=project_id, created_by_id=uuid4())
        first = await _backfill(connection)
        assert first == {"principals": 2, "paused": 1, "artifact_ids": 1}
        second = await _backfill(connection)
        assert second == {"principals": 0, "paused": 0, "artifact_ids": 0}


async def test_batches_cover_every_row():
    async with shadowed() as connection:
        project_id = uuid4()
        ids = [
            await _schedule(connection, project_id=project_id, created_by_id=uuid4())
            for _ in range(5)
        ]
        counts = await _backfill(connection, batch_size=2)
        assert counts["principals"] == 5
        for row_id in ids:
            row = await _row(connection, "trigger_schedules", row_id)
            assert row["principal_kind"] == "human"
