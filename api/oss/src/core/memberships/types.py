from typing import Optional
from uuid import UUID


class MembershipError(Exception):
    """Base for the memberships domain."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class OrganizationOwnerProtected(MembershipError):
    """`set_member_role` or `remove_member` on `organizations.owner_id`."""

    def __init__(self, *, organization_id: UUID, user_id: UUID):
        self.organization_id = organization_id
        self.user_id = user_id
        super().__init__("The organization owner cannot be changed or removed.")


class MemberNotFound(MembershipError):
    """No organization row: `set_member_role(must_exist=True)`, `transfer_ownership`."""

    def __init__(self, *, organization_id: UUID, user_id: Optional[UUID] = None):
        self.organization_id = organization_id
        self.user_id = user_id
        super().__init__("The user is not a member of the organization.")


class OrganizationNotFound(MembershipError):
    """`transfer_ownership` on an organization that does not exist."""

    def __init__(self, *, organization_id: UUID):
        self.organization_id = organization_id
        super().__init__("The organization does not exist.")


class WorkspaceNotFound(MembershipError):
    """`create_project` with a workspace outside the organization."""

    def __init__(self, *, organization_id: UUID, workspace_id: UUID):
        self.organization_id = organization_id
        self.workspace_id = workspace_id
        super().__init__("The workspace is not in the organization.")


class MembershipsServiceNotRegistered(RuntimeError):
    """A process called the memberships service before registering it."""
