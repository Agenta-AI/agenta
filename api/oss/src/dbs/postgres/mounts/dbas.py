from sqlalchemy import Column, String

from oss.src.dbs.postgres.shared.dbas import (
    DataDBA,
    FlagsDBA,
    HeaderDBA,
    IdentifierDBA,
    LifecycleDBA,
    ProjectScopeDBA,
    SlugDBA,
)


class MountDBA(
    ProjectScopeDBA,
    LifecycleDBA,
    IdentifierDBA,
    SlugDBA,
    HeaderDBA,
    DataDBA,
    FlagsDBA,
):
    __abstract__ = True

    # session_id is a bare column — not an FK (sessions may be external).
    session_id = Column(
        String,
        nullable=True,
    )
