from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import Column, String, UUID, TIMESTAMP, func, Integer


class ProjectScopeDBA:
    __abstract__ = True

    project_id = Column(
        UUID(as_uuid=True),
        nullable=False,
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
    updated_by_id = Column(
        UUID(as_uuid=True),
        nullable=True,
    )


class IdentifierDBA:
    __abstract__ = True

    id = Column(UUID(as_uuid=True), nullable=False)


class SlugDBA:
    __abstract__ = True

    slug = Column(String, nullable=False)


class HeaderDBA:
    __abstract__ = True

    name = Column(String, nullable=True)
    description = Column(String, nullable=True)


class VersionedDBA:
    __abstract__ = True

    slug = Column(String, nullable=False)
    version = Column(Integer, nullable=False)
    id = Column(UUID(as_uuid=True), nullable=False)


class TagsDBA:
    __abstract__ = True

    tags = Column(JSONB(none_as_null=True), nullable=True)
