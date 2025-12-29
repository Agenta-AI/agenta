from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse

from oss.src.apis.fastapi.auth.models import (
    DiscoverRequest,
    DiscoverResponse,
)
from oss.src.core.auth.service import AuthService
from oss.src.utils.common import is_ee


auth_router = APIRouter()
auth_service = AuthService()


@auth_router.post("/discover", response_model=DiscoverResponse)
async def discover(request: DiscoverRequest):
    """
    Discover authentication methods available for a given email.

    This endpoint does NOT reveal:
    - Organization names
    - User existence (optionally - currently does for UX)
    - Detailed policy information

    Returns minimal information needed for authentication flow.
    """
    try:
        result = await auth_service.discover(request.email)
        return DiscoverResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@auth_router.get("/authorize/oidc")
async def oidc_authorize(provider_id: str, redirect: str = "/"):
    """
    Initiate OIDC/SSO authorization flow using SuperTokens third-party recipe (EE only).

    Query params:
    - provider_id: UUID of the organization_providers entry
    - redirect: Where to redirect after successful authentication (stored in state)

    This endpoint redirects to SuperTokens third-party signinup with:
    - third_party_id: "oidc:{org_id}:{provider_slug}"
    - redirect_uri: Frontend URL after authentication

    SuperTokens will handle:
    1. Building OIDC authorization URL (via our get_dynamic_oidc_provider)
    2. Redirecting user to IdP
    3. Handling callback at /auth/callback/oidc/{thirdPartyId}
    4. Creating session with identities (via our overrides)
    5. Redirecting to frontend
    """
    if not is_ee():
        raise HTTPException(
            status_code=404,
            detail="SSO/OIDC is only available in Enterprise Edition",
        )

    try:
        # Get provider to build third_party_id
        from uuid import UUID
        from oss.src.dbs.postgres.organizations.dao import OrganizationProvidersDAO

        providers_dao = OrganizationProvidersDAO()
        provider = await providers_dao.get_by_id(UUID(provider_id))

        if not provider or not (provider.flags and provider.flags.get("is_active")):
            raise HTTPException(
                status_code=404, detail="Provider not found or disabled"
            )

        # Build third_party_id for SuperTokens
        # Format: "oidc:{org_id}:{provider_slug}"
        third_party_id = f"oidc:{provider.organization_id}:{provider.slug}"

        # Redirect to SuperTokens third-party signin
        # SuperTokens will use our get_dynamic_oidc_provider to fetch config
        supertokens_url = (
            f"/auth/signinup?thirdPartyId={third_party_id}&redirectToPath={redirect}"
        )

        return RedirectResponse(url=supertokens_url, status_code=302)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Note: OIDC callback is handled by SuperTokens automatically
# The callback URL is: /auth/callback/oidc/{thirdPartyId}
# SuperTokens will:
# 1. Exchange code for tokens (using our dynamic provider config)
# 2. Get user info
# 3. Call our sign_in_up override (creates user_identity, adds identities to session)
# 4. Redirect to frontend with session cookie
