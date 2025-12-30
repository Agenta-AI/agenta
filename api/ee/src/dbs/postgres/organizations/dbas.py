import uuid_utils.compat as uuid
from sqlalchemy import Column, String, UUID
from sqlalchemy.dialects.postgresql import JSONB

from oss.src.dbs.postgres.shared.dbas import (
    LegacyLifecycleDBA,
    HeaderDBA,
    OrganizationScopeDBA,
)


class OrganizationDomainDBA(OrganizationScopeDBA, LegacyLifecycleDBA):
    __abstract__ = True

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    slug = Column(
        String,
        nullable=False,
    )
    name = Column(
        String,
        nullable=False,
    )
    description = Column(
        String,
        nullable=True,
    )
    token = Column(
        String,
        nullable=True,
    )
    flags = Column(
        JSONB(none_as_null=True),
        nullable=True,
    )
    tags = Column(
        JSONB(none_as_null=True),
        nullable=True,
    )
    meta = Column(
        JSONB(none_as_null=True),
        nullable=True,
    )


class OrganizationProviderDBA(OrganizationScopeDBA, HeaderDBA, LegacyLifecycleDBA):
    __abstract__ = True

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    slug = Column(
        String,
        nullable=False,
    )
    settings = Column(
        JSONB(none_as_null=True),
        nullable=False,
    )
    flags = Column(
        JSONB(none_as_null=True),
        nullable=True,
    )
    tags = Column(
        JSONB(none_as_null=True),
        nullable=True,
    )
    meta = Column(
        JSONB(none_as_null=True),
        nullable=True,
    )
