"""Unit tests for the wallet's credit sources against the in-memory `FakeWalletsDAO`: the
daily free credits granted on admission, a paid plan's monthly credits, purchased top-ups
and the starter-credits transfer."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

import ee.src.core.wallets.service as service_module
from ee.src.core.access.entitlements.types import DefaultPlan
from ee.src.core.wallets.grants import (
    DAILY_FREE_CREDITS_MUSD,
    compose_award_idempotency_key,
    next_utc_midnight,
)
from ee.src.core.wallets.purchases import TOP_UP_PACKS
from ee.src.core.wallets.service import WalletsService
from ee.tests.pytest.utils.wallets.builders import build_general_wallet_balance
from ee.tests.pytest.utils.wallets.fakes import FakeWalletsDAO

HOBBY = DefaultPlan.CLOUD_V0_HOBBY.value
PRO = DefaultPlan.CLOUD_V0_PRO.value
BUSINESS = DefaultPlan.CLOUD_V0_BUSINESS.value

# In the future, so the fake's real-clock expiry filter keeps the credits spendable.
NOW = datetime(2036, 10, 2, 23, 30, tzinfo=timezone.utc)


def _dao(organization_id=None):
    return FakeWalletsDAO(
        general_balance=build_general_wallet_balance(
            organization_id=organization_id or uuid4(), balance_musd=0, floor_musd=0
        )
    )


def _plan_reader(plan, calls=None):
    async def read(organization_id):
        if calls is not None:
            calls.append(organization_id)
        return plan

    return read


def _freeze(monkeypatch, now):
    class _Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return now

    monkeypatch.setattr(service_module, "datetime", _Clock)


# ---------------------------------------------------------------------------
# Daily free credits
# ---------------------------------------------------------------------------


def test_next_utc_midnight_is_the_start_of_the_next_utc_day():
    assert next_utc_midnight(NOW) == datetime(2036, 10, 3, tzinfo=timezone.utc)
    late_in_new_york = datetime(
        2036, 10, 2, 20, 0, tzinfo=timezone(timedelta(hours=-5))
    )
    assert next_utc_midnight(late_in_new_york) == datetime(
        2036, 10, 4, tzinfo=timezone.utc
    )


@pytest.mark.asyncio
async def test_daily_free_credits_granted_on_first_admission_and_expire_at_midnight(
    monkeypatch,
):
    _freeze(monkeypatch, NOW)
    dao = _dao()
    organization_id = dao.general_balance.organization_id
    plan_reads = []
    service = WalletsService(
        wallets_dao=dao, plan_reader=_plan_reader(HOBBY, plan_reads)
    )

    assert await service.check(organization_id=organization_id) is True
    assert await service.check(organization_id=organization_id) is True

    [credit] = dao.awards.values()
    assert credit.credit_kind == "daily_free"
    assert credit.amount_musd == DAILY_FREE_CREDITS_MUSD == 750_000
    assert credit.end_time == datetime(2036, 10, 3, tzinfo=timezone.utc)
    assert credit.data["references"]["award_idempotency_key"] == (
        compose_award_idempotency_key(
            activity_code="daily_free",
            organization_id=organization_id,
            reference="2036-10-02",
        )
    )
    # The second admission of the day neither reads the plan nor awards again.
    assert plan_reads == [organization_id]
    assert dao.award_calls == 1


@pytest.mark.asyncio
async def test_daily_free_credits_once_per_day_across_processes(monkeypatch):
    _freeze(monkeypatch, NOW)
    dao = _dao()
    organization_id = dao.general_balance.organization_id

    for _ in range(2):
        service = WalletsService(wallets_dao=dao, plan_reader=_plan_reader(HOBBY))
        await service.check(organization_id=organization_id)

    assert len(dao._credits) == 1
    assert dao.general_balance.balance_musd == DAILY_FREE_CREDITS_MUSD


@pytest.mark.asyncio
async def test_daily_free_credits_granted_again_the_next_day(monkeypatch):
    dao = _dao()
    organization_id = dao.general_balance.organization_id
    service = WalletsService(wallets_dao=dao, plan_reader=_plan_reader(HOBBY))

    _freeze(monkeypatch, NOW)
    await service.check(organization_id=organization_id)
    _freeze(monkeypatch, NOW + timedelta(hours=1))
    await service.check(organization_id=organization_id)

    end_times = sorted(credit.end_time for credit in dao.awards.values())
    assert end_times == [
        datetime(2036, 10, 3, tzinfo=timezone.utc),
        datetime(2036, 10, 4, tzinfo=timezone.utc),
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("plan", [PRO, BUSINESS, None])
async def test_no_daily_free_credits_off_the_free_plan(plan):
    dao = _dao()
    service = WalletsService(wallets_dao=dao, plan_reader=_plan_reader(plan))

    await service.check(organization_id=dao.general_balance.organization_id)

    assert dao.award_calls == 0


@pytest.mark.asyncio
async def test_no_daily_free_credits_without_a_plan_reader():
    dao = _dao()
    service = WalletsService(wallets_dao=dao)

    await service.check(organization_id=dao.general_balance.organization_id)

    assert dao.award_calls == 0


@pytest.mark.asyncio
async def test_a_failed_daily_grant_admits_on_the_balance_and_retries_next_time():
    dao = _dao()
    organization_id = dao.general_balance.organization_id
    failures = [RuntimeError("plan read failed")]

    async def flaky_reader(_):
        if failures:
            raise failures.pop()
        return HOBBY

    service = WalletsService(wallets_dao=dao, plan_reader=flaky_reader)

    assert await service.check(organization_id=organization_id) is False
    assert dao.award_calls == 0
    assert await service.check(organization_id=organization_id) is True
    assert dao.award_calls == 1


@pytest.mark.asyncio
async def test_covers_also_grants_the_daily_free_credits():
    dao = _dao()
    service = WalletsService(wallets_dao=dao, plan_reader=_plan_reader(HOBBY))

    assert await service.covers(
        organization_id=dao.general_balance.organization_id, amount_musd=500_000
    )


# ---------------------------------------------------------------------------
# Monthly credits
# ---------------------------------------------------------------------------

PERIOD_START = datetime(2026, 10, 1, tzinfo=timezone.utc)
PERIOD_END = datetime(2026, 11, 1, tzinfo=timezone.utc)


@pytest.mark.asyncio
@pytest.mark.parametrize("plan,amount", [(PRO, 29_000_000), (BUSINESS, 299_000_000)])
async def test_period_allowance_is_the_plan_price_for_the_period(plan, amount):
    dao = _dao()
    service = WalletsService(wallets_dao=dao)

    credit = await service.grant_period_allowance(
        organization_id=dao.general_balance.organization_id,
        plan=plan,
        period_start=PERIOD_START,
        period_end=PERIOD_END,
    )

    assert credit.credit_kind == "plan_allowance"
    assert credit.amount_musd == amount
    assert (credit.start_time, credit.end_time) == (PERIOD_START, PERIOD_END)


@pytest.mark.asyncio
async def test_period_allowance_grants_once_per_period():
    dao = _dao()
    organization_id = dao.general_balance.organization_id
    service = WalletsService(wallets_dao=dao)
    period = dict(period_start=PERIOD_START, period_end=PERIOD_END)

    first = await service.grant_period_allowance(
        organization_id=organization_id, plan=PRO, **period
    )
    replay = await service.grant_period_allowance(
        organization_id=organization_id, plan=PRO, **period
    )
    await service.grant_period_allowance(
        organization_id=organization_id,
        plan=PRO,
        period_start=PERIOD_END,
        period_end=datetime(2026, 12, 1, tzinfo=timezone.utc),
    )

    assert replay.id == first.id
    assert len(dao._credits) == 2
    assert dao.general_balance.balance_musd == 2 * 29_000_000


@pytest.mark.asyncio
async def test_period_allowance_skips_a_plan_without_monthly_credits():
    dao = _dao()
    service = WalletsService(wallets_dao=dao)

    credit = await service.grant_period_allowance(
        organization_id=dao.general_balance.organization_id,
        plan=HOBBY,
        period_start=PERIOD_START,
        period_end=PERIOD_END,
    )

    assert credit is None
    assert dao.award_calls == 0


# ---------------------------------------------------------------------------
# Purchases and the starter-credits transfer
# ---------------------------------------------------------------------------


def test_top_up_packs_are_one_credit_per_cent():
    assert {
        code: (pack.price_cents, pack.credits, pack.amount_musd)
        for code, pack in TOP_UP_PACKS.items()
    } == {
        "credits_1000": (1_000, 1_000, 10_000_000),
        "credits_2500": (2_500, 2_500, 25_000_000),
        "credits_10000": (10_000, 10_000, 100_000_000),
    }


@pytest.mark.asyncio
async def test_purchase_grants_once_per_checkout_session_for_twelve_months():
    dao = _dao()
    organization_id = dao.general_balance.organization_id
    service = WalletsService(wallets_dao=dao)

    first = await service.grant_purchase(
        organization_id=organization_id,
        checkout_session_id="cs_test_1",
        amount_musd=10_000_000,
        now=NOW,
    )
    replay = await service.grant_purchase(
        organization_id=organization_id,
        checkout_session_id="cs_test_1",
        amount_musd=10_000_000,
        now=NOW + timedelta(minutes=5),
    )
    await service.grant_purchase(
        organization_id=organization_id,
        checkout_session_id="cs_test_2",
        amount_musd=25_000_000,
        now=NOW,
    )

    assert replay.id == first.id
    assert first.credit_kind == "purchase"
    assert first.end_time == NOW + timedelta(days=365)
    assert dao.general_balance.balance_musd == 35_000_000


@pytest.mark.asyncio
async def test_starter_credits_transfer_once_per_organization():
    dao = _dao()
    organization_id = dao.general_balance.organization_id
    service = WalletsService(wallets_dao=dao)

    first = await service.grant_starter_credits(
        organization_id=organization_id, amount_musd=3_210_000, now=NOW
    )
    replay = await service.grant_starter_credits(
        organization_id=organization_id, amount_musd=4_000_000, now=NOW
    )

    assert replay.id == first.id
    assert first.credit_kind == "starter_credits"
    assert first.end_time == NOW + timedelta(days=365)
    assert dao.general_balance.balance_musd == 3_210_000
