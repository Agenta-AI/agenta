from sqlalchemy import (
    CheckConstraint,
    Column,
    ForeignKeyConstraint,
    Index,
    Integer,
    PrimaryKeyConstraint,
    String,
    TIMESTAMP,
    UniqueConstraint,
    UUID,
    func,
    text,
)
from sqlalchemy.orm import relationship

from oss.src.dbs.postgres.shared.base import Base


class AgentSecretLeaseDBE(Base):
    __tablename__ = "agent_secret_leases"
    __table_args__ = (
        PrimaryKeyConstraint("id"),
        UniqueConstraint(
            "id",
            "organization_id",
            "workspace_id",
            "project_id",
            name="uq_agent_secret_leases_scope",
        ),
        UniqueConstraint(
            "organization_id",
            "project_id",
            "idempotency_key",
            name="uq_agent_secret_leases_idempotency",
        ),
        ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        ForeignKeyConstraint(["project_id"], ["projects.id"]),
        CheckConstraint("provider = 'daytona'", name="ck_agent_secret_leases_provider"),
        CheckConstraint(
            "owner_kind IN ('session','run')", name="ck_agent_secret_leases_owner_kind"
        ),
        CheckConstraint(
            "state IN ('reserved','provisioning','active','cleanup_pending','cleaning','deleted','quarantined')",
            name="ck_agent_secret_leases_state",
        ),
        CheckConstraint(
            "version >= 1 AND attempt_count >= 0 AND claim_generation >= 0",
            name="ck_agent_secret_leases_counters",
        ),
        CheckConstraint(
            "last_error_code IS NULL OR last_error_code IN "
            "('provision_failed','sandbox_create_failed','provider_unavailable',"
            "'provider_conflict','persistence_failed','sandbox_delete_failed',"
            "'secret_delete_failed','ownership_ambiguous','invalid_provider_response')",
            name="ck_agent_secret_leases_safe_error_code",
        ),
        Index(
            "ix_agent_secret_leases_provider_retry",
            "provider",
            "state",
            text("COALESCE(next_attempt_at, created_at)"),
            "id",
        ),
        Index(
            "ix_agent_secret_leases_org_retry",
            "organization_id",
            "state",
            text("COALESCE(next_attempt_at, created_at)"),
            "id",
        ),
        Index("ix_agent_secret_leases_owner", "project_id", "owner_kind", "owner_id"),
        Index(
            "uq_agent_secret_leases_provider_sandbox",
            "provider",
            "sandbox_id",
            unique=True,
            postgresql_where=text("sandbox_id IS NOT NULL"),
        ),
    )

    id = Column(UUID(as_uuid=True), nullable=False)
    organization_id = Column(UUID(as_uuid=True), nullable=False)
    workspace_id = Column(UUID(as_uuid=True), nullable=False)
    project_id = Column(UUID(as_uuid=True), nullable=False)
    created_by_id = Column(UUID(as_uuid=True), nullable=False)
    provider = Column(String, nullable=False)
    owner_kind = Column(String, nullable=False)
    owner_id = Column(String, nullable=False)
    idempotency_key = Column(String, nullable=False)
    plan_digest = Column(String, nullable=False)
    credential_epoch_digest = Column(String, nullable=False)
    sandbox_id = Column(String, nullable=True)
    sandbox_fingerprint = Column(String, nullable=True)
    sandbox_label = Column(String, nullable=False, unique=True)
    state = Column(String, nullable=False)
    version = Column(Integer, nullable=False, default=1)
    attempt_count = Column(Integer, nullable=False, default=0)
    next_attempt_at = Column(TIMESTAMP(timezone=True), nullable=True)
    last_error_code = Column(String, nullable=True)
    last_error_at = Column(TIMESTAMP(timezone=True), nullable=True)
    claim_id = Column(UUID(as_uuid=True), nullable=True)
    claim_owner = Column(String, nullable=True)
    claim_expires_at = Column(TIMESTAMP(timezone=True), nullable=True)
    claim_generation = Column(Integer, nullable=False, default=0)
    activated_at = Column(TIMESTAMP(timezone=True), nullable=True)
    cleanup_requested_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(
        TIMESTAMP(timezone=True),
        server_default=func.current_timestamp(),
        nullable=False,
    )
    updated_at = Column(TIMESTAMP(timezone=True), nullable=True)
    deleted_at = Column(TIMESTAMP(timezone=True), nullable=True)

    resources = relationship(
        "AgentSecretLeaseResourceDBE", back_populates="lease", lazy="selectin"
    )


