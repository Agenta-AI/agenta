from pydantic import BaseModel, EmailStr
from typing import Optional, List, Dict


# ============================================================================
# AUTH DISCOVER
# ============================================================================


class DiscoverRequest(BaseModel):
    email: EmailStr


class SSOProviderInfo(BaseModel):
    id: str
    slug: str
    third_party_id: str


class SSOProviders(BaseModel):
    providers: List[SSOProviderInfo]


class DiscoverResponse(BaseModel):
    exists: bool
    methods: Dict[str, bool | SSOProviders]


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
