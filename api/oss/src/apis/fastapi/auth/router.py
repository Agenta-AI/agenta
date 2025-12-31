from fastapi import APIRouter, HTTPException, Request
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
    - third_party_id: "oidc:{organization_slug}:{provider_slug}"
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
        from ee.src.dbs.postgres.organizations.dao import OrganizationProvidersDAO

        providers_dao = OrganizationProvidersDAO()
        provider = await providers_dao.get_by_id(UUID(provider_id))

        if not provider or not (provider.flags and provider.flags.get("is_active")):
            raise HTTPException(
                status_code=404, detail="Provider not found or disabled"
            )

        from oss.src.services import db_manager

        organization = await db_manager.get_organization_by_id(
            str(provider.organization_id)
        )
        if not organization or not organization.slug:
            raise HTTPException(
                status_code=400,
                detail="Organization slug is required for SSO providers",
            )

        # Build third_party_id for SuperTokens
        # Format: "oidc:{organization_slug}:{provider_slug}"
        third_party_id = f"oidc:{organization.slug}:{provider.slug}"

        # Redirect to SuperTokens third-party signin
        # SuperTokens will use our get_dynamic_oidc_provider to fetch config
        supertokens_url = (
            f"/auth/signinup?thirdPartyId={third_party_id}&redirectToPath={redirect}"
        )

        return RedirectResponse(url=supertokens_url, status_code=302)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@auth_router.get("/sso/callback/{organization_slug}/{provider_slug}")
async def sso_callback_redirect(
    organization_slug: str, provider_slug: str, request: Request
):
    """
    Custom SSO callback endpoint that redirects to SuperTokens.

    This endpoint:
    1. Accepts clean URL path: /auth/sso/callback/{organization_slug}/{provider_slug}
    2. Validates the organization and provider exist
    3. Builds SuperTokens thirdPartyId: oidc:{organization_slug}:{provider_slug}
    4. Redirects to SuperTokens callback: /auth/callback/{thirdPartyId}

    SuperTokens then handles:
    1. Exchange code for tokens (using our dynamic provider config)
    2. Get user info
    3. Call our sign_in_up override (creates user_identity, adds identities to session)
    4. Redirect to frontend with session cookie
    """
    if not is_ee():
        raise HTTPException(
            status_code=404,
            detail="SSO/OIDC is only available in Enterprise Edition",
        )

    try:
        from ee.src.dbs.postgres.organizations.dao import OrganizationProvidersDAO
        from oss.src.services import db_manager

        # Validate organization exists
        organization = await db_manager.get_organization_by_slug(organization_slug)
        if not organization:
            raise HTTPException(
                status_code=404,
                detail=f"Organization '{organization_slug}' not found",
            )

        # Validate provider exists and is active
        providers_dao = OrganizationProvidersDAO()
        provider = await providers_dao.get_by_slug(provider_slug, str(organization.id))

        if not provider:
            raise HTTPException(
                status_code=404,
                detail=f"SSO provider '{provider_slug}' not found for organization '{organization_slug}'",
            )

        if not (provider.flags and provider.flags.get("is_active")):
            raise HTTPException(
                status_code=400,
                detail=f"SSO provider '{provider_slug}' is not active",
            )

        # Build thirdPartyId and redirect to SuperTokens callback
        third_party_id = f"oidc:{organization.slug}:{provider.slug}"

        # Get the original query parameters from the IdP callback (code, state, etc.)
        # SuperTokens expects them at /auth/callback/{thirdPartyId}?code=...&state=...
        query_params = request.query_params

        # Build SuperTokens callback URL with query params
        supertokens_callback_url = f"/auth/callback/{third_party_id}"
        if query_params:
            query_string = "&".join(f"{k}={v}" for k, v in query_params.items())
            supertokens_callback_url = f"{supertokens_callback_url}?{query_string}"

        return RedirectResponse(url=supertokens_callback_url, status_code=302)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Note: Final OIDC callback is handled by SuperTokens at /auth/callback/{thirdPartyId}
# After our custom endpoint redirects to it with the code and state parameters
