from abc import ABC, abstractmethod
from typing import List, Optional, Sequence
from uuid import UUID

from oss.src.core.memberships.dtos import (
    CreatedProject,
    MembershipRow,
    MembershipWriteResult,
    OrganizationMember,
    ProjectScope,
)


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
        workspace_id: UUID,
        name: str,
        is_default: bool,
    ) -> CreatedProject:
        """Raises WorkspaceNotFound."""

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
