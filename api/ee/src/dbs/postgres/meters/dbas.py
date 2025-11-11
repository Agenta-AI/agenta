from sqlalchemy import Column, Enum as SQLEnum, SmallInteger, BigInteger

from ee.src.core.meters.types import Meters

from oss.src.dbs.postgres.shared.dbas import OrganizationScopeDBA


class PeriodDBA:
    __abstract__ = True

    year = Column(SmallInteger, nullable=True)
    month = Column(SmallInteger, nullable=True)


class MeterDBA(
    OrganizationScopeDBA,
    PeriodDBA,
):
    __abstract__ = True

    key = Column(
        SQLEnum(
            Meters,
            name="meters_type",
        ),
        nullable=False,
    )
    value = Column(BigInteger, nullable=False)
    synced = Column(BigInteger, nullable=False)
