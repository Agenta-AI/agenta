from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from supertokens_python.recipe.session.asyncio import get_session

from oss.src.apis.fastapi.auth.models import (
    DiscoverRequest,
    DiscoverResponse,
)
from oss.src.core.auth.service import AuthService
from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger


auth_router = APIRouter()
auth_service = AuthService()
log = get_module_logger(__name__)


class SessionIdentitiesUpdate(BaseModel):
    session_identities: list[str]


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
        import traceback

        print(f"❌ Discovery error: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@auth_router.get("/organization/access")
async def check_organization_access(request: Request, organization_id: str):
    """
    Check if the current session satisfies the organization's auth policy.

    Returns 200 when access is allowed, 403 with AUTH_UPGRADE_REQUIRED when not.
    """
    try:
        session = await get_session(request)  # type: ignore
    except Exception:
        raise HTTPException(status_code=401, detail="Unauthorized")

    payload = session.get_access_token_payload() if session else {}
    session_identities = payload.get("session_identities") or []
    user_identities = payload.get("user_identities", [])

    try:
        from uuid import UUID

        user_id = UUID(session.get_user_id())
        org_id = UUID(organization_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid organization_id")

    policy_error = await auth_service.check_organization_access(
        user_id, org_id, session_identities
    )

    if policy_error and policy_error.get("error") in {
        "AUTH_UPGRADE_REQUIRED",
        "AUTH_SSO_DISABLED",
    }:
        detail = {
            "error": policy_error.get("error"),
            "message": policy_error.get("message"),
            "required_methods": policy_error.get("required_methods", []),
            "session_identities": session_identities,
            "user_identities": user_identities,
            "sso_providers": policy_error.get("sso_providers", []),
        }
        raise HTTPException(status_code=403, detail=detail)

    return {"ok": True}


@auth_router.post("/session/identities")
async def update_session_identities(
    request: Request, payload: SessionIdentitiesUpdate
):
    try:
        session = await get_session(request)  # type: ignore
    except Exception:
        raise HTTPException(status_code=401, detail="Unauthorized")

    access_payload = session.get_access_token_payload() if session else {}
    current = access_payload.get("session_identities") or []
    merged = list(dict.fromkeys(current + payload.session_identities))
    log.debug(
        "[AUTH-IDENTITY] session_identities update",
        {
            "user_id": session.get_user_id() if session else None,
            "current": current,
            "incoming": payload.session_identities,
            "merged": merged,
        },
    )

    if hasattr(session, "update_access_token_payload"):
        access_payload["session_identities"] = merged
        await session.update_access_token_payload(access_payload)
    elif hasattr(session, "merge_into_access_token_payload"):
        await session.merge_into_access_token_payload({"session_identities": merged})
    else:
        raise HTTPException(status_code=500, detail="Session payload update not supported")
    return {"session_identities": merged, "previous": current}


@auth_router.get("/authorize/oidc")
async def oidc_authorize(request: Request, provider_id: str, redirect: str = "/"):
    """
    Initiate OIDC/SSO authorization flow using SuperTokens third-party recipe (EE only).

    Query params:
    - provider_id: UUID of the organization_providers entry
    - redirect: Where to redirect after successful authentication (stored in state)

    This endpoint redirects to SuperTokens third-party signinup with:
    - third_party_id: "sso:{organization_slug}:{provider_slug}"
    - redirect_uri: Frontend URL after authentication

    SuperTokens will handle:
    1. Building OIDC authorization URL (via our get_dynamic_oidc_provider)
    2. Redirecting user to IdP
    3. Handling callback at /auth/callback/sso:{organization_slug}:{provider_slug}
    4. Creating session with user_identities (via our overrides)
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
        import httpx

        from oss.src.utils.env import env
        from oss.src.utils.helpers import parse_url

        providers_dao = OrganizationProvidersDAO()
        provider = await providers_dao.get_by_id_any(str(provider_id))

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
        # Format: "sso:{organization_slug}:{provider_slug}"
        third_party_id = f"sso:{organization.slug}:{provider.slug}"

        callback_url = (
            f"{env.agenta.web_url.rstrip('/')}/auth/callback/{third_party_id}"
        )
        print(f"[OIDC-AUTH] Expected redirect URI: {callback_url}")
        api_url = parse_url(env.agenta.api_url)
        request_base_url = str(request.base_url).rstrip("/")

        authorisation_urls = [
            f"{request_base_url}/auth/authorisationurl",
            f"{api_url}/auth/authorisationurl",
        ]

        print(
            "[OIDC-AUTH] Request context: "
            f"request_url={request.url} base_url={request_base_url} api_url={api_url} "
            f"candidates={authorisation_urls}"
        )

        response = None
        async with httpx.AsyncClient(timeout=10.0) as client:
            for candidate in authorisation_urls:
                print(
                    f"[OIDC-AUTH] Resolving auth URL. third_party_id={third_party_id} "
                    f"authorisation_url={candidate} callback_url={callback_url}"
                )
                try:
                    response = await client.get(
                        candidate,
                        params={
                            "thirdPartyId": third_party_id,
                            "redirectURIOnProviderDashboard": callback_url,
                        },
                    )
                except Exception as exc:
                    print(f"[OIDC-AUTH] Request failed for {candidate}: {exc}")
                    continue
                content_type = response.headers.get("content-type", "")
                print(
                    f"[OIDC-AUTH] SuperTokens response status={response.status_code} "
                    f"content_type={content_type} body={response.text}"
                )
                if response.status_code == 200 and "application/json" in content_type:
                    break

        if not response or response.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail="Failed to fetch authorization URL from auth provider.",
            )

        data = response.json()
        redirect_url = data.get("urlWithQueryParams") or data.get("url")
        if not redirect_url:
            raise HTTPException(
                status_code=502,
                detail="Auth provider response missing authorization URL.",
            )

        return RedirectResponse(url=redirect_url, status_code=302)

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
    3. Builds SuperTokens thirdPartyId: sso:{organization_slug}:{provider_slug}
    4. Redirects to SuperTokens callback: /auth/callback/{thirdPartyId}

    SuperTokens then handles:
    1. Exchange code for tokens (using our dynamic provider config)
    2. Get user info
    3. Call our sign_in_up override (creates user_identity, adds user_identities to session)
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
        third_party_id = f"sso:{organization.slug}:{provider.slug}"

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


# Note: Final SSO callback is handled by SuperTokens at /auth/callback/{thirdPartyId}
# After our custom endpoint redirects to it with the code and state parameters
