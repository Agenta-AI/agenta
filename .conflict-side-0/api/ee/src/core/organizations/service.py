from typing import List
from uuid import UUID
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse, urlunparse

import re

import httpx
import secrets
import dns.resolver

from fastapi import HTTPException

from sqlalchemy.future import select
from sqlalchemy.exc import NoResultFound, IntegrityError

from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

from oss.src.services import db_manager
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.core.webhooks.utils import resolve_validated_webhook_ip
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
from oss.src.models.db_models import (
    OrganizationDB,
)
from oss.src.models.api.organization_models import OrganizationUpdate

from ee.src.dbs.postgres.organizations.dao import (
    OrganizationDomainsDAO,
    OrganizationProvidersDAO,
)
from ee.src.core.organizations.types import (
    OrganizationDomain,
    OrganizationDomainCreate,
    OrganizationProvider,
    OrganizationProviderCreate,
    OrganizationProviderUpdate,
)
from ee.src.core.organizations.exceptions import OrganizationSlugConflictError


log = get_module_logger(__name__)


async def update_organization(
    organization_id: str, payload: OrganizationUpdate
) -> OrganizationDB:
    """Update an organization's details (EE: validates SSO/domain auth flags)."""

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(OrganizationDB).filter_by(id=UUID(organization_id))
        )
        organization = result.scalars().first()

        if not organization:
            raise NoResultFound(f"Organization with id {organization_id} not found")

        payload_dict = payload.model_dump(exclude_unset=True)
        if "slug" in payload_dict:
            new_slug = payload_dict["slug"]

            if new_slug is not None:
                if len(new_slug) > 64:
                    raise ValueError("Organization slug cannot exceed 64 characters.")
                if not re.match(r"^[a-z-]+$", new_slug):
                    raise ValueError(
                        "Organization slug can only contain lowercase letters (a-z) and hyphens (-)."
                    )

            if organization.slug is not None and new_slug != organization.slug:
                raise ValueError(
                    f"Organization slug cannot be changed once set. "
                    f"Current slug: '{organization.slug}'"
                )

        # Flags: merge instead of replace, and guard against auth lockout.
        if "flags" in payload_dict:
            new_flags = payload_dict["flags"]
            if new_flags is not None:
                existing_flags = organization.flags or {}

                default_flags = {
                    "is_demo": False,
                    "allow_email": env.auth.email_enabled,
                    "allow_social": env.auth.oidc_enabled,
                    "allow_sso": False,
                    "allow_root": False,
                    "domains_only": False,
                    "auto_join": False,
                }

                merged_flags = {**default_flags, **existing_flags, **new_flags}

                allow_email = merged_flags.get("allow_email", False)
                allow_social = merged_flags.get("allow_social", False)
                allow_sso = merged_flags.get("allow_sso", False)
                allow_root = merged_flags.get("allow_root", False)

                changing_auth_flags = any(
                    key in new_flags
                    for key in ("allow_email", "allow_social", "allow_sso")
                )
                changing_auto_join = "auto_join" in new_flags
                changing_domains_only = "domains_only" in new_flags

                if changing_auth_flags and allow_sso:
                    providers_dao = OrganizationProvidersDAO(session)
                    providers = await providers_dao.list_by_organization(
                        organization_id=organization_id
                    )
                    active_valid = [
                        provider
                        for provider in providers
                        if (provider.flags or {}).get("is_active")
                        and (provider.flags or {}).get("is_valid")
                    ]
                    if not active_valid:
                        raise ValueError(
                            "SSO cannot be enabled until at least one SSO provider is "
                            "active and verified."
                        )
                    if not allow_email and not allow_social:
                        if not active_valid:
                            raise ValueError(
                                "SSO-only authentication requires at least one SSO provider to "
                                "be active and verified."
                            )

                if changing_auto_join and merged_flags.get("auto_join", False):
                    domains_dao = OrganizationDomainsDAO(session)
                    domains = await domains_dao.list_by_organization(
                        organization_id=organization_id
                    )
                    has_verified_domain = any(
                        (domain.flags or {}).get("is_verified") for domain in domains
                    )
                    if not has_verified_domain:
                        raise ValueError(
                            "Auto-join requires at least one verified domain."
                        )

                if changing_domains_only and merged_flags.get("domains_only", False):
                    domains_dao = OrganizationDomainsDAO(session)
                    domains = await domains_dao.list_by_organization(
                        organization_id=organization_id
                    )
                    has_verified_domain = any(
                        (domain.flags or {}).get("is_verified") for domain in domains
                    )
                    if not has_verified_domain:
                        raise ValueError(
                            "Domains-only requires at least one verified domain."
                        )

                all_auth_disabled = not (allow_email or allow_social or allow_sso)

                if all_auth_disabled and not allow_root:
                    merged_flags["allow_root"] = True
                    log.warning(
                        f"All authentication methods disabled for organization {organization_id}. "
                        f"Auto-enabling allow_root to prevent lockout."
                    )

                organization.flags = merged_flags
            del payload_dict["flags"]

        for key, value in payload_dict.items():
            if hasattr(organization, key):
                setattr(organization, key, value)

        try:
            await session.commit()
        except Exception as e:
            if isinstance(e, IntegrityError) and "uq_organizations_slug" in str(e):
                raise OrganizationSlugConflictError(
                    slug=payload_dict.get("slug", "unknown")
                ) from e
            raise

        await session.refresh(organization)
        return organization


