"""SQLAlchemy entities for the gateway-owned `measurements`/`measurement_values` tables.

Tracing DB (`AnalyticsEngine`), migration chain `tracing_ee`
(`ee0000000002_add_measurements`). See `docs/design/wallets-research/v1/entities.md`
"measurements" — no organization/workspace column, no wallet-debit FK.
"""

import uuid_utils.compat as uuid

from sqlalchemy import (
    Column,
    ForeignKey,
    Integer,
    PrimaryKeyConstraint,
    String,
    TIMESTAMP,
    UUID,
    UniqueConstraint,
    Index,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB

from oss.src.dbs.postgres.shared.base import Base


class MeasurementDBE(Base):
    __tablename__ = "measurements"

    id = Column(
        UUID(as_uuid=True),
        nullable=False,
        default=uuid.uuid7,
    )

    # Gateway-minted opaque identity; UNIQUE makes the tracing write replay-safe.
    measurement_id = Column(String, nullable=False)

    project_id = Column(UUID(as_uuid=True), nullable=False)
    user_id = Column(UUID(as_uuid=True), nullable=True)
    agent_id = Column(UUID(as_uuid=True), nullable=True)

    gateway_kind = Column(String, nullable=False)
    request_id = Column(String, nullable=False)
    resource_key = Column(String, nullable=False)
    endpoint_id = Column(String, nullable=True)
    endpoint_kind = Column(String, nullable=False)

    resource_locator = Column(JSONB(none_as_null=True), nullable=False, default=dict)
    data = Column(JSONB(none_as_null=True), nullable=False, default=dict)

    start_time = Column(TIMESTAMP(timezone=True), nullable=True)
    end_time = Column(TIMESTAMP(timezone=True), nullable=True)

    created_at = Column(
        TIMESTAMP(timezone=True),
        server_default=func.current_timestamp(),
        nullable=False,
    )
    updated_at = Column(TIMESTAMP(timezone=True), nullable=True)
    deleted_at = Column(TIMESTAMP(timezone=True), nullable=True)

    __table_args__ = (
        PrimaryKeyConstraint("id"),
        UniqueConstraint("measurement_id", name="uq_measurements_measurement_id"),
        Index("ix_measurements_project_id", "project_id"),
        Index("ix_measurements_request_id", "request_id"),
    )


class MeasurementValueDBE(Base):
    __tablename__ = "measurement_values"

    id = Column(
        UUID(as_uuid=True),
        nullable=False,
        default=uuid.uuid7,
    )

    measurement_id = Column(
        UUID(as_uuid=True),
        ForeignKey("measurements.id", ondelete="RESTRICT"),
        nullable=False,
    )

    key = Column(String, nullable=False)
    value = Column(Integer, nullable=False)
    cost_musd = Column(Integer, nullable=True)

    created_at = Column(
        TIMESTAMP(timezone=True),
        server_default=func.current_timestamp(),
        nullable=False,
    )

    __table_args__ = (
        PrimaryKeyConstraint("id"),
        UniqueConstraint(
            "measurement_id", "key", name="uq_measurement_values_measurement_id_key"
        ),
        Index("ix_measurement_values_measurement_id", "measurement_id"),
    )
