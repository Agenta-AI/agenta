from sqlalchemy import Column, PrimaryKeyConstraint, String, TIMESTAMP, func
from sqlalchemy.dialects.postgresql import UUID

from oss.src.dbs.postgres.shared.base import Base


class LicenseDBE(Base):
    """The license key added in the app. At most one row; `id` is the key's `key_id`."""

    __tablename__ = "licenses"

    __table_args__ = (PrimaryKeyConstraint("id"),)

    id = Column(UUID(as_uuid=True), nullable=False)
    key = Column(String, nullable=False)
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.current_timestamp(),
    )
    created_by_id = Column(UUID(as_uuid=True), nullable=False)
