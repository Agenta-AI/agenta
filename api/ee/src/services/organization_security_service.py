"""Service layer for organization security features (domains and SSO providers)."""

import secrets
import hashlib
from typing import List, Optional
from uuid import UUID
from fastapi import HTTPException

from oss.src.dbs.postgres.shared.engine import engine
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


class DomainVerificationService:
    """Service for managing domain verification."""

    @staticmethod
    def generate_verification_token(domain: str) -> str:
        """Generate a unique verification token for a domain."""
        random_token = secrets.token_urlsafe(32)
        combined = f"{domain}:{random_token}"
        return hashlib.sha256(combined.encode()).hexdigest()[:32]

    @staticmethod
    def get_verification_instructions(domain: str, token: str) -> dict:
        """Get DNS verification instructions."""
        return {
            "method": "DNS TXT Record",
            "record_type": "TXT",
            "host": f"_agenta-verification.{domain}",
            "value": f"agenta-verification={token}",
            "instructions": [
                f"1. Log in to your DNS provider for {domain}",
                f"2. Add a TXT record with host: _agenta-verification.{domain}",
                f"3. Set the value to: agenta-verification={token}",
                "4. Wait for DNS propagation (usually 5-30 minutes)",
                "5. Click 'Verify Domain' to complete verification",
            ],
        }

    @staticmethod
    async def verify_domain_dns(domain: str, expected_token: str) -> bool:
        """Verify domain ownership via DNS TXT record."""
        import dns.resolver

        try:
            txt_record_name = f"_agenta-verification.{domain}"
            answers = dns.resolver.resolve(txt_record_name, "TXT")

            for rdata in answers:
                txt_value = rdata.to_text().strip('"')
                if txt_value == f"agenta-verification={expected_token}":
                    return True
            return False
        except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer, dns.resolver.Timeout):
            return False
        except Exception:
            return False

    async def create_domain(
        self,
        organization_id: str,
        payload: OrganizationDomainCreate,
        user_id: str,
    ) -> OrganizationDomainResponse:
        """Create a new domain for verification."""
        async with engine.core_session() as session:
            dao = OrganizationDomainsDAO(session)

            # Check if domain already exists
            existing = await dao.get_by_slug(payload.domain, organization_id)
            if existing:
                raise HTTPException(
                    status_code=400,
                    detail=f"Domain {payload.domain} already exists for this organization",
                )

            # Generate verification token
            token = self.generate_verification_token(payload.domain)

            # Create domain
            domain = await dao.create(
                organization_id=organization_id,
                slug=payload.domain,
                name=payload.name,
                description=payload.description,
                token=token,
                created_by_id=user_id,
            )

            await session.commit()

            return OrganizationDomainResponse(
                id=str(domain.id),
                organization_id=str(domain.organization_id),
                slug=domain.slug,
                name=domain.name,
                description=domain.description,
                token=domain.token,
                is_verified=domain.flags.get("verified", False) if domain.flags else False,
                created_at=domain.created_at,
                updated_at=domain.updated_at,
            )

    async def verify_domain(
        self, organization_id: str, domain_id: str, user_id: str
    ) -> OrganizationDomainResponse:
        """Verify a domain via DNS check."""
        async with engine.core_session() as session:
            dao = OrganizationDomainsDAO(session)

            domain = await dao.get_by_id(domain_id, organization_id)
            if not domain:
                raise HTTPException(status_code=404, detail="Domain not found")

            # Check if already verified
            if domain.flags and domain.flags.get("verified"):
                raise HTTPException(status_code=400, detail="Domain already verified")

            # Perform DNS verification
            is_valid = await self.verify_domain_dns(domain.slug, domain.token)

            if not is_valid:
                raise HTTPException(
                    status_code=400,
                    detail="Domain verification failed. Please ensure the DNS TXT record is correctly configured.",
                )

            # Mark as verified
            domain.flags = {"verified": True}
            domain.updated_by_id = user_id
            await session.commit()

            return OrganizationDomainResponse(
                id=str(domain.id),
                organization_id=str(domain.organization_id),
                slug=domain.slug,
                name=domain.name,
                description=domain.description,
                token=domain.token,
                is_verified=True,
                created_at=domain.created_at,
                updated_at=domain.updated_at,
            )

    async def list_domains(
        self, organization_id: str
    ) -> List[OrganizationDomainResponse]:
        """List all domains for an organization."""
        async with engine.core_session() as session:
            dao = OrganizationDomainsDAO(session)
            domains = await dao.list_by_organization(organization_id)

            return [
                OrganizationDomainResponse(
                    id=str(d.id),
                    organization_id=str(d.organization_id),
                    slug=d.slug,
                    name=d.name,
                    description=d.description,
                    token=d.token,
                    is_verified=d.flags.get("verified", False) if d.flags else False,
                    created_at=d.created_at,
                    updated_at=d.updated_at,
                )
                for d in domains
            ]

    async def delete_domain(
        self, organization_id: str, domain_id: str, user_id: str
    ) -> bool:
        """Delete a domain."""
        async with engine.core_session() as session:
            dao = OrganizationDomainsDAO(session)

            domain = await dao.get_by_id(domain_id, organization_id)
            if not domain:
                raise HTTPException(status_code=404, detail="Domain not found")

            deleted = await dao.delete(domain_id, user_id)
            await session.commit()
            return deleted


