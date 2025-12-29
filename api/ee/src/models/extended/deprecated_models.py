from datetime import datetime, timezone

import uuid_utils.compat as uuid

from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy import Column, String, DateTime, ForeignKey, Boolean, Integer


DeprecatedBase = declarative_base()


class DeprecatedAppDB(DeprecatedBase):
    __tablename__ = "app_db"
    __table_args__ = {"extend_existing": True}

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    app_name = Column(String)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    modified_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class DeprecatedAPIKeyDB(DeprecatedBase):
    __tablename__ = "api_keys"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    prefix = Column(String)
    hashed_key = Column(String)
    user_id = Column(String, nullable=True)
    workspace_id = Column(String, nullable=True)
    project_id = Column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=True
    )
    created_by_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    rate_limit = Column(Integer, default=0)
    hidden = Column(Boolean, default=False)
    expiration_date = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class UserOrganizationDB(DeprecatedBase):
    __tablename__ = "user_organizations"
    __table_args__ = {"extend_existing": True}

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id"))


class DeprecatedOrganizationDB(DeprecatedBase):
    """
    Deprecated OrganizationDB model with 'owner' field.
    Used by migrations that ran before the schema was changed to use 'owner_id'.
    """
    __tablename__ = "organizations"
    __table_args__ = {"extend_existing": True}

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    name = Column(String)
    owner = Column(String)  # Deprecated: replaced by owner_id (UUID)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class OldInvitationDB(DeprecatedBase):
    __tablename__ = "invitations"
    __table_args__ = {"extend_existing": True}

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    token = Column(String, unique=True, nullable=False)
    email = Column(String, nullable=False)
    organization_id = Column(String, nullable=False)
    used = Column(Boolean, default=False)
    workspace_id = Column(String, nullable=False)
    workspace_roles = Column(JSONB, nullable=True)
    expiration_date = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
