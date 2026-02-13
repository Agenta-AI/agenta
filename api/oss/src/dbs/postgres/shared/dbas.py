import uuid_utils.compat as uuid

from sqlalchemy.dialects.postgresql import JSONB, JSON
from sqlalchemy import Column, String, UUID, TIMESTAMP, func, Integer


class OrganizationScopeDBA:
    __abstract__ = True

    organization_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )


class WorkspaceScopeDBA:
    __abstract__ = True

    workspace_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )


class ProjectScopeDBA:
    __abstract__ = True

    project_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )


class FolderScopeDBA:
    __abstract__ = True

    folder_id = Column(
        UUID(as_uuid=True),
        nullable=True,
    )


class LegacyLifecycleDBA:
    __abstract__ = True

    created_at = Column(
        TIMESTAMP(timezone=True),
        server_default=func.current_timestamp(),
        nullable=True,
    )
    updated_at = Column(
        TIMESTAMP(timezone=True),
        server_onupdate=func.current_timestamp(),
        nullable=True,
    )
    updated_by_id = Column(
        UUID(as_uuid=True),
        nullable=True,
    )


class LifecycleDBA:
    __abstract__ = True

    created_at = Column(
        TIMESTAMP(timezone=True),
        server_default=func.current_timestamp(),
        nullable=False,
    )
    updated_at = Column(
        TIMESTAMP(timezone=True),
        server_onupdate=func.current_timestamp(),
        nullable=True,
    )
    deleted_at = Column(
        TIMESTAMP(timezone=True),
        nullable=True,
    )
    created_by_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )
    updated_by_id = Column(
        UUID(as_uuid=True),
        nullable=True,
    )
    deleted_by_id = Column(
        UUID(as_uuid=True),
        nullable=True,
    )


class IdentifierDBA:
    __abstract__ = True

    id = Column(
        UUID(as_uuid=True),
        nullable=False,
        default=uuid.uuid7,
    )


class SlugDBA:
    __abstract__ = True

    slug = Column(
        String,
        nullable=False,
    )


class VersionDBA:
    __abstract__ = True

    version = Column(
        String,
        nullable=True,
    )


class HeaderDBA:
    __abstract__ = True

    name = Column(
        String,
        nullable=True,
    )
    description = Column(
        String,
        nullable=True,
    )


class VersionedDBA:
    __abstract__ = True

    id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )
    slug = Column(
        String,
        nullable=False,
    )
    version = Column(
        Integer,
        nullable=False,
    )


class FlagsDBA:
    __abstract__ = True

    flags = Column(
        JSONB(none_as_null=True),
        nullable=True,
    )


class TagsDBA:
    __abstract__ = True

    tags = Column(
        JSONB(none_as_null=True),
        nullable=True,
    )


class MetaDBA:
    __abstract__ = True

    meta = Column(
        JSON(none_as_null=True),
        nullable=True,
    )


class DataDBA:
    __abstract__ = True

    data = Column(
        JSON(none_as_null=True),
        nullable=True,
    )


class CommitDBA:
    __abstract__ = True

    message = Column(
        String,
        nullable=True,
    )
    author = Column(
        UUID(as_uuid=True),
        nullable=False,
    )
    date = Column(
        TIMESTAMP(timezone=True),
        server_default=func.current_timestamp(),
        nullable=False,
    )
