from sqlalchemy import (
    Column,
    String,
    PrimaryKeyConstraint,
    UniqueConstraint,
    ForeignKeyConstraint,
    Index,
)

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.shared.dbas import (
    IdentifierDBA,
    ProjectScopeDBA,
    DataDBA,
    LifecycleDBA,
)


class SessionStateDBE(
    Base,
    ProjectScopeDBA,
    IdentifierDBA,
    DataDBA,
    LifecycleDBA,
):
    __tablename__ = "session_states"

    __table_args__ = (
        PrimaryKeyConstraint("project_id", "id"),
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint("session_id", name="uq_session_states_session_id"),
        UniqueConstraint(
            "project_id",
            "session_id",
            name="uq_session_states_project_session_id",
        ),
        Index("ix_session_states_project_id", "project_id"),
        Index("ix_session_states_project_id_session_id", "project_id", "session_id"),
    )

    # bare correlator — not an FK; sessions may be external
    session_id = Column(String, nullable=False)

    # resume pointer: which sandbox to reconnect (null = no live sandbox)
    sandbox_id = Column(String, nullable=True)
