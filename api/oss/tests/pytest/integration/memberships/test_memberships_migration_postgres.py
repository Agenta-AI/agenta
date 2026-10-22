"""The membership repair revisions and the preflight script, against Postgres.

The revision SQL is global (no organization filter), as it runs in the upgrade hook. The
tests in this file seed their own organizations and assert only on them; they share one
xdist group so two global repairs never interleave with another test's broken shapes.
"""

from uuid import uuid4

import pytest
from sqlalchemy import text

from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.tests.pytest.utils.membership_seed import (
    delete_seeded_organization,
    delete_seeded_shapes,
    execute,
    fetch_all,
    load_revision_module,
    load_revision_sql,
    rolled_back_connection,
    seed_legacy_shapes,
    seed_organization,
    seed_stress_organization,
)
from oss.tests.pytest.utils.statements import count_statements


pytestmark = [
    pytest.mark.integration,
    pytest.mark.xdist_group("memberships_global_sql"),
]

_REPAIR = "oss000000044_repair_memberships_for_resolver.py"
_INDEX = "oss000000045_add_project_members_unique_index.py"

_REPAIR_CONSTANTS = (
    "_DELETE_DEMO_ONLY_MEMBERSHIPS_SQL",
    "_DELETE_DEMO_ROWS_SQL",
    "_ADD_OWNER_ORGANIZATION_ROWS_SQL",
    "_ADD_OWNER_PROJECT_ROWS_SQL",
    "_COPY_WORKSPACE_ROLE_SQL",
)


async def _run_repair(connection) -> list:
    """Run the five repair statements in order on `connection`; return their row
    counts. Callers pass a `rolled_back_connection()`, so the global statements never
    commit into the shared database."""

    counts = []
    for name in _REPAIR_CONSTANTS:
        result = await connection.execute(text(load_revision_sql(_REPAIR, name)))
        counts.append(result.rowcount)
    return counts


async def _rows(connection, sql: str, params: dict) -> list:
    if connection is None:
        return await fetch_all(sql, params)
    return list((await connection.execute(text(sql), params)).mappings().all())


async def _organization_roles(connection, organization_id) -> dict:
    rows = await _rows(
        connection,
        "SELECT user_id, role FROM organization_members WHERE organization_id = :org",
        {"org": organization_id},
    )
    roles: dict = {}
    for row in rows:
        roles.setdefault(row["user_id"], []).append(row["role"])
    return roles


async def _project_rows(connection, project_ids, user_id) -> dict:
    rows = await _rows(
        connection,
        "SELECT project_id, role FROM project_members "
        "WHERE project_id = ANY(CAST(:p AS uuid[])) AND user_id = :u",
        {"p": list(project_ids), "u": user_id},
    )
    found: dict = {}
    for row in rows:
        found.setdefault(row["project_id"], []).append(row["role"])
    return found


# -- oss000000044 ---------------------------------------------------------------------


async def test_repair_revision_adds_owner_rows():
    seeded = await seed_organization(
        members={"owner": "owner"}, projects_per_workspace=2, project_rows=False
    )
    try:
        await execute(
            "DELETE FROM organization_members WHERE organization_id = :org",
            {"org": seeded.organization_id},
        )

        async with rolled_back_connection(organizations=[seeded]) as conn:
            await _run_repair(conn)

            roles = await _organization_roles(conn, seeded.organization_id)
            assert roles == {seeded.owner_id: ["owner"]}
            rows = await _project_rows(conn, seeded.project_ids, seeded.owner_id)
            assert rows == {p: ["owner"] for p in seeded.project_ids}
    finally:
        await delete_seeded_organization(seeded)


async def test_repair_revision_deletes_demo_rows():
    seeded = await seed_organization(
        members={"demo": "viewer", "real": "editor"}, projects_per_workspace=2
    )
    try:
        demo = seeded.user_ids["demo"]
        await execute(
            "UPDATE project_members SET is_demo = true WHERE user_id = :u AND project_id = :p",
            {"u": demo, "p": seeded.project_ids[0]},
        )

        async with rolled_back_connection(organizations=[seeded]) as conn:
            await _run_repair(conn)

            demo_rows = await _rows(
                conn,
                "SELECT count(*) AS n FROM project_members "
                "WHERE project_id = ANY(CAST(:p AS uuid[])) AND is_demo IS TRUE",
                {"p": seeded.project_ids},
            )
            assert demo_rows[0]["n"] == 0
            assert await _project_rows(conn, seeded.project_ids, demo) == {
                seeded.project_ids[1]: ["viewer"]
            }
            assert await _project_rows(
                conn, seeded.project_ids, seeded.user_ids["real"]
            ) == {p: ["editor"] for p in seeded.project_ids}
            # A real project row in the organization keeps the organization row.
            assert demo in await _organization_roles(conn, seeded.organization_id)
    finally:
        await delete_seeded_organization(seeded)


async def test_repair_revision_removes_a_demo_only_user_from_the_organization():
    seeded = await seed_organization(
        members={"demo": "viewer", "real": "editor"}, projects_per_workspace=2
    )
    try:
        demo = seeded.user_ids["demo"]
        await execute(
            "UPDATE project_members SET is_demo = true WHERE user_id = :u",
            {"u": demo},
        )

        async with rolled_back_connection(organizations=[seeded]) as conn:
            await _run_repair(conn)

            roles = await _organization_roles(conn, seeded.organization_id)
            assert demo not in roles
            assert roles[seeded.user_ids["real"]] == ["editor"]
            assert roles[seeded.owner_id] == ["owner"]
            workspace_rows = await _rows(
                conn,
                "SELECT user_id FROM workspace_members "
                "WHERE workspace_id = ANY(CAST(:w AS uuid[]))",
                {"w": seeded.workspace_ids},
            )
            assert demo not in {row["user_id"] for row in workspace_rows}
            assert seeded.user_ids["real"] in {row["user_id"] for row in workspace_rows}
            assert await _project_rows(conn, seeded.project_ids, demo) == {}
    finally:
        await delete_seeded_organization(seeded)


async def test_role_copy_skips_the_owner_and_multi_workspace_organizations():
    org_a = await seed_organization(members={"bob": "editor"})
    org_b = await seed_organization(members={"eve": "editor"}, workspaces=2)
    try:
        await execute(
            "UPDATE organization_members SET role = 'viewer' "
            "WHERE organization_id = :org AND user_id = :u",
            {"org": org_a.organization_id, "u": org_a.user_ids["bob"]},
        )
        await execute(
            "UPDATE workspace_members SET role = 'admin' WHERE user_id = :u",
            {"u": org_a.owner_id},
        )
        await execute(
            "UPDATE organization_members SET role = 'viewer' "
            "WHERE organization_id = :org AND user_id = :u",
            {"org": org_b.organization_id, "u": org_b.user_ids["eve"]},
        )

        async with rolled_back_connection(organizations=[org_a, org_b]) as conn:
            await _run_repair(conn)

            roles_a = await _organization_roles(conn, org_a.organization_id)
            assert roles_a[org_a.user_ids["bob"]] == ["editor"]
            assert roles_a[org_a.owner_id] == ["owner"]
            roles_b = await _organization_roles(conn, org_b.organization_id)
            assert roles_b[org_b.user_ids["eve"]] == ["viewer"]
    finally:
        await delete_seeded_organization(org_a)
        await delete_seeded_organization(org_b)


