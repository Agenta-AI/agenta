from typing import List
from uuid import UUID
from datetime import datetime, timezone, timedelta
from urllib.parse import quote

import httpx
import secrets
import dns.resolver

from fastapi import HTTPException

from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

from oss.src.dbs.postgres.shared.engine import engine
from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    UpdateSecretDTO,
    SecretDTO,
    SecretKind,
    SSOProviderDTO,
    SSOProviderSettingsDTO,
)
from oss.src.core.secrets.services import VaultService
from oss.src.dbs.postgres.secrets.dao import SecretsDAO
from oss.src.core.shared.dtos import Header
from ee.src.dbs.postgres.organizations.dao import (
    OrganizationDomainsDAO,
    OrganizationProvidersDAO,
)
from ee.src.apis.fastapi.organizations.models import (
    OrganizationDomainCreate,
    OrganizationDomainResponse,
    OrganizationProviderCreate,
    OrganizationProviderUpdate,
    OrganizationProviderResponse,
)

from ee.src.services import db_manager_ee
from oss.src.services import email_service
from oss.src.models.db_models import UserDB
from oss.src.models.db_models import (
    WorkspaceDB,
    OrganizationDB,
)
from ee.src.models.api.organization_models import (
    OrganizationUpdate,
)


log = get_module_logger(__name__)


class NotFound(Exception):
    """Custom exception for credentials not found"""

    pass


async def update_an_organization(
    organization_id: str, payload: OrganizationUpdate
) -> OrganizationDB:
    org = await db_manager_ee.get_organization(organization_id)
    if org is not None:
        updated_org = await db_manager_ee.update_organization(str(org.id), payload)
        return updated_org
    raise NotFound("Organization not found")


async def send_invitation_email(
    email: str,
    token: str,
    project_id: str,
    workspace: WorkspaceDB,
    organization: OrganizationDB,
    user: UserDB,
):
    """
    Sends an invitation email to the specified email address, containing a link to accept the invitation.

    Args:
        email (str): The email address to send the invitation to.
        token (str): The token to include in the invitation link.
        project_id (str): The ID of the project that the user is being invited to join.
        workspace (WorkspaceDB): The workspace that the user is being invited to join.
        user (UserDB): The user who is sending the invitation.

    Returns:
        bool: True if the email was sent successfully, False otherwise.
    """

    html_template = email_service.read_email_template("./templates/send_email.html")

    token_param = quote(token, safe="")
    email_param = quote(email, safe="")
    org_param = quote(str(organization.id), safe="")
    workspace_param = quote(str(workspace.id), safe="")
    project_param = quote(project_id, safe="")

    invite_link = (
        f"{env.agenta.web_url}/auth"
        f"?token={token_param}"
        f"&email={email_param}"
        f"&organization_id={org_param}"
        f"&workspace_id={workspace_param}"
        f"&project_id={project_param}"
    )

    # If Sendgrid is not configured, return the link for manual sharing (URL-based invitation)
    if not env.sendgrid.enabled:
        return invite_link

    html_content = html_template.format(
        username_placeholder=user.username,
        action_placeholder="invited you to join",
        workspace_placeholder=workspace.name,
        call_to_action=(
            "Click the link below to accept the invitation:</p><br>"
            f'<a href="{invite_link}">Accept Invitation</a>'
        ),
    )

    await email_service.send_email(
        from_email="account@hello.agenta.ai",
        to_email=email,
        subject=f"{user.username} invited you to join {workspace.name}",
        html_content=html_content,
    )
    return True


async def notify_org_admin_invitation(workspace: WorkspaceDB, user: UserDB) -> bool:
    """
    Sends an email notification to the owner of an organization when a new member joins.

    Args:
        workspace (WorkspaceDB): The workspace that the user has joined.
        user (UserDB): The user who has joined the organization.

    Returns:
        bool: True if the email was sent successfully, False otherwise.
    """

    html_template = email_service.read_email_template("./templates/send_email.html")
    html_content = html_template.format(
        username_placeholder=user.username,
        action_placeholder="joined your Workspace",
        workspace_placeholder=f'"{workspace.name}"',
        call_to_action=f'Click the link below to view your Workspace:</p><br><a href="{env.agenta.web_url}/settings?tab=workspace">View Workspace</a>',
    )

    workspace_admins = await db_manager_ee.get_workspace_administrators(workspace)
    for workspace_admin in workspace_admins:
        await email_service.send_email(
            from_email="account@hello.agenta.ai",
            to_email=workspace_admin.email,
            subject=f"New Member Joined {workspace.name}",
            html_content=html_content,
        )

    return True


