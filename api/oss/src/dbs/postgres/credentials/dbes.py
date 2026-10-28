"""Which person's own account a run used (M7, design D8)."""

from sqlalchemy import (
    TIMESTAMP,
    UUID,
    Column,
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    String,
    func,
)

from oss.src.dbs.postgres.shared.base import Base


class RunCredentialUseDBE(Base):
    __tablename__ = "run_credential_uses"

    __table_args__ = (
        PrimaryKeyConstraint(
            "project_id", "run_id", "connection_key", name="pk_run_credential_uses"
        ),
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
            name="fk_run_credential_uses_project_id",
        ),
        Index("ix_run_credential_uses_session", "project_id", "session_id"),
    )

    project_id = Column(UUID(as_uuid=True), nullable=False)
    session_id = Column(String, nullable=False)
    run_id = Column(String, nullable=False)
    connection_key = Column(String, nullable=False)
    binding = Column(String, nullable=False)
    owner_kind = Column(String, nullable=False)
    owner_id = Column(UUID(as_uuid=True), nullable=False)
    # No FK: the record outlives the credential.
    credential_id = Column(UUID(as_uuid=True), nullable=False)
    credential_name = Column(String, nullable=True)
    created_at = Column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )
