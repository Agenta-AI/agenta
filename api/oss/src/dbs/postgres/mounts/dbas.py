from sqlalchemy import Column, String

from oss.src.dbs.postgres.shared.dbas import (
    DataDBA,
    FlagsDBA,
    HeaderDBA,
    IdentifierDBA,
    LifecycleDBA,
    MetaDBA,
    ProjectScopeDBA,
    SlugDBA,
    TagsDBA,
)


class MountDBA(
    ProjectScopeDBA,
    LifecycleDBA,
    IdentifierDBA,
    SlugDBA,
    HeaderDBA,
    DataDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
):
    __abstract__ = True

    # session_id is a bare column — not an FK (sessions may be external).
    session_id = Column(
        String,
        nullable=True,
    )

    # agent_id is a bare column — not an FK. Populated only for agent mounts,
    # mirroring session_id (populated only for session mounts).
    agent_id = Column(
        String,
        nullable=True,
    )