async def get_organization_details(organization_id: str) -> dict:
    organization = await db_manager_ee.get_organization(organization_id)
    return await db_manager_ee.get_org_details(organization)


async def transfer_organization_ownership(
    organization_id: str,
    new_owner_id: str,
    current_user_id: str,
) -> OrganizationDB:
    """Transfer organization ownership to another member.

    Args:
        organization_id: The ID of the organization
        new_owner_id: The UUID of the new owner
        current_user_id: The UUID of the current user (initiating the transfer)

    Returns:
        OrganizationDB: The updated organization

    Raises:
        NotFound: If organization or new owner member not found
        ValueError: If new owner is not a member of the organization
    """
    # Delegate to db_manager_ee
    return await db_manager_ee.transfer_organization_ownership(
        organization_id=organization_id,
        new_owner_id=new_owner_id,
        current_user_id=current_user_id,
    )


class OrganizationDomainsService:
    """Service for managing domain verification."""

    TOKEN_EXPIRY_HOURS = 48

    @staticmethod
    def generate_verification_token() -> str:
        """Generate a unique verification token."""
        # Generate cryptographically secure random token (16 bytes = 64 hex chars)
        random_part = secrets.token_hex(16)

        # Add prefix to make it identifiable as an Agenta verification token
        return f"{random_part}"

    @staticmethod
    async def verify_domain_dns(domain: str, expected_token: str) -> bool:
        """Verify domain ownership via DNS TXT record."""

        try:
            txt_record_name = f"_agenta-verification.{domain}"
            resolvers = [
                ("system", None),
                ("cloudflare+google", ["1.1.1.1", "8.8.8.8"]),
            ]

            def _resolve_txt(resolver_label: str, nameservers: list[str] | None):
                resolver = dns.resolver.Resolver()
                if nameservers:
                    resolver.nameservers = nameservers
                return resolver.resolve(txt_record_name, "TXT")

            for resolver_label, nameservers in resolvers:
                try:
                    answers = _resolve_txt(resolver_label, nameservers)
                except Exception as exc:
                    log.warning(
                        f"DNS lookup failed via {resolver_label} resolver: {exc}"
                    )
                    continue

                for rdata in answers:
                    txt_value = rdata.to_text().strip('"')

                    # Extract the token value from "_agenta-verification=TOKEN" format
                    if txt_value.startswith("_agenta-verification="):
                        token = txt_value.split("=", 1)[1]
                        if token == expected_token:
                            return True

                        else:
                            log.warning(
                                f"Token mismatch for {domain}. Expected length: {len(expected_token)}, Got length: {len(token)}"
                            )

            log.warning(
                f"No matching verification token found in DNS records for {domain}"
            )
            return False
        except dns.resolver.NXDOMAIN:
            log.warning(f"DNS record not found (NXDOMAIN) for {txt_record_name}")
            return False
        except dns.resolver.NoAnswer:
            log.warning(f"No TXT records found (NoAnswer) for {txt_record_name}")
            return False
        except dns.resolver.Timeout:
            log.error(f"DNS lookup timeout for {txt_record_name}")
            return False
        except Exception as e:
            log.error(
                f"Unexpected error during DNS verification for {domain}: {e}",
                exc_info=True,
            )
            return False

    async def create_domain(
        self,
        organization_id: str,
        payload: OrganizationDomainCreate,
        user_id: str,
    ) -> OrganizationDomainResponse:
        """Create a new domain for verification.

        Token expires after 48 hours and can be refreshed.
        """
        async with engine.core_session() as session:
            dao = OrganizationDomainsDAO(session)

            # Block if a verified domain already exists anywhere
            existing_verified = await dao.get_verified_by_slug(slug=payload.domain)
            if existing_verified:
                raise HTTPException(
                    status_code=409,
                    detail=f"Domain {payload.domain} is already verified",
                )

            # Reuse existing unverified domain for this organization, if any
            existing = await dao.get_by_slug(
                slug=payload.domain, organization_id=organization_id
            )
            if existing and not (existing.flags or {}).get("is_verified"):
                token = self.generate_verification_token()
                existing.token = token
                existing.created_at = datetime.now(timezone.utc)
                existing.flags = {"is_verified": False}
                existing.updated_by_id = user_id
                await session.commit()
                await session.refresh(existing)
                domain = existing
            else:
                # Generate verification token
                token = self.generate_verification_token()

                # Create domain with token
                domain = await dao.create(
                    created_by_id=user_id,
                    slug=payload.domain,
                    name=payload.name,
                    description=payload.description,
                    token=token,
                    organization_id=organization_id,
                )

                await session.commit()
                await session.refresh(domain)

            return OrganizationDomainResponse(
                id=str(domain.id),
                organization_id=str(domain.organization_id),
                slug=domain.slug,
                name=domain.name,
                description=domain.description,
                token=token,
                flags=domain.flags or {},
                created_at=domain.created_at,
                updated_at=domain.updated_at,
            )

    async def verify_domain(
        self, organization_id: str, domain_id: str, user_id: str
    ) -> OrganizationDomainResponse:
        """Verify a domain via DNS check."""
        async with engine.core_session() as session:
            dao = OrganizationDomainsDAO(session)

            domain = await dao.get_by_id(
                domain_id=domain_id, organization_id=organization_id
            )
            if not domain:
                raise HTTPException(status_code=404, detail="Domain not found")

            # Check if already verified by this organization
            if domain.flags and domain.flags.get("is_verified"):
                raise HTTPException(status_code=400, detail="Domain already verified")

            # Check if domain is already verified by another organization
            verified_by_other = await dao.get_verified_by_slug(slug=domain.slug)
            if (
                verified_by_other
                and str(verified_by_other.organization_id) != organization_id
            ):
                raise HTTPException(
                    status_code=409,
                    detail=f"Domain {domain.slug} is already verified by another organization",
                )

            # Check if token has expired (48 hours from creation)
            token_age = datetime.now(timezone.utc) - domain.created_at
            if token_age > timedelta(hours=self.TOKEN_EXPIRY_HOURS):
                raise HTTPException(
                    status_code=400,
                    detail=f"Verification token expired after {self.TOKEN_EXPIRY_HOURS} hours. Please refresh the token.",
                )

            # Perform DNS verification
            is_valid = await self.verify_domain_dns(domain.slug, domain.token)

            if not is_valid:
                raise HTTPException(
                    status_code=400,
                    detail="Domain verification failed. Please ensure the DNS TXT record is correctly configured.",
                )

            # Mark as verified and clear the token (one-time use)
            domain.flags = {"is_verified": True}
            domain.token = None
            domain.updated_by_id = user_id
            await session.commit()
            await session.refresh(domain)

            return OrganizationDomainResponse(
                id=str(domain.id),
                organization_id=str(domain.organization_id),
                slug=domain.slug,
                name=domain.name,
                description=domain.description,
                token=None,
                flags=domain.flags or {},
                created_at=domain.created_at,
                updated_at=domain.updated_at,
            )

    async def list_domains(
        self, organization_id: str
    ) -> List[OrganizationDomainResponse]:
        """List all domains for an organization.

        Tokens are returned for unverified domains (within expiry period).
        Verified domains have token=None (cleared after verification).
        """
        async with engine.core_session() as session:
            dao = OrganizationDomainsDAO(session)
            domains = await dao.list_by_organization(organization_id=organization_id)

            return [
                OrganizationDomainResponse(
                    id=str(d.id),
                    organization_id=str(d.organization_id),
                    slug=d.slug,
                    name=d.name,
                    description=d.description,
                    token=d.token,  # Token available for unverified domains, None for verified
                    flags=d.flags or {},
                    created_at=d.created_at,
                    updated_at=d.updated_at,
                )
                for d in domains
            ]

    async def refresh_token(
        self, organization_id: str, domain_id: str, user_id: str
    ) -> OrganizationDomainResponse:
        """Refresh the verification token for a domain.

        Generates a new token and resets the 48-hour expiry window.
        For verified domains, this marks them as unverified for re-verification.
        """
        async with engine.core_session() as session:
            dao = OrganizationDomainsDAO(session)

            domain = await dao.get_by_id(
                domain_id=domain_id, organization_id=organization_id
            )
            if not domain:
                raise HTTPException(status_code=404, detail="Domain not found")

            # Generate new token
            new_token = self.generate_verification_token()

            # Update domain with new token and reset created_at to restart the 48-hour expiry window
            # If domain was verified, mark as unverified for re-verification
            domain.token = new_token
            domain.created_at = datetime.now(timezone.utc)
            domain.flags = {"is_verified": False}
            domain.updated_by_id = user_id
            await session.commit()
            await session.refresh(domain)

            return OrganizationDomainResponse(
                id=str(domain.id),
                organization_id=str(domain.organization_id),
                slug=domain.slug,
                name=domain.name,
                description=domain.description,
                token=new_token,
                flags=domain.flags or {},
                created_at=domain.created_at,
                updated_at=domain.updated_at,
            )

    async def reset_domain(
        self, organization_id: str, domain_id: str, user_id: str
    ) -> OrganizationDomainResponse:
        """Reset a verified domain to unverified state for re-verification.

        Generates a new token and marks the domain as unverified.
        """
        async with engine.core_session() as session:
            dao = OrganizationDomainsDAO(session)

            domain = await dao.get_by_id(
                domain_id=domain_id, organization_id=organization_id
            )
            if not domain:
                raise HTTPException(status_code=404, detail="Domain not found")

            # Generate new token
            new_token = self.generate_verification_token()

            # Reset domain to unverified state with new token
            domain.token = new_token
            domain.created_at = datetime.now(timezone.utc)
            domain.flags = {"is_verified": False}
            domain.updated_by_id = user_id
            await session.commit()
            await session.refresh(domain)

            return OrganizationDomainResponse(
                id=str(domain.id),
                organization_id=str(domain.organization_id),
                slug=domain.slug,
                name=domain.name,
                description=domain.description,
                token=new_token,
                flags=domain.flags or {},
                created_at=domain.created_at,
                updated_at=domain.updated_at,
            )

    async def delete_domain(
        self, organization_id: str, domain_id: str, user_id: str
    ) -> bool:
        """Delete a domain."""
        async with engine.core_session() as session:
            dao = OrganizationDomainsDAO(session)

            domain = await dao.get_by_id(
                domain_id=domain_id, organization_id=organization_id
            )
            if not domain:
                raise HTTPException(status_code=404, detail="Domain not found")

            deleted = await dao.delete(deleted_by_id=user_id, domain_id=domain_id)
            await session.commit()
            return deleted


