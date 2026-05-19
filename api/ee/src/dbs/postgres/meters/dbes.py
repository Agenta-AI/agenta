from sqlalchemy import PrimaryKeyConstraint, ForeignKeyConstraint, Index
from sqlalchemy.orm import relationship

from oss.src.dbs.postgres.shared.base import Base
from ee.src.dbs.postgres.meters.dbas import MeterDBA


class MeterDBE(Base, MeterDBA):
    __tablename__ = "meters"

    __table_args__ = (
        PrimaryKeyConstraint(
            "meter_id",
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
        # Org-rollup scan path used by /billing/usage (filter on org only) and
        # entitlements soft-check fallback (filter on the full prefix).
        # Finer scope dimensions (workspace/project/user) are sparse and always
        # filtered alongside `organization_id`, so PG handles them in-memory
        # against the rows this index narrows down.
        Index(
            "idx_meters_org_key_period",
            "organization_id",
            "key",
            "year",
            "month",
            "day",
        ),
    )

    subscription = relationship("SubscriptionDBE", back_populates="meters")