async def test_repair_revision_is_idempotent():
    seeded = await seed_organization(members={"owner": "owner", "m": "editor"})
    try:
        await execute(
            "DELETE FROM organization_members WHERE organization_id = :org AND user_id = :u",
            {"org": seeded.organization_id, "u": seeded.owner_id},
        )
        await execute(
            "UPDATE organization_members SET role = 'viewer' "
            "WHERE organization_id = :org AND user_id = :u",
            {"org": seeded.organization_id, "u": seeded.user_ids["m"]},
        )

        # The copies hold only this organization, so the second run must find
        # nothing left to change.
        async with rolled_back_connection(organizations=[seeded]) as conn:
            first = await _run_repair(conn)
            second = await _run_repair(conn)

        assert first[2] >= 1 and first[4] >= 1
        assert second == [0, 0, 0, 0, 0]
    finally:
        await delete_seeded_organization(seeded)


async def test_repair_revision_handles_production_shapes():
    shapes = await seed_legacy_shapes()
    try:
        async with rolled_back_connection(organizations=list(shapes.values())) as conn:
            await _run_repair(conn)

            s = shapes["owner_without_rows"]
            assert (await _organization_roles(conn, s.organization_id))[s.owner_id] == [
                "owner"
            ]
            assert await _project_rows(conn, s.project_ids, s.owner_id) == {
                p: ["owner"] for p in s.project_ids
            }

            s = shapes["owner_row_not_owner"]
            assert (await _organization_roles(conn, s.organization_id))[s.owner_id] == [
                "admin"
            ]

            s = shapes["two_owner_rows"]
            roles = await _organization_roles(conn, s.organization_id)
            assert roles == {s.owner_id: ["owner"], s.user_ids["m"]: ["owner"]}
            assert await _project_rows(conn, s.project_ids, s.owner_id) == {
                s.project_ids[0]: ["owner"]
            }

            s = shapes["five_workspaces"]
            assert (await _organization_roles(conn, s.organization_id))[
                s.user_ids["m"]
            ] == ["editor"]

            s = shapes["null_project_role"]
            assert await _project_rows(conn, s.project_ids, s.owner_id) == {
                s.project_ids[0]: [None]
            }
            assert await _project_rows(conn, s.project_ids, s.user_ids["m"]) == {
                s.project_ids[0]: [None]
            }

            s = shapes["role_differs"]
            assert (await _organization_roles(conn, s.organization_id))[
                s.user_ids["m"]
            ] == ["editor"]
    finally:
        await delete_seeded_shapes(shapes)


# -- oss000000045 ---------------------------------------------------------------------


async def _shadow_project_members(connection) -> None:
    """An index-free temp table that shadows `project_members` on this connection.

    `pg_temp` comes first in the search path, so unqualified `project_members` in the
    statements below reads and writes the shadow. `INCLUDING DEFAULTS` copies no index,
    so duplicates can be inserted.
    """

    await connection.execute(
        text(
            "CREATE TEMP TABLE project_members "
            "(LIKE public.project_members INCLUDING DEFAULTS) ON COMMIT DROP"
        )
    )


async def test_unique_index_revision_refuses_duplicates():
    revision = load_revision_module(_INDEX)
    seeded = await seed_organization(members={"owner": "owner"}, project_rows=False)
    try:
        async with get_transactions_engine().transaction() as connection:
            await _shadow_project_members(connection)
            for _ in range(2):
                await connection.execute(
                    text(
                        "INSERT INTO project_members (id, user_id, project_id, role) "
                        "VALUES (gen_random_uuid(), :u, :p, 'viewer')"
                    ),
                    {"u": seeded.owner_id, "p": seeded.project_ids[0]},
                )

            sync_error = {}

            def _guard(sync_connection):
                try:
                    revision._guard_no_duplicates(sync_connection)
                except RuntimeError as error:
                    sync_error["message"] = str(error)

            await connection.run_sync(_guard)

            message = sync_error.get("message", "")
            assert (
                "project_members has 1 duplicate (project_id, user_id) groups"
                in message
            )
            assert "python -m entrypoints.memberships_check --apply" in message
    finally:
        await delete_seeded_organization(seeded)


