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


# -- run principal (M2) -------------------------------------------------------------


class DecisionInputMissing(AccessError):
    """`decide` got neither a project nor an authority."""

    def __init__(self, message: str = "A decision needs a project"):
        super().__init__(message)


class RequestAccessMissing(AccessError):
    """`check_action_access` ran with no request principal."""

    def __init__(self, message: str = "No request access is set for this check"):
        super().__init__(message)


class RequestAccessMismatch(AccessError):
    """`check_action_access` was asked about a user other than the request's."""

    def __init__(
        self,
        message: str = "The checked user is not the request's acting user",
    ):
        super().__init__(message)


class AccessDenied(AccessError):
    def __init__(self, *, decision, message: str = "Access denied"):
        self.decision = decision
        super().__init__(message)


class MissingEnvelope(AccessError):
    """A durable row without a `run_envelope` (code `missing_envelope`)."""

    def __init__(self, message: str = "The work has no run envelope"):
        super().__init__(message)


class MissingPrincipal(AccessError):
    """A trigger or evaluation run without a principal (code `missing_principal`)."""

    def __init__(self, message: str = "The work has no principal"):
        super().__init__(message)


class InvalidRunClaims(AccessError):
    """A run claim or a stored envelope whose shape or value is not valid."""

    def __init__(self, message: str = "Run claims are not valid"):
        super().__init__(message)
