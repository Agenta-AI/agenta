from time import monotonic
from typing import Dict, Tuple
from uuid import UUID

from ee.src.core.access.entitlements.service import (
    EntitlementsException,
    Flag,
    _check_entitlements,
    scope_from,
)
from oss.src.core.access.interfaces import RbacEntitlementInterface
from oss.src.core.access.types import RbacEntitlementUnavailable


# The RBAC entitlement of an organization changes with its plan, which is rare. This
# process-local memo keeps repeated reads (role lists, credential limits) off Redis. It
# is at most 30 s old.
_ENTITLED_TTL_SECONDS = 30.0
_MEMO_CAPACITY = 4096


class PlanRbacEntitlement(RbacEntitlementInterface):
    """EE: the organization's plan has `Flag.RBAC`."""

    def __init__(self) -> None:
        self._memo: Dict[UUID, Tuple[float, bool]] = {}

    async def is_entitled(self, *, organization_id: UUID) -> bool:
        now = monotonic()
        cached = self._memo.get(organization_id)
        if cached is not None and now - cached[0] < _ENTITLED_TTL_SECONDS:
            return cached[1]
        # Not `check_entitlements`: it answers True on a Redis or database error, and
        # a role write on Hobby or Pro would then store `viewer` for good. A failed
        # read raises and is not kept in the memo.
        try:
            check, _, _ = await _check_entitlements(
                key=Flag.RBAC,
                delta=None,
                cache=False,
                scope=scope_from(organization_id=organization_id),
                period=None,
            )
        except EntitlementsException:
            raise
        except Exception as exc:  # pylint: disable=broad-exception-caught
            raise RbacEntitlementUnavailable() from exc
        if len(self._memo) >= _MEMO_CAPACITY:
            self._memo.clear()
        self._memo[organization_id] = (now, bool(check))
        return bool(check)
