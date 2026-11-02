"""Seed organizations, workspaces, projects and membership rows for the membership tests.

Rows go straight into the core database through `get_transactions_engine()`, with
uuid-named emails under `@test.agenta.ai`, so tests never collide with each other or with
accounts made through the API. Each helper returns the ids it wrote, and
`delete_seeded_organization` removes them again (the organization cascades to its
workspaces, projects and membership rows; the users go last).

`seed_legacy_shapes` writes one organization per broken shape that the preflight script
reports (P1 to P12, technical design section 3.1) plus the shapes seen in production
counts. Duplicate project rows (P5) cannot exist once the unique index is in place, so the
P5 shape is seeded only on the index-free shadow table of the migration tests.
"""

from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence
from uuid import UUID, uuid4

from sqlalchemy import text

from oss.src.dbs.postgres.shared.engine import get_transactions_engine


@dataclass
class SeededOrganization:
    organization_id: UUID
    owner_id: UUID
    workspace_ids: List[UUID]
    project_ids: List[UUID]
    user_ids: Dict[str, UUID]  # key = member label
    # Other organizations a shape needs (for example the foreign workspace of
    # `cross_org_workspace`); deleted with this one.
    extra_organization_ids: List[UUID] = field(default_factory=list)
    extra_user_ids: List[UUID] = field(default_factory=list)


async def execute(sql: str, params: Optional[dict] = None) -> None:
    async with get_transactions_engine().transaction() as connection:
        await connection.execute(text(sql), params or {})


async def fetch_all(sql: str, params: Optional[dict] = None) -> list:
    async with get_transactions_engine().transaction() as connection:
        result = await connection.execute(text(sql), params or {})
        return list(result.mappings().all())


async def create_user(*, label: str = "user") -> UUID:
    user_id = uuid4()
    await execute(
        "INSERT INTO users (id, uid, username, email, created_at, updated_at) "
        "VALUES (:id, :uid, :username, :email, now(), now())",
        {
            "id": user_id,
            "uid": f"membership-seed-{user_id.hex}",
            "username": f"{label}-{user_id.hex[:8]}",
            "email": f"membership-{user_id.hex}@test.agenta.ai",
        },
    )
    return user_id


# Temp copies of the membership tables, restricted to the given organizations. `pg_temp`
# comes first in the search path, so unqualified table names in the statements under
# test read and write the copies. `LIKE ... INCLUDING DEFAULTS` copies no index.
_SHADOW_TABLES_SQL = (
    """CREATE TEMP TABLE organizations
       (LIKE public.organizations INCLUDING DEFAULTS) ON COMMIT DROP""",
    """INSERT INTO pg_temp.organizations
       SELECT * FROM public.organizations WHERE id = ANY(CAST(:orgs AS uuid[]))""",
    """CREATE TEMP TABLE projects
       (LIKE public.projects INCLUDING DEFAULTS) ON COMMIT DROP""",
    """INSERT INTO pg_temp.projects
       SELECT * FROM public.projects WHERE organization_id = ANY(CAST(:orgs AS uuid[]))""",
    """CREATE TEMP TABLE workspaces
       (LIKE public.workspaces INCLUDING DEFAULTS) ON COMMIT DROP""",
    """INSERT INTO pg_temp.workspaces
       SELECT * FROM public.workspaces
       WHERE organization_id = ANY(CAST(:orgs AS uuid[]))
          OR id IN (SELECT workspace_id FROM pg_temp.projects)""",
    """CREATE TEMP TABLE organization_members
       (LIKE public.organization_members INCLUDING DEFAULTS) ON COMMIT DROP""",
    """INSERT INTO pg_temp.organization_members
       SELECT * FROM public.organization_members
       WHERE organization_id = ANY(CAST(:orgs AS uuid[]))""",
    """CREATE TEMP TABLE workspace_members
       (LIKE public.workspace_members INCLUDING DEFAULTS) ON COMMIT DROP""",
    """INSERT INTO pg_temp.workspace_members
       SELECT * FROM public.workspace_members
       WHERE workspace_id IN (SELECT id FROM pg_temp.workspaces)""",
    """CREATE TEMP TABLE project_members
       (LIKE public.project_members INCLUDING DEFAULTS) ON COMMIT DROP""",
    """INSERT INTO pg_temp.project_members
       SELECT * FROM public.project_members
       WHERE project_id IN (SELECT id FROM pg_temp.projects)""",
)


