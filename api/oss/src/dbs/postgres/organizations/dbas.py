import uuid_utils.compat as uuid
from sqlalchemy import Column, String, UUID, Boolean, ARRAY
from sqlalchemy.dialects.postgresql import JSONB

from oss.src.dbs.postgres.shared.dbas import (
    LifecycleDBA,
    HeaderDBA,
    OrganizationScopeDBA,
)


class OrganizationPolicyDBA(OrganizationScopeDBA, LifecycleDBA):
    __abstract__ = True

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    allowed_methods = Column(
        ARRAY(String),
        nullable=False,
        server_default="{}",
    )
    invitation_only = Column(
        Boolean,
        nullable=False,
        server_default="true",
    )
    domains_only = Column(
        Boolean,
        nullable=False,
        server_default="false",
    )
    disable_root = Column(
        Boolean,
        nullable=False,
        server_default="false",
    )


class OrganizationDomainDBA(OrganizationScopeDBA, LifecycleDBA):
    __abstract__ = True

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    domain = Column(
        String,
        nullable=False,
    )
    verified = Column(
        Boolean,
        nullable=False,
        server_default="false",
    )
    verification_token = Column(
        String,
        nullable=True,
    )


class OrganizationProviderDBA(OrganizationScopeDBA, HeaderDBA, LifecycleDBA):
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
    enabled = Column(
        Boolean,
        nullable=False,
        server_default="true",
    )
    domain_id = Column(
        UUID(as_uuid=True),
        nullable=True,
    )
    config = Column(
        JSONB(none_as_null=True),
        nullable=False,
    )


class OrganizationInvitationDBA(OrganizationScopeDBA, LifecycleDBA):
    __abstract__ = True

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    email = Column(
        String,
        nullable=False,
    )
    role = Column(
        String,
        nullable=False,
    )
    token = Column(
        String,
        nullable=False,
    )
    status = Column(
        String,
        nullable=False,
        server_default="pending",
    )
    expires_at = Column(
        UUID(as_uuid=True),
        nullable=True,
    )
