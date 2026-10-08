"""Unit tests for the wallet's credit sources against the in-memory `FakeWalletsDAO`: the
daily free credits granted on admission, a paid plan's monthly credits, purchased top-ups
and the starter-credits transfer."""

import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

import ee.src.core.wallets.service as service_module
from ee.src.core.access.entitlements.types import DefaultPlan
from ee.src.core.wallets.grants import (
    DAILY_FREE_CREDITS_MUSD,
    DAILY_FREE_GRANTS_PER_MONTH,
    GrantCapReachedError,
    compose_award_idempotency_key,
    next_utc_midnight,
    utc_month_start,
)
from ee.src.core.wallets.purchases import TOP_UP_PACKS
from ee.src.core.wallets.service import WalletsService
from ee.tests.pytest.utils.wallets.builders import build_general_wallet_balance
from ee.tests.pytest.utils.wallets.fakes import FakeWalletsDAO

HOBBY = DefaultPlan.CLOUD_V0_HOBBY.value
PRO = DefaultPlan.CLOUD_V0_PRO.value
BUSINESS = DefaultPlan.CLOUD_V0_BUSINESS.value
AGENTA_AI = DefaultPlan.CLOUD_V0_AGENTA_AI.value
SELF_HOSTED = DefaultPlan.SELF_HOSTED_ENTERPRISE.value

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


def test_utc_month_start_is_the_first_utc_midnight_of_the_month():
    assert utc_month_start(NOW) == datetime(2036, 10, 1, tzinfo=timezone.utc)
    new_year_in_new_york = datetime(
        2036, 12, 31, 20, 0, tzinfo=timezone(timedelta(hours=-5))
    )
    assert utc_month_start(new_year_in_new_york) == datetime(
        2037, 1, 1, tzinfo=timezone.utc
    )


@pytest.mark.asyncio
async def test_daily_free_credits_stop_after_the_monthly_cap(monkeypatch):
    assert DAILY_FREE_GRANTS_PER_MONTH == 10
    dao = _dao()
    organization_id = dao.general_balance.organization_id
    service = WalletsService(wallets_dao=dao, plan_reader=_plan_reader(HOBBY))
    november = datetime(2036, 11, 1, 9, 0, tzinfo=timezone.utc)

    for day in range(12):
        _freeze(monkeypatch, november + timedelta(days=day))
        await service.check(organization_id=organization_id)

    granted_days = sorted(credit.start_time.day for credit in dao.awards.values())
    assert granted_days == list(range(1, 11))
    # The capped day is settled: the next admission neither reads nor awards again.
    calls = dao.award_calls
    await service.check(organization_id=organization_id)
    assert dao.award_calls == calls

    _freeze(monkeypatch, datetime(2036, 12, 1, 9, 0, tzinfo=timezone.utc))
    await service.check(organization_id=organization_id)
    assert len(dao.awards) == DAILY_FREE_GRANTS_PER_MONTH + 1


@pytest.mark.asyncio
async def test_monthly_cap_does_not_touch_the_signup_grant_or_a_replayed_day():
    dao = _dao()
    organization_id = dao.general_balance.organization_id
    service = WalletsService(wallets_dao=dao)
    start = datetime(2036, 11, 1, 9, 0, tzinfo=timezone.utc)

    for day in range(DAILY_FREE_GRANTS_PER_MONTH):
        await service.award(
            organization_id=organization_id,
            activity_code="daily_free",
            reference=f"day-{day}",
            now=start + timedelta(days=day),
        )

    with pytest.raises(GrantCapReachedError):
        await service.award(
            organization_id=organization_id,
            activity_code="daily_free",
            reference="day-10",
            now=start + timedelta(days=10),
        )
    replayed = await service.award(
        organization_id=organization_id,
        activity_code="daily_free",
        reference="day-9",
        now=start + timedelta(days=10),
    )
    assert replayed.start_time == start + timedelta(days=9)
    signup = await service.award(
        organization_id=organization_id, activity_code="signup", now=start
    )
    assert signup.credit_kind == "signup_grant"


