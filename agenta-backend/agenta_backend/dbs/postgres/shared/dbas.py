from sqlalchemy import Column, UUID, TIMESTAMP, func


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