@asynccontextmanager
async def rolled_back_connection(
    *,
    isolation_level: Optional[str] = None,
    organizations: Optional[Sequence["SeededOrganization"]] = None,
):
    """A connection whose transaction is always rolled back.

    For the global repair statements: the test sees their effect on its own rows, and
    the shared database never keeps it. With `organizations`, the six membership tables
    are first copied into temp tables that hold only those organizations (and their
    extra organizations). The global statements then lock no row of the shared
    database, so they cannot deadlock with tests that run in parallel, and they never
    see an organization that another test deletes in the meantime.
    """

    engine = get_transactions_engine()._engine  # the SQLAlchemy AsyncEngine
    async with engine.connect() as connection:
        if isolation_level:
            connection = await connection.execution_options(
                isolation_level=isolation_level
            )
        transaction = await connection.begin()
        try:
            if organizations is not None:
                organization_ids = sorted(
                    {
                        organization_id
                        for seeded in organizations
                        for organization_id in (
                            seeded.organization_id,
                            *seeded.extra_organization_ids,
                        )
                    }
                )
                for statement in _SHADOW_TABLES_SQL:
                    await connection.execute(
                        text(statement), {"orgs": organization_ids}
                    )
            yield connection
        finally:
            await transaction.rollback()


class ConnectionEngine:
    """An engine double whose sessions run on one connection, inside its open
    transaction. Lets the real DAO readers see a `rolled_back_connection()`'s rows."""

    def __init__(self, connection):
        self._connection = connection

    @asynccontextmanager
    async def session(self):
        from sqlalchemy.ext.asyncio import AsyncSession

        session = AsyncSession(bind=self._connection, expire_on_commit=False)
        try:
            yield session
        finally:
            await session.close()


async def user_email(user_id: UUID) -> str:
    rows = await fetch_all("SELECT email FROM users WHERE id = :id", {"id": user_id})
    return rows[0]["email"]


async def seed_organization(
    *,
    members: Dict[str, str],
    workspaces: int = 1,
    projects_per_workspace: int = 1,
    project_rows: bool = True,
    workspace_rows: bool = True,
) -> SeededOrganization:
    """Write one organization with the given members (label -> role).

    The label "owner" is the organization owner; it is added with role "owner" when
    missing. Every member gets an organization row, a workspace row in every workspace
    (unless `workspace_rows` is False) and a project row in every project (unless
    `project_rows` is False), all with their role.

    `workspaces=0` writes the shape workspace removal step 2 writes: no workspace and
    no workspace member rows, and `projects_per_workspace` projects with a NULL
    `workspace_id`. Any other value writes the legacy shape (existing data).
    """

    members = dict(members)
    members.setdefault("owner", "owner")

    user_ids: Dict[str, UUID] = {}
    for label in members:
        user_ids[label] = await create_user(label=label)

    owner_id = user_ids["owner"]
    organization_id = uuid4()

    async with get_transactions_engine().transaction() as connection:
        await connection.execute(
            text(
                "INSERT INTO organizations (id, name, owner_id, created_at, updated_at) "
                "VALUES (:id, :name, :owner_id, now(), now())"
            ),
            {
                "id": organization_id,
                "name": f"membership-seed-{organization_id.hex[:8]}",
                "owner_id": owner_id,
            },
        )

        for label, role in members.items():
            await connection.execute(
                text(
                    "INSERT INTO organization_members "
                    "(id, user_id, organization_id, role, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :user_id, :organization_id, :role, "
                    "now(), now())"
                ),
                {
                    "user_id": user_ids[label],
                    "organization_id": organization_id,
                    "role": role,
                },
            )

        workspace_ids: List[UUID] = []
        project_ids: List[UUID] = []

        for w in range(max(workspaces, 1)):
            workspace_id = uuid4() if workspaces else None
            if workspace_id is not None:
                workspace_ids.append(workspace_id)
                await connection.execute(
                    text(
                        "INSERT INTO workspaces "
                        "(id, name, type, organization_id, created_at, updated_at) "
                        "VALUES (:id, :name, 'default', :organization_id, now(), now())"
                    ),
                    {
                        "id": workspace_id,
                        "name": f"workspace-{w}",
                        "organization_id": organization_id,
                    },
                )

            if workspace_id is not None and workspace_rows:
                for label, role in members.items():
                    await connection.execute(
                        text(
                            "INSERT INTO workspace_members "
                            "(id, user_id, workspace_id, role, created_at, updated_at) "
                            "VALUES (gen_random_uuid(), :user_id, :workspace_id, :role, "
                            "now(), now())"
                        ),
                        {
                            "user_id": user_ids[label],
                            "workspace_id": workspace_id,
                            "role": role,
                        },
                    )

            for p in range(projects_per_workspace):
                project_id = uuid4()
                project_ids.append(project_id)
                await connection.execute(
                    text(
                        "INSERT INTO projects (id, project_name, is_default, "
                        "organization_id, workspace_id, created_at, updated_at) "
                        "VALUES (:id, :name, :is_default, :organization_id, "
                        ":workspace_id, clock_timestamp(), clock_timestamp())"
                    ),
                    {
                        "id": project_id,
                        "name": f"project-{w}-{p}",
                        "is_default": p == 0,
                        "organization_id": organization_id,
                        "workspace_id": workspace_id,
                    },
                )

                if project_rows:
                    for label, role in members.items():
                        await connection.execute(
                            text(
                                "INSERT INTO project_members "
                                "(id, user_id, project_id, role, created_at, "
                                "updated_at) "
                                "VALUES (gen_random_uuid(), :user_id, :project_id, "
                                ":role, now(), now())"
                            ),
                            {
                                "user_id": user_ids[label],
                                "project_id": project_id,
                                "role": role,
                            },
                        )

    return SeededOrganization(
        organization_id=organization_id,
        owner_id=owner_id,
        workspace_ids=workspace_ids,
        project_ids=project_ids,
        user_ids=user_ids,
    )