async def assert_invite_domain_allowed(organization_id: str, email: str) -> None:
    """EE-only: enforce verified-domain restriction on invites when an org has
    `domains_only` enabled. Raises HTTPException(400) when the invite is blocked.

    Called from the OSS invite orchestrator via the `is_ee()` seam.
    """

    organization = await db_manager.get_organization(organization_id)
    if not (organization.flags or {}).get("domains_only", False):
        return

    org_domains = await OrganizationDomainsDAO().list_by_organization(
        organization_id=organization_id
    )
    verified_domain_slugs = {
        d.slug.lower()
        for d in org_domains
        if d.flags and d.flags.get("is_verified", False)
    }

    if not verified_domain_slugs:
        raise HTTPException(
            status_code=400,
            detail="Cannot send invitations: domains_only is enabled but no verified domains exist",
        )

    email_domain = email.split("@")[-1].lower()
    if email_domain not in verified_domain_slugs:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot invite {email}: domain '{email_domain}' is not a verified domain for this organization",
        )


class OrganizationDomainsService:
    """Service for managing domain verification."""

    TOKEN_EXPIRY_HOURS = 48

    @staticmethod
    def generate_verification_token() -> str:
        """Generate a unique verification token."""
        random_part = secrets.token_hex(16)
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
    ) -> OrganizationDomain:
        """Create a new domain for verification.

        Token expires after 48 hours and can be refreshed.
        """
        engine = get_transactions_engine()

        async with engine.session() as session:
            dao = OrganizationDomainsDAO(session)

            existing_verified = await dao.get_verified_by_slug(slug=payload.slug)
            if existing_verified:
                raise HTTPException(
                    status_code=409,
                    detail=f"Domain {payload.slug} is already verified",
                )

            existing = await dao.get_by_slug(
                slug=payload.slug, organization_id=organization_id
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
                token = self.generate_verification_token()

                domain = await dao.create(
                    created_by_id=user_id,
                    slug=payload.slug,
                    name=payload.name,
                    description=payload.description,
                    token=token,
                    organization_id=organization_id,
                )

                await session.commit()
                await session.refresh(domain)

            return OrganizationDomain(
                id=domain.id,
                organization_id=domain.organization_id,
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
    ) -> OrganizationDomain:
        """Verify a domain via DNS check."""
        engine = get_transactions_engine()

        async with engine.session() as session:
            dao = OrganizationDomainsDAO(session)

            domain = await dao.get_by_id(
                domain_id=domain_id, organization_id=organization_id
            )
            if not domain:
                raise HTTPException(status_code=404, detail="Domain not found")

            if domain.flags and domain.flags.get("is_verified"):
                raise HTTPException(status_code=400, detail="Domain already verified")

            verified_by_other = await dao.get_verified_by_slug(slug=domain.slug)
            if (
                verified_by_other
                and str(verified_by_other.organization_id) != organization_id
            ):
                raise HTTPException(
                    status_code=409,
                    detail=f"Domain {domain.slug} is already verified by another organization",
                )

            token_age = datetime.now(timezone.utc) - domain.created_at
            if token_age > timedelta(hours=self.TOKEN_EXPIRY_HOURS):
                raise HTTPException(
                    status_code=400,
                    detail=f"Verification token expired after {self.TOKEN_EXPIRY_HOURS} hours. Please refresh the token.",
                )

            is_valid = await self.verify_domain_dns(domain.slug, domain.token)

            if not is_valid:
                raise HTTPException(
                    status_code=400,
                    detail="Domain verification failed. Please ensure the DNS TXT record is correctly configured.",
                )

            domain.flags = {"is_verified": True}
            domain.token = None
            domain.updated_by_id = user_id
            await session.commit()
            await session.refresh(domain)

            return OrganizationDomain(
                id=domain.id,
                organization_id=domain.organization_id,
                slug=domain.slug,
                name=domain.name,
                description=domain.description,
                token=None,
                flags=domain.flags or {},
                created_at=domain.created_at,
                updated_at=domain.updated_at,
            )

    async def list_domains(self, organization_id: str) -> List[OrganizationDomain]:
        """List all domains for an organization."""
        engine = get_transactions_engine()

        async with engine.session() as session:
            dao = OrganizationDomainsDAO(session)
            domains = await dao.list_by_organization(organization_id=organization_id)

            return [
                OrganizationDomain(
                    id=d.id,
                    organization_id=d.organization_id,
                    slug=d.slug,
                    name=d.name,
                    description=d.description,
                    token=d.token,
                    flags=d.flags or {},
                    created_at=d.created_at,
                    updated_at=d.updated_at,
                )
                for d in domains
            ]

    async def refresh_token(
        self, organization_id: str, domain_id: str, user_id: str
    ) -> OrganizationDomain:
        """Refresh the verification token for a domain."""
        engine = get_transactions_engine()

        async with engine.session() as session:
            dao = OrganizationDomainsDAO(session)

            domain = await dao.get_by_id(
                domain_id=domain_id, organization_id=organization_id
            )
            if not domain:
                raise HTTPException(status_code=404, detail="Domain not found")

            new_token = self.generate_verification_token()

            domain.token = new_token
            domain.created_at = datetime.now(timezone.utc)
            domain.flags = {"is_verified": False}
            domain.updated_by_id = user_id
            await session.commit()
            await session.refresh(domain)

            return OrganizationDomain(
                id=domain.id,
                organization_id=domain.organization_id,
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
    ) -> OrganizationDomain:
        """Reset a verified domain to unverified state for re-verification."""
        engine = get_transactions_engine()

        async with engine.session() as session:
            dao = OrganizationDomainsDAO(session)

            domain = await dao.get_by_id(
                domain_id=domain_id, organization_id=organization_id
            )
            if not domain:
                raise HTTPException(status_code=404, detail="Domain not found")

            new_token = self.generate_verification_token()

            domain.token = new_token
            domain.created_at = datetime.now(timezone.utc)
            domain.flags = {"is_verified": False}
            domain.updated_by_id = user_id
            await session.commit()
            await session.refresh(domain)

            return OrganizationDomain(
                id=domain.id,
                organization_id=domain.organization_id,
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
        engine = get_transactions_engine()

        async with engine.session() as session:
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
            # SSRF guard: resolve+range-block issuer_url, then pin to the literal IP (same
            # pattern as webhooks/handlers) so a DNS-rebind after this check can't reach it.
            resolved_ip = resolve_validated_webhook_ip(issuer_url)
            parsed = urlparse(issuer_url)
            host_literal = f"[{resolved_ip}]" if ":" in resolved_ip else resolved_ip
            pinned_netloc = (
                f"{host_literal}:{parsed.port}" if parsed.port else host_literal
            )
            pinned_issuer_url = urlunparse(parsed._replace(netloc=pinned_netloc))
            discovery_url = (
                f"{pinned_issuer_url.rstrip('/')}/.well-known/openid-configuration"
            )

            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    discovery_url,
                    headers={"Host": parsed.hostname or ""},
                    extensions={"sni_hostname": parsed.hostname or ""},
                )

                if response.status_code != 200:
                    return False

                config = response.json()

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
    ) -> OrganizationProvider:
        """Create a new SSO provider."""
        engine = get_transactions_engine()

        async with engine.session() as session:
            dao = OrganizationProvidersDAO(session)

            slug = payload.slug

            existing = await dao.get_by_slug(slug=slug, organization_id=organization_id)
            if existing:
                raise HTTPException(
                    status_code=400,
                    detail=f"Provider with slug '{payload.slug}' already exists",
                )

            settings = {
                **payload.settings,
            }

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

            flags = payload.flags or {}
            if "is_valid" not in flags:
                flags["is_valid"] = False
            if "is_active" not in flags:
                flags["is_active"] = False

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
    ) -> OrganizationProvider:
        """Update an SSO provider."""
        engine = get_transactions_engine()

        async with engine.session() as session:
            dao = OrganizationProvidersDAO(session)

            provider = await dao.get_by_id(
                provider_id=provider_id, organization_id=organization_id
            )
            if not provider:
                raise HTTPException(status_code=404, detail="Provider not found")

            settings = await self._get_provider_settings(
                organization_id, str(provider.secret_id)
            )
            settings_changed = False

            if payload.settings is not None:
                settings.update(payload.settings)
                settings_changed = True

            flags = provider.flags.copy() if provider.flags else {}

            if payload.flags is not None:
                flags.update(payload.flags)

            if settings_changed:
                flags["is_valid"] = False
                flags["is_active"] = False

            if payload.slug is not None:
                existing = await dao.get_by_slug(
                    slug=payload.slug, organization_id=organization_id
                )
                if existing and existing.id != provider_id:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Provider with slug '{payload.slug}' already exists",
                    )
                provider.slug = payload.slug

            if payload.name is not None:
                provider.name = payload.name

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

    async def list_providers(self, organization_id: str) -> List[OrganizationProvider]:
        """List all SSO providers for an organization."""
        engine = get_transactions_engine()

        async with engine.session() as session:
            dao = OrganizationProvidersDAO(session)
            providers = await dao.list_by_organization(organization_id=organization_id)

            responses: List[OrganizationProvider] = []
            for provider in providers:
                responses.append(await self._to_response(provider, organization_id))
            return responses

    async def get_provider(
        self, organization_id: str, provider_id: str
    ) -> OrganizationProvider:
        """Get a single SSO provider by ID."""
        engine = get_transactions_engine()

        async with engine.session() as session:
            dao = OrganizationProvidersDAO(session)
            provider = await dao.get_by_id(
                provider_id=provider_id, organization_id=organization_id
            )
            if not provider:
                raise HTTPException(status_code=404, detail="Provider not found")
            return await self._to_response(provider, organization_id)

    async def test_provider(
        self, organization_id: str, provider_id: str, user_id: str
    ) -> OrganizationProvider:
        """Test SSO provider connection and mark as valid if successful."""
        engine = get_transactions_engine()

        async with engine.session() as session:
            dao = OrganizationProvidersDAO(session)

            provider = await dao.get_by_id(
                provider_id=provider_id, organization_id=organization_id
            )
            if not provider:
                raise HTTPException(status_code=404, detail="Provider not found")

            settings = await self._get_provider_settings(
                organization_id, str(provider.secret_id)
            )

            is_valid = await self.test_oidc_connection(
                issuer_url=settings.get("issuer_url", ""),
                client_id=settings.get("client_id", ""),
                client_secret=settings.get("client_secret", ""),
            )

            flags = provider.flags.copy() if provider.flags else {}
            flags["is_valid"] = is_valid
            if is_valid:
                flags["is_active"] = True

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
        engine = get_transactions_engine()

        async with engine.session() as session:
            dao = OrganizationProvidersDAO(session)

            provider = await dao.get_by_id(
                provider_id=provider_id, organization_id=organization_id
            )
            if not provider:
                raise HTTPException(status_code=404, detail="Provider not found")

            organization = await db_manager.get_organization(organization_id)
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
        secret = await self._vault_service().get_secret_by_id(
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
    ) -> OrganizationProvider:
        """Convert DBE to response model."""
        settings = await self._get_provider_settings(
            organization_id, str(provider.secret_id)
        )

        return OrganizationProvider(
            id=provider.id,
            organization_id=provider.organization_id,
            slug=provider.slug,
            name=provider.name,
            description=provider.description,
            settings=settings,
            flags=provider.flags or {},
            created_at=provider.created_at,
            updated_at=provider.updated_at,
        )


