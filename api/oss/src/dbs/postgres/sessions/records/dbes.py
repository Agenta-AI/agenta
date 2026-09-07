from sqlalchemy import (
    BigInteger,
    Column,
    Index,
    PrimaryKeyConstraint,
    String,
)

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.sessions.records.dbas import RecordDBA, RecordTurnSpanDBA
from oss.src.dbs.postgres.shared.dbas import LifecycleDBA, ProjectScopeDBA


class SessionSequenceCursorDBE(Base, ProjectScopeDBA, LifecycleDBA):
    __tablename__ = "session_sequence_cursors"
    __table_args__ = (PrimaryKeyConstraint("project_id", "session_id"),)

    session_id = Column(String, nullable=False)
    latest_sequence = Column(BigInteger, nullable=False)


class RecordDBE(
    Base,
    ProjectScopeDBA,
    LifecycleDBA,
    RecordDBA,
    RecordTurnSpanDBA,
):
    __tablename__ = "records"

    __table_args__ = (
        PrimaryKeyConstraint("project_id", "record_id"),
        Index(
            "ix_records_project_id_session_id_record_id",
            "project_id",
            "session_id",
            "record_id",
        ),
        Index(
            "ix_records_attributes_gin",
            "attributes",
            postgresql_using="gin",
        ),
        Index(
            "ix_records_project_id_session_id_turn_id",
            "project_id",
            "session_id",
            "turn_id",
        ),
        Index(
            "ux_records_session_id_sequence",
            "project_id",
            "session_id",
            "sequence",
            unique=True,
        ),
    )
