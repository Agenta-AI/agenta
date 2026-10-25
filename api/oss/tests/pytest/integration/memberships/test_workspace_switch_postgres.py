"""Workspace removal step 2 ("switch") against a migrated Postgres.

Revision `oss000000053` repairs projects whose workspace belongs to another organization
and keeps one default project per organization. These cases pin both data changes, their
order, their locks against the step-1 and step-2 default writers, and the rule every
reader uses afterwards.

Global statements run on temp copies of the membership tables
(`rolled_back_connection(organizations=...)`) or are limited to the test's own
organizations (`switch(bind, organization_ids)`), so they never lock rows of tests that run
in parallel.
"""

import asyncio
from uuid import UUID, uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text

from oss.src.dbs.postgres.memberships.dao import MembershipsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.tests.pytest.utils.membership_seed import (
    ConnectionEngine,
    SeededOrganization,
    delete_seeded_organization,
    execute,
    fetch_all,
    load_revision_module,
    rolled_back_connection,
    seed_organization,
)


pytestmark = pytest.mark.integration

_REVISION = "oss000000053_switch_projects_to_organization_defaults.py"


def _revision():
    return load_revision_module(_REVISION)


def _dao() -> MembershipsDAO:
    return MembershipsDAO(engine=get_transactions_engine())


# --- shapes ------------------------------------------------------------------ #


async def _multi_default_organization() -> SeededOrganization:
    """Three workspaces, each with a default project. The `default`-type workspace is the
    second one, so the oldest default (project 0) is not the D-11 default (project 1)."""

    seeded = await seed_organization(members={"m": "editor"}, workspaces=3)
    await execute(
        "UPDATE workspaces SET type = NULL WHERE organization_id = :o",
        {"o": seeded.organization_id},
    )
    await execute(
        "UPDATE workspaces SET type = 'default' WHERE id = :w",
        {"w": seeded.workspace_ids[1]},
    )
    return seeded


async def _cross_organization_project(*, foreign_default_type: bool = True):
    """Project P of O1 whose workspace W belongs to O2 (a legacy shape)."""

    cross = await seed_organization(members={"m": "editor"}, workspaces=2)
    other = await seed_organization(members={"owner": "owner"})
    # O1: workspace 0 is not `default`-type, so only P's foreign workspace could rank first.
    await execute(
        "UPDATE workspaces SET type = NULL WHERE organization_id = :o",
        {"o": cross.organization_id},
    )
    await execute(
        "UPDATE workspaces SET type = :t WHERE id = :w",
        {"w": other.workspace_ids[0], "t": "default" if foreign_default_type else None},
    )
    await execute(
        "UPDATE projects SET workspace_id = :ws WHERE id = :p",
        {"ws": other.workspace_ids[0], "p": cross.project_ids[1]},
    )
    cross.extra_organization_ids.append(other.organization_id)
    cross.extra_user_ids.extend(other.user_ids.values())
    return cross, other


async def _no_default_organization() -> SeededOrganization:
    seeded = await seed_organization(members={"m": "editor"}, workspaces=2)
    await execute(
        "UPDATE projects SET is_default = false WHERE organization_id = :o",
        {"o": seeded.organization_id},
    )
    # The seed writes both workspaces in one transaction (same `now()`): make the second
    # one younger so the order does not depend on random ids.
    await execute(
        "UPDATE workspaces SET created_at = created_at + interval '1 second' WHERE id = :w",
        {"w": seeded.workspace_ids[1]},
    )
    return seeded


async def _upgrade(connection):
    def run(sync_connection):
        context = MigrationContext.configure(sync_connection)
        with Operations.context(context):
            _revision().upgrade()

    await connection.run_sync(run)


async def _switch(connection, organization_ids):
    return await connection.run_sync(
        lambda sync_connection: _revision().switch(sync_connection, organization_ids)
    )


async def _rows(connection, sql, params=None):
    return list((await connection.execute(text(sql), params or {})).mappings().all())


