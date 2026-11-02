from abc import ABC, abstractmethod
from typing import List, Optional, Sequence
from uuid import UUID

from oss.src.core.memberships.dtos import (
    CreatedProject,
    MembershipRow,
    MembershipWriteResult,
    MembershipPolicy,
    OrganizationMember,
    ProjectMemberProfile,
    ProjectScope,
)
from oss.src.core.shared.dtos import Windowing


class MembershipsDAOInterface(ABC):
    # readers: each is ONE SQL statement (the hot paths stay at today's count)

    @abstractmethod
    async def fetch_membership_row(
        self,
        *,
        user_id: UUID,
        project_id: UUID,
    ) -> Optional[MembershipRow]:
        """None when the project does not exist."""

    @abstractmethod
    async def list_membership_rows(
        self,
        *,
        user_id: UUID,
    ) -> List[MembershipRow]:
        """One row per project of every organization with an organization row for
        the user, ordered by organization, then project creation."""

    @abstractmethod
    async def fetch_organization_member(
        self,
        *,
        organization_id: UUID,
        user_id: UUID,
    ) -> Optional[OrganizationMember]:
        """The oldest organization row."""

    @abstractmethod
    async def list_projects(
        self,
        *,
        organization_ids: Sequence[UUID],
    ) -> List[ProjectScope]:
        """Project ids for invalidation after a write."""

    @abstractmethod
    async def query_project_member_profiles(
        self,
        *,
        project_id: UUID,
        policy: MembershipPolicy,
        #
        search: Optional[str] = None,
        windowing: Optional[Windowing] = None,
    ) -> List[ProjectMemberProfile]:
        """The members of a project with their profile, for the share picker. The
        policy decides who is a member: `ORGANIZATION_WIDE` lists the organization
        members with the organization role, `PROJECT_ROWS` lists the project rows
        whose user has an organization row, with the project role. Workspace rows are
        never read. `search` is a case-insensitive prefix of the email or the name.
        Ordered by email; `windowing.next` is the last `user_id` of the previous page,
        `windowing.limit` defaults to 50. One statement."""

    # writers: one transaction each, under the organization lock

    @abstractmethod
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
        """Raises OrganizationOwnerProtected, MemberNotFound.

        With `must_be_absent`, an existing organization row (checked under the
        organization lock) leaves every row unchanged, and the result has
        `user_id=None` (nothing was written)."""

    @abstractmethod
    async def remove_member(
        self,
        *,
        organization_id: UUID,
        email: str,
    ) -> MembershipWriteResult:
        """`user_id` is None when only invitations were removed.
        Raises OrganizationOwnerProtected."""

    @abstractmethod
    async def create_project(
        self,
        *,
        organization_id: UUID,
        name: str,
        is_default: bool,
    ) -> CreatedProject:
        """A project of the organization, with no workspace."""

    @abstractmethod
    async def transfer_ownership(
        self,
        *,
        organization_id: UUID,
        new_owner_id: UUID,
        current_owner_id: UUID,
    ) -> MembershipWriteResult:
        """`inserted_count` = owner rows seeded.
        Raises OrganizationNotFound, MemberNotFound."""
