from __future__ import annotations

from enum import Enum
from typing import Optional


class LeaseError(Exception):
    pass


class LeaseNotFound(LeaseError):
    pass


class LeaseConflict(LeaseError):
    def __init__(self, code: str, *, current_version: Optional[int] = None):
        self.code = code
        self.current_version = current_version
        super().__init__(code)


class LeaseInvalid(LeaseError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


class LeaseProvider(str, Enum):
    DAYTONA = "daytona"


class OwnerKind(str, Enum):
    SESSION = "session"
    RUN = "run"


class ConsumerKind(str, Enum):
    MODEL = "model"
    HTTP_MCP = "http_mcp"


class BindingKind(str, Enum):
    ENVIRONMENT = "environment"
    HEADER = "header"


class CredentialUsage(str, Enum):
    OPAQUE_HTTP = "opaque_http"


class LeaseState(str, Enum):
    RESERVED = "reserved"
    PROVISIONING = "provisioning"
    ACTIVE = "active"
    CLEANUP_PENDING = "cleanup_pending"
    CLEANING = "cleaning"
    DELETED = "deleted"
    QUARANTINED = "quarantined"


class ResourceState(str, Enum):
    PLANNED = "planned"
    CREATED = "created"
    DELETED = "deleted"


class LeaseTransition(str, Enum):
    BEGIN_PROVISIONING = "beginProvisioning"
    RECORD_SANDBOX = "recordSandbox"
    ACTIVATE = "activate"
    REQUEST_CLEANUP = "requestCleanup"
    BEGIN_CLEANUP = "beginCleanup"
    RECORD_RETRY = "recordRetry"
    MARK_DELETED = "markDeleted"
    QUARANTINE = "quarantine"


class SafeErrorCode(str, Enum):
    PROVIDER_UNAVAILABLE = "provider_unavailable"
    PROVIDER_CONFLICT = "provider_conflict"
    PERSISTENCE_FAILED = "persistence_failed"
    SANDBOX_DELETE_FAILED = "sandbox_delete_failed"
    SECRET_DELETE_FAILED = "secret_delete_failed"
    OWNERSHIP_AMBIGUOUS = "ownership_ambiguous"
    INVALID_PROVIDER_RESPONSE = "invalid_provider_response"


def normalize_exact_host(value: str) -> str:
    import ipaddress

    host = value.strip()
    if (
        not host
        or host != value
        or any(token in host for token in ("://", "/", "@", "*", "#", "?", ":"))
    ):
        raise LeaseInvalid("invalid_allowed_host")
    try:
        normalized = host.encode("idna").decode("ascii").lower()
    except UnicodeError as exc:
        raise LeaseInvalid("invalid_allowed_host") from exc
    if normalized == "localhost" or normalized.endswith(".localhost"):
        raise LeaseInvalid("prohibited_allowed_host")
    try:
        address = ipaddress.ip_address(normalized)
    except ValueError:
        address = None
    if address and (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    ):
        raise LeaseInvalid("prohibited_allowed_host")
    labels = normalized.split(".")
    if len(normalized) > 253 or any(not label or len(label) > 63 for label in labels):
        raise LeaseInvalid("invalid_allowed_host")
    return normalized
