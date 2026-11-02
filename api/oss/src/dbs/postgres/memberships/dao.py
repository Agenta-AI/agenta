"""Postgres implementation of `MembershipsDAOInterface`.

Readers are one statement each (`fetch_membership_row`, `list_membership_rows` are the
hot paths). Writers run in `engine.transaction()`, on their own connection, and first
take the organization advisory lock, so two writers for one organization never
interleave. "Oldest" orders by `created_at ASC NULLS LAST, id ASC` everywhere.

`project_members.id` has no database default: every literal `INSERT ... SELECT` selects
`gen_random_uuid()` per row, and every single-row insert passes `uuid7()`.
"""

from typing import List, Optional, Sequence
from uuid import UUID

import uuid_utils.compat as uuid_compat
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from oss.src.core.memberships.dtos import (
    CreatedProject,
    MembershipPolicy,
    MembershipRow,
    MembershipWriteResult,
    OrganizationMember,
    ProjectMemberProfile,
    ProjectScope,
)
from oss.src.core.memberships.interfaces import MembershipsDAOInterface
from oss.src.core.memberships.types import (
    MemberNotFound,
    OrganizationNotFound,
    OrganizationOwnerProtected,
)
from oss.src.dbs.postgres.memberships.mappings import (
    map_membership_row_to_dto,
    map_organization_member_dbe_to_dto,
    map_project_member_profile_to_dto,
    map_project_scope_dbe_to_dto,
)
from oss.src.core.shared.dtos import Windowing
from oss.src.models.db_models import (  # noqa: F401  (the tables this DAO owns)
    InvitationDB,
    OrganizationDB,
    OrganizationMemberDB,
    ProjectDB,
    ProjectMemberDB,
    UserDB,
)


_OLDEST = "ORDER BY created_at ASC NULLS LAST, id ASC LIMIT 1"

# Workspace removal step 2: the workspace fields answer the organization (design D6).
_SUMMARY_COLUMNS = """
    p.id AS project_id,
    p.organization_id,
    p.organization_id AS workspace_id,
    p.is_default,
    p.project_name,
    o.name AS workspace_name,
    o.name AS organization_name,
    o.owner_id AS organization_owner_id
"""

# -- readers --------------------------------------------------------------------------

_FETCH_MEMBERSHIP_ROW_SQL = f"""
SELECT {_SUMMARY_COLUMNS},
       om.id IS NOT NULL AS has_organization_row,
       om.role AS organization_role,
       pm.id IS NOT NULL AS has_project_row,
       pm.role AS project_role
FROM projects p
JOIN organizations o ON o.id = p.organization_id
LEFT JOIN LATERAL (
    SELECT id, role FROM organization_members
    WHERE organization_id = p.organization_id AND user_id = :user_id
    {_OLDEST}
) om ON true
LEFT JOIN LATERAL (
    SELECT id, role FROM project_members
    WHERE project_id = p.id AND user_id = :user_id
    {_OLDEST}
) pm ON true
WHERE p.id = :project_id
"""

_LIST_MEMBERSHIP_ROWS_SQL = f"""
SELECT {_SUMMARY_COLUMNS},
       true AS has_organization_row,
       om.role AS organization_role,
       pm.id IS NOT NULL AS has_project_row,
       pm.role AS project_role
FROM (
    SELECT DISTINCT ON (organization_id) organization_id, role
    FROM organization_members
    WHERE user_id = :user_id
    ORDER BY organization_id, created_at ASC NULLS LAST, id ASC
) om
JOIN projects p ON p.organization_id = om.organization_id
JOIN organizations o ON o.id = p.organization_id
LEFT JOIN LATERAL (
    SELECT id, role FROM project_members
    WHERE project_id = p.id AND user_id = :user_id
    {_OLDEST}
) pm ON true
ORDER BY om.organization_id, p.created_at ASC NULLS LAST, p.id ASC
"""

_FETCH_ORGANIZATION_MEMBER_SQL = f"""
SELECT organization_id, user_id, role FROM organization_members
WHERE organization_id = :organization_id AND user_id = :user_id
{_OLDEST}
"""

