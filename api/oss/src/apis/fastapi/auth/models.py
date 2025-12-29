from pydantic import BaseModel, EmailStr
from typing import Optional, List, Dict


# ============================================================================
# AUTH DISCOVER
# ============================================================================


class DiscoverRequest(BaseModel):
    email: EmailStr


class SSOProviderInfo(BaseModel):
    slug: str
    name: str


class DiscoverResponse(BaseModel):
    exists: bool
    methods: Dict[str, bool | List[SSOProviderInfo]]


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
