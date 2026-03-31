from sqlalchemy import Column, String, UUID

from oss.src.dbs.postgres.shared.dbas import (
    OrganizationScopeDBA,
    IdentifierDBA,
    SlugDBA,
    LifecycleDBA,
    HeaderDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
)


class OrganizationDomainDBA(
    OrganizationScopeDBA,
    IdentifierDBA,
    SlugDBA,
    LifecycleDBA,
    HeaderDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
):
    __abstract__ = True

    token = Column(
        String,
        nullable=True,
    )


class OrganizationProviderDBA(
    OrganizationScopeDBA,
    IdentifierDBA,
    SlugDBA,
    LifecycleDBA,
    HeaderDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
):
    __abstract__ = True

    secret_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )
