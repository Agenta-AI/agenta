"""Unit tests for the B2 grant catalog (`ee.src.core.wallets.grants`) and
`WalletsService.award` against the in-memory `FakeWalletsDAO` — no Postgres, no event
loop conflicts. Mirrors `test_wallets_provisioning.py`'s style.
"""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from ee.src.core.wallets.grants import (
    GRANT_CATALOG,
    GrantReferenceRequiredError,
    UnknownGrantActivityError,
    compose_award_idempotency_key,
    get_grant_rule,
)
from ee.src.core.wallets.service import WalletsService
from ee.tests.pytest.utils.wallets.builders import build_general_wallet_balance
from ee.tests.pytest.utils.wallets.fakes import FakeWalletsDAO

NOW = datetime(2026, 8, 14, 12, 0, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Catalog lookup
# ---------------------------------------------------------------------------


def test_signup_grant_catalog_entry_shape():
    rule = get_grant_rule(activity_code="signup")

    assert rule is not None
    assert rule.code == "signup"
    assert rule.amount_musd == 1_000_000  # $1
    assert rule.credit_kind == "award"
    assert rule.lifetime_days == 365  # twelve months, report.md 9.5/9.6
    assert rule.repeatable is False


def test_unknown_grant_activity_returns_none_from_lookup():
    assert get_grant_rule(activity_code="does-not-exist") is None


def test_grant_catalog_has_exactly_one_entry_today():
    """Seeded with exactly ONE entry (signup) — see the module docstring for the
    intended next entries (activation milestone, referral, contribution)."""
    assert list(GRANT_CATALOG.keys()) == ["signup"]


# ---------------------------------------------------------------------------
# Idempotency key format
# ---------------------------------------------------------------------------


def test_compose_award_idempotency_key_once_per_organization_omits_reference():
    organization_id = uuid4()
    key = compose_award_idempotency_key(
        activity_code="signup", organization_id=organization_id
    )
    assert key == f"award:signup:organization:{organization_id}"


def test_compose_award_idempotency_key_repeatable_includes_reference():
    organization_id = uuid4()
    key = compose_award_idempotency_key(
        activity_code="referral_bonus",
        organization_id=organization_id,
        reference="ref_123",
    )
    assert (
        key == f"award:referral_bonus:organization:{organization_id}:reference:ref_123"
    )


# ---------------------------------------------------------------------------
# WalletsService.award
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_award_unknown_activity_raises():
    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(balance_musd=0, floor_musd=0)
    )
    service = WalletsService(wallets_dao=dao)

    with pytest.raises(UnknownGrantActivityError):
        await service.award(
            organization_id=dao.general_balance.organization_id,
            activity_code="not-a-real-activity",
        )


@pytest.mark.asyncio
async def test_award_signup_grants_one_musd_and_updates_general_balance():
    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(balance_musd=0, floor_musd=0)
    )
    service = WalletsService(wallets_dao=dao)

    credit = await service.award(
        organization_id=dao.general_balance.organization_id,
        activity_code="signup",
        now=NOW,
    )

    assert credit.amount_musd == 1_000_000
    assert credit.credit_kind == "award"
    assert dao.general_balance.balance_musd == 1_000_000


@pytest.mark.asyncio
async def test_award_signup_end_time_honours_catalog_lifetime():
    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(balance_musd=0, floor_musd=0)
    )
    service = WalletsService(wallets_dao=dao)

    credit = await service.award(
        organization_id=dao.general_balance.organization_id,
        activity_code="signup",
        now=NOW,
    )

    assert credit.end_time == NOW + timedelta(days=365)


