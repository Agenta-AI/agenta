"""Unit tests for `WalletsService` (the concrete `WalletCheckPort`/`WalletSettlementPort`
adapter) against the in-memory `FakeWalletsDAO` — no Postgres, no event loop conflicts.
"""

import inspect
from uuid import uuid4

import pytest

from ee.src.core.wallets.interfaces import WalletCheckPort, WalletSettlementPort
from ee.src.core.wallets.plans import LAZY_PROVISION_FLOOR_MUSD
from ee.src.core.wallets.service import WalletsService
from ee.src.core.wallets.types import WalletGeneralBalanceNotFoundError
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


def test_check_signature_is_async():
    # The seed port contract declared `check` as a plain (non-async) method; the concrete
    # adapter now honors an async contract end to end, matching every other streams:
    # worker/service in the repo. No thread pool bridges this — see
    # test_check_never_spawns_a_thread_pool below.
    assert inspect.iscoroutinefunction(WalletsService.check)


def test_check_never_spawns_a_thread_pool():
    """Regression: `_run_blocking` (a fresh ThreadPoolExecutor + event loop per call) is
    gone entirely — `check` is a plain coroutine awaiting the DAO directly."""
    import ee.src.core.wallets.service as wallets_service_module

    assert not hasattr(wallets_service_module, "_run_blocking")
    source = inspect.getsource(wallets_service_module)
    assert "ThreadPoolExecutor" not in source
    assert "asyncio" not in source


@pytest.mark.asyncio
async def test_check_is_write_free():
    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(balance_musd=1000, floor_musd=0)
    )
    service = WalletsService(wallets_dao=dao)

    allowed = await service.check(organization_id=dao.general_balance.organization_id)

    assert allowed is True
    assert dao.settle_calls == 0
    assert dao.debits == []


@pytest.mark.asyncio
async def test_check_allows_when_balance_above_floor():
    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(balance_musd=1, floor_musd=0)
    )
    service = WalletsService(wallets_dao=dao)

    assert (
        await service.check(organization_id=dao.general_balance.organization_id) is True
    )


@pytest.mark.asyncio
async def test_check_rejects_when_balance_at_floor():
    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(balance_musd=0, floor_musd=0)
    )
    service = WalletsService(wallets_dao=dao)

    assert (
        await service.check(organization_id=dao.general_balance.organization_id)
        is False
    )


@pytest.mark.asyncio
async def test_check_rejects_when_balance_below_floor():
    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(balance_musd=-500, floor_musd=0)
    )
    service = WalletsService(wallets_dao=dao)

    assert (
        await service.check(organization_id=dao.general_balance.organization_id)
        is False
    )


@pytest.mark.asyncio
async def test_check_provisions_a_missing_general_balance_and_answers_from_it():
    """An organization created while `AGENTA_WALLETS_ENABLED` was off has no general
    balance row (open-designs item 14). `check` provisions one at the lazy floor and then
    answers from it — which is a rejection, because an organization with no credits is at
    its floor. The old behavior, allowing because "nothing to reject against", let those
    organizations spend without a wallet."""
    organization_id = uuid4()
    dao = FakeWalletsDAO(general_balance=None)
    service = WalletsService(wallets_dao=dao)

    allowed = await service.check(organization_id=organization_id)

    assert allowed is False
    assert dao.provision_calls == 1
    assert dao.general_balance is not None
    assert dao.general_balance.organization_id == organization_id
    assert dao.general_balance.balance_musd == 0
    assert dao.general_balance.floor_musd == LAZY_PROVISION_FLOOR_MUSD


@pytest.mark.asyncio
async def test_check_provisions_at_most_once_per_organization():
    dao = FakeWalletsDAO(general_balance=None)
    service = WalletsService(wallets_dao=dao)
    organization_id = uuid4()

    await service.check(organization_id=organization_id)
    first_row = dao.general_balance
    await service.check(organization_id=organization_id)

    # The second call reads the row the first one wrote; it does not provision again.
    assert dao.provision_calls == 1
    assert dao.general_balance is first_row