async def _defaults(connection, organization_id):
    return [
        row["id"]
        for row in await _rows(
            connection,
            "SELECT id FROM projects WHERE organization_id = :o AND is_default IS TRUE "
            "ORDER BY id",
            {"o": organization_id},
        )
    ]


# --- 053: data changes -------------------------------------------------------- #


async def test_053_repairs_cross_organization_projects():
    cross, other = await _cross_organization_project()
    try:
        async with rolled_back_connection(organizations=[cross]) as connection:
            before = {
                row["id"]: row["workspace_id"]
                for row in await _rows(
                    connection, "SELECT id, workspace_id FROM projects"
                )
            }
            await _upgrade(connection)
            after = {
                row["id"]: (row["workspace_id"], row["organization_id"])
                for row in await _rows(
                    connection, "SELECT id, workspace_id, organization_id FROM projects"
                )
            }
        p = cross.project_ids[1]
        assert after[p] == (None, cross.organization_id)
        for project_id, workspace_id in before.items():
            if project_id != p:
                assert after[project_id][0] == workspace_id
    finally:
        await delete_seeded_organization(cross)


async def test_053_keeps_one_default_per_organization(capsys):
    seeded = await _multi_default_organization()
    try:
        async with rolled_back_connection(organizations=[seeded]) as connection:
            await _upgrade(connection)
            defaults = await _defaults(connection, seeded.organization_id)
        assert defaults == [seeded.project_ids[1]]
        printed = capsys.readouterr().out
        for cleared in (seeded.project_ids[0], seeded.project_ids[2]):
            assert f"cleared default project {cleared}" in printed
        assert str(seeded.project_ids[1]) not in printed
    finally:
        await delete_seeded_organization(seeded)


async def test_053_sets_no_default_where_none_exists():
    seeded = await _no_default_organization()
    try:
        async with rolled_back_connection(organizations=[seeded]) as connection:
            await _upgrade(connection)
            defaults = await _defaults(connection, seeded.organization_id)
        assert defaults == []
    finally:
        await delete_seeded_organization(seeded)


async def test_053_repairs_before_it_consolidates():
    # P's foreign workspace is `default`-type: if the ranking ran first, P would win O1.
    cross, other = await _cross_organization_project(foreign_default_type=True)
    try:
        async with rolled_back_connection(organizations=[cross]) as connection:
            await _upgrade(connection)
            defaults = await _defaults(connection, cross.organization_id)
            foreign = await _defaults(connection, other.organization_id)
        assert defaults == [cross.project_ids[0]]
        assert foreign == [other.project_ids[0]]
    finally:
        await delete_seeded_organization(cross)


async def test_053_is_idempotent():
    seeded = await _multi_default_organization()
    cross, _ = await _cross_organization_project()
    try:
        async with rolled_back_connection(organizations=[seeded, cross]) as connection:
            first = await _switch(connection, None)
            second = await _switch(connection, None)
        assert first["repaired"] == 1 and first["cleared"] >= 2
        assert second == {
            "repaired": 0,
            "organizations_with_several_defaults": 0,
            "cleared": 0,
        }
    finally:
        await delete_seeded_organization(seeded)
        await delete_seeded_organization(cross)


async def test_053_keeps_project_access():
    seeded = await _multi_default_organization()
    cross, _ = await _cross_organization_project()
    try:
        async with rolled_back_connection(organizations=[seeded, cross]) as connection:
            dao = MembershipsDAO(engine=ConnectionEngine(connection))
            pairs = [
                (user_id, project_id)
                for org in (seeded, cross)
                for user_id in org.user_ids.values()
                for project_id in org.project_ids
            ]

            async def answers():
                out = {}
                for user_id, project_id in pairs:
                    row = await dao.fetch_membership_row(
                        user_id=user_id, project_id=project_id
                    )
                    out[(user_id, project_id)] = (
                        None
                        if row is None
                        else (
                            row.summary.organization_id,
                            row.has_organization_row,
                            row.organization_role,
                            row.has_project_row,
                            row.project_role,
                        )
                    )
                return out

            before = await answers()
            await _upgrade(connection)
            after = await answers()
        assert before == after
        assert all(value is not None for value in after.values())
    finally:
        await delete_seeded_organization(seeded)
        await delete_seeded_organization(cross)


