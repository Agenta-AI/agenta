from sqlalchemy import (
    ForeignKeyConstraint,
    UniqueConstraint,
    Index,
)

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.organizations.dbas import (
    OrganizationDomainDBA,
    OrganizationProviderDBA,
    OrganizationInvitationDBA,
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
            "slug",
            name="uq_organization_domains_slug",
        ),
        Index(
            "ix_organization_domains_org",
            "organization_id",
        ),
        Index(
            "ix_organization_domains_flags",
            "flags",
            postgresql_using="gin",
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
        UniqueConstraint(
            "organization_id",
            "slug",
            name="uq_organization_providers_org_slug",
        ),
        Index(
            "ix_organization_providers_org",
            "organization_id",
        ),
        Index(
            "ix_organization_providers_flags",
            "flags",
            postgresql_using="gin",
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
