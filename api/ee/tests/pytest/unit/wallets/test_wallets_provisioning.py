"""Unit tests for `WalletsService.provision_general_balance` and `.apply_plan_change`
against the in-memory `FakeWalletsDAO` — no Postgres, no event loop conflicts. Mirrors
`test_wallets_service.py`'s style for `check`/`settle`.
"""

from datetime import datetime, timezone
from uuid import uuid4

import pytest

from ee.src.core.wallets.service import WalletsService
from ee.tests.pytest.utils.wallets.builders import build_general_wallet_balance
from ee.tests.pytest.utils.wallets.fakes import FakeWalletsDAO

PERIOD_START = datetime(2026, 1, 1, tzinfo=timezone.utc)
PERIOD_END = datetime(2026, 2, 1, tzinfo=timezone.utc)
MID_PERIOD = datetime(2026, 1, 16, tzinfo=timezone.utc)


@pytest.mark.asyncio
async def test_provision_general_balance_is_idempotent():
    dao = FakeWalletsDAO()
    service = WalletsService(wallets_dao=dao)
    organization_id = uuid4()

    await service.provision_general_balance(
        organization_id=organization_id, plan="cloud_v0_hobby"
    )
    first_row = dao.general_balance

    await service.provision_general_balance(
        organization_id=organization_id, plan="cloud_v0_hobby"
    )

    # Two calls, one row: the second is a no-op (mirrors ON CONFLICT DO NOTHING against
    # the partial unique index in the real DAO).
    assert dao.provision_calls == 2
    assert dao.general_balance is first_row
    assert dao.general_balance.balance_musd == 0


@pytest.mark.asyncio
async def test_provision_general_balance_uses_the_plan_floor_mapping(monkeypatch):
    monkeypatch.setattr(
        "ee.src.core.wallets.service.floor_musd_for_plan", lambda *, plan: -2_500
    )
    dao = FakeWalletsDAO()
    service = WalletsService(wallets_dao=dao)

    await service.provision_general_balance(
        organization_id=uuid4(), plan="cloud_v0_pro"
    )

    assert dao.general_balance.floor_musd == -2_500


async def _change(service, dao, *, key, incoming_plan, now, period=None):
    period_start, period_end = period or (PERIOD_START, PERIOD_END)
    return await service.apply_plan_change(
        organization_id=dao.general_balance.organization_id,
        idempotency_key=key,
        subscription_id="sub_123",
        incoming_plan=incoming_plan,
        period_start=period_start,
        period_end=period_end,
        now=now,
    )


def _service_with_empty_wallet(balance_musd: int = 0):
    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(
            balance_musd=balance_musd, floor_musd=0
        )
    )
    return WalletsService(wallets_dao=dao), dao


@pytest.mark.asyncio
async def test_apply_plan_change_mints_no_value_on_the_zero_allowance_hobby_path():
    """`cloud_v0_hobby` maps to a 0 allowance (see `plans.py`) — the real mapping,
    unpatched: nothing is minted and nothing is clawed, but the floor is still set."""
    service, dao = _service_with_empty_wallet(balance_musd=1_000)

    result = await _change(
        service, dao, key="pc-zero", incoming_plan="cloud_v0_hobby", now=MID_PERIOD
    )

    assert result.outgoing_debit_amount_musd == 0
    assert result.incoming_credit_amount_musd == 0
    assert result.outgoing_debit_id is None
    assert result.incoming_credit_id is None
    assert dao.debits == []
    assert dao._credits == {}
    assert dao.general_balance.balance_musd == 1_000
    assert dao.general_balance.floor_musd == 0


@pytest.mark.asyncio
async def test_apply_plan_change_to_a_free_plan_needs_no_period():
    """A cancellation lands on the free plan, which has no Stripe subscription and so no
    billing period. It carries no allowance, so it needs none."""
    service, dao = _service_with_empty_wallet()

    result = await service.apply_plan_change(
        organization_id=dao.general_balance.organization_id,
        idempotency_key="pc-cancel",
        subscription_id=None,
        incoming_plan="cloud_v0_hobby",
        period_start=None,
        period_end=None,
        now=MID_PERIOD,
    )

    assert result.incoming_credit_id is None


@pytest.mark.asyncio
async def test_apply_plan_change_refuses_a_paid_plan_without_a_period():
    service, dao = _service_with_empty_wallet()

    with pytest.raises(ValueError):
        await service.apply_plan_change(
            organization_id=dao.general_balance.organization_id,
            idempotency_key="pc-no-period",
            subscription_id="sub_123",
            incoming_plan="cloud_v0_pro",
            period_start=None,
            period_end=None,
            now=MID_PERIOD,
        )