_LIST_PROJECTS_SQL = """
SELECT p.id AS project_id, p.organization_id,
       p.organization_id AS workspace_id, p.is_default,
       o.owner_id AS organization_owner_id
FROM projects p
JOIN organizations o ON o.id = p.organization_id
WHERE p.organization_id = ANY(CAST(:organization_ids AS uuid[]))
ORDER BY p.organization_id, p.created_at ASC NULLS LAST, p.id ASC
"""

# The members of one project, one row per user with the role of their oldest row. OSS
# reads the organization rows of the project's organization; EE reads the project rows
# and keeps only users that have an organization row too (as `resolve` does). Neither
# reads workspace rows.
_PROJECT_MEMBERS_BY_POLICY = {
    MembershipPolicy.ORGANIZATION_WIDE: """
    SELECT DISTINCT ON (om.user_id) om.user_id, om.role
    FROM organization_members om
    JOIN projects p ON p.organization_id = om.organization_id
    WHERE p.id = :project_id AND om.user_id IS NOT NULL
    ORDER BY om.user_id, om.created_at ASC NULLS LAST, om.id ASC
""",
    MembershipPolicy.PROJECT_ROWS: """
    SELECT DISTINCT ON (pm.user_id) pm.user_id, pm.role
    FROM project_members pm
    JOIN projects p ON p.id = pm.project_id
    WHERE p.id = :project_id
      AND EXISTS (
          SELECT 1 FROM organization_members om
          WHERE om.organization_id = p.organization_id AND om.user_id = pm.user_id
      )
    ORDER BY pm.user_id, pm.created_at ASC NULLS LAST, pm.id ASC
""",
}

_DEFAULT_MEMBERS_LIMIT = 50
# The largest page a members query returns: a bigger `limit` is clamped, so one request
# never sorts and returns a whole organization's members.
_MAX_MEMBERS_LIMIT = 500  # the /m roster page (MEMBER_ROSTER_PAGE_SIZE)


def _query_project_members_sql(
    *, policy: MembershipPolicy, search: bool, cursor: bool
) -> str:
    """Ordered by (email, user_id). The cursor is the last user of the previous page:
    the page starts after that user's (email, id)."""

    filters = []
    if search:
        filters.append(
            "(lower(COALESCE(u.email, '')) LIKE :pattern ESCAPE '\\' "
            "OR lower(COALESCE(u.username, '')) LIKE :pattern ESCAPE '\\')"
        )
    if cursor:
        filters.append(
            "(COALESCE(u.email, ''), u.id) > ("
            "SELECT COALESCE(c.email, ''), c.id FROM users c WHERE c.id = :cursor)"
        )
    where = f"WHERE {' AND '.join(filters)}" if filters else ""
    return f"""
WITH members AS ({_PROJECT_MEMBERS_BY_POLICY[policy]})
SELECT u.id AS user_id, COALESCE(u.email, '') AS email, u.username AS name, m.role
FROM members m
JOIN users u ON u.id = m.user_id
{where}
ORDER BY COALESCE(u.email, '') ASC, u.id ASC
LIMIT :limit
"""


def _prefix_pattern(search: str) -> str:
    escaped = (
        search.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    )
    return f"{escaped}%"


# -- writers --------------------------------------------------------------------------

_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtextextended('memberships:' || :organization_id, 0))"

# The memberships lock and the default-project lock of the organization, in one statement
# (the same order everywhere: no writer takes the project-default lock first and then the
# memberships lock).
_LOCK_WITH_PROJECT_DEFAULT_SQL = """
SELECT pg_advisory_xact_lock(hashtextextended('memberships:' || :organization_id, 0)),
       pg_advisory_xact_lock(
           hashtextextended('agenta:project_default:' || :organization_id, 0)
       )
"""

# The same lock for writers outside this DAO (the admin ownership transfer).
ORGANIZATION_LOCK_SQL = _LOCK_SQL

_FETCH_OWNER_SQL = "SELECT owner_id FROM organizations WHERE id = :organization_id"

_FETCH_OLDEST_ORGANIZATION_ROW_SQL = f"""
SELECT id, role FROM organization_members
WHERE organization_id = :organization_id AND user_id = :user_id
{_OLDEST}
"""

