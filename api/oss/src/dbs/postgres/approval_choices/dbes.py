from sqlalchemy import (
    Column,
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    String,
    UniqueConstraint,
    UUID,
)

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.shared.dbas import (
    IdentifierDBA,
    LifecycleDBA,
    ProjectScopeDBA,
)


class ApprovalChoiceDBE(Base, ProjectScopeDBA, IdentifierDBA, LifecycleDBA):
    """For one person, one agent and one tool: approve its calls with no card. Rows
    are deleted, never archived.

    `artifact_id` has no foreign key: the builder is served from code, and its
    `workflow_artifacts` row exists only after a project commits one of its fields."""

    __tablename__ = "approval_choices"

    artifact_id = Column(UUID(as_uuid=True), nullable=False)
    user_id = Column(UUID(as_uuid=True), nullable=False)
    call_ref = Column(String, nullable=False)

    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_approval_choices"),
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
            name="fk_approval_choices_project_id",
        ),
        ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
            name="fk_approval_choices_user_id",
        ),
        UniqueConstraint(
            "project_id",
            "artifact_id",
            "user_id",
            "call_ref",
            name="uq_approval_choices_project_id_artifact_id_user_id_call_ref",
        ),
        Index("ix_approval_choices_user_id", "user_id"),
    )
