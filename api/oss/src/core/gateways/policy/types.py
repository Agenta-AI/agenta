"""Gateway policy and secret-resolution exceptions."""

from typing import Optional, Union

from oss.src.core.access.permissions.types import Permission
from oss.src.core.gateways.policy.dtos import SecretMode, SecretOwnerKind
from oss.src.core.gateways.types import GatewaysError


class PolicyDeniedError(GatewaysError):
    """Permission denial with the subject and target."""

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


class SecretNotFoundError(GatewaysError):
    """Resolution failed. Names WHICH owner is missing a secret, so the
    caller learns whether they must connect or an administrator must
    (`secrets.md`: failure is never silent and never a fallback to none)."""

    def __init__(self, *, mode: SecretMode, missing: SecretOwnerKind, target: str):
        self.mode = mode
        self.missing = missing
        self.target = target
        super().__init__(
            f"No {missing.value} secret for {target} under mode {mode.value}"
        )


class SecretInvalidError(GatewaysError):
    """A secret exists but cannot be used."""

    def __init__(self, *, target: str, detail: Optional[str] = None):
        self.target = target
        self.detail = detail
        super().__init__(f"Secret for {target} is invalid")


class CeilingExceededError(GatewaysError):
    """A request exceeds its configured governance ceiling."""

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
