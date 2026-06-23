import uuid_utils.compat as uuid

import sqlalchemy as sa
from sqlalchemy import Connection, insert
from sqlalchemy.future import select

# Frozen table definitions pinned to the schema at this revision. The migration
# must not import live ORM models: a later model change would otherwise break
# replaying this revision on a fresh or delayed upgrade.
organizations = sa.table(
    "organizations",
    sa.column("id", sa.UUID()),
    sa.column("owner_id", sa.UUID()),
)
workspaces = sa.table(
    "workspaces",
    sa.column("id", sa.UUID()),
    sa.column("organization_id", sa.UUID()),
)
projects = sa.table(
    "projects",
    sa.column("id", sa.UUID()),
    sa.column("workspace_id", sa.UUID()),
    sa.column("organization_id", sa.UUID()),
)
project_invitations = sa.table(
    "project_invitations",
    sa.column("user_id", sa.UUID()),
    sa.column("project_id", sa.UUID()),
    sa.column("role", sa.String()),
    sa.column("used", sa.Boolean()),
)
organization_members = sa.table(
    "organization_members",
    sa.column("id", sa.UUID()),
    sa.column("user_id", sa.UUID()),
    sa.column("organization_id", sa.UUID()),
    sa.column("role", sa.String()),
)
workspace_members = sa.table(
    "workspace_members",
    sa.column("id", sa.UUID()),
    sa.column("user_id", sa.UUID()),
    sa.column("workspace_id", sa.UUID()),
    sa.column("role", sa.String()),
)
project_members = sa.table(
    "project_members",
    sa.column("id", sa.UUID()),
    sa.column("user_id", sa.UUID()),
    sa.column("project_id", sa.UUID()),
    sa.column("role", sa.String()),
)


def upgrade_membership_backfill(session: Connection):
    """Backfill membership rows for pre-membership OSS deployments.

    Owners become `owner` members of their org and of every workspace/project in
    it; users holding a used invitation become members of the invitation's
    project, its workspace, and its org with the invitation's role.
    """

    org_rows = session.execute(
        select(organizations.c.id, organizations.c.owner_id)
    ).all()
    workspace_rows = session.execute(
        select(workspaces.c.id, workspaces.c.organization_id)
    ).all()
    project_rows = session.execute(
        select(projects.c.id, projects.c.workspace_id, projects.c.organization_id)
    ).all()

    org_member_keys = {
        (row.user_id, row.organization_id)
        for row in session.execute(
            select(
                organization_members.c.user_id, organization_members.c.organization_id
            )
        )
    }
    workspace_member_keys = {
        (row.user_id, row.workspace_id)
        for row in session.execute(
            select(workspace_members.c.user_id, workspace_members.c.workspace_id)
        )
    }
    project_member_keys = {
        (row.user_id, row.project_id)
        for row in session.execute(
            select(project_members.c.user_id, project_members.c.project_id)
        )
    }

    def add_org_member(user_id, organization_id, role):
        if user_id and (user_id, organization_id) not in org_member_keys:
            session.execute(
                insert(organization_members).values(
                    id=uuid.uuid7(),
                    user_id=user_id,
                    organization_id=organization_id,
                    role=role,
                )
            )
            org_member_keys.add((user_id, organization_id))

    def add_workspace_member(user_id, workspace_id, role):
        if user_id and (user_id, workspace_id) not in workspace_member_keys:
            session.execute(
                insert(workspace_members).values(
                    id=uuid.uuid7(),
                    user_id=user_id,
                    workspace_id=workspace_id,
                    role=role,
                )
            )
            workspace_member_keys.add((user_id, workspace_id))

    def add_project_member(user_id, project_id, role):
        if user_id and (user_id, project_id) not in project_member_keys:
            session.execute(
                insert(project_members).values(
                    id=uuid.uuid7(), user_id=user_id, project_id=project_id, role=role
                )
            )
            project_member_keys.add((user_id, project_id))

    for organization in org_rows:
        add_org_member(organization.owner_id, organization.id, "owner")
        for workspace in workspace_rows:
            if workspace.organization_id == organization.id:
                add_workspace_member(organization.owner_id, workspace.id, "owner")
        for project in project_rows:
            if project.organization_id == organization.id:
                add_project_member(organization.owner_id, project.id, "owner")

    projects_by_id = {project.id: project for project in project_rows}

    invitations = session.execute(
        select(
            project_invitations.c.user_id,
            project_invitations.c.project_id,
            project_invitations.c.role,
        ).where(
            project_invitations.c.used.is_(True),
            project_invitations.c.user_id.is_not(None),
        )
    ).all()

    for invitation in invitations:
        project = projects_by_id.get(invitation.project_id)
        if project is None:
            continue
        add_project_member(invitation.user_id, project.id, invitation.role)
        if project.workspace_id:
            add_workspace_member(
                invitation.user_id, project.workspace_id, invitation.role
            )
        if project.organization_id:
            add_org_member(invitation.user_id, project.organization_id, invitation.role)


def downgrade_membership_backfill(session: Connection):
    # Backfilled rows are indistinguishable from organically created ones;
    # nothing safe to remove.
    pass
