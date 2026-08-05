"""Domain-level exceptions for organizations (shared OSS/EE)."""


class OrganizationError(Exception):
    """Base exception for organization-related errors."""

    pass


class OrganizationCreationNotAllowedError(OrganizationError):
    """Raised when a user is not in the org creation allowlist."""

    def __init__(self, email: str, message: str = None):
        self.email = email
        self.message = (
            message
            or "You are not allowed to create organizations. Please ask your administrator for an invitation."
        )
        super().__init__(self.message)


class LastOrganizationError(OrganizationError):
    """Raised when attempting to delete the user's last organization."""

    def __init__(self, message: str = None):
        self.message = (
            message
            or "Cannot delete your last organization. You must have at least one organization."
        )
        super().__init__(self.message)
