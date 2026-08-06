from pydantic import BaseModel, EmailStr
from typing import Optional

from oss.src.core.auth.dtos import (
    DiscoverResponse,
    SSOProviderInfo,
    SSOProviders,
)

__all__ = [
    "DiscoverRequest",
    "DiscoverResponse",
    "SSOProviderInfo",
    "SSOProviders",
    "OIDCAuthorizeRequest",
    "OIDCCallbackRequest",
]


# ============================================================================
# AUTH DISCOVER
# ============================================================================


class DiscoverRequest(BaseModel):
    email: EmailStr


# ============================================================================
# OIDC AUTHORIZE
# ============================================================================


class OIDCAuthorizeRequest(BaseModel):
    provider_id: str
    redirect: Optional[str] = "/"


# ============================================================================
# OIDC CALLBACK
# ============================================================================


class OIDCCallbackRequest(BaseModel):
    code: str
    state: str
