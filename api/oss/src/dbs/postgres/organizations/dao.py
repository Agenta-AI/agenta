from uuid import UUID
from typing import Optional, List
from sqlalchemy import select

from oss.src.dbs.postgres.shared.engine import engine
from oss.src.dbs.postgres.organizations.dbes import (
    OrganizationPolicyDBE,
    OrganizationDomainDBE,
    OrganizationProviderDBE,
    OrganizationInvitationDBE,
)
from oss.src.dbs.postgres.organizations.mappings import (
    map_policy_dbe_to_dto,
    map_create_policy_dto_to_dbe,
    map_update_policy_dto_to_dbe,
    map_domain_dbe_to_dto,
    map_create_domain_dto_to_dbe,
    map_provider_dbe_to_dto,
    map_create_provider_dto_to_dbe,
    map_update_provider_dto_to_dbe,
    map_invitation_dbe_to_dto,
    map_create_invitation_dto_to_dbe,
)
from ee.src.core.organizations.types import (
    OrganizationPolicy,
    OrganizationPolicyCreate,
    OrganizationPolicyUpdate,
    OrganizationDomain,
    OrganizationDomainCreate,
    OrganizationProvider,
    OrganizationProviderCreate,
    OrganizationProviderUpdate,
    OrganizationInvitation,
    OrganizationInvitationCreate,
)


class OrganizationPoliciesDAO:
    async def create(self, dto: OrganizationPolicyCreate) -> OrganizationPolicy:
        policy_dbe = map_create_policy_dto_to_dbe(dto)

        async with engine.core_session() as session:
            session.add(policy_dbe)
            await session.commit()
            await session.refresh(policy_dbe)

        return map_policy_dbe_to_dto(policy_dbe)

    async def get_by_organization(
        self, organization_id: UUID
    ) -> Optional[OrganizationPolicy]:
        async with engine.core_session() as session:
            stmt = select(OrganizationPolicyDBE).filter_by(
                organization_id=organization_id
            )
            result = await session.execute(stmt)
            policy_dbe = result.scalar()

            if policy_dbe is None:
                return None

            return map_policy_dbe_to_dto(policy_dbe)

    async def update(
        self,
        organization_id: UUID,
        dto: OrganizationPolicyUpdate,
    ) -> Optional[OrganizationPolicy]:
        async with engine.core_session() as session:
            stmt = select(OrganizationPolicyDBE).filter_by(
                organization_id=organization_id
            )
            result = await session.execute(stmt)
            policy_dbe = result.scalar()

            if policy_dbe is None:
                return None

            map_update_policy_dto_to_dbe(policy_dbe, dto)
            await session.commit()
            await session.refresh(policy_dbe)

            return map_policy_dbe_to_dto(policy_dbe)


class OrganizationDomainsDAO:
    async def create(self, dto: OrganizationDomainCreate) -> OrganizationDomain:
        domain_dbe = map_create_domain_dto_to_dbe(dto)

        async with engine.core_session() as session:
            session.add(domain_dbe)
            await session.commit()
            await session.refresh(domain_dbe)

        return map_domain_dbe_to_dto(domain_dbe)

    async def get_by_id(self, domain_id: UUID) -> Optional[OrganizationDomain]:
        async with engine.core_session() as session:
            stmt = select(OrganizationDomainDBE).filter_by(id=domain_id)
            result = await session.execute(stmt)
            domain_dbe = result.scalar()

            if domain_dbe is None:
                return None

            return map_domain_dbe_to_dto(domain_dbe)

    async def get_by_domain(self, domain: str) -> Optional[OrganizationDomain]:
        async with engine.core_session() as session:
            stmt = select(OrganizationDomainDBE).filter_by(domain=domain)
            result = await session.execute(stmt)
            domain_dbe = result.scalar()

            if domain_dbe is None:
                return None

            return map_domain_dbe_to_dto(domain_dbe)

    async def list_by_organization(
        self, organization_id: UUID, verified_only: bool = False
    ) -> List[OrganizationDomain]:
        async with engine.core_session() as session:
            stmt = select(OrganizationDomainDBE).filter_by(
                organization_id=organization_id
            )
            if verified_only:
                stmt = stmt.filter_by(verified=True)

            result = await session.execute(stmt)
            domain_dbes = result.scalars().all()

            return [map_domain_dbe_to_dto(dbe) for dbe in domain_dbes]

    async def mark_verified(self, domain_id: UUID) -> Optional[OrganizationDomain]:
        from oss.src.models.db_models import OrganizationDB

        async with engine.core_session() as session:
            stmt = select(OrganizationDomainDBE).filter_by(id=domain_id)
            result = await session.execute(stmt)
            domain_dbe = result.scalar()

            if domain_dbe is None:
                return None

            # GOVERNANCE: Domain verification exclusivity enforcement
            # Only one collaborative organization can verify a domain at a time
            # Check if organization is collaborative (personal orgs cannot verify domains)
            org_stmt = select(OrganizationDB).filter_by(id=domain_dbe.organization_id)
            org_result = await session.execute(org_stmt)
            org = org_result.scalar()

            if org is None:
                raise ValueError("Organization not found")

            if org.flags.get("is_personal", True):
                raise ValueError(
                    "Personal organizations cannot verify domains. "
                    "Domain verification is only available for collaborative organizations."
                )

            # Check if any OTHER organization has already verified this domain
            existing_verified = select(OrganizationDomainDBE).filter(
                OrganizationDomainDBE.domain == domain_dbe.domain,
                OrganizationDomainDBE.verified == True,
                OrganizationDomainDBE.organization_id != domain_dbe.organization_id,
            )
            existing_result = await session.execute(existing_verified)
            conflicting_domain = existing_result.scalar()

            if conflicting_domain:
                raise ValueError(
                    f"Domain '{domain_dbe.domain}' is already verified by another organization. "
                    "Each domain can only be verified by one organization at a time."
                )

            domain_dbe.verified = True
            await session.commit()
            await session.refresh(domain_dbe)

            return map_domain_dbe_to_dto(domain_dbe)