async def seed_stress_organization(
    *,
    members: int = 2000,
    projects: int = 4,
) -> SeededOrganization:
    """One organization with `members` viewers plus the owner, in bulk statements.

    Every member has an organization row, a workspace row and a project row in every
    project. The member users are not in `user_ids` (only "owner" is); read them from
    the database when a test needs them.
    """

    seeded = await seed_organization(
        members={"owner": "owner"},
        workspaces=1,
        projects_per_workspace=projects,
    )
    tag = seeded.organization_id.hex

    async with get_transactions_engine().transaction() as connection:
        await connection.execute(
            text(
                "INSERT INTO users (id, uid, username, email, created_at, updated_at) "
                "SELECT gen_random_uuid(), 'membership-stress-' || :tag || '-' || g, "
                "'stress-' || g, 'membership-stress-' || :tag || '-' || g "
                "|| '@test.agenta.ai', now(), now() "
                "FROM generate_series(1, :members) g"
            ),
            {"tag": tag, "members": members},
        )
        member_filter = (
            "SELECT id FROM users WHERE uid LIKE 'membership-stress-' || :tag || '-%'"
        )
        await connection.execute(
            text(
                "INSERT INTO organization_members "
                "(id, user_id, organization_id, role, created_at, updated_at) "
                f"SELECT gen_random_uuid(), u.id, :org, 'viewer', now(), now() FROM ({member_filter}) u"
            ),
            {"tag": tag, "org": seeded.organization_id},
        )
        await connection.execute(
            text(
                "INSERT INTO workspace_members "
                "(id, user_id, workspace_id, role, created_at, updated_at) "
                f"SELECT gen_random_uuid(), u.id, :ws, 'viewer', now(), now() FROM ({member_filter}) u"
            ),
            {"tag": tag, "ws": seeded.workspace_ids[0]},
        )
        await connection.execute(
            text(
                "INSERT INTO project_members "
                "(id, user_id, project_id, role, created_at, updated_at) "
                "SELECT gen_random_uuid(), u.id, p, 'viewer', now(), now() "
                f"FROM ({member_filter}) u CROSS JOIN unnest(CAST(:projects AS uuid[])) p"
            ),
            {"tag": tag, "projects": seeded.project_ids},
        )
        rows = await connection.execute(text(member_filter), {"tag": tag})
        seeded.extra_user_ids = [row[0] for row in rows]

    return seeded


