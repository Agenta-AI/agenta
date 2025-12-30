from sqlalchemy import (
    ForeignKeyConstraint,
    UniqueConstraint,
    Index,
    text,
)

from oss.src.dbs.postgres.shared.base import Base
from ee.src.dbs.postgres.organizations.dbas import (
    OrganizationDomainDBA,
    OrganizationProviderDBA,
)


class OrganizationDomainDBE(Base, OrganizationDomainDBA):
    __tablename__ = "organization_domains"

    __table_args__ = (
        ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            ondelete="CASCADE",
        ),
        Index(
            "uq_organization_domains_slug_verified",
            "slug",
            unique=True,
            postgresql_where=text("(flags->>'is_verified') = 'true'"),
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