@pytest.mark.asyncio
async def test_apply_plan_change_upgrade_hobby_to_pro_moves_real_value():
    """Real, unpatched `allowance_musd_for_plan` mapping (`plans.py`): an upgrade to
    `cloud_v0_pro` ($5/period) with no allowance credit yet. Only the incoming share is
    prorated: 16 of the remaining 31 days -> $5,000,000 * 16/31, floored."""
    service, dao = _service_with_empty_wallet()

    result = await _change(
        service, dao, key="pc-up", incoming_plan="cloud_v0_pro", now=MID_PERIOD
    )

    assert result.outgoing_debit_amount_musd == 0
    assert result.incoming_credit_amount_musd == 2_580_645  # 5e6 * 1382400 // 2678400
    incoming_candidate, _ = dao._credits[result.incoming_credit_id]
    assert incoming_candidate.credit_kind == "plan_allowance"
    assert incoming_candidate.end_time == PERIOD_END
    assert dao.general_balance.balance_musd == 2_580_645


@pytest.mark.asyncio
async def test_apply_plan_change_downgrade_business_to_pro_moves_real_value():
    """Business from the period start, then Pro on the 16th: half-ish of the $50 is
    clawed back from the Business credit and a prorated $5 share is minted."""
    service, dao = _service_with_empty_wallet()
    business = await _change(
        service, dao, key="pc-biz", incoming_plan="cloud_v0_business", now=PERIOD_START
    )
    assert business.incoming_credit_amount_musd == 50_000_000

    result = await _change(
        service, dao, key="pc-down", incoming_plan="cloud_v0_pro", now=MID_PERIOD
    )

    assert result.outgoing_credit_id == business.incoming_credit_id
    assert result.outgoing_debit_amount_musd == 25_806_451  # 5e7 * 1382400 // 2678400
    assert result.incoming_credit_amount_musd == 2_580_645
    assert dao.general_balance.balance_musd == 50_000_000 - 25_806_451 + 2_580_645


@pytest.mark.asyncio
async def test_apply_plan_change_updates_general_balance_floor(monkeypatch):
    monkeypatch.setattr(
        "ee.src.core.wallets.service.floor_musd_for_plan", lambda *, plan: -5_000
    )
    service, dao = _service_with_empty_wallet()

    await _change(service, dao, key="pc-floor", incoming_plan="b", now=PERIOD_START)

    assert dao.general_balance.floor_musd == -5_000


@pytest.mark.asyncio
async def test_apply_plan_change_moves_prorated_value_and_never_mutates_existing_credit(
    monkeypatch,
):
    monkeypatch.setattr(
        "ee.src.core.wallets.service.allowance_musd_for_plan",
        lambda *, plan: {"outgoing": 310_000, "incoming": 620_000}[plan],
    )
    service, dao = _service_with_empty_wallet()
    outgoing = await _change(
        service, dao, key="pc-first", incoming_plan="outgoing", now=PERIOD_START
    )
    outgoing_candidate, _ = dao._credits[outgoing.incoming_credit_id]

    result = await _change(
        service,
        dao,
        key="pc-move-value",
        incoming_plan="incoming",
        now=datetime(2026, 1, 22, tzinfo=timezone.utc),  # 10 days remaining of 31
    )

    # 10/31 of the period remains: 310_000/31 * 10 == 100_000 removed;
    # 620_000/31 * 10 == 200_000 minted.
    assert result.outgoing_debit_amount_musd == 100_000
    assert result.incoming_credit_amount_musd == 200_000
    assert result.outgoing_credit_id == outgoing.incoming_credit_id
    assert result.incoming_credit_id != outgoing.incoming_credit_id
    assert dao.general_balance.balance_musd == 310_000 - 100_000 + 200_000

    # The outgoing credit's own record is untouched; only its balance moved.
    new_candidate, new_balance = dao._credits[outgoing.incoming_credit_id]
    assert new_candidate.credit_kind == outgoing_candidate.credit_kind
    assert new_candidate.priority == outgoing_candidate.priority
    assert new_candidate.end_time == outgoing_candidate.end_time
    assert new_balance.balance_musd == 310_000 - 100_000

    _, new_credit_balance = dao._credits[result.incoming_credit_id]
    assert new_credit_balance.balance_musd == 200_000


def test_apply_plan_change_never_updates_an_existing_wallet_credit_row():
    """Source-level regression guard on the real Postgres DAO: `apply_plan_change` must
    never issue an UPDATE against `WalletCreditDBE` — a credit's own immutable fields
    (amount_musd/credit_kind/priority/end_time) are written once, at INSERT, never
    mutated afterward. Only `WalletBalanceDBE.balance_musd` (the mutable projection) is
    ever decremented in place."""
    import inspect
    import re

    import ee.src.dbs.postgres.wallets.dao as dao_module

    source = inspect.getsource(dao_module.WalletsDAO.apply_plan_change)

    assert "update(WalletCreditDBE)" not in source
    # An assignment, not a `==` comparison in a WHERE clause.
    for field in ("credit_kind", "priority", "end_time", "start_time", "amount_musd"):
        assert not re.search(rf"credit\w*\.{field}\s*=(?!=)", source), field


@pytest.mark.asyncio
async def test_apply_plan_change_replayed_webhook_applies_exactly_once(monkeypatch):
    monkeypatch.setattr(
        "ee.src.core.wallets.service.allowance_musd_for_plan", lambda *, plan: 620_000
    )
    service, dao = _service_with_empty_wallet()

    first = await _change(
        service, dao, key="pc-replay-once", incoming_plan="b", now=PERIOD_START
    )
    balance_after_first = dao.general_balance.balance_musd
    credits_after_first = dict(dao._credits)

    second = await _change(
        service, dao, key="pc-replay-once", incoming_plan="b", now=MID_PERIOD
    )

    assert first.replayed is False
    assert second.replayed is True
    assert second.incoming_credit_id == first.incoming_credit_id
    assert second.incoming_credit_amount_musd == first.incoming_credit_amount_musd
    assert dao.general_balance.balance_musd == balance_after_first
    assert dao._credits == credits_after_first
    assert len(dao._credits) == 1


@pytest.mark.asyncio
async def test_apply_plan_change_sizes_and_expires_the_new_credit_by_its_period():
    """The minted credit is worth the share of the period it covers and expires at
    that period's end."""
    service, dao = _service_with_empty_wallet()
    period_end = datetime(2026, 4, 14, 15, 0, tzinfo=timezone.utc)

    result = await _change(
        service,
        dao,
        key="pc-period",
        incoming_plan="cloud_v0_pro",
        now=datetime(2026, 3, 14, 15, 0, tzinfo=timezone.utc),
        period=(datetime(2026, 3, 14, 15, 0, tzinfo=timezone.utc), period_end),
    )

    assert result.incoming_credit_amount_musd == 5_000_000
    incoming_candidate, incoming_balance = dao._credits[result.incoming_credit_id]
    assert incoming_candidate.end_time == period_end
    assert incoming_balance.balance_musd == 5_000_000


@pytest.mark.asyncio
async def test_successive_changes_claw_back_the_newest_allowance():
    """Pro on the 1st, Business on the 11th, Hobby on the 22nd, one 31-day period.
    The Hobby change must claw the Business credit, not the Pro one: both end at the
    same instant, so choosing by expiry could pick either."""
    service, dao = _service_with_empty_wallet()
    await _change(
        service, dao, key="pc-pro", incoming_plan="cloud_v0_pro", now=PERIOD_START
    )
    business = await _change(
        service,
        dao,
        key="pc-biz",
        incoming_plan="cloud_v0_business",
        now=datetime(2026, 1, 11, tzinfo=timezone.utc),
    )

    hobby = await _change(
        service,
        dao,
        key="pc-hobby",
        incoming_plan="cloud_v0_hobby",
        now=datetime(2026, 1, 22, tzinfo=timezone.utc),
    )

    assert hobby.outgoing_credit_id == business.incoming_credit_id
    # The Business credit holds 21/31 of $50 (33_870_967); 10 of its 21 days remain.
    assert hobby.outgoing_debit_amount_musd == 33_870_967 * 10 // 21


@pytest.mark.asyncio
async def test_a_change_after_a_clawback_does_not_claw_the_same_credit_again():
    """Pro on the 1st, Hobby on the 11th (clawed, nothing minted), Pro again on the
    22nd. The Pro credit's remainder after the first clawback was earned; the third
    change must not treat it as an outgoing allowance a second time."""
    service, dao = _service_with_empty_wallet()
    pro = await _change(
        service, dao, key="pc-pro", incoming_plan="cloud_v0_pro", now=PERIOD_START
    )
    await _change(
        service,
        dao,
        key="pc-hobby",
        incoming_plan="cloud_v0_hobby",
        now=datetime(2026, 1, 11, tzinfo=timezone.utc),
    )
    _, earned = dao._credits[pro.incoming_credit_id]

    again = await _change(
        service,
        dao,
        key="pc-pro-again",
        incoming_plan="cloud_v0_pro",
        now=datetime(2026, 1, 22, tzinfo=timezone.utc),
    )

    assert again.outgoing_debit_amount_musd == 0
    assert dao._credits[pro.incoming_credit_id][1].balance_musd == earned.balance_musd
