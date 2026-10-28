"""The project-members unique index revision and the preflight script, against
Postgres.

The repair revision `oss000000044` read workspace rows; its tests went with the workspace
tables (workspace removal step 3). The tests in this file seed their own organizations
and assert only on them; they share one xdist group with the other global statements.
"""

from uuid import uuid4

import pytest
from sqlalchemy import text

from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.tests.pytest.utils.membership_seed import (
    delete_seeded_organization,
    execute,
    fetch_all,
    load_revision_module,
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


async def _rows(connection, sql: str, params: dict) -> list:
    if connection is None:
        return await fetch_all(sql, params)
    return list((await connection.execute(text(sql), params)).mappings().all())


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
def check_module():
    import entrypoints.memberships_check as module

    return module


async def test_oss_report_lists_p7_and_p8(check_module, monkeypatch, tmp_path):
    monkeypatch.setattr(check_module, "is_ee", lambda: False)
    # P7: the project row role differs from the organization role.
    p7 = await seed_organization(members={"m": "editor"})
    # P8: an organization member without a row in the second project.
    p8 = await seed_organization(members={"m": "editor"}, projects=2)
    try:
        await execute(
            "UPDATE project_members SET role = 'viewer' "
            "WHERE project_id = :p AND user_id = :u",
            {"p": p7.project_ids[0], "u": p7.user_ids["m"]},
        )
        await execute(
            "DELETE FROM project_members WHERE project_id = :p AND user_id = :u",
            {"p": p8.project_ids[1], "u": p8.user_ids["m"]},
        )
        organizations = sorted([p7.organization_id, p8.organization_id])

        report = await check_module.run_report(
            out_dir=tmp_path, organization_ids=organizations
        )

        assert report["P7"]["organizations"][str(p7.organization_id)] == [
            f"{p7.user_ids['m']}/{p7.project_ids[0]}"
        ]
        assert report["P8"]["organizations"][str(p8.organization_id)] == [
            f"{p8.user_ids['m']}/{p8.project_ids[1]}"
        ]
        for removed in ("P2b", "P3", "P4", "P6"):
            assert removed not in report
    finally:
        await delete_seeded_organization(p7)
        await delete_seeded_organization(p8)


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
    seeded = await seed_organization(members={"m": "editor"}, projects=2)
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