@pytest.mark.asyncio
async def test_award_signup_awarded_once_and_only_once_per_organization():
    organization_id = uuid4()
    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(
            organization_id=organization_id, balance_musd=0, floor_musd=0
        )
    )
    service = WalletsService(wallets_dao=dao)

    first = await service.award(
        organization_id=organization_id, activity_code="signup", now=NOW
    )
    second = await service.award(
        organization_id=organization_id,
        activity_code="signup",
        now=NOW + timedelta(days=1),
    )

    assert second.id == first.id  # the SAME credit, not a new one
    assert dao.award_calls == 2
    assert len(dao._credits) == 1  # only one credit was ever minted
    # Balance moved exactly once, not twice.
    assert dao.general_balance.balance_musd == 1_000_000


@pytest.mark.asyncio
async def test_award_repeat_call_returns_the_existing_credit_not_a_new_one():
    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(balance_musd=500_000, floor_musd=0)
    )
    service = WalletsService(wallets_dao=dao)

    first = await service.award(
        organization_id=dao.general_balance.organization_id,
        activity_code="signup",
        now=NOW,
    )
    second = await service.award(
        organization_id=dao.general_balance.organization_id,
        activity_code="signup",
        now=NOW,
    )

    assert second == first
    assert dao.general_balance.balance_musd == 500_000 + 1_000_000


@pytest.mark.asyncio
async def test_award_repeatable_rule_without_reference_raises(monkeypatch):
    """No catalog entry is repeatable today, so this exercises the guard against a
    hand-built repeatable rule injected via monkeypatch — the guard itself is what
    matters: `GrantReferenceRequiredError` is raised before any DAO call, regardless of
    which catalog entry triggers it."""
    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(balance_musd=0, floor_musd=0)
    )
    service = WalletsService(wallets_dao=dao)

    from ee.src.core.wallets.grants import GrantRule

    repeatable_rule = GrantRule(
        code="referral_bonus",
        amount_musd=1,
        credit_kind="award",
        priority=20,
        lifetime_days=365,
        repeatable=True,
    )
    monkeypatch.setattr(
        "ee.src.core.wallets.service.get_grant_rule",
        lambda *, activity_code: repeatable_rule,
    )

    with pytest.raises(GrantReferenceRequiredError):
        await service.award(
            organization_id=dao.general_balance.organization_id,
            activity_code="referral_bonus",
        )

    assert dao.award_calls == 0  # the guard fired before any DAO call


@pytest.mark.asyncio
async def test_award_repeatable_rule_with_reference_includes_it_in_the_key(monkeypatch):
    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(balance_musd=0, floor_musd=0)
    )
    service = WalletsService(wallets_dao=dao)

    from ee.src.core.wallets.grants import GrantRule

    repeatable_rule = GrantRule(
        code="referral_bonus",
        amount_musd=250_000,
        credit_kind="award",
        priority=20,
        lifetime_days=365,
        repeatable=True,
    )
    monkeypatch.setattr(
        "ee.src.core.wallets.service.get_grant_rule",
        lambda *, activity_code: repeatable_rule,
    )

    organization_id = dao.general_balance.organization_id
    first = await service.award(
        organization_id=organization_id,
        activity_code="referral_bonus",
        reference="referral-1",
        now=NOW,
    )
    second = await service.award(
        organization_id=organization_id,
        activity_code="referral_bonus",
        reference="referral-2",  # a DIFFERENT reference: a distinct award
        now=NOW,
    )

    assert first.id != second.id
    assert dao.general_balance.balance_musd == 500_000


@pytest.mark.asyncio
async def test_award_never_mutates_an_existing_wallet_credit_row():
    """Source-level regression guard on the real Postgres DAO: `award_credit` must never
    issue an UPDATE against `WalletCreditDBE` — only a NEW row is ever inserted, mirroring
    `apply_plan_change`'s immutability guarantee."""
    import inspect

    import ee.src.dbs.postgres.wallets.dao as dao_module

    source = inspect.getsource(dao_module.WalletsDAO.award_credit)

    assert "update(WalletCreditDBE)" not in source
    assert ".credit_kind =" not in source
    assert ".priority =" not in source
    assert ".end_time =" not in source
    assert "credit.amount_musd =" not in source