@pytest.mark.asyncio
@pytest.mark.parametrize("plan", [PRO, BUSINESS])
async def test_paid_plans_get_daily_free_credits_too(monkeypatch, plan):
    _freeze(monkeypatch, NOW)
    dao = _dao()
    service = WalletsService(wallets_dao=dao, plan_reader=_plan_reader(plan))

    await service.check(organization_id=dao.general_balance.organization_id)

    assert [credit.credit_kind for credit in dao.awards.values()] == ["daily_free"]


@pytest.mark.asyncio
@pytest.mark.parametrize("plan", [AGENTA_AI, SELF_HOSTED, None])
async def test_no_daily_free_credits_on_internal_or_self_hosted_plans(plan):
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
async def test_a_stalled_daily_grant_does_not_stall_the_admission(monkeypatch):
    monkeypatch.setattr(service_module, "DAILY_GRANT_TIMEOUT_SECONDS", 0.05)
    dao = _dao()
    dao.general_balance = dao.general_balance.model_copy(
        update={"balance_musd": 1_000_000}
    )
    stalled = asyncio.Event()

    async def stalled_reader(_):
        await stalled.wait()
        return HOBBY

    service = WalletsService(wallets_dao=dao, plan_reader=stalled_reader)

    allowed = await asyncio.wait_for(
        service.check(organization_id=dao.general_balance.organization_id), 1.0
    )

    assert allowed is True
    assert dao.award_calls == 0
    # Not marked done: the next admission tries again.
    assert dao.general_balance.organization_id not in service._daily_done


@pytest.mark.asyncio
async def test_a_grant_that_crosses_midnight_does_not_mark_the_new_day_done(
    monkeypatch,
):
    dao = _dao()
    organization_id = dao.general_balance.organization_id
    release = asyncio.Event()

    async def slow_reader(_):
        await release.wait()
        return HOBBY

    service = WalletsService(wallets_dao=dao, plan_reader=slow_reader)
    monkeypatch.setattr(service_module, "DAILY_GRANT_TIMEOUT_SECONDS", 5)

    _freeze(monkeypatch, NOW)
    before_midnight = asyncio.ensure_future(
        service.check(organization_id=organization_id)
    )
    await asyncio.sleep(0)
    # Another organization's admission after midnight starts the new day.
    _freeze(monkeypatch, NOW + timedelta(hours=1))
    other = asyncio.ensure_future(service.check(organization_id=uuid4()))
    await asyncio.sleep(0)
    release.set()
    await asyncio.gather(before_midnight, other)

    assert service._daily_day == (NOW + timedelta(hours=1)).date()
    assert organization_id not in service._daily_done


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
@pytest.mark.parametrize("plan,amount", [(PRO, 29_000_000), (BUSINESS, 320_000_000)])
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
async def test_a_purchase_is_read_back_by_its_checkout_session_only():
    dao = _dao()
    organization_id = dao.general_balance.organization_id
    service = WalletsService(wallets_dao=dao)

    assert (
        await service.read_purchase(
            organization_id=organization_id, checkout_session_id="cs_test_1"
        )
        is None
    )

    granted = await service.grant_purchase(
        organization_id=organization_id,
        checkout_session_id="cs_test_1",
        amount_musd=25_000_000,
        now=NOW,
    )

    read = await service.read_purchase(
        organization_id=organization_id, checkout_session_id="cs_test_1"
    )
    assert read is not None and read.id == granted.id
    assert (
        await service.read_purchase(
            organization_id=organization_id, checkout_session_id="cs_test_2"
        )
        is None
    )
    assert (
        await service.read_purchase(
            organization_id=uuid4(), checkout_session_id="cs_test_1"
        )
        is None
    )


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
