from sqlalchemy import Column, String, Boolean, SmallInteger

from oss.src.dbs.postgres.shared.dbas import LifecycleDBA, OrganizationScopeDBA


class StripeDBA:
    customer_id = Column(String, nullable=True)
    subscription_id = Column(String, nullable=True)


class SubscriptionDBA(
    OrganizationScopeDBA,
    StripeDBA,
    LifecycleDBA,
):
    __abstract__ = True

    plan = Column(String, nullable=False)
    active = Column(Boolean, nullable=False)
    anchor = Column(SmallInteger, nullable=True)
