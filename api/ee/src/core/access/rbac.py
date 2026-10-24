from time import monotonic
from typing import Dict, Tuple
from uuid import UUID

from ee.src.core.access.entitlements.service import (
    Flag,
    check_entitlements,
    scope_from,
)
from oss.src.core.access.interfaces import RbacEnforcementInterface


# The RBAC entitlement of an organization changes with its plan, which is rare. A
# decision reads it on every call; this process-local memo keeps that read off the hot
# path (no Redis round trip per decision). It is at most 30 s old, which is fresher
# than the 300 s cached decision M1 kept for the same answer.
_ENFORCED_TTL_SECONDS = 30.0
_MEMO_CAPACITY = 4096


class EntitlementsRbacEnforcement(RbacEnforcementInterface):
    """EE: role checks apply only when the organization's plan has the RBAC
    entitlement. Without it every member passes, as before."""

    def __init__(self) -> None:
        self._memo: Dict[UUID, Tuple[float, bool]] = {}

    async def is_enforced(self, *, organization_id: UUID) -> bool:
        now = monotonic()
        cached = self._memo.get(organization_id)
        if cached is not None and now - cached[0] < _ENFORCED_TTL_SECONDS:
            return cached[1]
        check, _, _ = await check_entitlements(
            key=Flag.RBAC,
            scope=scope_from(organization_id=organization_id),
        )
        if len(self._memo) >= _MEMO_CAPACITY:
            self._memo.clear()
        self._memo[organization_id] = (now, bool(check))
        return bool(check)
