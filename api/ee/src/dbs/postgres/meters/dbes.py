from sqlalchemy import PrimaryKeyConstraint, ForeignKeyConstraint, Index
from sqlalchemy.orm import relationship

from oss.src.dbs.postgres.shared.base import Base
from ee.src.dbs.postgres.meters.dbas import MeterDBA


class MeterDBE(Base, MeterDBA):
    __tablename__ = "meters"

    __table_args__ = (
        PrimaryKeyConstraint(
            "organization_id",
            "key",
            "year",
            "month",
        ),
        ForeignKeyConstraint(
            ["organization_id"],
            ["subscriptions.organization_id"],
        ),
        Index(
            "idx_synced_value",
            "synced",
            "value",
        ),
    )

    subscription = relationship("SubscriptionDBE", back_populates="meters")
