"""ServicesAPI tests."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from core.db import seed_data as S
from core.domain import ServiceTicketStatus
from core.integrations.pms.fake import FakePMS


async def test_add_to_reservation_uses_clock_when_when_omitted(pms: FakePMS, fixed_clock) -> None:
    charge = await pms.services.add_to_reservation(
        S.RES_EVE_CURRENT_STAY_ID,
        S.SVC_BREAKFAST,
    )
    # Catalog default for breakfast is $28.
    assert charge.amount == Decimal("28.00")
    assert charge.when == fixed_clock.now()
    assert charge.status == ServiceTicketStatus.OPEN
    assert charge.reservation_id == S.RES_EVE_CURRENT_STAY_ID
    assert charge.service_code == S.SVC_BREAKFAST


async def test_add_to_reservation_uses_explicit_when(pms: FakePMS, fixed_clock) -> None:
    explicit = fixed_clock.now() + timedelta(hours=3)
    charge = await pms.services.add_to_reservation(
        S.RES_EVE_CURRENT_STAY_ID,
        S.SVC_BREAKFAST,
        when=explicit,
    )
    assert charge.when == explicit


async def test_list_for_reservation_includes_seeded_and_added(pms: FakePMS) -> None:
    before = await pms.services.list_for_reservation(S.RES_EVE_CURRENT_STAY_ID)
    # Seeded: one breakfast charge (svc_eve_breakfast_day1).
    assert len(before) == 1
    assert before[0].service_code == S.SVC_BREAKFAST

    await pms.services.add_to_reservation(
        S.RES_EVE_CURRENT_STAY_ID,
        S.SVC_PARKING,
    )
    after = await pms.services.list_for_reservation(S.RES_EVE_CURRENT_STAY_ID)
    assert len(after) == 2
    codes = {c.service_code for c in after}
    assert codes == {S.SVC_BREAKFAST, S.SVC_PARKING}
