"""Unit tests for `WalletsService.provision_general_balance` and `.apply_plan_change`
against the in-memory `FakeWalletsDAO` — no Postgres, no event loop conflicts. Mirrors
`test_wallets_service.py`'s style for `check`/`settle`.
"""

from datetime import datetime, timezone
from uuid import uuid4

import pytest

from ee.src.core.wallets.service import WalletsService
from ee.tests.pytest.utils.wallets.builders import (
    build_credit_candidate,
    build_credit_wallet_balance,
    build_general_wallet_balance,
)
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


@pytest.mark.asyncio
async def test_apply_plan_change_mints_no_value_when_mapping_is_zero():
    """Today's real `allowance_musd_for_plan` mapping (see `plans.py`) is a constant 0
    for every plan — this exercises the actual production mapping, unpatched."""
    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(balance_musd=1_000, floor_musd=0)
    )
    service = WalletsService(wallets_dao=dao)

    result = await service.apply_plan_change(
        organization_id=dao.general_balance.organization_id,
        idempotency_key="pc-zero-mapping",
        outgoing_plan="cloud_v0_hobby",
        incoming_plan="cloud_v0_pro",
        period_start=PERIOD_START,
        period_end=PERIOD_END,
        now=MID_PERIOD,
    )

    assert result.outgoing_debit_amount_musd == 0
    assert result.incoming_credit_amount_musd == 0
    assert result.outgoing_debit_id is None
    assert result.incoming_credit_id is None
    assert dao.debits == []
    assert dao._credits == {}
    # general balance itself is untouched (net zero move); floor is still applied.
    assert dao.general_balance.balance_musd == 1_000
    assert dao.general_balance.floor_musd == 0


@pytest.mark.asyncio
async def test_apply_plan_change_updates_general_balance_floor(monkeypatch):
    monkeypatch.setattr(
        "ee.src.core.wallets.service.floor_musd_for_plan", lambda *, plan: -5_000
    )
    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(balance_musd=0, floor_musd=0)
    )
    service = WalletsService(wallets_dao=dao)

    await service.apply_plan_change(
        organization_id=dao.general_balance.organization_id,
        idempotency_key="pc-floor",
        outgoing_plan="a",
        incoming_plan="b",
        period_start=PERIOD_START,
        period_end=PERIOD_END,
        now=PERIOD_START,
    )

    assert dao.general_balance.floor_musd == -5_000


@pytest.mark.asyncio
async def test_apply_plan_change_moves_prorated_value_and_never_mutates_existing_credit(
    monkeypatch,
):
    monkeypatch.setattr(
        "ee.src.core.wallets.service.allowance_musd_for_plan",
        lambda *, plan: {"outgoing": 310_000, "incoming": 620_000}[plan],
    )
    outgoing_credit_id = uuid4()
    outgoing_candidate = build_credit_candidate(
        wallet_credit_id=outgoing_credit_id, balance_musd=310_000
    )
    outgoing_balance = build_credit_wallet_balance(
        wallet_credit_id=outgoing_credit_id, balance_musd=310_000
    )
    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(
            balance_musd=100_000, floor_musd=0
        ),
        credits=[(outgoing_candidate, outgoing_balance)],
    )
    service = WalletsService(wallets_dao=dao)

    result = await service.apply_plan_change(
        organization_id=dao.general_balance.organization_id,
        idempotency_key="pc-move-value",
        outgoing_plan="outgoing",
        incoming_plan="incoming",
        period_start=PERIOD_START,
        period_end=PERIOD_END,
        now=datetime(2026, 1, 22, tzinfo=timezone.utc),  # 10 days remaining of 31
    )

    # 10/31 of the period remains: 310_000/31 * 10 == 100_000 removed;
    # 620_000/31 * 10 == 200_000 minted.
    assert result.outgoing_debit_amount_musd == 100_000
    assert result.incoming_credit_amount_musd == 200_000
    assert result.outgoing_credit_id == outgoing_credit_id
    assert result.incoming_credit_id is not None
    assert result.incoming_credit_id != outgoing_credit_id  # a NEW credit, not a reuse

    # The general balance moved by exactly (incoming - outgoing).
    assert dao.general_balance.balance_musd == 100_000 + (200_000 - 100_000)

    # The outgoing credit's OWN immutable record (kind/priority) is untouched — only its
    # balance projection changed, and it changed by exactly the applied amount.
    new_candidate, new_balance = dao._credits[outgoing_credit_id]
    assert new_candidate.credit_kind == outgoing_candidate.credit_kind
    assert new_candidate.priority == outgoing_candidate.priority
    assert new_balance.balance_musd == 310_000 - 100_000

    # A brand-new credit was minted for the incoming share — the old one was never
    # reused or rewritten.
    new_credit_candidate, new_credit_balance = dao._credits[result.incoming_credit_id]
    assert new_credit_balance.balance_musd == 200_000


def test_apply_plan_change_never_updates_an_existing_wallet_credit_row():
    """Source-level regression guard on the real Postgres DAO: `apply_plan_change` must
    never issue an UPDATE against `WalletCreditDBE` — a credit's own immutable fields
    (amount_musd/credit_kind/priority/end_time) are written once, at INSERT, never
    mutated afterward. Only `WalletBalanceDBE.balance_musd` (the mutable projection) is
    ever decremented in place."""
    import inspect

    import ee.src.dbs.postgres.wallets.dao as dao_module

    source = inspect.getsource(dao_module.WalletsDAO.apply_plan_change)

    assert "update(WalletCreditDBE)" not in source
    assert ".credit_kind =" not in source
    assert ".priority =" not in source
    assert ".end_time =" not in source
    # amount_musd is only ever set as a constructor kwarg on a NEW WalletCreditDBE(...),
    # never assigned onto an existing object.
    assert "credit.amount_musd =" not in source
    assert "outgoing_credit.amount_musd =" not in source


@pytest.mark.asyncio
async def test_apply_plan_change_replayed_webhook_applies_exactly_once(monkeypatch):
    monkeypatch.setattr(
        "ee.src.core.wallets.service.allowance_musd_for_plan", lambda *, plan: 620_000
    )
    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(balance_musd=0, floor_musd=0)
    )
    service = WalletsService(wallets_dao=dao)

    kwargs = dict(
        organization_id=dao.general_balance.organization_id,
        idempotency_key="pc-replay-once",
        outgoing_plan="a",
        incoming_plan="b",
        period_start=PERIOD_START,
        period_end=PERIOD_END,
        now=PERIOD_START,
    )

    first = await service.apply_plan_change(**kwargs)
    balance_after_first = dao.general_balance.balance_musd
    credits_after_first = dict(dao._credits)

    second = await service.apply_plan_change(**kwargs)  # same idempotency_key, replayed

    assert first.replayed is False
    assert second.replayed is True
    assert second.incoming_credit_id == first.incoming_credit_id
    assert second.incoming_credit_amount_musd == first.incoming_credit_amount_musd
    # No second financial effect: same balance, same credit set.
    assert dao.general_balance.balance_musd == balance_after_first
    assert dao._credits == credits_after_first
    assert len(dao._credits) == 1  # only ONE credit was ever minted, not two