async def _delete_owner_rows(
    seeded: SeededOrganization,
    *,
    label: str,
    organization_row: bool = False,
    project_ids: Optional[List[UUID]] = None,
    workspace_row: bool = False,
) -> None:
    user_id = seeded.user_ids[label]
    if organization_row:
        await execute(
            "DELETE FROM organization_members "
            "WHERE organization_id = :org AND user_id = :user",
            {"org": seeded.organization_id, "user": user_id},
        )
    if project_ids:
        await execute(
            "DELETE FROM project_members "
            "WHERE project_id = ANY(CAST(:projects AS uuid[])) AND user_id = :user",
            {"projects": project_ids, "user": user_id},
        )
    if workspace_row:
        await execute(
            "DELETE FROM workspace_members "
            "WHERE workspace_id = ANY(CAST(:workspaces AS uuid[])) AND user_id = :user",
            {"workspaces": seeded.workspace_ids, "user": user_id},
        )


async def seed_legacy_shapes() -> Dict[str, SeededOrganization]:
    """One organization per broken shape. Keys are the check ids and shape names.

    The member label that carries the shape is "m" unless noted.
    """

    shapes: Dict[str, SeededOrganization] = {}

    # P1: the owner has no organization row (keeps the project row).
    p1 = await seed_organization(members={"owner": "owner"})
    await _delete_owner_rows(p1, label="owner", organization_row=True)
    shapes["P1"] = p1

    # P2a: the owner has no row in the second project.
    p2a = await seed_organization(members={"owner": "owner"}, projects_per_workspace=2)
    await _delete_owner_rows(p2a, label="owner", project_ids=[p2a.project_ids[1]])
    shapes["P2a"] = p2a

    # P2b (EE): a workspace member with an organization row and no project row.
    p2b = await seed_organization(members={"m": "editor"})
    await _delete_owner_rows(p2b, label="m", project_ids=p2b.project_ids)
    shapes["P2b"] = p2b

    # P3 (EE): organization and project rows, no workspace row.
    p3 = await seed_organization(members={"m": "editor"})
    await _delete_owner_rows(p3, label="m", workspace_row=True)
    shapes["P3"] = p3

    # P4 (EE): an organization with two workspaces.
    shapes["P4"] = await seed_organization(members={"m": "editor"}, workspaces=2)

    # P6: the organization role differs from the workspace role (one workspace).
    p6 = await seed_organization(members={"m": "editor"})
    await execute(
        "UPDATE organization_members SET role = 'viewer' "
        "WHERE organization_id = :org AND user_id = :user",
        {"org": p6.organization_id, "user": p6.user_ids["m"]},
    )
    shapes["P6"] = p6
    shapes["role_differs"] = p6

    # P7 (OSS): the project row role differs from the organization role.
    p7 = await seed_organization(members={"m": "editor"})
    await execute(
        "UPDATE project_members SET role = 'viewer' WHERE project_id = :p AND user_id = :u",
        {"p": p7.project_ids[0], "u": p7.user_ids["m"]},
    )
    shapes["P7"] = p7

    # P8 (OSS): an organization member without a row in the second project.
    p8 = await seed_organization(members={"m": "editor"}, projects_per_workspace=2)
    await _delete_owner_rows(p8, label="m", project_ids=[p8.project_ids[1]])
    shapes["P8"] = p8

    # P9: a project row without an organization row.
    p9 = await seed_organization(members={"m": "editor"})
    await _delete_owner_rows(p9, label="m", organization_row=True)
    shapes["P9"] = p9
    shapes["non_member_project_row"] = p9

    # P10: soft-deleted rows in the three membership tables.
    p10 = await seed_organization(members={"m": "editor"})
    for table, scope_column, scope_ids in (
        ("organization_members", "organization_id", [p10.organization_id]),
        ("workspace_members", "workspace_id", p10.workspace_ids),
        ("project_members", "project_id", p10.project_ids),
    ):
        await execute(
            f"UPDATE {table} SET deleted_at = now() "
            f"WHERE {scope_column} = ANY(CAST(:ids AS uuid[])) AND user_id = :u",
            {"ids": scope_ids, "u": p10.user_ids["m"]},
        )
    shapes["P10"] = p10

    # P11: a former demo-only user: organization and workspace rows, and only a demo
    # project row.
    p11 = await seed_organization(members={"m": "viewer"})
    await execute(
        "UPDATE project_members SET is_demo = true WHERE project_id = :p AND user_id = :u",
        {"p": p11.project_ids[0], "u": p11.user_ids["m"]},
    )
    shapes["P11"] = p11

    # P12: two organization rows for one user.
    p12 = await seed_organization(members={"m": "editor"})
    await execute(
        "INSERT INTO organization_members "
        "(id, user_id, organization_id, role, created_at, updated_at) "
        "VALUES (gen_random_uuid(), :u, :org, 'admin', now() + interval '1 second', now())",
        {"u": p12.user_ids["m"], "org": p12.organization_id},
    )
    shapes["P12"] = p12

    # The owner has neither an organization row nor a project row.
    owner_without_rows = await seed_organization(
        members={"owner": "owner"}, projects_per_workspace=2
    )
    await _delete_owner_rows(
        owner_without_rows,
        label="owner",
        organization_row=True,
        project_ids=owner_without_rows.project_ids,
    )
    shapes["owner_without_rows"] = owner_without_rows

    # The owner's organization row has role admin.
    owner_row_not_owner = await seed_organization(members={"owner": "owner"})
    await execute(
        "UPDATE organization_members SET role = 'admin' "
        "WHERE organization_id = :org AND user_id = :u",
        {
            "org": owner_row_not_owner.organization_id,
            "u": owner_row_not_owner.owner_id,
        },
    )
    shapes["owner_row_not_owner"] = owner_row_not_owner

    # Two organization rows with role owner.
    shapes["two_owner_rows"] = await seed_organization(
        members={"owner": "owner", "m": "owner"}
    )

    # Five workspaces.
    shapes["five_workspaces"] = await seed_organization(
        members={"m": "editor"}, workspaces=5
    )

    # A project whose workspace belongs to another organization.
    cross = await seed_organization(members={"m": "editor"})
    other = await seed_organization(members={"owner": "owner"})
    await execute(
        "UPDATE projects SET workspace_id = :ws WHERE id = :p",
        {"ws": other.workspace_ids[0], "p": cross.project_ids[0]},
    )
    cross.extra_organization_ids.append(other.organization_id)
    cross.extra_user_ids.extend(other.user_ids.values())
    shapes["cross_org_workspace"] = cross

    # An EE project row with a null role, for a member and for the owner.
    null_role = await seed_organization(members={"m": "editor"})
    await execute(
        "UPDATE project_members SET role = NULL "
        "WHERE project_id = :p AND user_id = ANY(CAST(:users AS uuid[]))",
        {
            "p": null_role.project_ids[0],
            "users": [null_role.user_ids["m"], null_role.owner_id],
        },
    )
    shapes["null_project_role"] = null_role

    return shapes


