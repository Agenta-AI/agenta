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
from oss.src.dbs.postgres.organizations.dbes import (
    OrganizationPolicyDBE,
    OrganizationDomainDBE,
    OrganizationProviderDBE,
    OrganizationInvitationDBE,
)


# Policy mappings
def map_policy_dbe_to_dto(dbe: OrganizationPolicyDBE) -> OrganizationPolicy:
    return OrganizationPolicy(
        id=dbe.id,
        organization_id=dbe.organization_id,
        allowed_methods=dbe.allowed_methods,
        invitation_only=dbe.invitation_only,
        domains_only=dbe.domains_only,
        disable_root=dbe.disable_root,
        created_at=dbe.created_at,
        updated_at=dbe.updated_at,
    )


def map_create_policy_dto_to_dbe(
    dto: OrganizationPolicyCreate,
) -> OrganizationPolicyDBE:
    return OrganizationPolicyDBE(
        organization_id=dto.organization_id,
        allowed_methods=dto.allowed_methods,
        invitation_only=dto.invitation_only,
        domains_only=dto.domains_only,
        disable_root=dto.disable_root,
    )


def map_update_policy_dto_to_dbe(
    dbe: OrganizationPolicyDBE, dto: OrganizationPolicyUpdate
) -> None:
    if dto.allowed_methods is not None:
        dbe.allowed_methods = dto.allowed_methods
    if dto.invitation_only is not None:
        dbe.invitation_only = dto.invitation_only
    if dto.domains_only is not None:
        dbe.domains_only = dto.domains_only
    if dto.disable_root is not None:
        dbe.disable_root = dto.disable_root


# Domain mappings
def map_domain_dbe_to_dto(dbe: OrganizationDomainDBE) -> OrganizationDomain:
    return OrganizationDomain(
        id=dbe.id,
        organization_id=dbe.organization_id,
        domain=dbe.domain,
        verified=dbe.verified,
        verification_token=dbe.verification_token,
        created_at=dbe.created_at,
        updated_at=dbe.updated_at,
    )


def map_create_domain_dto_to_dbe(
    dto: OrganizationDomainCreate,
) -> OrganizationDomainDBE:
    return OrganizationDomainDBE(
        organization_id=dto.organization_id,
        domain=dto.domain,
        verification_token=dto.verification_token,
        verified=False,
    )


# Provider mappings
def map_provider_dbe_to_dto(dbe: OrganizationProviderDBE) -> OrganizationProvider:
    return OrganizationProvider(
        id=dbe.id,
        organization_id=dbe.organization_id,
        slug=dbe.slug,
        name=dbe.name,
        description=dbe.description,
        enabled=dbe.enabled,
        domain_id=dbe.domain_id,
        config=dbe.config,
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
        enabled=dto.enabled,
        domain_id=dto.domain_id,
        config=dto.config,
    )


def map_update_provider_dto_to_dbe(
    dbe: OrganizationProviderDBE, dto: OrganizationProviderUpdate
) -> None:
    if dto.name is not None:
        dbe.name = dto.name
    if dto.description is not None:
        dbe.description = dto.description
    if dto.enabled is not None:
        dbe.enabled = dto.enabled
    if dto.domain_id is not None:
        dbe.domain_id = dto.domain_id
    if dto.config is not None:
        dbe.config = dto.config


# Invitation mappings
def map_invitation_dbe_to_dto(
    dbe: OrganizationInvitationDBE,
) -> OrganizationInvitation:
    return OrganizationInvitation(
        id=dbe.id,
        organization_id=dbe.organization_id,
        email=dbe.email,
        role=dbe.role,
        token=dbe.token,
        status=dbe.status,
        expires_at=dbe.expires_at,
        created_at=dbe.created_at,
        updated_at=dbe.updated_at,
    )


def map_create_invitation_dto_to_dbe(
    dto: OrganizationInvitationCreate,
) -> OrganizationInvitationDBE:
    return OrganizationInvitationDBE(
        organization_id=dto.organization_id,
        email=dto.email,
        role=dto.role,
        token=dto.token,
        expires_at=dto.expires_at,
        status="pending",
    )
