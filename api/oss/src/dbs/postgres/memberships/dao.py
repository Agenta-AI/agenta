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
    MembershipRow,
    MembershipWriteResult,
    OrganizationMember,
    ProjectScope,
)
from oss.src.core.memberships.interfaces import MembershipsDAOInterface
from oss.src.core.memberships.types import (
    MemberNotFound,
    OrganizationNotFound,
    OrganizationOwnerProtected,
    WorkspaceNotFound,
)
from oss.src.dbs.postgres.memberships.mappings import (
    map_membership_row_to_dto,
    map_organization_member_dbe_to_dto,
    map_project_scope_dbe_to_dto,
)
from oss.src.models.db_models import (  # noqa: F401  (the tables this DAO owns)
    InvitationDB,
    OrganizationDB,
    OrganizationMemberDB,
    ProjectDB,
    ProjectMemberDB,
    UserDB,
    WorkspaceDB,
    WorkspaceMemberDB,
)


_OLDEST = "ORDER BY created_at ASC NULLS LAST, id ASC LIMIT 1"

_SUMMARY_COLUMNS = """
    p.id AS project_id,
    p.organization_id,
    p.workspace_id,
    p.is_default,
    p.project_name,
    w.name AS workspace_name,
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
JOIN workspaces w ON w.id = p.workspace_id
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
JOIN workspaces w ON w.id = p.workspace_id
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
SELECT p.id AS project_id, p.organization_id, p.workspace_id, p.is_default,
       o.owner_id AS organization_owner_id
FROM projects p
JOIN organizations o ON o.id = p.organization_id
WHERE p.organization_id = ANY(CAST(:organization_ids AS uuid[]))
ORDER BY p.organization_id, p.created_at ASC NULLS LAST, p.id ASC
"""

# -- writers --------------------------------------------------------------------------

_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtextextended('memberships:' || :organization_id, 0))"

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

_UPDATE_WORKSPACE_ROWS_SQL = """
UPDATE workspace_members SET role = :role, updated_at = now()
WHERE user_id = :user_id
  AND workspace_id IN (SELECT id FROM workspaces WHERE organization_id = :organization_id)
"""

_INSERT_WORKSPACE_ROWS_SQL = """
INSERT INTO workspace_members (id, user_id, workspace_id, role, created_at, updated_at)
SELECT gen_random_uuid(), :user_id, t.workspace_id, :role, now(), now()
FROM (
    -- The workspace must belong to the organization too: a legacy project can point
    -- at a workspace of another organization, and that tenant must never gain a row.
    SELECT DISTINCT p.workspace_id FROM projects p
    JOIN workspaces w ON w.id = p.workspace_id AND w.organization_id = p.organization_id
    WHERE p.organization_id = :organization_id
      AND (:all_projects OR p.id = ANY(CAST(:project_ids AS uuid[])))
) t
WHERE NOT EXISTS (
    SELECT 1 FROM workspace_members wm
    WHERE wm.workspace_id = t.workspace_id AND wm.user_id = :user_id
)
"""

_FETCH_USER_BY_EMAIL_SQL = "SELECT id FROM users WHERE email = :email"

_DELETE_PROJECT_ROWS_SQL = """
DELETE FROM project_members
WHERE user_id = :user_id
  AND project_id IN (SELECT id FROM projects WHERE organization_id = :organization_id)
"""

_DELETE_WORKSPACE_ROWS_SQL = """
DELETE FROM workspace_members
WHERE user_id = :user_id
  AND workspace_id IN (SELECT id FROM workspaces WHERE organization_id = :organization_id)
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

_WORKSPACE_IN_ORGANIZATION_SQL = """
SELECT 1 FROM workspaces WHERE id = :workspace_id AND organization_id = :organization_id
"""

_WORKSPACE_HAS_DEFAULT_SQL = """
SELECT 1 FROM projects WHERE workspace_id = :workspace_id AND is_default IS TRUE LIMIT 1
"""

_UNSET_DEFAULTS_SQL = """
UPDATE projects SET is_default = false, updated_at = now()
WHERE workspace_id = :workspace_id AND is_default IS TRUE
"""

_INSERT_PROJECT_SQL = """
INSERT INTO projects (id, project_name, is_default, organization_id, workspace_id,
                      created_at, updated_at)