async def test_unique_index_exists_after_the_upgrade():
    versions = await fetch_all("SELECT version_num FROM alembic_version_oss")
    if not any(v["version_num"] >= "oss000000045" for v in versions):
        pytest.skip("oss000000045 is not applied on this database")

    # The revision is recorded, so its index must be there and valid.
    rows = await fetch_all(
        "SELECT indisvalid, indisunique FROM pg_catalog.pg_index "
        "WHERE indexrelid = pg_catalog.to_regclass('ux_project_members_project_id_user_id')"
    )
    assert rows, "oss000000045 is recorded but its index is missing"
    assert rows[0]["indisvalid"] is True
    assert rows[0]["indisunique"] is True


def test_revisions_chain_after_the_current_head():
    repair = load_revision_module(_REPAIR)
    index = load_revision_module(_INDEX)
    assert (repair.revision, repair.down_revision) == ("oss000000044", "oss000000043")
    assert (index.revision, index.down_revision) == ("oss000000045", "oss000000044")


# -- entrypoints/memberships_check.py --------------------------------------------------


@pytest.fixture
def check_module(monkeypatch):
    import entrypoints.memberships_check as module

    async def _no_rbac(organization_id):
        return False

    monkeypatch.setattr(module, "_rbac_enforced", _no_rbac)
    return module


async def _shadow_alembic_version(connection, version: str) -> None:
    await connection.execute(
        text(
            "CREATE TEMP TABLE alembic_version_oss (version_num varchar(32) NOT NULL) "
            "ON COMMIT DROP"
        )
    )
    await connection.execute(
        text("INSERT INTO alembic_version_oss VALUES (:v)"), {"v": version}
    )


async def _membership_snapshot(organization_ids) -> list:
    """Every membership row of these organizations, with the columns a writer would
    change, so "writes nothing" is checked row by row."""

    rows = await fetch_all(
        "SELECT 'o' AS t, om.id, om.user_id, om.role, om.deleted_at, NULL::boolean AS d "
        "FROM organization_members om WHERE om.organization_id = ANY(CAST(:o AS uuid[])) "
        "UNION ALL "
        "SELECT 'w', wm.id, wm.user_id, wm.role, wm.deleted_at, NULL "
        "FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id "
        "WHERE w.organization_id = ANY(CAST(:o AS uuid[])) "
        "UNION ALL "
        "SELECT 'p', pm.id, pm.user_id, pm.role, pm.deleted_at, pm.is_demo "
        "FROM project_members pm JOIN projects p ON p.id = pm.project_id "
        "WHERE p.organization_id = ANY(CAST(:o AS uuid[])) "
        "ORDER BY 1, 2",
        {"o": list(organization_ids)},
    )
    return [tuple(row.values()) for row in rows]


def _organizations_of(report, check) -> set:
    return set(report[check]["organizations"])


async def test_report_lists_p3_and_p4_and_writes_nothing(
    check_module, monkeypatch, tmp_path
):
    monkeypatch.setattr(check_module, "is_ee", lambda: True)
    shapes = await seed_legacy_shapes()
    try:
        organizations = sorted({s.organization_id for s in shapes.values()})
        before = await _membership_snapshot(organizations)

        report = await check_module.run_report(
            out_dir=tmp_path, organization_ids=organizations
        )

        p3 = shapes["P3"]
        p3_items = report["P3"]["organizations"][str(p3.organization_id)]
        assert f"{p3.user_ids['m']}/{p3.project_ids[0]}" in p3_items
        p2b = shapes["P2b"]
        assert report["P2b"]["organizations"][str(p2b.organization_id)] == [
            f"{p2b.user_ids['m']}/{p2b.project_ids[0]}"
        ]
        expected = {
            "P1": {"P1", "owner_without_rows"},
            "P2a": {"P2a", "owner_without_rows"},
            "P4": {"P4", "five_workspaces"},
            "P6": {"P6", "P12"},  # P12: the newer admin row differs too
            "P9": {"P9", "P1"},  # the P1 owner keeps a project row
            "P10": {"P10"},
            "P11": {"P11"},
            "P12": {"P12"},
        }
        for check, keys in expected.items():
            assert _organizations_of(report, check) == {
                str(shapes[k].organization_id) for k in keys
            }, check
        assert report["P5"]["count"] == 0
        assert "P7" not in report and "P8" not in report  # OSS-only checks
        assert (tmp_path / "report.json").exists()

        assert await _membership_snapshot(organizations) == before
    finally:
        await delete_seeded_shapes(shapes)


