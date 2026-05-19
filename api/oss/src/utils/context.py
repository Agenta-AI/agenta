from contextvars import ContextVar, Token
from datetime import datetime
from typing import Literal, Optional, Union
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Auth context
#
# Set once by the auth middleware on every authenticated tenant request,
# then read anywhere downstream (handlers, services, background tasks
# spawned via asyncio.create_task) via the typed getters below.
#
# `AuthContext` represents a tenant-bound caller — ApiKey or Secret
# credentials, always with a fully-populated `AuthScope`. The admin/Access
# path is intentionally NOT represented here: it carries no tenant, lives
# on `request.state.admin`, and never calls into entitlements or other
# scope-aware code.
#
# Callers should NOT pass `Request` past the middleware boundary just to
# read these values.
# ---------------------------------------------------------------------------


class AuthError(Exception):
    """Base class for auth-context errors."""


class AuthContextMissing(AuthError):
    """Raised when the auth context is read outside an authenticated tenant
    request (e.g. middleware not configured, admin/Access endpoint, public
    endpoint, background task without explicit setup, or sync threadpool
    offload that did not propagate the ContextVar)."""


class AuthScope(BaseModel):
    model_config = ConfigDict(frozen=True)

    organization_id: UUID
    workspace_id: UUID
    project_id: UUID
    user_id: UUID


# Authorization header scheme prefixes — keep aligned with auth_service.
_APIKEY_PREFIX = "ApiKey "
_SECRET_PREFIX = "Secret "


class ApiKeyCredentials(BaseModel):
    model_config = ConfigDict(frozen=True)

    kind: Literal["apikey"] = "apikey"
    value: str

    def header(self) -> tuple[str, str]:
        return ("Authorization", f"{_APIKEY_PREFIX}{self.value}")


class SecretCredentials(BaseModel):
    """JWT credentials minted upstream by the auth middleware (on
    cookie-authenticated bearer flows) and threaded through as a string.
    See `verify_bearer_token` in auth_service.py — the JWT is signed at
    auth time with `_SECRET_EXP` (15 min) and re-used until it expires."""

    model_config = ConfigDict(frozen=True)

    kind: Literal["secret"] = "secret"
    value: str

    def header(self) -> tuple[str, str]:
        return ("Authorization", f"{_SECRET_PREFIX}{self.value}")


Credentials = Union[ApiKeyCredentials, SecretCredentials]


def parse_credentials(header_value: str) -> Credentials:
    """Build the right `Credentials` variant from an Authorization header
    value (or the cached `request.state.credentials` string, which has the
    same shape: `"<Scheme> <token>"`).

    Admin/Access tokens are intentionally NOT supported here — they don't
    represent a tenant-bound caller and don't belong in `AuthContext`.
    """
    if header_value.startswith(_APIKEY_PREFIX):
        return ApiKeyCredentials(value=header_value[len(_APIKEY_PREFIX) :])
    if header_value.startswith(_SECRET_PREFIX):
        return SecretCredentials(value=header_value[len(_SECRET_PREFIX) :])
    raise AuthError(
        f"unrecognized credentials scheme: {header_value.split(' ', 1)[0]!r}"
    )


class AuthContext(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True, frozen=True)

    # Discriminated on `kind` — Pydantic picks the right variant when
    # the context is reconstructed from a dict (rare, but free).
    credentials: Credentials = Field(discriminator="kind")
    scope: AuthScope


_auth_context_ctx: ContextVar[Optional[AuthContext]] = ContextVar(
    "auth_context", default=None
)


def set_auth_context(ctx: AuthContext) -> Token:
    """Set the auth context for the current async task.

    Returns a Token that MUST be passed to `reset_auth_context()` in a
    finally block — otherwise the value leaks into the next request served
    by the same event-loop task.
    """
    return _auth_context_ctx.set(ctx)


def reset_auth_context(token: Token) -> None:
    _auth_context_ctx.reset(token)


def get_auth_context() -> AuthContext:
    """Return the active auth context. Raises `AuthContextMissing` if none
    is set — callers running inside an authenticated tenant request should
    never see this; if they do, it indicates the middleware was bypassed,
    the endpoint is admin/Access (no tenant), or a threadpool offload
    dropped the ContextVar."""
    ctx = _auth_context_ctx.get()
    if ctx is None:
        raise AuthContextMissing(
            "auth context not set — middleware not configured, admin/Access "
            "endpoint, or ContextVar dropped (e.g. threadpool offload "
            "without propagation)"
        )
    return ctx


def get_auth_credentials() -> Credentials:
    return get_auth_context().credentials


def get_auth_scope() -> AuthScope:
    return get_auth_context().scope


class Support(BaseModel):
    support_id: Optional[str] = None
    support_ts: Optional[datetime] = None


support_ctx: ContextVar[Optional[Support]] = ContextVar("support", default=None)