VALUES (:id, :name, :is_default, :organization_id, :workspace_id, now(), now())
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

_WORKSPACE_ROWS_OF_TWO_SQL = """
SELECT DISTINCT ON (wm.workspace_id, wm.user_id) wm.id, wm.workspace_id, wm.user_id, wm.role
FROM workspace_members wm
JOIN workspaces w ON w.id = wm.workspace_id
WHERE w.organization_id = :organization_id
  AND wm.user_id = ANY(CAST(:user_ids AS uuid[]))
ORDER BY wm.workspace_id, wm.user_id, wm.created_at ASC NULLS LAST, wm.id ASC
"""

_UPDATE_WORKSPACE_ROW_SQL = """
UPDATE workspace_members SET role = :role, updated_at = now() WHERE id = :id
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

            # Workspace mirror, until M4 drops workspaces.
            await connection.execute(
                text(_UPDATE_WORKSPACE_ROWS_SQL), {**scope, "role": role}
            )
            if join_all_projects or join_project_ids:
                await connection.execute(text(_INSERT_WORKSPACE_ROWS_SQL), targets)

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
                await connection.execute(text(_DELETE_WORKSPACE_ROWS_SQL), scope)
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
        workspace_id: UUID,
        name: str,
        is_default: bool,
    ) -> CreatedProject:
        project_id = uuid_compat.uuid7()

        async with self.engine.transaction() as connection:
            await self._lock(connection, organization_id)

            scope = {"organization_id": organization_id, "workspace_id": workspace_id}

            in_organization = (
                await connection.execute(text(_WORKSPACE_IN_ORGANIZATION_SQL), scope)
            ).first()
            if in_organization is None:
                raise WorkspaceNotFound(
                    organization_id=organization_id, workspace_id=workspace_id
                )

            # As today: the new project becomes the default when asked, or when the
            # workspace has none.
            should_be_default = (
                is_default
                or (
                    await connection.execute(
                        text(_WORKSPACE_HAS_DEFAULT_SQL), {"workspace_id": workspace_id}
                    )
                ).first()
                is None
            )
            if should_be_default:
                await connection.execute(
                    text(_UNSET_DEFAULTS_SQL), {"workspace_id": workspace_id}
                )

            await connection.execute(
                text(_INSERT_PROJECT_SQL),
                {
                    **scope,
                    "id": project_id,
                    "name": name,
                    "is_default": should_be_default,
                },
            )

            seeded = await connection.execute(
                text(_SEED_PROJECT_MEMBERS_SQL),
                {"organization_id": organization_id, "project_id": project_id},
            )

            owner_id = await self._owner_id(connection, organization_id)

        return CreatedProject(
            scope=ProjectScope(
                project_id=project_id,
                organization_id=organization_id,
                workspace_id=workspace_id,
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

            # Swap the two organization roles (today's behavior).
            if current_row is not None:
                await connection.execute(
                    text(_UPDATE_ORGANIZATION_ROW_SQL),
                    {"id": current_row.id, "role": new_row.role},
                )
                await connection.execute(
                    text(_UPDATE_ORGANIZATION_ROW_SQL),
                    {"id": new_row.id, "role": current_row.role},
                )

            # Swap the workspace roles in every workspace where both have a row.
            workspace_rows = (
                await connection.execute(
                    text(_WORKSPACE_ROWS_OF_TWO_SQL),
                    {
                        "organization_id": organization_id,
                        "user_ids": [current_owner_id, new_owner_id],
                    },
                )
            ).all()
            by_workspace: dict = {}
            for row in workspace_rows:
                by_workspace.setdefault(row.workspace_id, {})[row.user_id] = row
            for rows in by_workspace.values():
                current_ws, new_ws = rows.get(current_owner_id), rows.get(new_owner_id)
                if current_ws is None or new_ws is None:
                    continue
                await connection.execute(
                    text(_UPDATE_WORKSPACE_ROW_SQL),
                    {"id": current_ws.id, "role": new_ws.role},
                )
                await connection.execute(
                    text(_UPDATE_WORKSPACE_ROW_SQL),
                    {"id": new_ws.id, "role": current_ws.role},
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