async def test_oss_report_lists_p7_and_p8(check_module, monkeypatch, tmp_path):
    monkeypatch.setattr(check_module, "is_ee", lambda: False)
    shapes = await seed_legacy_shapes()
    try:
        organizations = sorted({s.organization_id for s in shapes.values()})
        before = await _membership_snapshot(organizations)

        report = await check_module.run_report(
            out_dir=tmp_path, organization_ids=organizations
        )

        p7, p8 = shapes["P7"], shapes["P8"]
        assert report["P7"]["organizations"][str(p7.organization_id)] == [
            f"{p7.user_ids['m']}/{p7.project_ids[0]}"
        ]
        assert report["P8"]["organizations"][str(p8.organization_id)] == [
            f"{p8.user_ids['m']}/{p8.project_ids[1]}"
        ]
        assert "P2b" not in report and "P3" not in report and "P4" not in report
        assert await _membership_snapshot(organizations) == before
    finally:
        await delete_seeded_shapes(shapes)


async def test_report_handles_a_row_without_a_user(check_module, monkeypatch, tmp_path):
    monkeypatch.setattr(check_module, "is_ee", lambda: False)
    seeded = await seed_organization(members={"owner": "owner"})
    try:
        await execute(
            "INSERT INTO project_members (id, user_id, project_id, role) "
            "VALUES (gen_random_uuid(), NULL, :p, 'viewer')",
            {"p": seeded.project_ids[0]},
        )

        report = await check_module.run_report(
            out_dir=tmp_path, organization_ids=[seeded.organization_id]
        )

        assert report["P9"]["organizations"][str(seeded.organization_id)] == [None]
    finally:
        await delete_seeded_organization(seeded)


async def test_apply_keeps_the_oldest_duplicate(check_module, monkeypatch):
    monkeypatch.setattr(check_module, "is_ee", lambda: False)
    seeded = await seed_organization(members={"owner": "owner"}, project_rows=False)
    project_id, user_id = seeded.project_ids[0], seeded.owner_id
    try:
        async with get_transactions_engine().transaction() as connection:
            await _shadow_project_members(connection)
            older, newer = uuid4(), uuid4()
            for row_id, offset, role in ((older, 0, "viewer"), (newer, 1, "admin")):
                await connection.execute(
                    text(
                        "INSERT INTO project_members "
                        "(id, user_id, project_id, role, created_at) VALUES "
                        "(:id, :u, :p, :role, now() + make_interval(secs => :offset))"
                    ),
                    {
                        "id": row_id,
                        "u": user_id,
                        "p": project_id,
                        "role": role,
                        "offset": offset,
                    },
                )

            result = await check_module.run_apply(
                organization_ids=[seeded.organization_id], connection=connection
            )

            assert result["deleted_duplicates"] == [
                {
                    "id": str(newer),
                    "project_id": str(project_id),
                    "user_id": str(user_id),
                    "role": "admin",
                }
            ]
            remaining = (
                await connection.execute(text("SELECT id FROM project_members"))
            ).scalars()
            assert list(remaining) == [older]

            again = await check_module.run_apply(
                organization_ids=[seeded.organization_id], connection=connection
            )
            assert again["deleted_duplicates"] == []
    finally:
        await delete_seeded_organization(seeded)