async def test_053_downgrade_is_a_noop():
    seeded = await _multi_default_organization()
    try:
        async with rolled_back_connection(organizations=[seeded]) as connection:
            await _upgrade(connection)
            before = await _rows(connection, "SELECT * FROM projects ORDER BY id")

            def run(sync_connection):
                context = MigrationContext.configure(sync_connection)
                with Operations.context(context):
                    _revision().downgrade()

            await connection.run_sync(run)
            after = await _rows(connection, "SELECT * FROM projects ORDER BY id")
        assert before == after
    finally:
        await delete_seeded_organization(seeded)


async def test_053_locks_only_organizations_with_several_defaults():
    several = await _multi_default_organization()
    single = await seed_organization(members={"m": "editor"}, workspaces=1)
    none = await _no_default_organization()
    try:
        async with rolled_back_connection(
            organizations=[several, single, none]
        ) as connection:
            await _upgrade(connection)
            advisory = await _rows(
                connection,
                "SELECT objid FROM pg_locks WHERE locktype = 'advisory' "
                "AND pid = pg_backend_pid()",
            )
        assert len(advisory) == 1
    finally:
        for seeded in (several, single, none):
            await delete_seeded_organization(seeded)


# --- 053 against concurrent default writers ----------------------------------- #
#
# Two connections on the real tables, in an explicit order. The revision's `switch` is
# limited to the test's organization.

_STEP1_CLEAR_ORGANIZATION_SQL = (
    "UPDATE projects SET is_default = false "
    "WHERE organization_id = :o AND is_default = true"
)
_STEP1_CLEAR_WORKSPACE_SQL = (
    "UPDATE projects SET is_default = false "
    "WHERE workspace_id = :w AND is_default = true"
)
_STEP1_SET_SQL = "UPDATE projects SET is_default = true WHERE id = :p"


async def _add_project(*, organization_id, workspace_id, is_default) -> UUID:
    project_id = uuid4()
    await execute(
        "INSERT INTO projects (id, project_name, is_default, organization_id, workspace_id, "
        "created_at, updated_at) VALUES (:id, 'extra', :d, :o, :w, clock_timestamp(), "
        "clock_timestamp())",
        {"id": project_id, "d": is_default, "o": organization_id, "w": workspace_id},
    )
    return project_id


async def _committed_defaults(organization_id) -> list:
    return [
        row["id"]
        for row in await fetch_all(
            "SELECT id FROM projects WHERE organization_id = :o AND is_default IS TRUE "
            "ORDER BY id",
            {"o": organization_id},
        )
    ]


async def _blocked(task, seconds=0.4) -> bool:
    await asyncio.sleep(seconds)
    return not task.done()


async def _migration_task(organization_id):
    engine = get_transactions_engine()._engine

    async def run():
        async with engine.begin() as connection:
            await connection.execute(text("SET LOCAL lock_timeout = '2s'"))
            return await _switch(connection, [organization_id])

    return asyncio.create_task(run())


async def test_053_waits_for_a_step1_null_workspace_promotion():
    seeded = await _multi_default_organization()
    try:
        target = await _add_project(
            organization_id=seeded.organization_id, workspace_id=None, is_default=False
        )
        engine = get_transactions_engine()._engine
        async with engine.connect() as a:
            transaction = await a.begin()
            await a.execute(
                text(_STEP1_CLEAR_ORGANIZATION_SQL), {"o": seeded.organization_id}
            )
            migration = await _migration_task(seeded.organization_id)
            assert await _blocked(migration)
            await a.execute(text(_STEP1_SET_SQL), {"p": target})
            await transaction.commit()
        counts = await migration
        assert counts["cleared"] == 0
        assert await _committed_defaults(seeded.organization_id) == [target]
    finally:
        await delete_seeded_organization(seeded)


