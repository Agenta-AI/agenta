"""Data Access Objects for organization domains and SSO providers."""

from typing import Optional, List
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from oss.src.dbs.postgres.shared.engine import engine
from ee.src.dbs.postgres.organizations.dbes import (
    OrganizationDomainDBE,
    OrganizationProviderDBE,
)


class OrganizationDomainsDAO:
    """DAO for organization_domains table.

    Can be used in two ways:
    1. With a session (for service layer): OrganizationDomainsDAO(session)
    2. Without a session (creates own sessions): OrganizationDomainsDAO()
    """

    def __init__(self, session: Optional[AsyncSession] = None):
        self.session = session

    async def create(
        self,
        organization_id: str,
        slug: str,
        name: Optional[str],
        description: Optional[str],
        token: str,
        created_by_id: str,
    ) -> OrganizationDomainDBE:
        """Create a new domain for an organization."""
        if self.session:
            domain = OrganizationDomainDBE(
                organization_id=organization_id,
                slug=slug,
                name=name,
                description=description,
                token=token,
                flags={"is_verified": False},
                created_by_id=created_by_id,
            )
            self.session.add(domain)
            await self.session.flush()
            await self.session.refresh(domain)
            return domain
        else:
            async with engine.core_session() as session:
                domain = OrganizationDomainDBE(
                    organization_id=organization_id,
                    slug=slug,
                    name=name,
                    description=description,
                    token=token,
                    flags={"is_verified": False},
                    created_by_id=created_by_id,
                )
                session.add(domain)
                await session.commit()
                await session.refresh(domain)
                return domain

    async def get_by_id(
        self, domain_id: str, organization_id: str
    ) -> Optional[OrganizationDomainDBE]:
        """Get a domain by ID."""
        if self.session:
            result = await self.session.execute(
                select(OrganizationDomainDBE).where(
                    and_(
                        OrganizationDomainDBE.id == domain_id,
                        OrganizationDomainDBE.organization_id == organization_id,
                    )
                )
            )
            return result.scalars().first()
        else:
            async with engine.core_session() as session:
                result = await session.execute(
                    select(OrganizationDomainDBE).where(
                        and_(
                            OrganizationDomainDBE.id == domain_id,
                            OrganizationDomainDBE.organization_id == organization_id,
                        )
                    )
                )
                return result.scalars().first()

    async def get_by_slug(
        self, slug: str, organization_id: str
    ) -> Optional[OrganizationDomainDBE]:
        """Get a domain by slug (domain name)."""
        if self.session:
            result = await self.session.execute(
                select(OrganizationDomainDBE).where(
                    and_(
                        OrganizationDomainDBE.slug == slug,
                        OrganizationDomainDBE.organization_id == organization_id,
                    )
                )
            )
            return result.scalars().first()
        else:
            async with engine.core_session() as session:
                result = await session.execute(
                    select(OrganizationDomainDBE).where(
                        and_(
                            OrganizationDomainDBE.slug == slug,
                            OrganizationDomainDBE.organization_id == organization_id,
                        )
                    )
                )
                return result.scalars().first()

    async def get_verified_by_slug(self, slug: str) -> Optional[OrganizationDomainDBE]:
        """Get a verified domain by slug (domain name), across organizations."""
        is_verified = OrganizationDomainDBE.flags["is_verified"].astext == "true"
        if self.session:
            result = await self.session.execute(
                select(OrganizationDomainDBE).where(
                    and_(
                        OrganizationDomainDBE.slug == slug,
                        is_verified,
                    )
                )
            )
            return result.scalars().first()
        else:
            async with engine.core_session() as session:
                result = await session.execute(
                    select(OrganizationDomainDBE).where(
                        and_(
                            OrganizationDomainDBE.slug == slug,
                            is_verified,
                        )
                    )
                )
                return result.scalars().first()

    async def list_by_organization(
        self, organization_id: str
    ) -> List[OrganizationDomainDBE]:
        """List all domains for an organization."""
        if self.session:
            result = await self.session.execute(
                select(OrganizationDomainDBE).where(
                    OrganizationDomainDBE.organization_id == organization_id
                )
            )
            return list(result.scalars().all())
        else:
            async with engine.core_session() as session:
                result = await session.execute(
                    select(OrganizationDomainDBE).where(
                        OrganizationDomainDBE.organization_id == organization_id
                    )
                )
                return list(result.scalars().all())

    async def update_flags(
        self, domain_id: str, flags: dict, updated_by_id: str
    ) -> Optional[OrganizationDomainDBE]:
        """Update domain flags (e.g., mark as verified)."""
        domain = await self.get_by_id(domain_id, organization_id="")
        if self.session:
            if domain:
                domain.flags = flags
                domain.updated_by_id = updated_by_id
                await self.session.flush()
                await self.session.refresh(domain)
            return domain
        else:
            async with engine.core_session() as session:
                if domain:
                    # Re-attach to new session
                    domain = await session.get(OrganizationDomainDBE, domain_id)
                    if domain:
                        domain.flags = flags
                        domain.updated_by_id = updated_by_id
                        await session.commit()
                        await session.refresh(domain)
                return domain

    async def delete(self, domain_id: str, deleted_by_id: str) -> bool:
        """Hard delete a domain."""
        if self.session:
            domain = await self.session.get(OrganizationDomainDBE, domain_id)
            if domain:
                await self.session.delete(domain)
                await self.session.flush()
                return True
            return False
        else:
            async with engine.core_session() as session:
                domain = await session.get(OrganizationDomainDBE, domain_id)
                if domain:
                    await session.delete(domain)
                    await session.commit()
                    return True
                return False


