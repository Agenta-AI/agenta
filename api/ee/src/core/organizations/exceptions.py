"""Domain-level exceptions for organizations."""


class OrganizationError(Exception):
    """Base exception for organization-related errors."""

    pass


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


class LastOrganizationError(OrganizationError):
    """Raised when attempting to delete the user's last organization."""

    def __init__(self, message: str = None):
        self.message = (
            message
            or "Cannot delete your last organization. You must have at least one organization."
        )
        super().__init__(self.message)
