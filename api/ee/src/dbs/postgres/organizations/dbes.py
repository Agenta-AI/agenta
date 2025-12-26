from sqlalchemy import (
    ForeignKeyConstraint,
    UniqueConstraint,
    Index,
)

from oss.src.dbs.postgres.shared.base import Base
from ee.src.dbs.postgres.organizations.dbas import (
    OrganizationPolicyDBA,
    OrganizationDomainDBA,
    OrganizationProviderDBA,
    OrganizationInvitationDBA,
)


class OrganizationPolicyDBE(Base, OrganizationPolicyDBA):
    __tablename__ = "organization_policies"

    __table_args__ = (
        ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint(
            "organization_id",
            name="uq_organization_policies_org",
        ),
    )


class OrganizationDomainDBE(Base, OrganizationDomainDBA):
    __tablename__ = "organization_domains"

    __table_args__ = (
        ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint(
            "domain",
            name="uq_organization_domains_domain",
        ),
        Index(
            "ix_organization_domains_org_verified",
            "organization_id",
            "verified",
        ),
    )


class OrganizationProviderDBE(Base, OrganizationProviderDBA):
    __tablename__ = "organization_providers"

    __table_args__ = (
        ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["domain_id"],
            ["organization_domains.id"],
            ondelete="SET NULL",
        ),
        UniqueConstraint(
            "organization_id",
            "slug",
            name="uq_organization_providers_org_slug",
        ),
        Index(
            "ix_organization_providers_org_enabled",
            "organization_id",
            "enabled",
        ),
    )


class OrganizationInvitationDBE(Base, OrganizationInvitationDBA):
    __tablename__ = "organization_invitations"

    __table_args__ = (
        ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint(
            "token",
            name="uq_organization_invitations_token",
        ),
        Index(
            "ix_organization_invitations_org_email_status",
            "organization_id",
            "email",
            "status",
        ),
    )
