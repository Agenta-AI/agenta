class AccessError(Exception):
    """Base for the access domain; M2 derives its exceptions from it."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class InvalidRoleRequirement(AccessError):
    def __init__(self, message: str = "Invalid role specified"):
        super().__init__(message)


class InvalidPermission(AccessError):
    def __init__(self, message: str = "Invalid permission specified"):
        super().__init__(message)


class AccessServiceNotRegistered(RuntimeError):
    """A wiring error, not a domain error."""
