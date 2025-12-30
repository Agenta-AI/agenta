"""Service layer for organization security features (domains and SSO providers)."""

import secrets
import hashlib
import logging
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

logger = logging.getLogger(__name__)


class DomainVerificationService:
    """Service for managing domain verification."""

    TOKEN_EXPIRY_HOURS = 48

    @staticmethod
    def generate_verification_token() -> str:
        """Generate a unique verification token."""
        # Generate cryptographically secure random token (32 bytes = 64 hex chars)
        random_part = secrets.token_hex(32)

        # Add prefix to make it identifiable as an Agenta verification token
        return f"ag_{random_part}"

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
            logger.info(f"Attempting DNS verification for {txt_record_name}")

            answers = dns.resolver.resolve(txt_record_name, "TXT")
            logger.info(f"Found {len(answers)} TXT records for {txt_record_name}")

            for rdata in answers:
                txt_value = rdata.to_text().strip('"')
                logger.info(f"TXT record value: {txt_value}")

                # Extract the token value from "agenta-verification=TOKEN" format
                if txt_value.startswith("agenta-verification="):
                    token = txt_value.split("=", 1)[1]
                    logger.info(f"Extracted token from DNS: {token}")
                    logger.info(f"Expected token from DB: {expected_token}")
                    logger.info(f"Tokens match: {token == expected_token}")
                    if token == expected_token:
                        logger.info(f"Domain verification successful for {domain}")
                        return True
                    else:
                        logger.warning(
                            f"Token mismatch for {domain}. Expected length: {len(expected_token)}, Got length: {len(token)}"
                        )
                        logger.warning(f"Expected: {expected_token}")
                        logger.warning(f"Got: {token}")

            logger.warning(
                f"No matching verification token found in DNS records for {domain}"
            )
            return False
        except dns.resolver.NXDOMAIN:
            logger.warning(f"DNS record not found (NXDOMAIN) for {txt_record_name}")
            return False
        except dns.resolver.NoAnswer:
            logger.warning(f"No TXT records found (NoAnswer) for {txt_record_name}")
            return False
        except dns.resolver.Timeout:
            logger.error(f"DNS lookup timeout for {txt_record_name}")
            return False
        except Exception as e:
            logger.error(
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
            existing_verified = await dao.get_verified_by_slug(payload.domain)
            if existing_verified:
                raise HTTPException(
                    status_code=409,
                    detail=f"Domain {payload.domain} is already verified",
                )

            # Reuse existing unverified domain for this organization, if any
            existing = await dao.get_by_slug(payload.domain, organization_id)
            if existing and not (existing.flags or {}).get("is_verified"):
                from datetime import datetime, timezone

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
                    organization_id=organization_id,
                    slug=payload.domain,
                    name=payload.name,
                    description=payload.description,
                    token=token,
                    created_by_id=user_id,
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
        from datetime import datetime, timezone, timedelta

        async with engine.core_session() as session:
            dao = OrganizationDomainsDAO(session)

            domain = await dao.get_by_id(domain_id, organization_id)
            if not domain:
                raise HTTPException(status_code=404, detail="Domain not found")

            # Check if already verified
            if domain.flags and domain.flags.get("is_verified"):
                raise HTTPException(status_code=400, detail="Domain already verified")

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
            domains = await dao.list_by_organization(organization_id)

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

            domain = await dao.get_by_id(domain_id, organization_id)
            if not domain:
                raise HTTPException(status_code=404, detail="Domain not found")

            # Generate new token
            new_token = self.generate_verification_token()

            # Update domain with new token and reset created_at to restart the 48-hour expiry window
            # If domain was verified, mark as unverified for re-verification
            from datetime import datetime, timezone

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

            domain = await dao.get_by_id(domain_id, organization_id)
            if not domain:
                raise HTTPException(status_code=404, detail="Domain not found")

            # Generate new token
            new_token = self.generate_verification_token()

            # Reset domain to unverified state with new token
            from datetime import datetime, timezone

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
                flags={"is_valid": False, "is_active": False},
            )

            await session.commit()
            await session.refresh(provider)

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
                flags["is_valid"] = False
                flags["is_active"] = False

            # Validate is_active constraint: cannot be true if is_valid is false
            if payload.is_active is not None:
                if payload.is_active and not flags.get("is_valid", False):
                    raise HTTPException(
                        status_code=400,
                        detail="Cannot activate provider. Please test the connection first.",
                    )
                flags["is_active"] = payload.is_active

            provider = await dao.update(
                provider_id=provider_id,
                settings=settings,
                flags=flags,
                updated_by_id=user_id,
            )

            await session.commit()
            await session.refresh(provider)

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
            flags["is_valid"] = is_valid

            # If validation failed, deactivate the provider
            if not is_valid:
                flags["is_active"] = False

            provider = await dao.update(
                provider_id=provider_id,
                flags=flags,
                updated_by_id=user_id,
            )

            await session.commit()
            await session.refresh(provider)

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
            flags=provider.flags or {},
            created_at=provider.created_at,
            updated_at=provider.updated_at,
        )
