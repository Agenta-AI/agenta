from oss.src.core.memberships.dtos import (
    MembershipRow,
    OrganizationMember,
    ProjectScope,
    ProjectSummary,
)


def map_project_scope_dbe_to_dto(row) -> ProjectScope:
    """`row` is a result row with project_id, organization_id, workspace_id,
    organization_owner_id and is_default."""

    return ProjectScope(
        project_id=row.project_id,
        organization_id=row.organization_id,
        workspace_id=row.workspace_id,
        organization_owner_id=row.organization_owner_id,
        is_default=bool(row.is_default),
    )


def map_project_summary_dbe_to_dto(row) -> ProjectSummary:
    return ProjectSummary(
        project_id=row.project_id,
        organization_id=row.organization_id,
        workspace_id=row.workspace_id,
        organization_owner_id=row.organization_owner_id,
        is_default=bool(row.is_default),
        project_name=row.project_name,
        workspace_name=row.workspace_name or "",
        organization_name=row.organization_name or "",
    )


def map_membership_row_to_dto(row) -> MembershipRow:
    return MembershipRow(
        summary=map_project_summary_dbe_to_dto(row),
        has_organization_row=bool(row.has_organization_row),
        organization_role=row.organization_role,
        has_project_row=bool(row.has_project_row),
        project_role=row.project_role,
    )


def map_organization_member_dbe_to_dto(dbe) -> OrganizationMember:
    return OrganizationMember(
        organization_id=dbe.organization_id,
        user_id=dbe.user_id,
        role=dbe.role,
    )
