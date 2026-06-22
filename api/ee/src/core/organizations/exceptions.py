"""Domain-level exceptions for organizations."""

from oss.src.core.organizations.exceptions import (  # noqa: F401 — shared base/types
    OrganizationError,
    OrganizationCreationNotAllowedError,
    LastOrganizationError,
)


class OrganizationSlugConflictError(OrganizationError):
    """Raised when attempting to use a slug that is already in use."""

    def __init__(self, slug: str, message: str = None):
        self.slug = slug
        self.message = message or f"Organization slug '{slug}' is already in use."
        super().__init__(self.message)


class OrganizationNotFoundError(OrganizationError):
    """Raised when an organization is not found."""

    def __init__(self, organization_id: str, message: str = None):
        self.organization_id = organization_id
        self.message = message or f"Organization with id '{organization_id}' not found."
        super().__init__(self.message)
