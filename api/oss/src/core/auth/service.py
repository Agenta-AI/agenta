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
from sqlalchemy import select

# Organization DAOs and models (EE only)
if is_ee():
    from ee.src.dbs.postgres.organizations.dao import (
        OrganizationDomainsDAO,
        OrganizationProvidersDAO,
    )
    from oss.src.models.db_models import OrganizationDB
    from ee.src.models.db_models import OrganizationMemberDB


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
            self.domains_dao = OrganizationDomainsDAO()
            self.providers_dao = OrganizationProvidersDAO()
        else:
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

        Response format:
        {
            "exists": bool,  # Whether user account exists
            "methods": {
                "email:password": true,  # Only present if available
                "email:otp": true,       # Only present if available
                "social:google": true,   # Only present if available
                "social:github": true,   # Only present if available
                "sso": [                 # Only present if SSO available
                    {"slug": "okta", "name": "ACME SSO"}
                ]
            }
        }

        Note: Only methods that are available (true) are included in the response.
        Missing methods should be assumed false on the client side.
        """
        # Extract domain from email (if provided)
        domain = email.split("@")[1] if email and "@" in email else None

        # Check if user exists only when email looks valid
        user = None
        user_exists = False
        user_id = None
        if email and "@" in email:
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

        if is_ee() and org_ids:
            # Check policy flags for each organization
            for org_id in org_ids:
                org_flags = await self._get_organization_flags(org_id)
                if org_flags:
                    # Convert boolean flags to method strings
                    # Default to True if not explicitly set
                    if org_flags.get("allow_email", True):
                        all_allowed_methods.add("email:*")
                    if org_flags.get("allow_social", True):
                        all_allowed_methods.add("social:*")
                    if org_flags.get("allow_sso", True):
                        all_allowed_methods.add("sso:*")

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

            if env.auth.google_workspaces_enabled:
                all_allowed_methods.add("social:google-workspaces")

            if env.auth.github_enabled:
                all_allowed_methods.add("social:github")

            if env.auth.facebook_enabled:
                all_allowed_methods.add("social:facebook")

            if env.auth.apple_enabled:
                all_allowed_methods.add("social:apple")

            if env.auth.discord_enabled:
                all_allowed_methods.add("social:discord")

            if env.auth.twitter_enabled:
                all_allowed_methods.add("social:twitter")

            if env.auth.gitlab_enabled:
                all_allowed_methods.add("social:gitlab")

            if env.auth.bitbucket_enabled:
                all_allowed_methods.add("social:bitbucket")

            if env.auth.linkedin_enabled:
                all_allowed_methods.add("social:linkedin")

            if env.auth.okta_enabled:
                all_allowed_methods.add("social:okta")

            if env.auth.azure_ad_enabled:
                all_allowed_methods.add("social:azure-ad")

            if env.auth.boxy_saml_enabled:
                all_allowed_methods.add("social:boxy-saml")

        # Get SSO providers for the domain (EE only)
        sso_providers = []
        if is_ee() and domain and self.domains_dao and self.providers_dao:
            domain_dto = await self.domains_dao.get_by_slug(domain)
            if domain_dto and domain_dto.flags and domain_dto.flags.get("is_verified"):
                providers = await self.providers_dao.list_by_domain(
                    domain_dto.id, enabled_only=True
                )
                sso_providers = [
                    {
                        "slug": p.slug,
                        "name": p.name,
                    }
                    for p in providers
                ]

        # Build methods dict - only include methods that are true
        methods = {}

        # Email methods
        if "email:password" in all_allowed_methods or "email:*" in all_allowed_methods:
            methods["email:password"] = True
        if "email:otp" in all_allowed_methods or "email:*" in all_allowed_methods:
            methods["email:otp"] = True

        # Social methods
        if "social:google" in all_allowed_methods or "social:*" in all_allowed_methods:
            methods["social:google"] = True
        if "social:google-workspaces" in all_allowed_methods or "social:*" in all_allowed_methods:
            methods["social:google-workspaces"] = True
        if "social:github" in all_allowed_methods or "social:*" in all_allowed_methods:
            methods["social:github"] = True
        if "social:facebook" in all_allowed_methods or "social:*" in all_allowed_methods:
            methods["social:facebook"] = True
        if "social:apple" in all_allowed_methods or "social:*" in all_allowed_methods:
            methods["social:apple"] = True
        if "social:discord" in all_allowed_methods or "social:*" in all_allowed_methods:
            methods["social:discord"] = True
        if "social:twitter" in all_allowed_methods or "social:*" in all_allowed_methods:
            methods["social:twitter"] = True
        if "social:gitlab" in all_allowed_methods or "social:*" in all_allowed_methods:
            methods["social:gitlab"] = True
        if "social:bitbucket" in all_allowed_methods or "social:*" in all_allowed_methods:
            methods["social:bitbucket"] = True
        if "social:linkedin" in all_allowed_methods or "social:*" in all_allowed_methods:
            methods["social:linkedin"] = True
        if "social:okta" in all_allowed_methods or "social:*" in all_allowed_methods:
            methods["social:okta"] = True
        if "social:azure-ad" in all_allowed_methods or "social:*" in all_allowed_methods:
            methods["social:azure-ad"] = True
        if "social:boxy-saml" in all_allowed_methods or "social:*" in all_allowed_methods:
            methods["social:boxy-saml"] = True

        # SSO - only include if providers are available
        if sso_providers:
            methods["sso"] = sso_providers

        response = {
            "exists": user_exists,
            "methods": methods,
        }

        return response

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

        if not provider or not (provider.flags and provider.flags.get("is_active")):
            return False

        # Note: domain_id FK removed - SSO providers can handle multiple domains
        # Domain validation is now handled at discovery time, not provider validation time

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
        if not is_ee():
            return None

        # Note: We don't check membership here - that's the responsibility of route handlers
        # This function only validates authentication method policies

        # Get organization flags
        org_flags = await self._get_organization_flags(organization_id)

        if not org_flags:
            # No flags means no restrictions (default allow all)
            return None

        # Check for root bypass: if user is owner and allow_root is True, bypass policy
        is_owner = await self._is_organization_owner(user_id, organization_id)

        if is_owner and org_flags.get("allow_root", True):
            # Owner with root access bypasses policy
            return None

        # Build allowed methods from flags
        # Default to True if not explicitly set
        allowed_methods = []
        if org_flags.get("allow_email", True):
            allowed_methods.append("email:*")
        if org_flags.get("allow_social", True):
            allowed_methods.append("social:*")
        if org_flags.get("allow_sso", True):
            allowed_methods.append("sso:*")

        # If no methods are allowed, deny access
        if not allowed_methods:
            return {
                "error": "AUTH_UPGRADE_REQUIRED",
                "message": "No authentication methods are allowed for this organization",
                "required_methods": [],
                "current_identities": identities,
            }

        # Check if identities satisfy allowed_methods
        matches = self._matches_policy(identities, allowed_methods)

        if not matches:
            return {
                "error": "AUTH_UPGRADE_REQUIRED",
                "message": "Additional authentication required",
                "required_methods": allowed_methods,
                "current_identities": identities,
            }

        return None

    def _matches_policy(
        self, identities: List[str], allowed_methods: List[str]
    ) -> bool:
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

    async def _get_organization_flags(self, organization_id: UUID) -> Optional[Dict[str, Any]]:
        """
        Get organization flags from organizations table (EE only).

        Returns flags JSONB field or None if organization not found.
        """
        if not is_ee():
            return None

        async with db_manager.engine.core_session() as session:
            stmt = select(OrganizationDB.flags).where(OrganizationDB.id == organization_id)
            result = await session.execute(stmt)
            flags = result.scalar()
            return flags or {}

    async def _is_organization_member(
        self, user_id: UUID, organization_id: UUID
    ) -> bool:
        """
        Check if user is a member of the organization (EE only).
        """
        if not is_ee():
            return False

        async with db_manager.engine.core_session() as session:
            stmt = select(OrganizationMemberDB).where(
                OrganizationMemberDB.user_id == user_id,
                OrganizationMemberDB.organization_id == organization_id,
            )
            result = await session.execute(stmt)
            return result.scalar() is not None

    async def _is_organization_owner(
        self, user_id: UUID, organization_id: UUID
    ) -> bool:
        """
        Check if user is the owner of the organization (EE only).
        """
        if not is_ee():
            return False

        async with db_manager.engine.core_session() as session:
            stmt = select(OrganizationMemberDB.role).where(
                OrganizationMemberDB.user_id == user_id,
                OrganizationMemberDB.organization_id == organization_id,
            )
            result = await session.execute(stmt)
            role = result.scalar()
            return role == "owner"