class SSOProviderService:
    """Service for managing SSO providers."""

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
        import httpx

        try:
            # Try to fetch OIDC discovery document
            discovery_url = f"{issuer_url.rstrip('/')}/.well-known/openid-configuration"

            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(discovery_url)

                if response.status_code != 200:
                    return False

                config = response.json()

                # Verify required OIDC endpoints exist
                required_fields = ["authorization_endpoint", "token_endpoint", "userinfo_endpoint"]
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
        # Validate provider type (only OIDC supported for now)
        if payload.provider_type != "oidc":
            raise HTTPException(
                status_code=400,
                detail="Only 'oidc' provider type is supported. SAML support coming soon.",
            )

        async with engine.core_session() as session:
            dao = OrganizationProvidersDAO(session)

            # Generate slug from provider type and name
            slug = f"{payload.provider_type}:{payload.name.lower().replace(' ', '-')}"

            # Check if provider with this slug already exists
            existing = await dao.get_by_slug(slug, organization_id)
            if existing:
                raise HTTPException(
                    status_code=400,
                    detail=f"Provider with name '{payload.name}' already exists",
                )

            # Build settings
            settings = {
                "type": payload.provider_type,
                "name": payload.name,
                "client_id": payload.client_id,
                "client_secret": payload.client_secret,
                "issuer_url": payload.issuer_url,
                "authorization_endpoint": payload.authorization_endpoint,
                "token_endpoint": payload.token_endpoint,
                "userinfo_endpoint": payload.userinfo_endpoint,
                "scopes": payload.scopes or ["openid", "profile", "email"],
            }

            # Create provider with is_valid=False and is_active=False initially
            # User must test the connection before activating
            provider = await dao.create(
                organization_id=organization_id,
                slug=slug,
                settings=settings,
                created_by_id=user_id,
                flags={"valid": False, "active": False},
            )

            await session.commit()

            return self._to_response(provider)

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

            provider = await dao.get_by_id(provider_id, organization_id)
            if not provider:
                raise HTTPException(status_code=404, detail="Provider not found")

            # Update settings
            settings = provider.settings.copy()
            settings_changed = False

            if payload.name is not None:
                settings["name"] = payload.name
                settings_changed = True
            if payload.client_id is not None:
                settings["client_id"] = payload.client_id
                settings_changed = True
            if payload.client_secret is not None:
                settings["client_secret"] = payload.client_secret
                settings_changed = True
            if payload.issuer_url is not None:
                settings["issuer_url"] = payload.issuer_url
                settings_changed = True
            if payload.authorization_endpoint is not None:
                settings["authorization_endpoint"] = payload.authorization_endpoint
                settings_changed = True
            if payload.token_endpoint is not None:
                settings["token_endpoint"] = payload.token_endpoint
                settings_changed = True
            if payload.userinfo_endpoint is not None:
                settings["userinfo_endpoint"] = payload.userinfo_endpoint
                settings_changed = True
            if payload.scopes is not None:
                settings["scopes"] = payload.scopes
                settings_changed = True

            # Update flags
            flags = provider.flags.copy() if provider.flags else {}

            # If settings changed, invalidate the provider (needs re-testing)
            if settings_changed:
                flags["valid"] = False
                flags["active"] = False

            # Validate is_active constraint: cannot be true if is_valid is false
            if payload.is_active is not None:
                if payload.is_active and not flags.get("valid", False):
                    raise HTTPException(
                        status_code=400,
                        detail="Cannot activate provider. Please test the connection first.",
                    )
                flags["active"] = payload.is_active

            provider = await dao.update(
                provider_id=provider_id,
                settings=settings,
                flags=flags,
                updated_by_id=user_id,
            )

            await session.commit()

            return self._to_response(provider)

    async def list_providers(
        self, organization_id: str
    ) -> List[OrganizationProviderResponse]:
        """List all SSO providers for an organization."""
        async with engine.core_session() as session:
            dao = OrganizationProvidersDAO(session)
            providers = await dao.list_by_organization(organization_id)

            return [self._to_response(p) for p in providers]

    async def test_provider(
        self, organization_id: str, provider_id: str, user_id: str
    ) -> OrganizationProviderResponse:
        """Test SSO provider connection and mark as valid if successful."""
        async with engine.core_session() as session:
            dao = OrganizationProvidersDAO(session)

            provider = await dao.get_by_id(provider_id, organization_id)
            if not provider:
                raise HTTPException(status_code=404, detail="Provider not found")

            settings = provider.settings

            # Test OIDC connection
            is_valid = await self.test_oidc_connection(
                issuer_url=settings.get("issuer_url", ""),
                client_id=settings.get("client_id", ""),
                client_secret=settings.get("client_secret", ""),
            )

            # Update flags based on test result
            flags = provider.flags.copy() if provider.flags else {}
            flags["valid"] = is_valid

            # If validation failed, deactivate the provider
            if not is_valid:
                flags["active"] = False

            provider = await dao.update(
                provider_id=provider_id,
                flags=flags,
                updated_by_id=user_id,
            )

            await session.commit()

            return self._to_response(provider)

    async def delete_provider(
        self, organization_id: str, provider_id: str, user_id: str
    ) -> bool:
        """Delete an SSO provider."""
        async with engine.core_session() as session:
            dao = OrganizationProvidersDAO(session)

            provider = await dao.get_by_id(provider_id, organization_id)
            if not provider:
                raise HTTPException(status_code=404, detail="Provider not found")

            deleted = await dao.delete(provider_id, user_id)
            await session.commit()
            return deleted

    def _to_response(self, provider) -> OrganizationProviderResponse:
        """Convert DBE to response model."""
        settings = provider.settings
        return OrganizationProviderResponse(
            id=str(provider.id),
            organization_id=str(provider.organization_id),
            slug=provider.slug,
            provider_type=settings.get("type", "oidc"),
            name=settings.get("name", ""),
            client_id=settings.get("client_id", ""),
            client_secret=self.mask_secret(settings.get("client_secret", "")),
            issuer_url=settings.get("issuer_url", ""),
            authorization_endpoint=settings.get("authorization_endpoint"),
            token_endpoint=settings.get("token_endpoint"),
            userinfo_endpoint=settings.get("userinfo_endpoint"),
            scopes=settings.get("scopes", ["openid", "profile", "email"]),
            is_valid=provider.flags.get("valid", False) if provider.flags else False,
            is_active=provider.flags.get("active", False) if provider.flags else False,
            created_at=provider.created_at,
            updated_at=provider.updated_at,
        )
