"""Policy + resolution exceptions (entities.md §5).

`PolicyDeniedError` and `CredentialNotFoundError` are different failures on purpose: the
first says you may not, the second says you could, once someone connects — the second maps
to the needs-auth / needs-input interaction path (D17).
"""

from typing import Optional, Union

from oss.src.core.access.permissions.types import Permission
from oss.src.core.gateways.policy.dtos import CredentialMode, CredentialOwnerKind
from oss.src.core.gateways.types import GatewaysError


class PolicyDeniedError(GatewaysError):
    """The permission check refused (WP3). Carries the subject and the target so
    the denial is explainable on a fixed-shape wire (§9)."""

    def __init__(self, *, permission: Permission, target: str):
        self.permission = permission
        self.target = target
        super().__init__(f"Denied {permission.value} on {target}")


class EntitlementDeniedError(GatewaysError):
    """The plan-level check refused. Distinct from PolicyDeniedError because
    permissions and entitlements answer different questions and conflating them
    is a known trap (`policy.md`)."""

    def __init__(self, *, key: str, target: str):
        self.key = key
        self.target = target
        super().__init__(f"Entitlement {key} exceeded for {target}")


class CredentialNotFoundError(GatewaysError):
    """Resolution failed. Names WHICH owner is missing a credential, so the
    caller learns whether they must connect or an administrator must
    (`secrets.md`: failure is never silent and never a fallback to none)."""

    def __init__(
        self, *, mode: CredentialMode, missing: CredentialOwnerKind, target: str
    ):
        self.mode = mode
        self.missing = missing
        self.target = target
        super().__init__(
            f"No {missing.value} credential for {target} under mode {mode.value}"
        )


class CredentialInvalidError(GatewaysError):
    """A credential exists and cannot be used — revoked, or refresh failed.
    Surfaces as needs_auth with a connect affordance (D17, D18)."""

    def __init__(self, *, target: str, detail: Optional[str] = None):
        self.target = target
        self.detail = detail
        super().__init__(f"Credential for {target} is invalid")


class CeilingExceededError(GatewaysError):
    """A governance ceiling rejects; it never silently clamps (D25). Carries the
    three facts the denial must name so a caller retries correctly the first
    time: the ceiling, the value asked for, and the value allowed."""

    def __init__(
        self,
        *,
        ceiling: str,
        requested: Union[int, float],
        allowed: Union[int, float],
        target: str,
    ):
        self.ceiling = ceiling  # the config key, e.g. "max_output_tokens"
        self.requested = requested
        self.allowed = allowed
        self.target = target
        super().__init__(
            f"{ceiling} on {target}: requested {requested}, allowed {allowed}"
        )
