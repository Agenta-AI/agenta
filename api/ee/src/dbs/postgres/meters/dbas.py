from sqlalchemy import Column, Enum as SQLEnum, BigInteger
from sqlalchemy.dialects.postgresql import UUID

from ee.src.core.meters.types import Meters

from oss.src.dbs.postgres.shared.dbas import ScopeDBA, PeriodDBA


class MeterDBA(
    ScopeDBA,
    PeriodDBA,
):
    __abstract__ = True

    meter_id = Column(UUID(as_uuid=True), nullable=False)

    key = Column(SQLEnum(Meters, name="meters_type"), nullable=False)
    value = Column(BigInteger, nullable=False)
    synced = Column(BigInteger, nullable=False)
