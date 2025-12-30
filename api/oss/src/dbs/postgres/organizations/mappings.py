from ee.src.core.organizations.types import (
    OrganizationDomain,
    OrganizationDomainCreate,
    OrganizationProvider,
    OrganizationProviderCreate,
    OrganizationProviderUpdate,
)
from oss.src.dbs.postgres.organizations.dbes import (
    OrganizationDomainDBE,
    OrganizationProviderDBE,
)


# Domain mappings
def map_domain_dbe_to_dto(dbe: OrganizationDomainDBE) -> OrganizationDomain:
    return OrganizationDomain(
        id=dbe.id,
        organization_id=dbe.organization_id,
        slug=dbe.slug,
        name=dbe.name,
        description=dbe.description,
        token=dbe.token,
        flags=dbe.flags,
        tags=dbe.tags,
        meta=dbe.meta,
        created_at=dbe.created_at,
        updated_at=dbe.updated_at,
    )


def map_create_domain_dto_to_dbe(
    dto: OrganizationDomainCreate,
) -> OrganizationDomainDBE:
    return OrganizationDomainDBE(
        organization_id=dto.organization_id,
        slug=dto.slug,
        name=dto.name,
        description=dto.description,
        token=dto.token,
        flags=dto.flags,
        tags=dto.tags,
        meta=dto.meta,
    )


# Provider mappings
def map_provider_dbe_to_dto(dbe: OrganizationProviderDBE) -> OrganizationProvider:
    return OrganizationProvider(
        id=dbe.id,
        organization_id=dbe.organization_id,
        slug=dbe.slug,
        name=dbe.name,
        description=dbe.description,
        settings=dbe.settings,
        flags=dbe.flags,
        tags=dbe.tags,
        meta=dbe.meta,
        created_at=dbe.created_at,
        updated_at=dbe.updated_at,
    )


def map_create_provider_dto_to_dbe(
    dto: OrganizationProviderCreate,
) -> OrganizationProviderDBE:
    return OrganizationProviderDBE(
        organization_id=dto.organization_id,
        slug=dto.slug,
        name=dto.name,
        description=dto.description,
        settings=dto.settings,
        flags=dto.flags,
        tags=dto.tags,
        meta=dto.meta,
    )


def map_update_provider_dto_to_dbe(
    dbe: OrganizationProviderDBE, dto: OrganizationProviderUpdate
) -> None:
    if dto.name is not None:
        dbe.name = dto.name
    if dto.description is not None:
        dbe.description = dto.description
    if dto.settings is not None:
        dbe.settings = dto.settings
    if dto.flags is not None:
        dbe.flags = dto.flags
    if dto.tags is not None:
        dbe.tags = dto.tags
    if dto.meta is not None:
        dbe.meta = dto.meta
