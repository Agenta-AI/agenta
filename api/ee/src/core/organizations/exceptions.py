"""Domain-level exceptions for organizations (EE-specific)."""

from oss.src.core.organizations.exceptions import OrganizationError


class OrganizationSlugConflictError(OrganizationError):
    """Raised when attempting to use a slug that is already in use."""

    def __init__(self, slug: str, message: str = None):
        self.slug = slug
        self.message = message or f"Organization slug '{slug}' is already in use."
        super().__init__(self.message)