_UPDATE_ORGANIZATION_ROW_SQL = """
UPDATE organization_members SET role = :role, updated_at = now() WHERE id = :id
"""

_INSERT_ORGANIZATION_ROW_SQL = """
INSERT INTO organization_members (id, user_id, organization_id, role, created_at, updated_at)
VALUES (:id, :user_id, :organization_id, :role, now(), now())
"""

_UPDATE_PROJECT_ROWS_SQL = """
UPDATE project_members SET role = :role, updated_at = now()
WHERE user_id = :user_id
  AND project_id IN (SELECT id FROM projects WHERE organization_id = :organization_id)
"""

_INSERT_PROJECT_ROWS_SQL = """
INSERT INTO project_members (id, user_id, project_id, role, created_at, updated_at)
SELECT gen_random_uuid(), :user_id, p.id, :role, now(), now()
FROM projects p
WHERE p.organization_id = :organization_id
  AND (:all_projects OR p.id = ANY(CAST(:project_ids AS uuid[])))
ON CONFLICT (project_id, user_id) DO NOTHING
"""

_FETCH_USER_BY_EMAIL_SQL = "SELECT id FROM users WHERE email = :email"

_DELETE_PROJECT_ROWS_SQL = """
DELETE FROM project_members
WHERE user_id = :user_id
  AND project_id IN (SELECT id FROM projects WHERE organization_id = :organization_id)
"""

_DELETE_ORGANIZATION_ROWS_SQL = """
DELETE FROM organization_members
WHERE user_id = :user_id AND organization_id = :organization_id
"""

_DELETE_INVITATIONS_SQL = """
DELETE FROM project_invitations
WHERE email = :email
  AND project_id IN (SELECT id FROM projects WHERE organization_id = :organization_id)
"""

# One statement after the locks: with `make_default`, every other default of the
# organization is cleared; the new project is the default when asked, or when the
# organization has none (the main query sees the snapshot before the clear).
_INSERT_PROJECT_SQL = """
WITH cleared AS (
    UPDATE projects SET is_default = false, updated_at = now()
    WHERE organization_id = :organization_id AND is_default IS TRUE
      AND CAST(:make_default AS boolean)
)
INSERT INTO projects (id, project_name, is_default, organization_id,
                      created_at, updated_at)
SELECT :id, :name,
       CAST(:make_default AS boolean) OR NOT EXISTS (
           SELECT 1 FROM projects
           WHERE organization_id = :organization_id AND is_default IS TRUE
       ),
       :organization_id, now(), now()
RETURNING is_default
"""

# One statement, whatever the member count: one row per organization member, with the
# role of the member's oldest organization row.
_SEED_PROJECT_MEMBERS_SQL = """
INSERT INTO project_members (id, user_id, project_id, role, created_at, updated_at)
SELECT gen_random_uuid(), m.user_id, :project_id, m.role, now(), now()
FROM (
    SELECT DISTINCT ON (user_id) user_id, role
    FROM organization_members
    WHERE organization_id = :organization_id AND user_id IS NOT NULL
    ORDER BY user_id, created_at ASC NULLS LAST, id ASC
) m
ON CONFLICT (project_id, user_id) DO NOTHING
"""

# One statement: the FROM side reads the rows before the update, so the two roles
# swap. Only projects where both users have a row, as the admin transfer tool does
# (`db_manager.admin_swap_project_memberships`).
_SWAP_PROJECT_ROLES_OF_TWO_SQL = """
UPDATE project_members pm
SET role = other.role, updated_at = now()
FROM project_members other
JOIN projects p ON p.id = other.project_id
WHERE p.organization_id = :organization_id
  AND other.project_id = pm.project_id
  AND pm.user_id = ANY(CAST(:user_ids AS uuid[]))
  AND other.user_id = ANY(CAST(:user_ids AS uuid[]))
  AND other.user_id <> pm.user_id
"""

_SEED_OWNER_PROJECT_ROWS_SQL = """
INSERT INTO project_members (id, user_id, project_id, role, created_at, updated_at)
SELECT gen_random_uuid(), :user_id, p.id, 'owner', now(), now()
FROM projects p
WHERE p.organization_id = :organization_id
ON CONFLICT (project_id, user_id) DO NOTHING
"""

