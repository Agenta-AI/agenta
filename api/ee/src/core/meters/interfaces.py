from typing import Tuple, Callable, Optional

from ee.src.core.entitlements.types import Quota
from ee.src.core.meters.types import MeterDTO


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
        organization_id: str,
    ) -> list[MeterDTO]:
        """
        Fetch all meters for a given organization.

        Parameters:
        - organization_id: The ID of the organization to fetch meters for.

        Returns:
        - List[MeterDTO]: A list of MeterDTO objects containing the meter details.
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

        Returns:
        - allowed (bool): Whether the adjustment was within quota limits.
        - meter (MeterDTO): The updated meter value after the adjustment.
        - rollback (callable): A function to rollback the adjustment (optional, if applicable).
        """
        raise NotImplementedError
