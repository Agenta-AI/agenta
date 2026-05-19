from typing import Tuple, Callable, Optional

from ee.src.core.entitlements.types import Quota
from ee.src.core.meters.types import MeterDTO, MeterScope, MeterPeriod, Meters


class MetersDAOInterface:
    def __init__(self):
        raise NotImplementedError

    async def dump(
        self,
        limit: Optional[int] = None,
    ) -> list[MeterDTO]:
        """
        Dump all meters where 'synced' != 'value'.

        :return: A list of MeterDTO objects for meters where 'synced' != 'value'.
        """
        raise NotImplementedError

    async def bump(
        self,
        meters: list[MeterDTO],
    ) -> None:
        """
        Update the 'synced' field for the given list of meters.

        :param meters: A list of MeterDTO objects containing the details of meters to update.
        """
        raise NotImplementedError

    async def fetch(
        self,
        *,
        scope: MeterScope,
        key: Optional[Meters] = None,
        period: Optional[MeterPeriod] = None,
    ) -> list[MeterDTO]:
        """
        Fetch meters rooted at `scope.organization_id`, optionally narrowed by
        finer scope dimensions, key, and/or period bucket.

        Parameters:
        - scope: MeterScope identifying the org and any finer dimensions
          (workspace/project/user) to filter on.
        - key: Optional Meters member to filter on. Callers holding a
          Counter/Gauge/Flag must convert via Meters[counter.name] — the DB
          column binds by Python enum *name* (uppercase), not value
          (lowercase), so a Counter passed raw would silently miss rows.
        - period: Optional MeterPeriod bucket (year/month/day) to filter on.

        Returns:
        - List[MeterDTO]: A list of MeterDTO objects matching the filters.
        """
        raise NotImplementedError

    async def check(
        self,
        *,
        meter: MeterDTO,
        quota: Quota,
        anchor: Optional[int] = None,
    ) -> Tuple[bool, MeterDTO]:
        """
        Check if the meter adjustment or absolute value is allowed.

        Parameters:
        - meter: MeterDTO containing the current meter information and either `value` or `delta`.
        - quota: QuotaDTO defining the allowed quota limits.
        - anchor: Optional billing anchor day used to compute the active period bucket.

        Returns:
        - allowed (bool): Whether the operation is within the allowed limits.
        - meter (MeterDTO): The current meter value if found or 0 if not.
        """
        raise NotImplementedError

    async def adjust(
        self,
        *,
        meter: MeterDTO,
        quota: Quota,
        anchor: Optional[int] = None,
    ) -> Tuple[bool, MeterDTO, Callable]:
        """
        Adjust the meter value based on the quota.

        Parameters:
        - meter: MeterDTO containing either `value` or `delta` for the adjustment.
        - quota: QuotaDTO defining the allowed quota limits.
        - anchor: Optional billing anchor day used to compute the active period bucket.

        Returns:
        - allowed (bool): Whether the adjustment was within quota limits.
        - meter (MeterDTO): The updated meter value after the adjustment.
        - rollback (callable): A function to rollback the adjustment (optional, if applicable).
        """
        raise NotImplementedError
