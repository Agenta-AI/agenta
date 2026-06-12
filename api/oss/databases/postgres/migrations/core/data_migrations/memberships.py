from sqlalchemy import Connection, insert
from sqlalchemy.future import select

from oss.src.models.db_models import (
    InvitationDB,
    OrganizationDB,
    OrganizationMemberDB,
    ProjectDB,
    ProjectMemberDB,
    WorkspaceDB,
    WorkspaceMemberDB,
)


def upgrade_membership_backfill(session: Connection):
    """Backfill membership rows for pre-membership OSS deployments.

    Owners become `owner` members of their org and of every workspace/project in
    it; users holding a used invitation become members of the invitation's
    project, its workspace, and its org with the invitation's role.
    """

    organizations = session.execute(
        select(OrganizationDB.id, OrganizationDB.owner_id)
    ).all()
    workspaces = session.execute(
        select(WorkspaceDB.id, WorkspaceDB.organization_id)
    ).all()
    projects = session.execute(
        select(ProjectDB.id, ProjectDB.workspace_id, ProjectDB.organization_id)
    ).all()

    org_members = {
        (row.user_id, row.organization_id)
        for row in session.execute(
            select(OrganizationMemberDB.user_id, OrganizationMemberDB.organization_id)
        )
    }
    workspace_members = {
        (row.user_id, row.workspace_id)
        for row in session.execute(
            select(WorkspaceMemberDB.user_id, WorkspaceMemberDB.workspace_id)
        )
    }
    project_members = {
        (row.user_id, row.project_id)
        for row in session.execute(
            select(ProjectMemberDB.user_id, ProjectMemberDB.project_id)
        )
    }

    def add_org_member(user_id, organization_id, role):
        if user_id and (user_id, organization_id) not in org_members:
            session.execute(
                insert(OrganizationMemberDB).values(
                    user_id=user_id, organization_id=organization_id, role=role
                )
            )
            org_members.add((user_id, organization_id))

    def add_workspace_member(user_id, workspace_id, role):
        if user_id and (user_id, workspace_id) not in workspace_members:
            session.execute(
                insert(WorkspaceMemberDB).values(
                    user_id=user_id, workspace_id=workspace_id, role=role
                )
            )
            workspace_members.add((user_id, workspace_id))

    def add_project_member(user_id, project_id, role):
        if user_id and (user_id, project_id) not in project_members:
            session.execute(
                insert(ProjectMemberDB).values(
                    user_id=user_id, project_id=project_id, role=role
                )
            )
            project_members.add((user_id, project_id))

    for organization in organizations:
        add_org_member(organization.owner_id, organization.id, "owner")
        for workspace in workspaces:
            if workspace.organization_id == organization.id:
                add_workspace_member(organization.owner_id, workspace.id, "owner")
        for project in projects:
            if project.organization_id == organization.id:
                add_project_member(organization.owner_id, project.id, "owner")

    projects_by_id = {project.id: project for project in projects}

    invitations = session.execute(
        select(InvitationDB.user_id, InvitationDB.project_id, InvitationDB.role).where(
            InvitationDB.used.is_(True), InvitationDB.user_id.is_not(None)
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
