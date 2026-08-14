"""Unit tests for `WalletsService` (the concrete `WalletCheckPort`/`WalletSettlementPort`
adapter) against the in-memory `FakeWalletsDAO` — no Postgres, no event loop conflicts.
"""

import inspect

import pytest

from ee.src.core.wallets.interfaces import WalletCheckPort, WalletSettlementPort
from ee.src.core.wallets.service import WalletsService
from ee.tests.pytest.utils.wallets.builders import (
    build_credit_candidate,
    build_credit_wallet_balance,
    build_debit_command,
    build_general_wallet_balance,
)
from ee.tests.pytest.utils.wallets.fakes import FakeWalletsDAO


def test_wallet_check_never_delegates_to_entitlements_check():
    """A wallet check and an entitlement check answer different questions (balance vs.
    floor, not a meter vs. a plan limit). `service.py` must not import or call
    `check_entitlements` — no test may assert one through the other."""
    import ee.src.core.wallets.service as wallets_service_module

    assert "check_entitlements" not in dir(wallets_service_module)
    source = inspect.getsource(wallets_service_module)
    assert "check_entitlements(" not in source


def test_wallets_service_implements_both_ports():
    service = WalletsService(wallets_dao=FakeWalletsDAO())
    assert isinstance(service, WalletCheckPort)
    assert isinstance(service, WalletSettlementPort)


def test_check_signature_stays_synchronous():
    # The seed port contract declares `check` as a plain (non-async) method; the concrete
    # adapter must honor that signature exactly.
    assert not inspect.iscoroutinefunction(WalletsService.check)


def test_check_is_write_free():
    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(balance_musd=1000, floor_musd=0)
    )
    service = WalletsService(wallets_dao=dao)

    allowed = service.check(
        organization_id=dao.general_balance.organization_id, amount_musd=999_999
    )

    assert allowed is True
    assert dao.settle_calls == 0
    assert dao.debits == []


def test_check_allows_when_balance_above_floor():
    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(balance_musd=1, floor_musd=0)
    )
    service = WalletsService(wallets_dao=dao)

    assert (
        service.check(
            organization_id=dao.general_balance.organization_id, amount_musd=100
        )
        is True
    )


def test_check_rejects_when_balance_at_floor():
    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(balance_musd=0, floor_musd=0)
    )
    service = WalletsService(wallets_dao=dao)

    assert (
        service.check(
            organization_id=dao.general_balance.organization_id, amount_musd=1
        )
        is False
    )


def test_check_rejects_when_balance_below_floor():
    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(balance_musd=-500, floor_musd=0)
    )
    service = WalletsService(wallets_dao=dao)

    assert (
        service.check(
            organization_id=dao.general_balance.organization_id, amount_musd=1
        )
        is False
    )


def test_check_ignores_requested_amount_in_its_decision():
    """Non-strict by design: the accept/reject decision depends only on the already-
    committed balance vs floor, never on the amount_musd of the request being checked."""
    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(balance_musd=1, floor_musd=0)
    )
    service = WalletsService(wallets_dao=dao)

    small = service.check(
        organization_id=dao.general_balance.organization_id, amount_musd=1
    )
    huge = service.check(
        organization_id=dao.general_balance.organization_id, amount_musd=10_000_000
    )

    assert small is True
    assert huge is True


def test_check_allows_when_organization_has_no_wallet_provisioned():
    dao = FakeWalletsDAO(general_balance=None)
    service = WalletsService(wallets_dao=dao)

    assert (
        service.check(
            organization_id=build_general_wallet_balance().organization_id,
            amount_musd=1,
        )
        is True
    )


@pytest.mark.asyncio
async def test_settle_delegates_to_dao():
    candidate = build_credit_candidate(balance_musd=5000)
    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(),
        credits=[
            (
                candidate,
                build_credit_wallet_balance(
                    wallet_credit_id=candidate.wallet_credit_id,
                    balance_musd=candidate.balance_musd,
                ),
            )
        ],
    )
    service = WalletsService(wallets_dao=dao)
    command = build_debit_command(
        organization_id=dao.general_balance.organization_id, amount_musd=100
    )

    await service.settle(command)

    assert dao.settle_calls == 1
    assert len(dao.debits) == 1
    assert dao.debits[0].amount_musd == 100


@pytest.mark.asyncio
async def test_settle_replay_is_a_no_op_second_write():
    candidate = build_credit_candidate(balance_musd=5000)
    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(balance_musd=10_000),
        credits=[
            (
                candidate,
                build_credit_wallet_balance(
                    wallet_credit_id=candidate.wallet_credit_id,
                    balance_musd=candidate.balance_musd,
                ),
            )
        ],
    )
    service = WalletsService(wallets_dao=dao)
    command = build_debit_command(
        organization_id=dao.general_balance.organization_id,
        idempotency_key="gw_replay_test",
        amount_musd=250,
    )

    await service.settle(command)
    balance_after_first = dao.general_balance.balance_musd
    debits_after_first = list(dao.debits)

    await service.settle(command)  # same posting, delivered again

    assert dao.settle_calls == 2  # the DAO method was invoked twice...
    assert dao.debits == debits_after_first  # ...but produced no new rows
    assert (
        dao.general_balance.balance_musd == balance_after_first
    )  # ...and no second write
