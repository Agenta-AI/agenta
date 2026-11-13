from sqlalchemy import TIMESTAMP, UUID, Column, PrimaryKeyConstraint, text

from oss.src.dbs.postgres.shared.base import Base


class InstanceDBE(Base):
    """The one row that names this installation. The migration inserts it."""

    __tablename__ = "instances"

    id = Column(UUID(as_uuid=True), nullable=False)
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    installed_event_sent_at = Column(TIMESTAMP(timezone=True), nullable=True)
    heartbeat_sent_at = Column(TIMESTAMP(timezone=True), nullable=True)

    __table_args__ = (PrimaryKeyConstraint("id", name="pk_instances"),)
