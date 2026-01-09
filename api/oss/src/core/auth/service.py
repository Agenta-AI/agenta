from typing import Optional, Dict, List, Any
from uuid import UUID

from sqlalchemy import select

from oss.src.utils.env import env
from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger

from oss.src.models.db_models import InvitationDB, ProjectDB, OrganizationDB
from oss.src.services import db_manager

from oss.src.dbs.postgres.shared.engine import engine
from oss.src.dbs.postgres.users.dao import IdentitiesDAO

if is_ee():
    from ee.src.models.db_models import OrganizationMemberDB

    from ee.src.dbs.postgres.organizations.dao import (
        OrganizationDomainsDAO,
        OrganizationProvidersDAO,
    )


log = get_module_logger(__name__)


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

        Logic:
        1. Check user's organization memberships and pending invitations
        2. Check for organizations with verified domains matching user's email
        3. For each relevant organization:
           - If org has verified domain + active SSO: enforce SSO-only
           - Otherwise: aggregate allowed methods from org policy flags
        4. SSO providers are shown if user has access to orgs with active SSO

        SSO Enforcement Rules:
        - SSO can ONLY be the sole auth method if org has BOTH:
          a) Verified domain matching user's email domain
          b) Active SSO provider configured
        - When SSO is enforced, email and social auth are not available

        Auto-join and Domain Restrictions (enforced at login, not discovery):
        - auto_join: User is auto-added to org on login if domain matches
        - domains_only: Only users with matching domain can access org

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

        # Get relevant organization IDs (EE only)
        # Include: memberships, pending invitations, and domain-based access
        org_ids: List[UUID] = []
        domain_org_ids: List[
            UUID
        ] = []  # Orgs with verified domain matching user's email

        if is_ee():
            # 1. User's existing memberships
            if user_exists and user_id:
                try:
                    orgs = await db_manager.get_user_organizations(str(user_id))
                    org_ids = [org.id for org in orgs]
                except Exception:
                    log.error(
                        "[DISCOVERY] Error fetching user organizations",
                        exc_info=True,
                    )
                    org_ids = []

            # 2. Organizations with pending project invitations
            if email:
                try:
                    async with engine.core_session() as session:
                        # Query project_invitations for this email, join with projects to get organization_id
                        stmt = (
                            select(ProjectDB.organization_id)
                            .join(InvitationDB, InvitationDB.project_id == ProjectDB.id)
                            .where(InvitationDB.email == email)
                            .where(~InvitationDB.used)
                            .distinct()
                        )
                        result = await session.execute(stmt)
                        invitation_org_ids = [row[0] for row in result.fetchall()]

                        # Add to org_ids if not already present
                        for invitation_org_id in invitation_org_ids:
                            if invitation_org_id not in org_ids:
                                org_ids.append(invitation_org_id)
                except Exception:
                    log.error(
                        "[DISCOVERY] Error fetching pending invitations",
                        exc_info=True,
                    )

            # 3. Organizations with verified domain matching user's email
            if domain and self.domains_dao:
                domain_dto = await self.domains_dao.get_verified_by_slug(domain)

                if domain_dto:
                    domain_org_ids.append(domain_dto.organization_id)

                    # Include in org_ids for policy aggregation
                    if domain_dto.organization_id not in org_ids:
                        org_ids.append(domain_dto.organization_id)

        # Aggregate allowed methods across all organizations (EE only)
        all_allowed_methods: set[str] = set()
        has_sso_enforcement = False  # Track if any org has SSO + verified domain

        if is_ee() and org_ids:
            # Check policy flags for each organization
            for org_id in org_ids:
                org_flags = await self._get_organization_flags(org_id)

                if org_flags:
                    # Check if this org has verified domain (enables SSO enforcement)
                    has_verified_domain = org_id in domain_org_ids

                    # Check if this org has active SSO providers
                    has_active_sso = False
                    if self.providers_dao:
                        providers = await self.providers_dao.list_by_organization(
                            str(org_id)
                        )

                        has_active_sso = any(
                            p.flags and p.flags.get("is_active", False)
                            for p in providers
                        )

                    # SSO enforcement: only SSO allowed if org has both verified domain + active SSO
                    if has_verified_domain and has_active_sso:
                        has_sso_enforcement = True
                        all_allowed_methods.add("sso:*")
                        # Skip adding email/social methods for this org
                        continue

                    # Otherwise, check normal policy flags
                    # Default to True if not explicitly set
                    if org_flags.get("allow_email", env.auth.email_enabled):
                        all_allowed_methods.add("email:*")
                    if org_flags.get("allow_social", env.auth.oidc_enabled):
                        all_allowed_methods.add("social:*")
                    if org_flags.get("allow_sso", False):
                        all_allowed_methods.add("sso:*")

        # If user has no organizations, show globally configured auth methods
        if not all_allowed_methods:
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

        # Get SSO providers (EE only)
        # Show SSO providers from user's organizations (if user exists and is a member)
        sso_providers = []

        if is_ee() and self.providers_dao and org_ids:
            provider_map = {}  # Use dict to deduplicate by slug

            # Get SSO providers from all user's organizations
            for org_id in org_ids:
                organization = await db_manager.get_organization_by_id(str(org_id))
                if not organization or not organization.slug:
                    continue

                providers = await self.providers_dao.list_by_organization(str(org_id))
                for p in providers:
                    is_active = p.flags and p.flags.get("is_active", False)
                    if is_active:
                        provider_map[p.slug] = {
                            "id": str(p.id),
                            "slug": p.slug,
                            "third_party_id": f"sso:{organization.slug}:{p.slug}",
                        }

            sso_providers = list(provider_map.values())

        # Build methods dict - only include methods that are true
        methods = {}

        # If SSO enforcement is active, ONLY return SSO methods
        if has_sso_enforcement:
            # SSO enforcement: only SSO providers, no email or social
            if sso_providers:
                methods["sso"] = {"providers": sso_providers}
            response = {
                "exists": user_exists,
                "methods": methods,
            }
            return response

        # Otherwise, include all allowed methods based on policy
        # Email methods - check both specific method and wildcard
        # But respect the configured email_method (only one can be active)
        if "email:*" in all_allowed_methods:
            # Organization allows email, use the globally configured method
            if env.auth.email_method == "password":
                methods["email:password"] = True
            elif env.auth.email_method == "otp":
                methods["email:otp"] = True
        else:
            # Use specific methods from all_allowed_methods
            if "email:password" in all_allowed_methods:
                methods["email:password"] = True
            if "email:otp" in all_allowed_methods:
                methods["email:otp"] = True

        # Social methods - respect environment configuration
        has_social_wildcard = "social:*" in all_allowed_methods

        if "social:google" in all_allowed_methods or (
            has_social_wildcard and env.auth.google_enabled
        ):
            methods["social:google"] = True
        if "social:google-workspaces" in all_allowed_methods or (
            has_social_wildcard and env.auth.google_workspaces_enabled
        ):
            methods["social:google-workspaces"] = True
        if "social:github" in all_allowed_methods or (
            has_social_wildcard and env.auth.github_enabled
        ):
            methods["social:github"] = True
        if "social:facebook" in all_allowed_methods or (
            has_social_wildcard and env.auth.facebook_enabled
        ):
            methods["social:facebook"] = True
        if "social:apple" in all_allowed_methods or (
            has_social_wildcard and env.auth.apple_enabled
        ):
            methods["social:apple"] = True
        if "social:discord" in all_allowed_methods or (
            has_social_wildcard and env.auth.discord_enabled
        ):
            methods["social:discord"] = True
        if "social:twitter" in all_allowed_methods or (
            has_social_wildcard and env.auth.twitter_enabled
        ):
            methods["social:twitter"] = True
        if "social:gitlab" in all_allowed_methods or (
            has_social_wildcard and env.auth.gitlab_enabled
        ):
            methods["social:gitlab"] = True
        if "social:bitbucket" in all_allowed_methods or (
            has_social_wildcard and env.auth.bitbucket_enabled
        ):
            methods["social:bitbucket"] = True
        if "social:linkedin" in all_allowed_methods or (
            has_social_wildcard and env.auth.linkedin_enabled
        ):
            methods["social:linkedin"] = True
        if "social:okta" in all_allowed_methods or (
            has_social_wildcard and env.auth.okta_enabled
        ):
            methods["social:okta"] = True
        if "social:azure-ad" in all_allowed_methods or (
            has_social_wildcard and env.auth.azure_ad_enabled
        ):
            methods["social:azure-ad"] = True
        if "social:boxy-saml" in all_allowed_methods or (
            has_social_wildcard and env.auth.boxy_saml_enabled
        ):
            methods["social:boxy-saml"] = True

        # SSO - only include if providers are available
        if sso_providers:
            methods["sso"] = {"providers": sso_providers}

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

    async def enforce_domain_policies(self, email: str, user_id: UUID) -> None:
        """
        Enforce domain-based policies after successful authentication:
        1. Auto-join: Automatically add user to organizations with verified domain + auto_join flag
        2. Domains-only validation: Block if user's domain doesn't match org's verified domains

        This should be called during login/callback after user is authenticated.

        Args:
            email: User's email address
            user_id: Internal user UUID

        Raises:
            Exception: If domains-only enforcement blocks access
        """
        if not is_ee() or not self.domains_dao:
            return

        # Extract domain from email
        domain = email.split("@")[1] if "@" in email and email.count("@") == 1 else None
        if not domain:
            return

        # Check for verified domain matching user's email
        domain_dto = await self.domains_dao.get_verified_by_slug(domain)
        if not domain_dto:
            return

        # Get organization and check flags
        org_id = domain_dto.organization_id
        org_flags = await self._get_organization_flags(org_id)
        if not org_flags:
            return

        # 1. Auto-join: Add user to organization if auto_join flag is enabled
        auto_join = org_flags.get("auto_join", False)
        if auto_join:
            try:
                # Check if user is already a member of this organization
                user_orgs = await db_manager.get_user_organizations(str(user_id))
                is_member = any(org.id == org_id for org in user_orgs)

                if not is_member:
                    from ee.src.services import db_manager_ee
                    from ee.src.models.db_models import (
                        OrganizationMemberDB,
                        WorkspaceMemberDB,
                        ProjectMemberDB,
                    )
                    from oss.src.dbs.postgres.shared.engine import engine as db_engine
                    from sqlalchemy import select

                    organization = await db_manager.get_organization_by_id(str(org_id))
                    user = await db_manager.get_user_with_id(user_id=str(user_id))
                    workspaces = await db_manager_ee.get_organization_workspaces(
                        str(org_id)
                    )

                    if not organization or not user or not workspaces:
                        raise ValueError(
                            "Auto-join requires organization, user, and at least one workspace"
                        )

                    async with db_engine.core_session() as session:
                        existing_org_member = await session.execute(
                            select(OrganizationMemberDB).filter_by(
                                user_id=user.id, organization_id=organization.id
                            )
                        )
                        if not existing_org_member.scalars().first():
                            session.add(
                                OrganizationMemberDB(
                                    user_id=user.id,
                                    organization_id=organization.id,
                                    role="member",
                                )
                            )

                        for workspace in workspaces:
                            existing_workspace_member = await session.execute(
                                select(WorkspaceMemberDB).filter_by(
                                    user_id=user.id, workspace_id=workspace.id
                                )
                            )
                            if not existing_workspace_member.scalars().first():
                                session.add(
                                    WorkspaceMemberDB(
                                        user_id=user.id,
                                        workspace_id=workspace.id,
                                        role="editor",
                                    )
                                )

                            projects = await db_manager.fetch_projects_by_workspace(
                                str(workspace.id)
                            )
                            if not projects:
                                continue

                            existing_project_members = await session.execute(
                                select(ProjectMemberDB).filter(
                                    ProjectMemberDB.project_id.in_(
                                        [project.id for project in projects]
                                    ),
                                    ProjectMemberDB.user_id == user.id,
                                )
                            )
                            existing_project_ids = {
                                member.project_id
                                for member in existing_project_members.scalars().all()
                            }

                            for project in projects:
                                if project.id in existing_project_ids:
                                    continue
                                session.add(
                                    ProjectMemberDB(
                                        user_id=user.id,
                                        project_id=project.id,
                                        role="editor",
                                    )
                                )

                        await session.commit()

                    log.info(
                        "[AUTH] [AUTO-JOIN] Added user to organization as 'editor'",
                        organization_id=str(org_id),
                        user_id=str(user_id),
                    )
            except Exception:
                log.error("[AUTH] [AUTO-JOIN]", exc_infp=True)

        # 2. Domains-only enforcement: Check if user has access
        # This is enforced at the organization level via check_organization_access()
        # when the user tries to access organization resources through the middleware.
        # No action needed here during login - enforcement happens at access time.

    # ============================================================================
    # AUTHORIZATION: Validate access based on policies
    # ============================================================================

    async def check_organization_access(
        self, user_id: UUID, organization_id: UUID, session_identities: List[str]
    ) -> Optional[Dict[str, Any]]:
        """
        Check if user's identities satisfy organization policy (EE only).

        This is the core authorization logic used by the middleware.

        Args:
            user_id: User's UUID
            organization_id: Organization's UUID
            session_identities: List of authentication methods verified in session

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

        if is_owner and org_flags.get("allow_root", False):
            # Owner with root access bypasses policy
            return None

        # Build allowed methods from flags
        # Default to True if not explicitly set
        allowed_methods = []

        allow_email = org_flags.get("allow_email", env.auth.email_enabled)
        allow_social = org_flags.get("allow_social", env.auth.oidc_enabled)
        allow_sso = org_flags.get("allow_sso", False)

        if allow_email:
            allowed_methods.append("email:*")
        if allow_social:
            allowed_methods.append("social:*")
        if allow_sso:
            allowed_methods.append("sso:*")

        # If no methods are allowed, deny access
        if not allowed_methods:
            return {
                "error": "AUTH_UPGRADE_REQUIRED",
                "message": "No authentication methods are allowed for this organization",
                "required_methods": [],
                "current_identities": session_identities,
            }

        # Check if identities satisfy allowed_methods
        matches = self._matches_policy(session_identities, allowed_methods)

        if not matches:
            # If the session used SSO but the org doesn't allow it (or provider inactive),
            # block and instruct user to re-auth with allowed methods.
            sso_identity = next(
                (
                    identity
                    for identity in session_identities
                    if identity.startswith("sso:")
                ),
                None,
            )
            if sso_identity and self.providers_dao:
                org_slug = await self._get_organization_slug(organization_id)
                provider_slug = (
                    sso_identity.split(":")[2]
                    if len(sso_identity.split(":")) > 2
                    else None
                )
                providers = await self.providers_dao.list_by_organization(
                    str(organization_id)
                )
                active_provider_slugs = {
                    p.slug
                    for p in providers
                    if p.flags and p.flags.get("is_active", False)
                }
                sso_matches_org = bool(
                    org_slug and sso_identity.startswith(f"sso:{org_slug}:")
                )
                sso_provider_active = bool(
                    provider_slug and provider_slug in active_provider_slugs
                )

                if not allow_sso or not sso_matches_org or not sso_provider_active:
                    required_methods = []
                    if allow_email:
                        required_methods.append("email:*")
                    if allow_social:
                        required_methods.append("social:*")
                    return {
                        "error": "AUTH_SSO_DENIED",
                        "message": "SSO is denied for this organization",
                        "required_methods": required_methods,
                        "current_identities": session_identities,
                    }
            sso_providers = []
            if "sso:*" in allowed_methods:
                sso_providers = await self._get_active_sso_providers(organization_id)
            return {
                "error": "AUTH_UPGRADE_REQUIRED",
                "message": "Additional authentication required",
                "required_methods": allowed_methods,
                "current_identities": session_identities,
                "sso_providers": sso_providers,
            }

        # Check domains_only enforcement
        domains_only = org_flags.get("domains_only", False)
        if domains_only and self.domains_dao:
            # Get user's email to check domain
            user = await db_manager.get_user(str(user_id))
            if user and user.email:
                email_domain = user.email.split("@")[-1].lower()

                # Get verified domains for this organization
                org_domains = await self.domains_dao.list_by_organization(
                    str(organization_id)
                )
                verified_domain_slugs = {
                    d.slug.lower()
                    for d in org_domains
                    if d.flags and d.flags.get("is_verified", False)
                }

                # If user's domain is not in the verified domains, deny access
                if email_domain not in verified_domain_slugs:
                    return {
                        "error": "AUTH_DOMAIN_DENIED",
                        "message": f"Your email domain '{email_domain}' is not allowed for this organization",
                        "current_domain": email_domain,
                        "allowed_domains": list(verified_domain_slugs),
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

    async def _get_active_sso_providers(
        self, organization_id: UUID
    ) -> List[Dict[str, str]]:
        if not is_ee() or not self.providers_dao:
            return []

        organization = await db_manager.get_organization_by_id(str(organization_id))
        if not organization or not organization.slug:
            return []

        providers = await self.providers_dao.list_by_organization(str(organization_id))
        results = []
        for provider in providers:
            if provider.flags and provider.flags.get("is_active", False):
                results.append(
                    {
                        "id": str(provider.id),
                        "slug": provider.slug,
                        "third_party_id": f"sso:{organization.slug}:{provider.slug}",
                    }
                )
        return results

    async def _get_organization_flags(
        self, organization_id: UUID
    ) -> Optional[Dict[str, Any]]:
        """
        Get organization flags from organizations table (EE only).

        Returns flags JSONB field or None if organization not found.
        """
        if not is_ee():
            return None

        async with db_manager.engine.core_session() as session:
            stmt = select(OrganizationDB.flags).where(
                OrganizationDB.id == organization_id
            )
            result = await session.execute(stmt)
            flags = result.scalar()
            return flags or {}

    async def _get_organization_slug(self, organization_id: UUID) -> Optional[str]:
        if not is_ee():
            return None

        async with db_manager.engine.core_session() as session:
            stmt = select(OrganizationDB.slug).where(
                OrganizationDB.id == organization_id
            )
            result = await session.execute(stmt)
            slug = result.scalar()
            return slug or None

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
