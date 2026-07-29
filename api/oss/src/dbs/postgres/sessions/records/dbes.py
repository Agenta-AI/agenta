from sqlalchemy import PrimaryKeyConstraint, Index

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.sessions.records.dbas import RecordDBA, RecordTurnSpanDBA
from oss.src.dbs.postgres.shared.dbas import ProjectScopeDBA, LifecycleDBA


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
    )
