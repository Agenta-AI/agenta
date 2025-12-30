"""Data Access Objects for organization domains and SSO providers."""

from typing import Optional, List
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ee.src.dbs.postgres.organizations.dbes import (
    OrganizationDomainDBE,
    OrganizationProviderDBE,
)


class OrganizationDomainsDAO:
    """DAO for organization_domains table."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(
        self,
        organization_id: str,
        slug: str,
        name: str,
        description: Optional[str],
        token: str,
        created_by_id: str,
    ) -> OrganizationDomainDBE:
        """Create a new domain for an organization."""
        domain = OrganizationDomainDBE(
            organization_id=organization_id,
            slug=slug,
            name=name,
            description=description,
            token=token,
            flags={"verified": False},
            created_by_id=created_by_id,
        )
        self.session.add(domain)
        await self.session.flush()
        await self.session.refresh(domain)
        return domain

    async def get_by_id(
        self, domain_id: str, organization_id: str
    ) -> Optional[OrganizationDomainDBE]:
        """Get a domain by ID."""
        result = await self.session.execute(
            select(OrganizationDomainDBE).where(
                and_(
                    OrganizationDomainDBE.id == domain_id,
                    OrganizationDomainDBE.organization_id == organization_id,
                    OrganizationDomainDBE.deleted_at.is_(None),
                )
            )
        )
        return result.scalars().first()

    async def get_by_slug(
        self, slug: str, organization_id: str
    ) -> Optional[OrganizationDomainDBE]:
        """Get a domain by slug (domain name)."""
        result = await self.session.execute(
            select(OrganizationDomainDBE).where(
                and_(
                    OrganizationDomainDBE.slug == slug,
                    OrganizationDomainDBE.organization_id == organization_id,
                    OrganizationDomainDBE.deleted_at.is_(None),
                )
            )
        )
        return result.scalars().first()

    async def list_by_organization(
        self, organization_id: str
    ) -> List[OrganizationDomainDBE]:
        """List all domains for an organization."""
        result = await self.session.execute(
            select(OrganizationDomainDBE).where(
                and_(
                    OrganizationDomainDBE.organization_id == organization_id,
                    OrganizationDomainDBE.deleted_at.is_(None),
                )
            )
        )
        return list(result.scalars().all())

    async def update_flags(
        self, domain_id: str, flags: dict, updated_by_id: str
    ) -> Optional[OrganizationDomainDBE]:
        """Update domain flags (e.g., mark as verified)."""
        domain = await self.get_by_id(domain_id, organization_id="")  # Will be filtered by ID
        if domain:
            domain.flags = flags
            domain.updated_by_id = updated_by_id
            await self.session.flush()
            await self.session.refresh(domain)
        return domain

    async def delete(self, domain_id: str, deleted_by_id: str) -> bool:
        """Soft delete a domain."""
        domain = await self.session.get(OrganizationDomainDBE, domain_id)
        if domain and not domain.deleted_at:
            from datetime import datetime, timezone

            domain.deleted_at = datetime.now(timezone.utc)
            domain.deleted_by_id = deleted_by_id
            await self.session.flush()
            return True
        return False


class OrganizationProvidersDAO:
    """DAO for organization_providers table."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(
        self,
        organization_id: str,
        slug: str,
        settings: dict,
        created_by_id: str,
        flags: Optional[dict] = None,
    ) -> OrganizationProviderDBE:
        """Create a new SSO provider for an organization."""
        provider = OrganizationProviderDBE(
            organization_id=organization_id,
            slug=slug,
            settings=settings,
            flags=flags or {"active": True},
            created_by_id=created_by_id,
        )
        self.session.add(provider)
        await self.session.flush()
        await self.session.refresh(provider)
        return provider

    async def get_by_id(
        self, provider_id: str, organization_id: str
    ) -> Optional[OrganizationProviderDBE]:
        """Get a provider by ID."""
        result = await self.session.execute(
            select(OrganizationProviderDBE).where(
                and_(
                    OrganizationProviderDBE.id == provider_id,
                    OrganizationProviderDBE.organization_id == organization_id,
                    OrganizationProviderDBE.deleted_at.is_(None),
                )
            )
        )
        return result.scalars().first()

    async def get_by_slug(
        self, slug: str, organization_id: str
    ) -> Optional[OrganizationProviderDBE]:
        """Get a provider by slug."""
        result = await self.session.execute(
            select(OrganizationProviderDBE).where(
                and_(
                    OrganizationProviderDBE.slug == slug,
                    OrganizationProviderDBE.organization_id == organization_id,
                    OrganizationProviderDBE.deleted_at.is_(None),
                )
            )
        )
        return result.scalars().first()

    async def list_by_organization(
        self, organization_id: str
    ) -> List[OrganizationProviderDBE]:
        """List all SSO providers for an organization."""
        result = await self.session.execute(
            select(OrganizationProviderDBE).where(
                and_(
                    OrganizationProviderDBE.organization_id == organization_id,
                    OrganizationProviderDBE.deleted_at.is_(None),
                )
            )
        )
        return list(result.scalars().all())

    async def update(
        self,
        provider_id: str,
        settings: Optional[dict] = None,
        flags: Optional[dict] = None,
        updated_by_id: Optional[str] = None,
    ) -> Optional[OrganizationProviderDBE]:
        """Update a provider's settings or flags."""
        provider = await self.session.get(OrganizationProviderDBE, provider_id)
        if provider and not provider.deleted_at:
            if settings is not None:
                provider.settings = settings
            if flags is not None:
                provider.flags = flags
            if updated_by_id:
                provider.updated_by_id = updated_by_id
            await self.session.flush()
            await self.session.refresh(provider)
        return provider

    async def delete(self, provider_id: str, deleted_by_id: str) -> bool:
        """Soft delete a provider."""
        provider = await self.session.get(OrganizationProviderDBE, provider_id)
        if provider and not provider.deleted_at:
            from datetime import datetime, timezone

            provider.deleted_at = datetime.now(timezone.utc)
            provider.deleted_by_id = deleted_by_id
            await self.session.flush()
            return True
        return False
