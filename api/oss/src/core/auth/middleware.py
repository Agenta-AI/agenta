"""Organization policy enforcement middleware (EE)."""

from typing import Optional, Callable, List
from uuid import UUID
from fastapi import Request, Response, HTTPException
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from supertokens_python.recipe.session import SessionContainer
from supertokens_python.recipe.session.framework.fastapi import verify_session

from oss.src.core.auth.types import MethodKind
from oss.src.utils.common import is_ee

# Note: This middleware requires EE organization tables
# Organization policy enforcement is only available in EE
if is_ee():
    from oss.src.dbs.postgres.organizations.dao import OrganizationPoliciesDAO

    policies_dao = OrganizationPoliciesDAO()
else:
    policies_dao = None


def matches_policy(identities: List[str], allowed_methods: List[str]) -> bool:
    """
    Check if user's identities satisfy the organization's allowed_methods policy.

    Supports wildcards defined in MethodKind:
    - "email:*" matches "email:otp", "email:password"
    - "social:*" matches "social:google", "social:github"
    - "sso:*" matches any SSO provider
    - "sso:acme:*" matches any provider for organization 'acme'

    Args:
        identities: List of authentication methods used by user (from session)
        allowed_methods: List of MethodKind patterns allowed by organization policy

    Returns:
        True if any identity matches any allowed method pattern

    Examples:
        identities = ["email:otp", "social:google"]
        allowed_methods = ["email:*", "social:*"]
        → True

        identities = ["email:otp"]
        allowed_methods = ["sso:*"]
        → False

        identities = ["sso:acme:okta"]
        allowed_methods = ["sso:acme:*"]
        → True
    """
    for identity in identities:
        for allowed in allowed_methods:
            if MethodKind.matches_pattern(identity, allowed):
                return True

    return False


async def check_organization_policy(
    session: SessionContainer,
    organization_id: UUID,
) -> Optional[dict]:
    """
    Check if user's session satisfies organization policy.

    Returns:
        None if policy satisfied
        Dict with error details if upgrade required
    """
    # Get session identities
    payload = session.get_access_token_payload()
    identities = payload.get("identities", [])

    # Get user ID and check membership
    user_id = session.get_user_id()

    # TODO: Check if user is a member of organization
    # For now, assume they are
    is_member = True

    if not is_member:
        return {
            "error": "NOT_A_MEMBER",
            "message": "You are not a member of this organization",
        }

    # Get organization policy
    policy = await policies_dao.get_by_organization(organization_id)

    if not policy:
        # No policy means no restrictions
        return None

    # Check for root bypass
    # TODO: Check if user role is 'owner' and disable_root is False
    # For now, skip this check

    # Check if identities satisfy allowed_methods
    if not matches_policy(identities, policy.allowed_methods):
        return {
            "error": "AUTH_UPGRADE_REQUIRED",
            "message": "Additional authentication required",
            "required_methods": policy.allowed_methods,
            "current_identities": identities,
        }

    return None


class OrganizationPolicyMiddleware(BaseHTTPMiddleware):
    """
    Middleware to enforce organization authentication policies (EE).

    Applies to routes that specify an organization_id (via query param or path).
    Only active when EE features are enabled.
    """

    async def dispatch(
        self, request: Request, call_next: Callable
    ) -> Response:
        # Skip if EE not enabled
        if not is_ee():
            return await call_next(request)

        # Skip auth routes
        if request.url.path.startswith("/auth"):
            return await call_next(request)

        # Skip non-org routes
        # Check if organization_id is in query params
        organization_id_str = request.query_params.get("organization_id")

        if not organization_id_str:
            # No organization context, skip policy check
            return await call_next(request)

        try:
            organization_id = UUID(organization_id_str)
        except ValueError:
            return JSONResponse(
                status_code=400,
                content={"error": "Invalid organization_id"},
            )

        # Verify session
        try:
            session = await verify_session(request)
        except Exception:
            return JSONResponse(
                status_code=401,
                content={"error": "Unauthorized", "message": "No valid session"},
            )

        # Check organization policy
        policy_error = await check_organization_policy(session, organization_id)

        if policy_error:
            return JSONResponse(
                status_code=403,
                content=policy_error,
            )

        # Policy satisfied, continue
        return await call_next(request)