# ---------------------------------------------------------------------------
# Subscription provisioning (EE signup/org-creation hooks)
# ---------------------------------------------------------------------------

from ee.src.dbs.postgres.subscriptions.dao import SubscriptionsDAO  # noqa: E402
from ee.src.core.subscriptions.service import SubscriptionsService  # noqa: E402
from ee.src.core.subscriptions.types import get_default_plan  # noqa: E402
from ee.src.core.access.entitlements.service import (  # noqa: E402
    check_entitlements,
    scope_from,
    Gauge,
)


_subscription_service = SubscriptionsService(
    subscriptions_dao=SubscriptionsDAO(),
)


async def provision_signup_subscription(
    organization: OrganizationDB,
    *,
    organization_email: str,
) -> None:
    """Provision the signup subscription + seed the user gauge for a new org.

    Cloud (Stripe enabled) gets a reverse trial; self-hosted gets the default
    plan. Called from the OSS signup flow via the `is_ee()` seam.
    """

    try:
        await _subscription_service.provision_subscription(
            organization_id=str(organization.id),
            organization_name=organization.name,
            organization_email=organization_email,
        )
    except Exception as exc:
        log.error(
            "[scopes] Failed to create subscription for organization [%s]: %s",
            organization.id,
            exc,
        )
        raise

    await check_entitlements(
        key=Gauge.USERS,
        delta=1,
        scope=scope_from(organization_id=organization.id),
    )


async def provision_user_subscription(organization: OrganizationDB) -> None:
    """Start the default plan + seed the user gauge for an explicitly-created org.

    Entry point for `POST /organizations/`. Called from OSS via the `is_ee()` seam.
    """

    try:
        await _subscription_service.start_plan(
            organization_id=str(organization.id),
            plan=get_default_plan(),
        )
    except Exception as exc:
        log.error(
            "[scopes] Failed to create subscription for organization [%s]: %s",
            organization.id,
            exc,
        )
        raise

    await check_entitlements(
        key=Gauge.USERS,
        delta=1,
        scope=scope_from(organization_id=organization.id),
    )