class AgentSecretLeaseResourceDBE(Base):
    __tablename__ = "agent_secret_lease_resources"
    __table_args__ = (
        PrimaryKeyConstraint("id"),
        UniqueConstraint(
            "lease_id", "ordinal", name="uq_agent_secret_lease_resources_ordinal"
        ),
        UniqueConstraint(
            "provider",
            "provider_secret_name",
            name="uq_agent_secret_lease_resources_provider_name",
        ),
        ForeignKeyConstraint(
            ["lease_id", "organization_id", "workspace_id", "project_id"],
            [
                "agent_secret_leases.id",
                "agent_secret_leases.organization_id",
                "agent_secret_leases.workspace_id",
                "agent_secret_leases.project_id",
            ],
            ondelete="RESTRICT",
            name="fk_agent_secret_lease_resources_parent_scope",
        ),
        CheckConstraint(
            "consumer_kind IN ('model','http_mcp')",
            name="ck_agent_secret_lease_resources_consumer_kind",
        ),
        CheckConstraint(
            "binding_kind IN ('environment','header')",
            name="ck_agent_secret_lease_resources_binding_kind",
        ),
        CheckConstraint(
            "usage = 'opaque_http'", name="ck_agent_secret_lease_resources_usage"
        ),
        CheckConstraint(
            "state IN ('planned','created','deleted')",
            name="ck_agent_secret_lease_resources_state",
        ),
        CheckConstraint(
            "version >= 1 AND ordinal >= 0",
            name="ck_agent_secret_lease_resources_counters",
        ),
        CheckConstraint(
            "(consumer_kind = 'model' AND consumer_key IS NULL) OR "
            "(consumer_kind = 'http_mcp' AND consumer_key IS NOT NULL "
            "AND consumer_key <> '')",
            name="ck_agent_secret_lease_resources_consumer_key",
        ),
        CheckConstraint(
            "state <> 'created' OR "
            "(provider_secret_id IS NOT NULL AND provider_secret_id <> '')",
            name="ck_agent_secret_lease_resources_created_id",
        ),
        Index(
            "uq_agent_secret_lease_resources_binding",
            "lease_id",
            "binding_kind",
            "binding_name",
            "consumer_kind",
            text("COALESCE(consumer_key, '')"),
            unique=True,
        ),
        Index("ix_agent_secret_lease_resources_lease", "lease_id", "ordinal"),
    )

    id = Column(UUID(as_uuid=True), nullable=False)
    lease_id = Column(UUID(as_uuid=True), nullable=False)
    organization_id = Column(UUID(as_uuid=True), nullable=False)
    workspace_id = Column(UUID(as_uuid=True), nullable=False)
    project_id = Column(UUID(as_uuid=True), nullable=False)
    provider = Column(String, nullable=False)
    ordinal = Column(Integer, nullable=False)
    consumer_kind = Column(String, nullable=False)
    consumer_key = Column(String, nullable=True)
    binding_kind = Column(String, nullable=False)
    binding_name = Column(String, nullable=False)
    usage = Column(String, nullable=False)
    allowed_host = Column(String, nullable=False)
    provider_secret_name = Column(String, nullable=False)
    provider_secret_id = Column(String, nullable=True)
    state = Column(String, nullable=False)
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(
        TIMESTAMP(timezone=True),
        server_default=func.current_timestamp(),
        nullable=False,
    )
    updated_at = Column(TIMESTAMP(timezone=True), nullable=True)
    deleted_at = Column(TIMESTAMP(timezone=True), nullable=True)

    lease = relationship("AgentSecretLeaseDBE", back_populates="resources")