async def delete_seeded_organization(seeded: SeededOrganization) -> None:
    organization_ids = [seeded.organization_id, *seeded.extra_organization_ids]
    user_ids = [*seeded.user_ids.values(), *seeded.extra_user_ids]

    async with get_transactions_engine().transaction() as connection:
        await connection.execute(
            text(
                "DELETE FROM project_invitations WHERE project_id IN "
                "(SELECT id FROM projects "
                "WHERE organization_id = ANY(CAST(:orgs AS uuid[])))"
            ),
            {"orgs": organization_ids},
        )
        # Rows that point at the organizations from outside (another test's
        # organization) are removed with the users below.
        await connection.execute(
            text("DELETE FROM organizations WHERE id = ANY(CAST(:orgs AS uuid[]))"),
            {"orgs": organization_ids},
        )
        # A user can own another organization made by a writer under test (for
        # example transfer). Remove those too, then the users.
        await connection.execute(
            text(
                "DELETE FROM organizations WHERE owner_id = ANY(CAST(:users AS uuid[]))"
            ),
            {"users": user_ids},
        )
        await connection.execute(
            text("DELETE FROM users WHERE id = ANY(CAST(:users AS uuid[]))"),
            {"users": user_ids},
        )


async def delete_seeded_shapes(shapes: Dict[str, SeededOrganization]) -> None:
    seen = set()
    for seeded in shapes.values():
        if seeded.organization_id in seen:
            continue
        seen.add(seeded.organization_id)
        await delete_seeded_organization(seeded)


def load_revision_sql(revision_file: str, name: str) -> str:
    """Read a module-level SQL constant from a revision file in `core_oss/versions/`.

    Loads the file by path, so the test does not import the migration package.
    """

    return getattr(load_revision_module(revision_file), name)


def load_revision_module(revision_file: str):
    import importlib.util
    from pathlib import Path

    path = (
        Path(__file__).resolve().parents[3]
        / "databases"
        / "postgres"
        / "migrations"
        / "core_oss"
        / "versions"
        / revision_file
    )
    if not path.exists():
        raise FileNotFoundError(f"revision file not found: {path}")
    spec = importlib.util.spec_from_file_location(f"_revision_{path.stem}", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module
