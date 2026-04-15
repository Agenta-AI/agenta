from typing import Optional, Dict, Any


class AdminError(Exception):
    """Base exception for platform admin operations."""

    def __init__(
        self,
        *,
        code: str,
        message: str,
        details: Optional[Dict[str, Any]] = None,
    ):
        self.code = code
        self.message = message
        self.details = details or {}
        super().__init__(message)


class AdminUserAlreadyExistsError(AdminError):
    def __init__(self, email: str):
        super().__init__(
            code="user_already_exists",
            message=f"User with email '{email}' already exists.",
            details={"email": email},
        )


class AdminUserNotFoundError(AdminError):
    def __init__(self, ref: str):
        super().__init__(
            code="user_not_found",
            message=f"User not found: {ref}.",
            details={"ref": ref},
        )


class AdminOrganizationNotFoundError(AdminError):
    def __init__(self, ref: str):
        super().__init__(
            code="organization_not_found",
            message=f"Organization not found: {ref}.",
            details={"ref": ref},
        )


class AdminWorkspaceNotFoundError(AdminError):
    def __init__(self, ref: str):
        super().__init__(
            code="workspace_not_found",
            message=f"Workspace not found: {ref}.",
            details={"ref": ref},
        )


class AdminProjectNotFoundError(AdminError):
    def __init__(self, ref: str):
        super().__init__(
            code="project_not_found",
            message=f"Project not found: {ref}.",
            details={"ref": ref},
        )


class AdminApiKeyNotFoundError(AdminError):
    def __init__(self, ref: str):
        super().__init__(
            code="api_key_not_found",
            message=f"API key not found: {ref}.",
            details={"ref": ref},
        )


class AdminMembershipNotFoundError(AdminError):
    def __init__(self, ref: str):
        super().__init__(
            code="membership_not_found",
            message=f"Membership not found: {ref}.",
            details={"ref": ref},
        )


class AdminInvalidReferenceError(AdminError):
    def __init__(self, path: str, reason: str = ""):
        super().__init__(
            code="invalid_reference",
            message=f"Invalid reference at '{path}'"
            + (f": {reason}" if reason else "."),
            details={"path": path, "reason": reason},
        )


class AdminValidationError(AdminError):
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(
            code="validation_error",
            message=message,
            details=details,
        )


class AdminNotImplementedError(AdminError):
    def __init__(self, feature: str):
        super().__init__(
            code="not_implemented",
            message=f"'{feature}' is not yet implemented in this edition.",
            details={"feature": feature},
        )


class AdminDryRunResult(Exception):
    """Raised to abort a dry-run after collecting what would be written."""

    def __init__(self, result: Any):
        self.result = result
        super().__init__("dry_run")