async def test_step1_promotion_after_053_waits_and_keeps_one_default():
    seeded = await _multi_default_organization()
    try:
        target = await _add_project(
            organization_id=seeded.organization_id, workspace_id=None, is_default=False
        )
        engine = get_transactions_engine()._engine
        async with engine.connect() as b:
            transaction = await b.begin()
            await _switch(b, [seeded.organization_id])

            async def step1():
                async with engine.begin() as a:
                    await a.execute(
                        text(_STEP1_CLEAR_ORGANIZATION_SQL),
                        {"o": seeded.organization_id},
                    )
                    await a.execute(text(_STEP1_SET_SQL), {"p": target})

            promotion = asyncio.create_task(step1())
            assert await _blocked(promotion)
            await transaction.commit()
        await promotion
        assert await _committed_defaults(seeded.organization_id) == [target]
    finally:
        await delete_seeded_organization(seeded)


async def test_step1_workspace_promotion_after_053_may_leave_two_defaults_never_zero():
    seeded = await _multi_default_organization()
    try:
        secondary = seeded.workspace_ids[2]
        target = await _add_project(
            organization_id=seeded.organization_id,
            workspace_id=secondary,
            is_default=False,
        )
        engine = get_transactions_engine()._engine
        async with engine.connect() as b:
            transaction = await b.begin()
            await _switch(b, [seeded.organization_id])

            async def step1():
                async with engine.begin() as a:
                    await a.execute(text(_STEP1_CLEAR_WORKSPACE_SQL), {"w": secondary})
                    await a.execute(text(_STEP1_SET_SQL), {"p": target})

            promotion = asyncio.create_task(step1())
            await asyncio.sleep(0.3)
            await transaction.commit()
        await promotion
        defaults = await _committed_defaults(seeded.organization_id)
        assert sorted(defaults) == sorted([seeded.project_ids[1], target])
    finally:
        await delete_seeded_organization(seeded)


async def test_step1_stale_project_read_keeps_a_default():
    # Step-1 `set_default_project` reads the target, sees `is_default` true and returns
    # without writing ("already default"). When 053 cleared that project in between, the
    # organization still keeps exactly one default: the D-11 winner.
    seeded = await _multi_default_organization()
    try:
        stale = seeded.project_ids[0]
        read = await fetch_all(
            "SELECT is_default FROM projects WHERE id = :p", {"p": stale}
        )
        assert read[0]["is_default"] is True
        engine = get_transactions_engine()._engine
        async with engine.begin() as b:
            await _switch(b, [seeded.organization_id])
        # The step-1 writer returns here from its stale read; nothing else runs.
        assert await _committed_defaults(seeded.organization_id) == [
            seeded.project_ids[1]
        ]
    finally:
        await delete_seeded_organization(seeded)


# --- one default-project rule (R1, R2, R4) ------------------------------------ #

import oss.src.core.access.permissions.service as permissions_service  # noqa: E402
import oss.src.services.db_manager as db_manager  # noqa: E402
from oss.src.core.access.dtos import RequestCredentialKind  # noqa: E402
from oss.src.core.access.permissions.types import Permission  # noqa: E402
from oss.tests.pytest.utils.statements import count_statements  # noqa: E402


async def _consolidated(seeded: SeededOrganization) -> SeededOrganization:
    """Run 053's switch for this organization only, committed."""

    engine = get_transactions_engine()._engine
    async with engine.begin() as connection:
        await _switch(connection, [seeded.organization_id])
    return seeded


async def _readers(ref) -> tuple:
    by_workspace = await db_manager.get_project_by_workspace(str(ref))
    default = await db_manager.fetch_default_project(
        workspace_or_organization_id=str(ref)
    )
    return by_workspace.id, default.project_id if default else None