@pytest.mark.parametrize("demo_is_older", [True, False])
async def test_apply_never_keeps_a_demo_row_over_a_real_row(
    check_module, monkeypatch, demo_is_older
):
    monkeypatch.setattr(check_module, "is_ee", lambda: False)
    seeded = await seed_organization(members={"owner": "owner"}, project_rows=False)
    project_id, user_id = seeded.project_ids[0], seeded.owner_id
    try:
        async with rolled_back_connection(organizations=[seeded]) as connection:
            demo_offset, real_offset = (0, 1) if demo_is_older else (1, 0)
            real_id = uuid4()
            await connection.execute(
                text(
                    "INSERT INTO project_members "
                    "(id, user_id, project_id, role, is_demo, created_at) VALUES "
                    "(gen_random_uuid(), :u, :p, 'viewer', true, "
                    " now() + make_interval(secs => :o)), "
                    "(:real, :u, :p, 'editor', NULL, now() + make_interval(secs => :r))"
                ),
                {
                    "u": user_id,
                    "p": project_id,
                    "o": demo_offset,
                    "r": real_offset,
                    "real": real_id,
                },
            )

            result = await check_module.run_apply(
                organization_ids=[seeded.organization_id], connection=connection
            )
            assert result["deleted_duplicates"] == []

            await _run_repair(connection)

            rows = (
                await connection.execute(
                    text(
                        "SELECT id, role FROM project_members "
                        "WHERE project_id = :p AND user_id = :u"
                    ),
                    {"p": project_id, "u": user_id},
                )
            ).all()
            assert [(row.id, row.role) for row in rows] == [(real_id, "editor")]
    finally:
        await delete_seeded_organization(seeded)


async def test_apply_twice_then_migration_never_restores_demo_access(
    check_module, monkeypatch
):
    monkeypatch.setattr(check_module, "is_ee", lambda: True)
    seeded = await seed_organization(
        members={"d": "viewer", "m": "editor"}, projects_per_workspace=2
    )
    demo, member = seeded.user_ids["d"], seeded.user_ids["m"]
    try:
        await execute(
            "UPDATE project_members SET is_demo = true WHERE user_id = :u AND project_id = :p",
            {"u": demo, "p": seeded.project_ids[0]},
        )
        await execute(
            "DELETE FROM project_members WHERE user_id = :d AND project_id = :p",
            {"d": demo, "p": seeded.project_ids[1]},
        )
        await execute(
            "DELETE FROM project_members WHERE user_id = :m AND project_id = :p",
            {"m": member, "p": seeded.project_ids[1]},
        )

        async with rolled_back_connection(organizations=[seeded]) as connection:
            await _shadow_alembic_version(connection, "oss000000043")

            first = await check_module.run_apply(
                organization_ids=[seeded.organization_id], connection=connection
            )
            second = await check_module.run_apply(
                organization_ids=[seeded.organization_id], connection=connection
            )
            assert (first["added_p2b"], second["added_p2b"]) == (1, 0)

            await _run_repair(connection)
            await connection.execute(
                text("UPDATE alembic_version_oss SET version_num = 'oss000000044'")
            )

            third = await check_module.run_apply(
                organization_ids=[seeded.organization_id], connection=connection
            )
            assert third["p2b_skipped"] is True

            assert await _project_rows(connection, seeded.project_ids, demo) == {}
            assert await _project_rows(connection, seeded.project_ids, member) == {
                p: ["editor"] for p in seeded.project_ids
            }
    finally:
        await delete_seeded_organization(seeded)


async def test_apply_adds_the_row_a_no_rbac_member_needs(check_module, monkeypatch):
    monkeypatch.setattr(check_module, "is_ee", lambda: True)
    seeded = await seed_organization(members={"m": "editor"})
    member = seeded.user_ids["m"]
    try:
        await execute("DELETE FROM project_members WHERE user_id = :m", {"m": member})

        async with get_transactions_engine().transaction() as connection:
            await _shadow_alembic_version(connection, "oss000000043")
            first = await check_module.run_apply(
                organization_ids=[seeded.organization_id], connection=connection
            )
            second = await check_module.run_apply(
                organization_ids=[seeded.organization_id], connection=connection
            )

        assert (first["added_p2b"], second["added_p2b"]) == (1, 0)
        assert await _project_rows(None, seeded.project_ids, member) == {
            seeded.project_ids[0]: ["editor"]
        }
    finally:
        await delete_seeded_organization(seeded)


