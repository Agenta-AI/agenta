from typing import Optional, Dict, List

from ee.src.core.entitlements.types import (
    Tracker,
    Constraint,
    ENTITLEMENTS,
    CONSTRAINTS,
)
from ee.src.core.entitlements.types import Quota, Gauge
from ee.src.core.subscriptions.types import Plan
from ee.src.core.meters.service import MetersService
from ee.src.core.meters.types import MeterDTO


class ConstaintsException(Exception):
    issues: Dict[Gauge, int] = {}


class EntitlementsService:
    def __init__(
        self,
        meters_service: MetersService,
    ):
        self.meters_service = meters_service

    async def enforce(
        self,
        *,
        organization_id: str,
        plan: str,
        force: Optional[bool] = False,
    ) -> None:
        issues = await self.check(
            organization_id=organization_id,
            plan=plan,
        )

        if issues:
            if not force:
                raise ConstaintsException(
                    issues=issues,
                )

            await self.fix(
                organization_id=organization_id,
                issues=issues,
            )

    async def check(
        self,
        *,
        organization_id: str,
        plan: Plan,
    ) -> Dict[Gauge, int]:
        issues = {}

        for key in CONSTRAINTS[Constraint.BLOCKED][Tracker.GAUGES]:
            quotas: List[Quota] = ENTITLEMENTS[plan][Tracker.GAUGES]

            if key in quotas:
                meter = MeterDTO(
                    organization_id=organization_id,
                    key=key,
                )
                quota: Quota = quotas[key]

                check, meter = await self.meters_service.check(
                    meter=meter,
                    quota=quota,
                )

                if not check:
                    issues[key] = quota.limit

        return issues

    async def fix(
        self,
        *,
        organization_id: str,
        issues: Dict[Gauge, int],
    ) -> None:
        # TODO: Implement fix
        pass


# TODO:
# -- P0 / MUST
# - Add active : Optional[bool] = None to all scopes and users
# -- P1 / SHOULD
# - Add parent scopes to all child scope
# - Add parent scopes membership on child scope membership creation
# - Remove children scopes membership on parent scope membership removal
# -- P2 / COULD
# - Add created_at / updated_at to all scopes
# - Set updated_at on all updates + on creation
# - Move organization roles to memberships