async def test_default_helpers_agree_for_every_seed_scope():
    # Every workspace id and organization id of the seed (not of other tests) whose
    # organization has a default project, after the consolidation of the seed copy.
    refs = await fetch_all(
        "SELECT w.id AS ref FROM workspaces w JOIN organizations o "
        "ON o.id = w.organization_id WHERE o.name NOT LIKE 'membership-seed-%' "
        "AND EXISTS (SELECT 1 FROM projects p WHERE p.organization_id = o.id "
        "AND p.is_default IS TRUE) "
        "UNION ALL SELECT o.id FROM organizations o WHERE o.name NOT LIKE "
        "'membership-seed-%' AND EXISTS (SELECT 1 FROM projects p WHERE "
        "p.organization_id = o.id AND p.is_default IS TRUE)"
    )
    assert refs
    for row in refs:
        by_workspace, default = await _readers(row["ref"])
        assert by_workspace == default, row["ref"]


async def test_member_routes_and_bearer_pick_the_same_project():
    seeded = await _consolidated(await _multi_default_organization())
    try:
        for ref in (*seeded.workspace_ids, seeded.organization_id):
            assert await _readers(ref) == (seeded.project_ids[1],) * 2
    finally:
        await delete_seeded_organization(seeded)


async def test_readers_pick_the_d11_default_when_two_remain():
    seeded = await _consolidated(await _multi_default_organization())
    try:
        # A step-1-shaped write after 053: a second default in a secondary workspace.
        await execute(
            "UPDATE projects SET is_default = true WHERE id = :p",
            {"p": seeded.project_ids[2]},
        )
        for ref in (*seeded.workspace_ids, seeded.organization_id):
            assert await _readers(ref) == (seeded.project_ids[1],) * 2
    finally:
        await delete_seeded_organization(seeded)


async def test_default_lookups_stay_in_the_ref_organization():
    cross, other = await _cross_organization_project()
    try:
        await _consolidated(cross)
        # The cross-organization shape written again after 053 (a step-1 admin call).
        await execute(
            "UPDATE projects SET workspace_id = :w WHERE id = :p",
            {"w": other.workspace_ids[0], "p": cross.project_ids[1]},
        )
        by_workspace, default = await _readers(other.workspace_ids[0])
        assert by_workspace == default == other.project_ids[0]
        first = await db_manager.get_project_by_workspace(
            str(other.workspace_ids[0]), use_default=False
        )
        assert first.id == other.project_ids[0]
        own = await _readers(cross.organization_id)
        assert own == (cross.project_ids[0],) * 2
    finally:
        await delete_seeded_organization(cross)


async def test_get_project_by_workspace_falls_back_without_a_default():
    seeded = await _no_default_organization()
    try:
        for ref in (*seeded.workspace_ids, seeded.organization_id):
            project = await db_manager.get_project_by_workspace(str(ref))
            # Both workspaces are `default`-type: the oldest workspace's project.
            assert project.id == seeded.project_ids[0]
            assert (
                await db_manager.fetch_default_project(
                    workspace_or_organization_id=str(ref)
                )
                is None
            )
    finally:
        await delete_seeded_organization(seeded)


async def test_default_lookups_are_one_statement():
    seeded = await _consolidated(await _multi_default_organization())
    try:
        engine = get_transactions_engine()
        for ref in (seeded.workspace_ids[2], seeded.organization_id):
            with count_statements(engine) as fetched:
                await db_manager.fetch_default_project(
                    workspace_or_organization_id=str(ref)
                )
            with count_statements(engine) as found:
                await db_manager.get_project_by_workspace(str(ref))
            assert len(fetched) == 1
            assert len(found) == 1
    finally:
        await delete_seeded_organization(seeded)


# --- check_organization_write follows the organization default (owner question 1,
# option (a): the D-11 default) ------------------------------------------------ #


class _KeyAccess:
    def __init__(self, project_id):
        self.credential_kind = RequestCredentialKind.API_KEY
        self.project_id = project_id


async def _organization_write(monkeypatch, organization_id, key_project_id) -> bool:
    checked = []

    async def check_action_access(*, user_uid, project_id, permission):
        checked.append(project_id)
        return str(project_id) == str(key_project_id)

    monkeypatch.setattr(
        permissions_service, "get_request_access", lambda: _KeyAccess(key_project_id)
    )
    monkeypatch.setattr(permissions_service, "check_action_access", check_action_access)
    allowed = await permissions_service.check_organization_write(
        user_uid="u",
        organization_id=str(organization_id),
        permission=Permission.EDIT_WORKSPACE,
    )
    assert len(checked) == 1
    return allowed