@pytest.mark.asyncio
async def test_check_writes_no_debit_when_it_provisions():
    """The port's contract is that `check` writes no debit, reservation, hold or
    allocation. Provisioning a zero-balance projection row is none of those, and nothing
    else moves."""
    dao = FakeWalletsDAO(general_balance=None)
    service = WalletsService(wallets_dao=dao)

    await service.check(organization_id=uuid4())

    assert dao.settle_calls == 0
    assert dao.debits == []
    assert dao.awards == {}
    assert dao.general_balance.balance_musd == 0


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


@pytest.mark.asyncio
async def test_settle_provisions_a_missing_general_balance_rather_than_raising():
    """The settlement path is where the flag gap used to surface: a posting for an
    organization created while `AGENTA_WALLETS_ENABLED` was off raised
    `WalletGeneralBalanceNotFoundError` and the worker retried it forever. It now
    provisions the row and settles against it (open-designs item 14)."""
    dao = FakeWalletsDAO(general_balance=None)
    service = WalletsService(wallets_dao=dao)
    organization_id = uuid4()
    command = build_debit_command(
        organization_id=organization_id,
        idempotency_key="gw_first_posting_for_unprovisioned_org",
        amount_musd=250,
    )

    await service.settle(command)

    assert dao.general_balance is not None
    assert dao.general_balance.organization_id == organization_id
    # No credit funds it, so the whole amount is a deficit against the general balance.
    assert dao.general_balance.balance_musd == -250
    assert [debit.amount_musd for debit in dao.debits] == [250]


@pytest.mark.asyncio
async def test_settle_still_raises_when_the_row_cannot_be_provisioned():
    """The defensive invariant survives: when the row is neither present nor insertable,
    `settle` raises, and `DebitWorker` treats that as terminal."""
    dao = FakeWalletsDAO(general_balance=None, can_provision=False)
    service = WalletsService(wallets_dao=dao)

    with pytest.raises(WalletGeneralBalanceNotFoundError):
        await service.settle(build_debit_command(organization_id=uuid4()))


@pytest.mark.asyncio
async def test_award_provisions_a_missing_general_balance():
    dao = FakeWalletsDAO(general_balance=None)
    service = WalletsService(wallets_dao=dao)
    organization_id = uuid4()

    credit = await service.award(
        organization_id=organization_id, activity_code="signup"
    )

    assert dao.general_balance is not None
    assert dao.general_balance.balance_musd == credit.amount_musd


# ---------------------------------------------------------------------------
# The fake DAO's own guardrails.
#
# `FakeWalletsDAO` is the only DAO the unit suite exercises, so any production
# constraint it drops turns into a green test for a settlement Postgres would refuse.
# Organization ownership is the constraint that is easiest to lose, because
# `CreditCandidateDTO` does not carry the column and `plan_settlement` has no way to
# check it. These tests pin the scope the fake applies on the caller's behalf.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_settle_never_funds_a_debit_from_another_organizations_credit():
    other_organization_id = uuid4()
    foreign_candidate = build_credit_candidate(balance_musd=5_000)
    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(balance_musd=0),
        credits=[
            (
                foreign_candidate,
                build_credit_wallet_balance(
                    organization_id=other_organization_id,
                    wallet_credit_id=foreign_candidate.wallet_credit_id,
                    balance_musd=foreign_candidate.balance_musd,
                ),
            )
        ],
    )
    service = WalletsService(wallets_dao=dao)

    await service.settle(
        build_debit_command(
            organization_id=dao.general_balance.organization_id, amount_musd=100
        )
    )

    # One deficit debit, funded by nobody — not a debit against the other organization.
    assert len(dao.debits) == 1
    assert dao.debits[0].wallet_credit_id is None
    assert dao.debits[0].amount_musd == 100


@pytest.mark.asyncio
async def test_active_plan_allowance_is_never_read_across_organizations():
    other_organization_id = uuid4()
    foreign_candidate = build_credit_candidate(credit_kind="plan_allowance")
    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(),
        credits=[
            (
                foreign_candidate,
                build_credit_wallet_balance(
                    organization_id=other_organization_id,
                    wallet_credit_id=foreign_candidate.wallet_credit_id,
                ),
            )
        ],
    )

    found = await dao.get_active_plan_allowance_credit(
        organization_id=dao.general_balance.organization_id
    )

    assert found is None
