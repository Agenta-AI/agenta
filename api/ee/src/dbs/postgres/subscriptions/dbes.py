from sqlalchemy import PrimaryKeyConstraint
from sqlalchemy.orm import relationship


from oss.src.dbs.postgres.shared.base import Base
from ee.src.dbs.postgres.subscriptions.dbas import SubscriptionDBA


class SubscriptionDBE(Base, SubscriptionDBA):
    __tablename__ = "subscriptions"

    __table_args__ = (
        PrimaryKeyConstraint(
            "organization_id",
        ),
    )

    meters = relationship("MeterDBE", back_populates="subscription")
