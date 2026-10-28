"""Seed organizations, projects and membership rows for the membership tests.

Rows go straight into the core database through `get_transactions_engine()`, with
uuid-named emails under `@test.agenta.ai`, so tests never collide with each other or with
accounts made through the API. Each helper returns the ids it wrote, and
`delete_seeded_organization` removes them again (the organization cascades to its
projects and membership rows; the users go last). Projects belong to the organization
only: workspace removal step 3 dropped the workspace tables.
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
    project_ids: List[UUID]
    user_ids: Dict[str, UUID]  # key = member label
    # Other organizations a test needs; deleted with this one.
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
    """CREATE TEMP TABLE organization_members
       (LIKE public.organization_members INCLUDING DEFAULTS) ON COMMIT DROP""",
    """INSERT INTO pg_temp.organization_members
       SELECT * FROM public.organization_members
       WHERE organization_id = ANY(CAST(:orgs AS uuid[]))""",
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
    the shared database never keeps it. With `organizations`, the four membership tables
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
    projects: int = 1,
    project_rows: bool = True,
) -> SeededOrganization:
    """Write one organization with the given members (label -> role) and `projects`
    projects; the first project is the default.

    The label "owner" is the organization owner; it is added with role "owner" when
    missing. Every member gets an organization row and a project row in every project
    (unless `project_rows` is False), all with their role.
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

        project_ids: List[UUID] = []
        for p in range(projects):
            project_id = uuid4()
            project_ids.append(project_id)
            await connection.execute(
                text(
                    "INSERT INTO projects (id, project_name, is_default, "
                    "organization_id, created_at, updated_at) "
                    "VALUES (:id, :name, :is_default, :organization_id, "
                    "clock_timestamp(), clock_timestamp())"
                ),
                {
                    "id": project_id,
                    "name": f"project-{p}",
                    "is_default": p == 0,
                    "organization_id": organization_id,
                },
            )

            if project_rows:
                for label, role in members.items():
                    await connection.execute(
                        text(
                            "INSERT INTO project_members "
                            "(id, user_id, project_id, role, created_at, updated_at) "
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
        project_ids=project_ids,
        user_ids=user_ids,
    )


async def seed_stress_organization(
    *,
    members: int = 2000,
    projects: int = 4,
) -> SeededOrganization:
    """One organization with `members` viewers plus the owner, in bulk statements.

    Every member has an organization row and a project row in every project. The member users are not in `user_ids` (only "owner" is); read them from
    the database when a test needs them.
    """

    seeded = await seed_organization(members={"owner": "owner"}, projects=projects)
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
