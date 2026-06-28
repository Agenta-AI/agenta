from sqlalchemy import PrimaryKeyConstraint, Index

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.transcripts.dbas import TranscriptDBA
from oss.src.dbs.postgres.shared.dbas import ProjectScopeDBA, LifecycleDBA


class TranscriptDBE(
    Base,
    ProjectScopeDBA,
    LifecycleDBA,
    TranscriptDBA,
):
    __tablename__ = "transcripts"

    __table_args__ = (
        PrimaryKeyConstraint("project_id", "id"),
        Index("ix_transcripts_project_id", "project_id"),
        Index("ix_transcripts_project_id_session_id", "project_id", "session_id"),
        Index("ix_transcripts_project_id_id", "project_id", "id"),
        Index(
            "ix_transcripts_project_id_session_id_id",
            "project_id",
            "session_id",
            "id",
        ),
        Index(
            "ix_transcripts_payload_gin",
            "payload",
            postgresql_using="gin",
        ),
    )
