from pydantic import BaseModel
from typing import Optional, List, Dict


# ============================================================================
# AUTH DISCOVER
# ============================================================================


class DiscoverRequest(BaseModel):
    email: str


class SSOProviderInfo(BaseModel):
    slug: str
    name: str
    recommended: bool


class SSOMethodInfo(BaseModel):
    available: bool
    required_by_some_orgs: bool
    providers: List[SSOProviderInfo]


class DiscoverResponse(BaseModel):
    user_exists: bool
    primary_method: Optional[str]
    methods: Dict[str, bool | SSOMethodInfo]


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