class OrganizationProvidersService:
    """Service for managing SSO providers."""

    @staticmethod
    def _vault_service() -> VaultService:
        return VaultService(SecretsDAO())

    @staticmethod
    def mask_secret(secret: str) -> str:
        """Mask a secret for display."""
        if len(secret) <= 8:
            return "***"
        return f"{secret[:4]}...{secret[-4:]}"

    @staticmethod
    async def test_oidc_connection(
        issuer_url: str,
        client_id: str,
        client_secret: str,
    ) -> bool:
        """Test OIDC provider connection by fetching discovery document."""
        try:
            # Try to fetch OIDC discovery document
            discovery_url = f"{issuer_url.rstrip('/')}/.well-known/openid-configuration"

            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(discovery_url)

                if response.status_code != 200:
                    return False

                config = response.json()

                # Verify required OIDC endpoints exist
                required_fields = [
                    "authorization_endpoint",
                    "token_endpoint",
                    "userinfo_endpoint",
                ]
                if not all(field in config for field in required_fields):
                    return False

                return True
        except Exception:
            return False

    async def create_provider(
        self,
        organization_id: str,
        payload: OrganizationProviderCreate,
        user_id: str,
    ) -> OrganizationProviderResponse:
        """Create a new SSO provider."""
        async with engine.core_session() as session:
            dao = OrganizationProvidersDAO(session)

            # Use the slug from payload (already validated to be lowercase letters and hyphens)
            slug = payload.slug

            # Check if provider with this slug already exists
            existing = await dao.get_by_slug(slug=slug, organization_id=organization_id)
            if existing:
                raise HTTPException(
                    status_code=400,
                    detail=f"Provider with slug '{payload.slug}' already exists",
                )

            # Merge provided settings with defaults
            settings = {
                **payload.settings,
            }

            # Ensure scopes have default if not provided
            if "scopes" not in settings or not settings["scopes"]:
                settings["scopes"] = ["openid", "profile", "email"]

            secret_payload = CreateSecretDTO(
                header=Header(name=slug, description=payload.description),
                secret=SecretDTO(
                    kind=SecretKind.SSO_PROVIDER,
                    data=SSOProviderDTO(
                        provider=SSOProviderSettingsDTO(
                            client_id=settings.get("client_id", ""),
                            client_secret=settings.get("client_secret", ""),
                            issuer_url=settings.get("issuer_url", ""),
                            scopes=settings.get("scopes", []),
                            extra=settings.get("extra", {}) or {},
                        )
                    ),
                ),
            )

            secret_dto = await self._vault_service().create_secret(
                organization_id=UUID(organization_id),
                create_secret_dto=secret_payload,
            )

            # Merge provided flags with defaults
            flags = payload.flags or {}
            if "is_valid" not in flags:
                flags["is_valid"] = False
            if "is_active" not in flags:
                flags["is_active"] = False

            # Create provider
            provider = await dao.create(
                created_by_id=user_id,
                slug=slug,
                name=payload.name,
                description=payload.description,
                flags=flags,
                secret_id=str(secret_dto.id),
                organization_id=organization_id,
            )

            await session.commit()
            await session.refresh(provider)

            return await self._to_response(provider, organization_id)

    async def update_provider(
        self,
        organization_id: str,
        provider_id: str,
        payload: OrganizationProviderUpdate,
        user_id: str,
    ) -> OrganizationProviderResponse:
        """Update an SSO provider."""
        async with engine.core_session() as session:
            dao = OrganizationProvidersDAO(session)

            provider = await dao.get_by_id(
                provider_id=provider_id, organization_id=organization_id
            )
            if not provider:
                raise HTTPException(status_code=404, detail="Provider not found")

            # Update settings if provided
            settings = await self._get_provider_settings(
                organization_id, str(provider.secret_id)
            )
            settings_changed = False

            if payload.settings is not None:
                settings.update(payload.settings)
                settings_changed = True

            # Update flags if provided
            flags = provider.flags.copy() if provider.flags else {}

            if payload.flags is not None:
                flags.update(payload.flags)

            # If settings changed, invalidate the provider (needs re-testing)
            if settings_changed:
                flags["is_valid"] = False
                flags["is_active"] = False

            # Update slug if provided
            if payload.slug is not None:
                # Check if new slug already exists
                existing = await dao.get_by_slug(
                    slug=payload.slug, organization_id=organization_id
                )
                if existing and existing.id != provider_id:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Provider with slug '{payload.slug}' already exists",
                    )
                # Update slug in the provider
                provider.slug = payload.slug

            # Update name if provided
            if payload.name is not None:
                provider.name = payload.name

            # Update description if provided
            if payload.description is not None:
                provider.description = payload.description

            if settings_changed:
                updated_secret = UpdateSecretDTO(
                    header=Header(name=provider.slug, description=provider.description),
                    secret=SecretDTO(
                        kind=SecretKind.SSO_PROVIDER,
                        data=SSOProviderDTO(
                            provider=SSOProviderSettingsDTO(
                                client_id=settings.get("client_id", ""),
                                client_secret=settings.get("client_secret", ""),
                                issuer_url=settings.get("issuer_url", ""),
                                scopes=settings.get("scopes", []),
                                extra=settings.get("extra", {}) or {},
                            )
                        ),
                    ),
                )
                await self._vault_service().update_secret(
                    secret_id=provider.secret_id,
                    organization_id=organization_id,
                    update_secret_dto=updated_secret,
                )

            provider = await dao.update(
                updated_by_id=user_id,
                provider_id=provider_id,
                flags=flags,
            )

            await session.commit()
            await session.refresh(provider)

            return await self._to_response(provider, organization_id)

    async def list_providers(
        self, organization_id: str
    ) -> List[OrganizationProviderResponse]:
        """List all SSO providers for an organization."""
        async with engine.core_session() as session:
            dao = OrganizationProvidersDAO(session)
            providers = await dao.list_by_organization(organization_id=organization_id)

            responses: List[OrganizationProviderResponse] = []
            for provider in providers:
                responses.append(await self._to_response(provider, organization_id))
            return responses

    async def get_provider(
        self, organization_id: str, provider_id: str
    ) -> OrganizationProviderResponse:
        """Get a single SSO provider by ID."""
        async with engine.core_session() as session:
            dao = OrganizationProvidersDAO(session)
            provider = await dao.get_by_id(
                provider_id=provider_id, organization_id=organization_id
            )
            if not provider:
                raise HTTPException(status_code=404, detail="Provider not found")
            return await self._to_response(provider, organization_id)

    async def test_provider(
        self, organization_id: str, provider_id: str, user_id: str
    ) -> OrganizationProviderResponse:
        """Test SSO provider connection and mark as valid if successful."""
        async with engine.core_session() as session:
            dao = OrganizationProvidersDAO(session)

            provider = await dao.get_by_id(
                provider_id=provider_id, organization_id=organization_id
            )
            if not provider:
                raise HTTPException(status_code=404, detail="Provider not found")

            settings = await self._get_provider_settings(
                organization_id, str(provider.secret_id)
            )

            # Test OIDC connection
            is_valid = await self.test_oidc_connection(
                issuer_url=settings.get("issuer_url", ""),
                client_id=settings.get("client_id", ""),
                client_secret=settings.get("client_secret", ""),
            )

            # Update flags based on test result
            flags = provider.flags.copy() if provider.flags else {}
            flags["is_valid"] = is_valid
            if is_valid:
                flags["is_active"] = True

            # If validation failed, deactivate the provider
            if not is_valid:
                flags["is_active"] = False

            provider = await dao.update(
                updated_by_id=user_id,
                provider_id=provider_id,
                flags=flags,
            )

            await session.commit()
            await session.refresh(provider)

            return await self._to_response(provider, organization_id)

    async def delete_provider(
        self, organization_id: str, provider_id: str, user_id: str
    ) -> bool:
        """Delete an SSO provider."""
        async with engine.core_session() as session:
            dao = OrganizationProvidersDAO(session)

            provider = await dao.get_by_id(
                provider_id=provider_id, organization_id=organization_id
            )
            if not provider:
                raise HTTPException(status_code=404, detail="Provider not found")

            organization = await db_manager_ee.get_organization(organization_id)
            flags = organization.flags or {}
            if flags.get("allow_sso"):
                providers = await dao.list_by_organization(
                    organization_id=organization_id
                )
                remaining = [
                    p
                    for p in providers
                    if str(p.id) != str(provider_id)
                    and (p.flags or {}).get("is_active")
                    and (p.flags or {}).get("is_valid")
                ]
                if not remaining:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "Cannot delete the last active and verified SSO provider while "
                            "SSO is enabled."
                        ),
                    )

            await self._vault_service().delete_secret(
                secret_id=provider.secret_id,
                organization_id=organization_id,
            )
            deleted = await dao.delete(deleted_by_id=user_id, provider_id=provider_id)
            await session.commit()
            return deleted

    async def _get_provider_settings(
        self, organization_id: str, secret_id: str
    ) -> dict:
        secret = await self._vault_service().get_secret(
            secret_id=UUID(secret_id),
            organization_id=UUID(organization_id),
        )
        if not secret:
            raise HTTPException(status_code=404, detail="Provider secret not found")

        data = secret.data
        if hasattr(data, "provider"):
            return data.provider.model_dump()
        if isinstance(data, dict):
            provider = data.get("provider") or {}
            if isinstance(provider, dict):
                return provider
        raise HTTPException(status_code=500, detail="Invalid provider secret format")

    async def _to_response(
        self, provider, organization_id: str
    ) -> OrganizationProviderResponse:
        """Convert DBE to response model."""
        settings = await self._get_provider_settings(
            organization_id, str(provider.secret_id)
        )

        return OrganizationProviderResponse(
            id=str(provider.id),
            organization_id=str(provider.organization_id),
            slug=provider.slug,
            name=provider.name,
            description=provider.description,
            settings=settings,
            flags=provider.flags or {},
            created_at=provider.created_at,
            updated_at=provider.updated_at,
        )
