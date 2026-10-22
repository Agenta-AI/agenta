"""In-memory doubles for the memberships and access unit tests."""

from typing import Dict, List, Optional, Sequence, Tuple
from uuid import UUID, uuid4

from oss.src.core.access.interfaces import RbacEnforcementInterface
from oss.src.core.memberships.dtos import (
    CreatedProject,
    MembershipRow,
    MembershipWriteResult,
    OrganizationMember,
    ProjectMember,
    ProjectScope,
    ProjectSummary,
)
from oss.src.core.memberships.interfaces import MembershipsDAOInterface


def make_summary(
    *,
    organization_id: Optional[UUID] = None,
    project_id: Optional[UUID] = None,
    workspace_id: Optional[UUID] = None,
    organization_owner_id: Optional[UUID] = None,
    is_default: bool = False,
    project_name: str = "Project",
) -> ProjectSummary:
    return ProjectSummary(
        project_id=project_id or uuid4(),
        organization_id=organization_id or uuid4(),
        workspace_id=workspace_id or uuid4(),
        organization_owner_id=organization_owner_id,
        is_default=is_default,
        project_name=project_name,
        workspace_name="Default",
        organization_name="Organization",
    )


class InMemoryMembershipsDAO(MembershipsDAOInterface):
    """Readers build `MembershipRow` values from the public fields, oldest row first by
    list order. Writers only record their call and return a default result."""

    def __init__(self) -> None:
        self.projects: Dict[UUID, ProjectSummary] = {}
        self.organization_members: List[OrganizationMember] = []
        self.project_members: List[ProjectMember] = []
        self.writes: List[Tuple[str, dict]] = []
        self.reads: List[str] = []
        self.write_results: Dict[str, MembershipWriteResult] = {}

    # -- setup helpers -----------------------------------------------------------------

    def add_project(self, summary: ProjectSummary) -> ProjectSummary:
        self.projects[summary.project_id] = summary
        return summary

    def add_organization_member(
        self, *, organization_id: UUID, user_id: UUID, role: str
    ) -> None:
        self.organization_members.append(
            OrganizationMember(
                organization_id=organization_id, user_id=user_id, role=role
            )
        )

    def add_project_member(
        self, *, project_id: UUID, user_id: UUID, role: Optional[str]
    ) -> None:
        self.project_members.append(
            ProjectMember(project_id=project_id, user_id=user_id, role=role)
        )

    # -- readers -----------------------------------------------------------------------

    def _row(self, *, user_id: UUID, summary: ProjectSummary) -> MembershipRow:
        organization_row = next(
            (
                m
                for m in self.organization_members
                if m.organization_id == summary.organization_id and m.user_id == user_id
            ),
            None,
        )
        project_row = next(
            (
                m
                for m in self.project_members
                if m.project_id == summary.project_id and m.user_id == user_id
            ),
            None,
        )
        return MembershipRow(
            summary=summary,
            has_organization_row=organization_row is not None,
            organization_role=organization_row.role if organization_row else None,
            has_project_row=project_row is not None,
            project_role=project_row.role if project_row else None,
        )

    async def fetch_membership_row(
        self, *, user_id: UUID, project_id: UUID
    ) -> Optional[MembershipRow]:
        self.reads.append("fetch_membership_row")
        summary = self.projects.get(project_id)
        if summary is None:
            return None
        return self._row(user_id=user_id, summary=summary)

    async def list_membership_rows(self, *, user_id: UUID) -> List[MembershipRow]:
        self.reads.append("list_membership_rows")
        organization_ids = {
            m.organization_id for m in self.organization_members if m.user_id == user_id
        }
        return [
            self._row(user_id=user_id, summary=summary)
            for summary in self.projects.values()
            if summary.organization_id in organization_ids
        ]

    async def fetch_organization_member(
        self, *, organization_id: UUID, user_id: UUID
    ) -> Optional[OrganizationMember]:
        self.reads.append("fetch_organization_member")
        return next(
            (
                m
                for m in self.organization_members
                if m.organization_id == organization_id and m.user_id == user_id
            ),
            None,
        )

    async def list_projects(
        self, *, organization_ids: Sequence[UUID]
    ) -> List[ProjectScope]:
        self.reads.append("list_projects")
        return [
            ProjectScope(**summary.model_dump(include=set(ProjectScope.model_fields)))
            for summary in self.projects.values()
            if summary.organization_id in organization_ids
        ]

    # -- writers -----------------------------------------------------------------------

    async def set_member_role(self, **kwargs) -> MembershipWriteResult:
        self.writes.append(("set_member_role", kwargs))
        return self.write_results.get("set_member_role", MembershipWriteResult())

    async def remove_member(self, **kwargs) -> MembershipWriteResult:
        self.writes.append(("remove_member", kwargs))
        return self.write_results.get("remove_member", MembershipWriteResult())

    async def create_project(self, **kwargs) -> CreatedProject:
        self.writes.append(("create_project", kwargs))
        summary = self.add_project(
            make_summary(
                organization_id=kwargs["organization_id"],
                workspace_id=kwargs["workspace_id"],
                is_default=kwargs["is_default"],
                project_name=kwargs["name"],
            )
        )
        return CreatedProject(
            scope=ProjectScope(
                **summary.model_dump(include=set(ProjectScope.model_fields))
            ),
            seeded_count=0,
        )

    async def transfer_ownership(self, **kwargs) -> MembershipWriteResult:
        self.writes.append(("transfer_ownership", kwargs))
        return self.write_results.get("transfer_ownership", MembershipWriteResult())


class RecordingRbac(RbacEnforcementInterface):
    """Records the organization of each `is_enforced` call."""

    def __init__(self, enforced: bool = True) -> None:
        self.enforced = enforced
        self.calls: List[UUID] = []

    async def is_enforced(self, *, organization_id: UUID) -> bool:
        self.calls.append(organization_id)
        return self.enforced