# The new owner holds `owner` on every row of the organization, whatever role the
# swap moved over: a former owner's row can hold another role (rows written by the
# admin accounts path held the column default `viewer`).
_PROMOTE_NEW_OWNER_ORGANIZATION_ROWS_SQL = """
UPDATE organization_members
SET role = 'owner', updated_at = now()
WHERE organization_id = :organization_id
  AND user_id = :user_id
  AND role IS DISTINCT FROM 'owner'
"""

_PROMOTE_NEW_OWNER_PROJECT_ROWS_SQL = """
UPDATE project_members pm
SET role = 'owner', updated_at = now()
FROM projects p
WHERE p.id = pm.project_id
  AND p.organization_id = :organization_id
  AND pm.user_id = :user_id
  AND pm.role IS DISTINCT FROM 'owner'
"""

# Run after the role swaps of an ownership transfer, by the app transfer and by the
# admin transfer tool, with :organization_id and :user_id (the new owner).
PROMOTE_NEW_OWNER_SQL = (
    _PROMOTE_NEW_OWNER_ORGANIZATION_ROWS_SQL,
    _PROMOTE_NEW_OWNER_PROJECT_ROWS_SQL,
)

_SET_OWNER_SQL = """
UPDATE organizations
SET owner_id = :new_owner_id, updated_at = now(), updated_by_id = :current_owner_id
WHERE id = :organization_id
"""


