"""Authentication and authorization service.

This service provides three main capabilities:
1. Discovery: Determine available authentication methods for a user
2. Authentication: Support authentication flows (via SuperTokens + helpers)
3. Authorization: Validate user access based on organization policies
"""

from typing import Optional, Dict, List, Any
from uuid import UUID

from oss.src.utils.common import is_ee
from oss.src.dbs.postgres.users.dao import IdentitiesDAO
from oss.src.services import db_manager

# Organization DAOs (EE only)
if is_ee():
    from oss.src.dbs.postgres.organizations.dao import (
        OrganizationPoliciesDAO,
        OrganizationDomainsDAO,
        OrganizationProvidersDAO,
    )


class AuthService:
    """
    Centralized authentication and authorization service.

    Note: Actual authentication flows are handled by SuperTokens recipes.
    This service provides supporting logic for discovery, validation, and policy enforcement.
    """

    def __init__(self):
        self.identities_dao = IdentitiesDAO()

        # Initialize EE DAOs if available
        if is_ee():
            self.policies_dao = OrganizationPoliciesDAO()
            self.domains_dao = OrganizationDomainsDAO()
            self.providers_dao = OrganizationProvidersDAO()
        else:
            self.policies_dao = None
            self.domains_dao = None
            self.providers_dao = None

    # ============================================================================
    # DISCOVERY: Determine available authentication methods
    # ============================================================================

    async def discover(self, email: str) -> Dict[str, Any]:
        """
        Discover authentication methods available for a given email.

        This is the pre-authentication discovery endpoint that helps the frontend
        determine which auth flows to present to the user.

        Returns Format C:
        {
            "user_exists": bool,
            "primary_method": str | null,
            "methods": {
                "email:otp": bool,
                "social:google": bool,
                "social:github": bool,
                "sso": {
                    "available": bool,
                    "required_by_some_orgs": bool,
                    "providers": [
                        {"slug": "okta", "name": "ACME SSO", "recommended": bool}
                    ]
                }
            }
        }
        """
        # Extract domain from email
        domain = email.split("@")[1] if "@" in email else None

        # Check if user exists
        user = await db_manager.get_user_with_email(email)
        user_exists = user is not None
        user_id = UUID(str(user.id)) if user else None

        # Get user's organization memberships
        org_ids: List[UUID] = []
        if user_exists and user_id:
            try:
                orgs = await db_manager.get_user_organizations(str(user_id))
                org_ids = [org.id for org in orgs]
            except Exception as e:
                # Log error but don't block discovery
                print(f"Error fetching user organizations: {e}")
                org_ids = []

        # Aggregate allowed methods across all organizations (EE only)
        all_allowed_methods: set[str] = set()
        sso_required_by_some = False

        if is_ee() and self.policies_dao:
            for org_id in org_ids:
                policy = await self.policies_dao.get_by_organization(org_id)
                if policy:
                    all_allowed_methods.update(policy.allowed_methods)
                    # Check if SSO is required (only SSO methods allowed)
                    if policy.allowed_methods and all(
                        m.startswith("sso:") for m in policy.allowed_methods
                    ):
                        sso_required_by_some = True

        # If user has no organizations, show globally configured auth methods
        if not all_allowed_methods:
            from oss.src.utils.env import env

            # Check what's actually enabled in the SuperTokens configuration
            if env.auth.email_method == "password":
                all_allowed_methods.add("email:password")
            elif env.auth.email_method == "otp":
                all_allowed_methods.add("email:otp")

            if env.auth.google_enabled:
                all_allowed_methods.add("social:google")

            if env.auth.github_enabled:
                all_allowed_methods.add("social:github")

        # Get SSO providers for the domain (EE only)
        sso_providers = []
        if is_ee() and domain and self.domains_dao and self.providers_dao:
            domain_dto = await self.domains_dao.get_by_domain(domain)
            if domain_dto and domain_dto.verified:
                providers = await self.providers_dao.list_by_domain(
                    domain_dto.id, enabled_only=True
                )
                sso_providers = [
                    {
                        "slug": p.slug,
                        "name": p.name,
                        "recommended": True,  # All domain-matched providers are recommended
                    }
                    for p in providers
                ]

        # Build response
        primary_method = None
        if sso_providers:
            primary_method = "sso"
        elif "email:password" in all_allowed_methods:
            primary_method = "email:password"
        elif "email:otp" in all_allowed_methods:
            primary_method = "email:otp"
        elif any(m.startswith("social:") for m in all_allowed_methods):
            primary_method = "social"

        # Build SSO response - nested object if available, otherwise false
        sso_available = bool(sso_providers) or any(
            m.startswith("sso:") for m in all_allowed_methods
        )

        if sso_available and sso_providers:
            sso_response = {
                "available": True,
                "required_by_some_orgs": sso_required_by_some,
                "providers": sso_providers,
            }
        else:
            sso_response = False

        return {
            "user_exists": user_exists,
            "primary_method": primary_method,
            "methods": {
                "email:password": "email:password" in all_allowed_methods
                or "email:*" in all_allowed_methods,
                "email:otp": "email:otp" in all_allowed_methods
                or "email:*" in all_allowed_methods,
                "social:google": "social:google" in all_allowed_methods
                or "social:*" in all_allowed_methods,
                "social:github": "social:github" in all_allowed_methods
                or "social:*" in all_allowed_methods,
                "sso": sso_response,
            },
        }

    # ============================================================================
    # AUTHENTICATION: Support authentication flows
    # ============================================================================
    # Note: Actual authentication is handled by SuperTokens recipes.
    # See supertokens_overrides.py for:
    # - Dynamic OIDC provider configuration (get_dynamic_oidc_provider)
    # - Post-authentication hooks (sign_in_up override)
    # - Session creation with identities (create_new_session override)

    async def get_user_identities(self, user_id: UUID) -> List[str]:
        """
        Get all authentication methods (identities) for a user.

        Returns list of method strings like:
        - ["email:otp", "social:google", "sso:acme:okta"]

        Used to populate session payload and for policy validation.
        """
        identities = await self.identities_dao.list_by_user(user_id)
        return [identity.method for identity in identities]

    async def validate_provider_access(
        self, provider_id: UUID, email: Optional[str] = None
    ) -> bool:
        """
        Validate if a user can access a given SSO provider (EE only).

        Checks:
        1. Provider exists and is enabled
        2. If provider has domain restriction, user's email domain matches

        Args:
            provider_id: UUID of the organization_providers entry
            email: User's email (optional, for domain validation)

        Returns:
            True if user can access this provider
        """
        if not is_ee() or not self.providers_dao:
            return False

        provider = await self.providers_dao.get_by_id(provider_id)

        if not provider or not provider.enabled:
            return False

        # If provider has domain restriction, validate email domain
        if provider.domain_id and email and self.domains_dao:
            domain = email.split("@")[1] if "@" in email else None
            if not domain:
                return False

            # Get domain and check if it matches
            domain_dto = await self.domains_dao.get_by_id(provider.domain_id)
            if not domain_dto or not domain_dto.verified:
                return False

            if domain_dto.domain != domain:
                return False

        return True

    # ============================================================================
    # AUTHORIZATION: Validate access based on policies
    # ============================================================================

    async def check_organization_access(
        self, user_id: UUID, organization_id: UUID, identities: List[str]
    ) -> Optional[Dict[str, Any]]:
        """
        Check if user's identities satisfy organization policy (EE only).

        This is the core authorization logic used by the middleware.

        Args:
            user_id: User's UUID
            organization_id: Organization's UUID
            identities: List of authentication methods from session

        Returns:
            None if access allowed
            Dict with error details if access denied

        Possible error responses:
        - NOT_A_MEMBER: User is not a member of the organization
        - AUTH_UPGRADE_REQUIRED: User must authenticate with additional method
        """
        # If EE not enabled, allow access (no policy enforcement in OSS)
        if not is_ee() or not self.policies_dao:
            return None

        # TODO: Check if user is a member of organization
        # For now, assume they are
        is_member = True

        if not is_member:
            return {
                "error": "NOT_A_MEMBER",
                "message": "You are not a member of this organization",
            }

        # Get organization policy
        policy = await self.policies_dao.get_by_organization(organization_id)

        if not policy:
            # No policy means no restrictions
            return None

        # TODO: Check for root bypass
        # If user role is 'owner' and disable_root is False, bypass policy
        # For now, skip this check

        # Check if identities satisfy allowed_methods
        if not self._matches_policy(identities, policy.allowed_methods):
            return {
                "error": "AUTH_UPGRADE_REQUIRED",
                "message": "Additional authentication required",
                "required_methods": policy.allowed_methods,
                "current_identities": identities,
            }

        return None

    def _matches_policy(self, identities: List[str], allowed_methods: List[str]) -> bool:
        """
        Check if user's identities satisfy the allowed_methods policy.

        Supports wildcards:
        - "email:*" matches "email:otp", "email:password"
        - "social:*" matches "social:google", "social:github"
        - "sso:*" matches any SSO provider
        - "sso:acme:*" matches any provider for organization 'acme'

        This is the same logic as middleware.matches_policy().
        """
        for identity in identities:
            for allowed in allowed_methods:
                # Exact match
                if identity == allowed:
                    return True

                # Wildcard match
                if allowed.endswith(":*"):
                    prefix = allowed[:-2]  # Remove ":*"
                    if identity.startswith(f"{prefix}:"):
                        return True

        return False