class OrganizationProvidersDAO:
    """DAO for organization_providers table.

    Can be used in two ways:
    1. With a session (for service layer): OrganizationProvidersDAO(session)
    2. Without a session (creates own sessions): OrganizationProvidersDAO()
    """

    def __init__(self, session: Optional[AsyncSession] = None):
        self.session = session

    async def create(
        self,
        organization_id: str,
        slug: str,
        secret_id: str,
        created_by_id: str,
        name: Optional[str],
        description: Optional[str] = None,
        flags: Optional[dict] = None,
    ) -> OrganizationProviderDBE:
        """Create a new SSO provider for an organization."""
        if self.session:
            provider = OrganizationProviderDBE(
                organization_id=organization_id,
                slug=slug,
                name=name,
                description=description,
                secret_id=secret_id,
                flags=flags or {"is_active": True, "is_valid": False},
                created_by_id=created_by_id,
            )
            self.session.add(provider)
            await self.session.flush()
            await self.session.refresh(provider)
            return provider
        else:
            async with engine.core_session() as session:
                provider = OrganizationProviderDBE(
                    organization_id=organization_id,
                    slug=slug,
                    name=name,
                    description=description,
                    secret_id=secret_id,
                    flags=flags or {"is_active": True, "is_valid": False},
                    created_by_id=created_by_id,
                )
                session.add(provider)
                await session.commit()
                await session.refresh(provider)
                return provider

    async def get_by_id(
        self, provider_id: str, organization_id: str
    ) -> Optional[OrganizationProviderDBE]:
        """Get a provider by ID."""
        if self.session:
            result = await self.session.execute(
                select(OrganizationProviderDBE).where(
                    and_(
                        OrganizationProviderDBE.id == provider_id,
                        OrganizationProviderDBE.organization_id == organization_id,
                    )
                )
            )
            return result.scalars().first()
        else:
            async with engine.core_session() as session:
                result = await session.execute(
                    select(OrganizationProviderDBE).where(
                        and_(
                            OrganizationProviderDBE.id == provider_id,
                            OrganizationProviderDBE.organization_id == organization_id,
                        )
                    )
                )
                return result.scalars().first()

    async def get_by_slug(
        self, slug: str, organization_id: str
    ) -> Optional[OrganizationProviderDBE]:
        """Get a provider by slug."""
        if self.session:
            result = await self.session.execute(
                select(OrganizationProviderDBE).where(
                    and_(
                        OrganizationProviderDBE.slug == slug,
                        OrganizationProviderDBE.organization_id == organization_id,
                    )
                )
            )
            return result.scalars().first()
        else:
            async with engine.core_session() as session:
                result = await session.execute(
                    select(OrganizationProviderDBE).where(
                        and_(
                            OrganizationProviderDBE.slug == slug,
                            OrganizationProviderDBE.organization_id == organization_id,
                        )
                    )
                )
                return result.scalars().first()

    async def list_by_organization(
        self, organization_id: str
    ) -> List[OrganizationProviderDBE]:
        """List all SSO providers for an organization."""
        if self.session:
            result = await self.session.execute(
                select(OrganizationProviderDBE).where(
                    OrganizationProviderDBE.organization_id == organization_id
                )
            )
            return list(result.scalars().all())
        else:
            async with engine.core_session() as session:
                result = await session.execute(
                    select(OrganizationProviderDBE).where(
                        OrganizationProviderDBE.organization_id == organization_id
                    )
                )
                return list(result.scalars().all())

    async def update(
        self,
        provider_id: str,
        secret_id: Optional[str] = None,
        flags: Optional[dict] = None,
        updated_by_id: Optional[str] = None,
    ) -> Optional[OrganizationProviderDBE]:
        """Update a provider's secret reference or flags."""
        if self.session:
            provider = await self.session.get(OrganizationProviderDBE, provider_id)
            if provider:
                if secret_id is not None:
                    provider.secret_id = secret_id
                if flags is not None:
                    provider.flags = flags
                if updated_by_id:
                    provider.updated_by_id = updated_by_id
                await self.session.flush()
                await self.session.refresh(provider)
            return provider
        else:
            async with engine.core_session() as session:
                provider = await session.get(OrganizationProviderDBE, provider_id)
                if provider:
                    if secret_id is not None:
                        provider.secret_id = secret_id
                    if flags is not None:
                        provider.flags = flags
                    if updated_by_id:
                        provider.updated_by_id = updated_by_id
                    await session.commit()
                    await session.refresh(provider)
                return provider

    async def delete(self, provider_id: str, deleted_by_id: str) -> bool:
        """Hard delete a provider."""
        if self.session:
            provider = await self.session.get(OrganizationProviderDBE, provider_id)
            if provider:
                await self.session.delete(provider)
                await self.session.flush()
                return True
            return False
        else:
            async with engine.core_session() as session:
                provider = await session.get(OrganizationProviderDBE, provider_id)
                if provider:
                    await session.delete(provider)
                    await session.commit()
                    return True
                return False