class OrganizationProvidersDAO:
    async def create(self, dto: OrganizationProviderCreate) -> OrganizationProvider:
        provider_dbe = map_create_provider_dto_to_dbe(dto)

        async with engine.core_session() as session:
            session.add(provider_dbe)
            await session.commit()
            await session.refresh(provider_dbe)

        return map_provider_dbe_to_dto(provider_dbe)

    async def get_by_id(self, provider_id: UUID) -> Optional[OrganizationProvider]:
        async with engine.core_session() as session:
            stmt = select(OrganizationProviderDBE).filter_by(id=provider_id)
            result = await session.execute(stmt)
            provider_dbe = result.scalar()

            if provider_dbe is None:
                return None

            return map_provider_dbe_to_dto(provider_dbe)

    async def get_by_slug(
        self, organization_id: UUID, slug: str
    ) -> Optional[OrganizationProvider]:
        async with engine.core_session() as session:
            stmt = select(OrganizationProviderDBE).filter_by(
                organization_id=organization_id, slug=slug
            )
            result = await session.execute(stmt)
            provider_dbe = result.scalar()

            if provider_dbe is None:
                return None

            return map_provider_dbe_to_dto(provider_dbe)

    async def list_by_organization(
        self, organization_id: UUID, enabled_only: bool = False
    ) -> List[OrganizationProvider]:
        async with engine.core_session() as session:
            stmt = select(OrganizationProviderDBE).filter_by(
                organization_id=organization_id
            )
            if enabled_only:
                stmt = stmt.filter_by(enabled=True)

            result = await session.execute(stmt)
            provider_dbes = result.scalars().all()

            return [map_provider_dbe_to_dto(dbe) for dbe in provider_dbes]

    async def list_by_domain(
        self, domain_id: UUID, enabled_only: bool = False
    ) -> List[OrganizationProvider]:
        async with engine.core_session() as session:
            stmt = select(OrganizationProviderDBE).filter_by(domain_id=domain_id)
            if enabled_only:
                stmt = stmt.filter_by(enabled=True)

            result = await session.execute(stmt)
            provider_dbes = result.scalars().all()

            return [map_provider_dbe_to_dto(dbe) for dbe in provider_dbes]

    async def update(
        self,
        provider_id: UUID,
        dto: OrganizationProviderUpdate,
    ) -> Optional[OrganizationProvider]:
        async with engine.core_session() as session:
            stmt = select(OrganizationProviderDBE).filter_by(id=provider_id)
            result = await session.execute(stmt)
            provider_dbe = result.scalar()

            if provider_dbe is None:
                return None

            map_update_provider_dto_to_dbe(provider_dbe, dto)
            await session.commit()
            await session.refresh(provider_dbe)

            return map_provider_dbe_to_dto(provider_dbe)


class OrganizationInvitationsDAO:
    async def create(self, dto: OrganizationInvitationCreate) -> OrganizationInvitation:
        invitation_dbe = map_create_invitation_dto_to_dbe(dto)

        async with engine.core_session() as session:
            session.add(invitation_dbe)
            await session.commit()
            await session.refresh(invitation_dbe)

        return map_invitation_dbe_to_dto(invitation_dbe)

    async def get_by_token(self, token: str) -> Optional[OrganizationInvitation]:
        async with engine.core_session() as session:
            stmt = select(OrganizationInvitationDBE).filter_by(token=token)
            result = await session.execute(stmt)
            invitation_dbe = result.scalar()

            if invitation_dbe is None:
                return None

            return map_invitation_dbe_to_dto(invitation_dbe)

    async def list_by_organization(
        self, organization_id: UUID, status: Optional[str] = None
    ) -> List[OrganizationInvitation]:
        async with engine.core_session() as session:
            stmt = select(OrganizationInvitationDBE).filter_by(
                organization_id=organization_id
            )
            if status:
                stmt = stmt.filter_by(status=status)

            result = await session.execute(stmt)
            invitation_dbes = result.scalars().all()

            return [map_invitation_dbe_to_dto(dbe) for dbe in invitation_dbes]
