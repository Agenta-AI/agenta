from sqlalchemy import (
    Column,
    String,
    PrimaryKeyConstraint,
    UniqueConstraint,
    ForeignKeyConstraint,
)

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.shared.dbas import (
    IdentifierDBA,
    ProjectScopeDBA,
    DataDBA,
    FlagsDBA,
    LifecycleDBA,
    MetaDBA,
    TagsDBA,
)


class SessionStateDBE(
    Base,
    ProjectScopeDBA,
    IdentifierDBA,
    DataDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
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
        UniqueConstraint(
            "project_id",
            "session_id",
            name="uq_session_states_project_session_id",
        ),
    )

    # bare correlator — not an FK; sessions may be external
    session_id = Column(String, nullable=False)

    # resume pointer: which sandbox to reconnect (null = no live sandbox)
    sandbox_id = Column(String, nullable=True)