async def test_apply_pages_p2b_by_members(check_module, monkeypatch):
    monkeypatch.setattr(check_module, "is_ee", lambda: True)
    monkeypatch.setattr(check_module, "MEMBER_PAGE_SIZE", 2)
    seeded = await seed_organization(
        members={"a": "editor", "b": "viewer", "c": "admin", "d": "editor"}
    )
    members = [seeded.user_ids[label] for label in ("a", "b", "c", "d")]
    try:
        await execute(
            "DELETE FROM project_members WHERE user_id = ANY(CAST(:m AS uuid[]))",
            {"m": members},
        )

        async with rolled_back_connection(organizations=[seeded]) as connection:
            await _shadow_alembic_version(connection, "oss000000043")
            with count_statements(get_transactions_engine()) as statements:
                result = await check_module.run_apply(
                    organization_ids=[seeded.organization_id], connection=connection
                )

            assert result["added_p2b"] == 4
            # 5 organization members (owner included), pages of 2: 3 inserts.
            inserts = [s for s in statements if "INSERT INTO project_members" in s]
            assert len(inserts) == 3
            for label, role in (("a", "editor"), ("b", "viewer"), ("c", "admin")):
                assert await _project_rows(
                    connection, seeded.project_ids, seeded.user_ids[label]
                ) == {seeded.project_ids[0]: [role]}
    finally:
        await delete_seeded_organization(seeded)


async def test_materialize_pages_a_large_organization(check_module, monkeypatch):
    monkeypatch.setattr(check_module, "is_ee", lambda: True)
    # 1,999 members plus the owner: 2,000 organization members, two pages.
    seeded = await seed_stress_organization(members=1999, projects=4)
    try:
        await execute(
            "DELETE FROM project_members WHERE project_id = :p",
            {"p": seeded.project_ids[0]},
        )

        with count_statements(get_transactions_engine()) as statements:
            result = await check_module.run_materialize(
                organization_ids=[seeded.organization_id]
            )

        inserts = [s for s in statements if s.lstrip().upper().startswith("INSERT")]
        assert len(inserts) == 2
        assert result == {"inserted": 2000, "updated": 0}
    finally:
        await delete_seeded_organization(seeded)


async def test_materialize_corrects_a_stale_row(check_module, monkeypatch):
    monkeypatch.setattr(check_module, "is_ee", lambda: True)
    seeded = await seed_organization(members={"m": "editor"}, projects_per_workspace=2)
    member = seeded.user_ids["m"]
    try:
        await execute(
            "UPDATE project_members SET role = 'viewer' WHERE user_id = :m AND project_id = :p",
            {"m": member, "p": seeded.project_ids[0]},
        )
        await execute(
            "DELETE FROM project_members WHERE user_id = :m AND project_id = :p",
            {"m": member, "p": seeded.project_ids[1]},
        )

        first = await check_module.run_materialize(
            organization_ids=[seeded.organization_id]
        )
        assert first == {"inserted": 1, "updated": 1}
        assert await _project_rows(None, seeded.project_ids, member) == {
            p: ["editor"] for p in seeded.project_ids
        }

        second = await check_module.run_materialize(
            organization_ids=[seeded.organization_id]
        )
        assert second == {"inserted": 0, "updated": 0}
    finally:
        await delete_seeded_organization(seeded)


async def test_materialize_refuses_without_the_unique_index(check_module, monkeypatch):
    monkeypatch.setattr(check_module, "UNIQUE_INDEX_NAME", "ux_not_there")
    with pytest.raises(SystemExit) as exit_:
        await check_module.run_materialize(organization_ids=[])
    assert exit_.value.code == 1