async def test_check_organization_write_uses_the_organization_default(monkeypatch):
    # The oldest default (project 0) is not in the `default`-type workspace (project 1).
    seeded = await _consolidated(await _multi_default_organization())
    try:
        engine = get_transactions_engine()
        with count_statements(engine) as statements:
            kept = await _organization_write(
                monkeypatch, seeded.organization_id, seeded.project_ids[1]
            )
        assert kept is True
        assert len(statements) == 1
        assert (
            await _organization_write(
                monkeypatch, seeded.organization_id, seeded.project_ids[0]
            )
            is False
        )
    finally:
        await delete_seeded_organization(seeded)


async def test_kept_default_key_can_update_organization_settings(monkeypatch):
    seeded = await _consolidated(await _multi_default_organization())
    try:
        # Newly allowed: before step 2 the oldest default (project 0) decided.
        assert await _organization_write(
            monkeypatch, seeded.organization_id, seeded.project_ids[1]
        )
    finally:
        await delete_seeded_organization(seeded)


async def test_cleared_default_key_cannot_update_organization_settings(monkeypatch):
    seeded = await _consolidated(await _multi_default_organization())
    try:
        # Newly refused: the key of the oldest default, which 053 cleared.
        assert not await _organization_write(
            monkeypatch, seeded.organization_id, seeded.project_ids[0]
        )
    finally:
        await delete_seeded_organization(seeded)


def test_organization_write_callers_go_through_check_organization_write():
    # Organization settings, domains, SSO providers and billing all decide through
    # `check_organization_write`, so the two tests above cover them.
    from pathlib import Path

    api = Path(__file__).resolve().parents[5]
    callers = {
        "oss/src/routers/organization_router.py",
        "oss/src/routers/workspace_router.py",
        "ee/src/apis/fastapi/billing/router.py",
        "ee/src/apis/fastapi/organizations/router.py",
    }
    for relative in callers:
        path = api / relative
        if not path.exists():
            continue
        assert "check_organization_write" in path.read_text(), relative


# --- default writers serialize on the organization lock (S-30) ---------------- #

_LOCK_SQL = (
    "SELECT pg_advisory_xact_lock(hashtextextended('agenta:project_default:' "
    "|| CAST(:o AS text), 0))"
)


async def _hold_lock_and_promote(connection, organization_id, project_id):
    await connection.execute(text(_LOCK_SQL), {"o": str(organization_id)})
    await connection.execute(
        text(
            "UPDATE projects SET is_default = (id = :p) WHERE organization_id = :o "
            "AND (is_default IS TRUE OR id = :p)"
        ),
        {"o": organization_id, "p": project_id},
    )


def test_writers_and_053_use_one_lock_key():
    revision = _revision()
    assert "'agenta:project_default:' || o::text" in revision._ADVISORY_LOCKS_SQL
    assert "'agenta:project_default:'" in db_manager._PROJECT_DEFAULT_LOCK_SQL
    from oss.src.dbs.postgres.memberships import dao as memberships_dao

    assert "'agenta:project_default:'" in memberships_dao._LOCK_WITH_PROJECT_DEFAULT_SQL


async def test_default_writers_serialize_on_the_organization_lock():
    seeded = await _consolidated(await _multi_default_organization())
    try:
        p_a, p_b = seeded.project_ids[1], seeded.project_ids[2]
        engine = get_transactions_engine()._engine
        async with engine.connect() as a:
            transaction = await a.begin()
            await _hold_lock_and_promote(a, seeded.organization_id, p_b)
            # B starts while pA is still the committed default.
            b = asyncio.create_task(db_manager.set_default_project(str(p_a)))
            assert await _blocked(b)
            await transaction.commit()
        promoted = await b
        assert promoted.id == p_a and promoted.is_default is True
        assert await _committed_defaults(seeded.organization_id) == [p_a]
    finally:
        await delete_seeded_organization(seeded)


