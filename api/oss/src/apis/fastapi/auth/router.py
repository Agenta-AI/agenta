from uuid import UUID

from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

from supertokens_python.recipe.session.asyncio import get_session
from supertokens_python.asyncio import get_user as get_supertokens_user_by_id

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger

from oss.src.apis.fastapi.auth.models import DiscoverRequest, DiscoverResponse
from oss.src.core.auth.service import AuthService
from oss.src.services import db_manager

if is_ee():
    from ee.src.dbs.postgres.organizations.dao import OrganizationProvidersDAO


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
        log.error("[DISCOVERY]", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@auth_router.get("/access")
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
        user_uid = session.get_user_id()

        # Get SuperTokens user info to extract email
        # This handles AUTH_UPGRADE case where user has multiple ST UIDs
        user_info = await get_supertokens_user_by_id(user_uid)
        if not user_info or not user_info.emails:
            log.warning(
                "[AUTH] [ACCESS] SuperTokens user has no email user_id=%s organization_id=%s",
                user_uid,
                organization_id,
            )
            raise HTTPException(status_code=401, detail="Unauthorized")

        user_email = user_info.emails[0]

        # Look up internal user by email (not UID) to handle AUTH_UPGRADE
        user = await db_manager.get_user_with_email(email=user_email)
        if not user:
            log.warning(
                "[AUTH] [ACCESS] user not found email=%s organization_id=%s session_identities=%s",
                user_email,
                organization_id,
                session_identities,
            )
            raise HTTPException(status_code=401, detail="Unauthorized")

        user_id = UUID(str(user.id))
        org_id = UUID(organization_id)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid organization_id")

    policy_error = await auth_service.check_organization_access(
        user_id, org_id, session_identities
    )

    if policy_error and policy_error.get("error") in {
        "AUTH_UPGRADE_REQUIRED",
        "AUTH_SSO_DENIED",
        "AUTH_DOMAIN_DENIED",
    }:
        detail = {
            "error": policy_error.get("error"),
            "message": policy_error.get("message"),
            "required_methods": policy_error.get("required_methods", []),
            "session_identities": session_identities,
            "user_identities": user_identities,
            "sso_providers": policy_error.get("sso_providers", []),
            "current_domain": policy_error.get("current_domain"),
            "allowed_domains": policy_error.get("allowed_domains", []),
        }
        raise HTTPException(status_code=403, detail=detail)

    return {"ok": True}


@auth_router.patch("/session/identities")
async def update_session_identities(request: Request, payload: SessionIdentitiesUpdate):
    try:
        session = await get_session(request)  # type: ignore
    except Exception:
        raise HTTPException(status_code=401, detail="Unauthorized")

    access_payload = session.get_access_token_payload() if session else {}
    current = access_payload.get("session_identities") or []
    merged = list(dict.fromkeys(current + payload.session_identities))

    if hasattr(session, "update_access_token_payload"):
        access_payload["session_identities"] = merged
        await session.update_access_token_payload(access_payload)
    elif hasattr(session, "merge_into_access_token_payload"):
        await session.merge_into_access_token_payload({"session_identities": merged})
    else:
        raise HTTPException(
            status_code=500, detail="Session payload update not supported"
        )
    return {"session_identities": merged, "previous": current}


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
            detail="SSO/OIDC is only available in EE",
        )

    try:
        # Validate organization exists
        organization = await db_manager.get_organization_by_slug(organization_slug)
        if not organization:
            raise HTTPException(
                status_code=404,
                detail=f"Organization '{organization_slug}' not found",
            )

        # Validate provider exists and is active
        providers_dao = OrganizationProvidersDAO()
        provider = await providers_dao.get_by_slug(
            slug=provider_slug, organization_id=str(organization.id)
        )

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