class MembershipsDAO(MembershipsDAOInterface):
    def __init__(self, *, engine):
        self.engine = engine

    # -- readers -----------------------------------------------------------------------

    async def fetch_membership_row(
        self,
        *,
        user_id: UUID,
        project_id: UUID,
    ) -> Optional[MembershipRow]:
        async with self.engine.session() as session:
            row = (
                await session.execute(
                    text(_FETCH_MEMBERSHIP_ROW_SQL),
                    {"user_id": user_id, "project_id": project_id},
                )
            ).first()
        return map_membership_row_to_dto(row) if row is not None else None

    async def list_membership_rows(
        self,
        *,
        user_id: UUID,
    ) -> List[MembershipRow]:
        async with self.engine.session() as session:
            rows = (
                await session.execute(
                    text(_LIST_MEMBERSHIP_ROWS_SQL),
                    {"user_id": user_id},
                )
            ).all()
        return [map_membership_row_to_dto(row) for row in rows]

    async def fetch_organization_member(
        self,
        *,
        organization_id: UUID,
        user_id: UUID,
    ) -> Optional[OrganizationMember]:
        async with self.engine.session() as session:
            row = (
                await session.execute(
                    text(_FETCH_ORGANIZATION_MEMBER_SQL),
                    {"organization_id": organization_id, "user_id": user_id},
                )
            ).first()
        return map_organization_member_dbe_to_dto(row) if row is not None else None

    async def list_projects(
        self,
        *,
        organization_ids: Sequence[UUID],
    ) -> List[ProjectScope]:
        if not organization_ids:
            return []
        async with self.engine.session() as session:
            rows = (
                await session.execute(
                    text(_LIST_PROJECTS_SQL),
                    {"organization_ids": list(organization_ids)},
                )
            ).all()
        return [map_project_scope_dbe_to_dto(row) for row in rows]

    async def query_project_member_profiles(
        self,
        *,
        project_id: UUID,
        policy: MembershipPolicy,
        #
        search: Optional[str] = None,
        windowing: Optional[Windowing] = None,
    ) -> List[ProjectMemberProfile]:
        search = (search or "").strip() or None
        cursor = windowing.next if windowing else None
        limit = min(
            (windowing.limit if windowing else None) or _DEFAULT_MEMBERS_LIMIT,
            _MAX_MEMBERS_LIMIT,
        )

        params = {"project_id": project_id, "limit": limit}
        if search is not None:
            params["pattern"] = _prefix_pattern(search)
        if cursor is not None:
            params["cursor"] = cursor

        async with self.engine.session() as session:
            rows = (
                await session.execute(
                    text(
                        _query_project_members_sql(
                            policy=policy,
                            search=search is not None,
                            cursor=cursor is not None,
                        )
                    ),
                    params,
                )
            ).all()
        return [map_project_member_profile_to_dto(row) for row in rows]

    # -- writers -----------------------------------------------------------------------

    @staticmethod
    async def _lock(connection: AsyncConnection, organization_id: UUID) -> None:
        await connection.execute(
            text(_LOCK_SQL), {"organization_id": str(organization_id)}
        )

    @staticmethod
    async def _owner_id(
        connection: AsyncConnection, organization_id: UUID
    ) -> Optional[UUID]:
        return (
            await connection.execute(
                text(_FETCH_OWNER_SQL), {"organization_id": organization_id}
            )
        ).scalar()

    async def set_member_role(
        self,
        *,
        organization_id: UUID,
        user_id: UUID,
        role: str,
        #
        join_project_ids: Sequence[UUID] = (),
        join_all_projects: bool = False,
        must_exist: bool = False,
        must_be_absent: bool = False,
    ) -> MembershipWriteResult:
        async with self.engine.transaction() as connection:
            await self._lock(connection, organization_id)

            owner_id = await self._owner_id(connection, organization_id)
            if owner_id is None:
                raise OrganizationNotFound(organization_id=organization_id)
            if owner_id == user_id:
                raise OrganizationOwnerProtected(
                    organization_id=organization_id, user_id=user_id
                )

            scope = {"organization_id": organization_id, "user_id": user_id}

            existing = (
                await connection.execute(
                    text(_FETCH_OLDEST_ORGANIZATION_ROW_SQL), scope
                )
            ).first()
            if existing is None and must_exist:
                raise MemberNotFound(organization_id=organization_id, user_id=user_id)
            if existing is not None and must_be_absent:
                # Auto-join: a membership written since the caller's check (an
                # accepted invitation, an admin write) keeps its role.
                return MembershipWriteResult(
                    user_id=None, previous_role=existing.role, inserted_count=0
                )

            if existing is not None:
                await connection.execute(
                    text(_UPDATE_ORGANIZATION_ROW_SQL),
                    {"id": existing.id, "role": role},
                )
            else:
                await connection.execute(
                    text(_INSERT_ORGANIZATION_ROW_SQL),
                    {**scope, "id": uuid_compat.uuid7(), "role": role},
                )

            await connection.execute(
                text(_UPDATE_PROJECT_ROWS_SQL), {**scope, "role": role}
            )

            targets = {
                **scope,
                "role": role,
                "all_projects": join_all_projects,
                "project_ids": list(join_project_ids),
            }
            inserted = 0
            if join_all_projects or join_project_ids:
                result = await connection.execute(
                    text(_INSERT_PROJECT_ROWS_SQL), targets
                )
                inserted = result.rowcount or 0

        return MembershipWriteResult(
            user_id=user_id,
            previous_role=existing.role if existing is not None else None,
            inserted_count=inserted,
        )

    async def remove_member(
        self,
        *,
        organization_id: UUID,
        email: str,
    ) -> MembershipWriteResult:
        async with self.engine.transaction() as connection:
            await self._lock(connection, organization_id)

            user_id = (
                await connection.execute(
                    text(_FETCH_USER_BY_EMAIL_SQL), {"email": email}
                )
            ).scalar()

            if user_id is not None:
                owner_id = await self._owner_id(connection, organization_id)
                if owner_id == user_id:
                    raise OrganizationOwnerProtected(
                        organization_id=organization_id, user_id=user_id
                    )

                scope = {"organization_id": organization_id, "user_id": user_id}
                await connection.execute(text(_DELETE_PROJECT_ROWS_SQL), scope)
                await connection.execute(text(_DELETE_ORGANIZATION_ROWS_SQL), scope)

            result = await connection.execute(
                text(_DELETE_INVITATIONS_SQL),
                {"organization_id": organization_id, "email": email},
            )

        return MembershipWriteResult(
            user_id=user_id,
            deleted_invitation_count=result.rowcount or 0,
        )

    async def create_project(
        self,
        *,
        organization_id: UUID,
        name: str,
        is_default: bool,
    ) -> CreatedProject:
        """A project of the organization (no workspace). With `is_default`, it becomes
        the organization's one default; it is also the default when there is none."""

        project_id = uuid_compat.uuid7()

        async with self.engine.transaction() as connection:
            await connection.execute(
                text(_LOCK_WITH_PROJECT_DEFAULT_SQL),
                {"organization_id": str(organization_id)},
            )

            should_be_default = (
                await connection.execute(
                    text(_INSERT_PROJECT_SQL),
                    {
                        "organization_id": organization_id,
                        "id": project_id,
                        "name": name,
                        "make_default": bool(is_default),
                    },
                )
            ).scalar_one()

            seeded = await connection.execute(
                text(_SEED_PROJECT_MEMBERS_SQL),
                {"organization_id": organization_id, "project_id": project_id},
            )

            owner_id = await self._owner_id(connection, organization_id)

        return CreatedProject(
            scope=ProjectScope(
                project_id=project_id,
                organization_id=organization_id,
                workspace_id=organization_id,
                organization_owner_id=owner_id,
                is_default=should_be_default,
            ),
            seeded_count=seeded.rowcount or 0,
        )

    async def transfer_ownership(
        self,
        *,
        organization_id: UUID,
        new_owner_id: UUID,
        current_owner_id: UUID,
    ) -> MembershipWriteResult:
        async with self.engine.transaction() as connection:
            await self._lock(connection, organization_id)

            owner_id = await self._owner_id(connection, organization_id)
            if owner_id is None:
                raise OrganizationNotFound(organization_id=organization_id)
            if owner_id != current_owner_id:
                # The router authorized a caller who was the owner when it checked;
                # a transfer that committed since then makes this one stale.
                raise MemberNotFound(
                    organization_id=organization_id, user_id=current_owner_id
                )

            new_row = (
                await connection.execute(
                    text(_FETCH_OLDEST_ORGANIZATION_ROW_SQL),
                    {"organization_id": organization_id, "user_id": new_owner_id},
                )
            ).first()
            if new_row is None:
                raise MemberNotFound(
                    organization_id=organization_id, user_id=new_owner_id
                )

            current_row = (
                await connection.execute(
                    text(_FETCH_OLDEST_ORGANIZATION_ROW_SQL),
                    {"organization_id": organization_id, "user_id": current_owner_id},
                )
            ).first()

            # The former owner takes the new owner's organization role (today's swap);
            # the new owner becomes `owner`, never the former owner's stored role.
            if current_row is not None:
                await connection.execute(
                    text(_UPDATE_ORGANIZATION_ROW_SQL),
                    {"id": current_row.id, "role": new_row.role},
                )
            await connection.execute(
                text(_UPDATE_ORGANIZATION_ROW_SQL),
                {"id": new_row.id, "role": "owner"},
            )

            # Swap the project roles where both have a row, exactly like the admin
            # transfer tool: the former owner keeps access with the new owner's
            # previous role (owner decision, 2026-10-23).
            await connection.execute(
                text(_SWAP_PROJECT_ROLES_OF_TWO_SQL),
                {
                    "organization_id": organization_id,
                    "user_ids": [current_owner_id, new_owner_id],
                },
            )

            # After M1 the owner shortcut runs only for a member: seed the new owner
            # into every project where they still have no row.
            seeded = await connection.execute(
                text(_SEED_OWNER_PROJECT_ROWS_SQL),
                {"organization_id": organization_id, "user_id": new_owner_id},
            )

            # Whatever the swaps moved over, the new owner is `owner` on every
            # organization and project row of the organization.
            for statement in PROMOTE_NEW_OWNER_SQL:
                await connection.execute(
                    text(statement),
                    {"organization_id": organization_id, "user_id": new_owner_id},
                )

            await connection.execute(
                text(_SET_OWNER_SQL),
                {
                    "organization_id": organization_id,
                    "new_owner_id": new_owner_id,
                    "current_owner_id": current_owner_id,
                },
            )

        return MembershipWriteResult(
            user_id=new_owner_id,
            previous_role=new_row.role,
            inserted_count=seeded.rowcount or 0,
        )