async def test_create_and_admin_create_serialize_with_set_default():
    seeded = await _consolidated(await _multi_default_organization())
    try:
        engine = get_transactions_engine()._engine
        for writer in ("create", "admin"):
            async with engine.connect() as a:
                transaction = await a.begin()
                await _hold_lock_and_promote(
                    a, seeded.organization_id, seeded.project_ids[2]
                )
                if writer == "create":
                    task = asyncio.create_task(
                        _dao().create_project(
                            organization_id=seeded.organization_id,
                            workspace_id=seeded.organization_id,
                            name="made-default",
                            is_default=True,
                        )
                    )
                else:
                    task = asyncio.create_task(
                        db_manager.admin_create_project(
                            name="admin-default",
                            org_id=seeded.organization_id,
                            is_default=True,
                        )
                    )
                assert await _blocked(task)
                await transaction.commit()
            created = await task
            created_id = created.scope.project_id if writer == "create" else created.id
            assert await _committed_defaults(seeded.organization_id) == [created_id]
    finally:
        await delete_seeded_organization(seeded)


async def test_053_waits_for_a_step2_promotion():
    seeded = await _multi_default_organization()
    try:
        p_b = seeded.project_ids[2]
        engine = get_transactions_engine()._engine
        async with engine.connect() as a:
            transaction = await a.begin()
            await _hold_lock_and_promote(a, seeded.organization_id, p_b)
            migration = await _migration_task(seeded.organization_id)
            assert await _blocked(migration)
            await transaction.commit()
        counts = await migration
        assert counts["cleared"] == 0
        assert await _committed_defaults(seeded.organization_id) == [p_b]
    finally:
        await delete_seeded_organization(seeded)


async def test_053_waits_for_a_step2_create_with_make_default():
    seeded = await _multi_default_organization()
    try:
        engine = get_transactions_engine()._engine
        async with engine.connect() as a:
            transaction = await a.begin()
            await a.execute(text(_LOCK_SQL), {"o": str(seeded.organization_id)})
            migration = await _migration_task(seeded.organization_id)
            assert await _blocked(migration)
            await transaction.commit()
        await migration
        created = await _dao().create_project(
            organization_id=seeded.organization_id,
            workspace_id=seeded.organization_id,
            name="after",
            is_default=True,
        )
        assert await _committed_defaults(seeded.organization_id) == [
            created.scope.project_id
        ]
    finally:
        await delete_seeded_organization(seeded)


async def test_default_writer_statement_counts():
    seeded = await _consolidated(await _multi_default_organization())
    try:
        engine = get_transactions_engine()
        with count_statements(engine) as promoted:
            await db_manager.set_default_project(str(seeded.project_ids[2]))
        with count_statements(engine) as created:
            await _dao().create_project(
                organization_id=seeded.organization_id,
                workspace_id=seeded.organization_id,
                name="c",
                is_default=True,
            )
        with count_statements(engine) as admin_created:
            await db_manager.admin_create_project(
                name="a", org_id=seeded.organization_id, is_default=False
            )
        assert len(promoted) == 2  # step 1: read, clear, set, refresh
        assert (
            len(created) <= 5
        )  # step 1: 6 (lock, resolve, has-default, unset, insert, seed, owner)
        assert len(admin_created) == 2  # step 1: 1 insert (+1 lock, admin-only)
    finally:
        await delete_seeded_organization(seeded)


async def test_admin_routes_cannot_create_a_second_default():
    seeded = await _consolidated(await _multi_default_organization())
    try:
        first = await db_manager.admin_create_project(
            name="one", org_id=seeded.organization_id, is_default=True
        )
        second = await db_manager.admin_create_project(
            name="two", org_id=seeded.organization_id, is_default=True
        )
        assert await _committed_defaults(seeded.organization_id) == [second.id]
        assert first.id != second.id
    finally:
        await delete_seeded_organization(seeded)
