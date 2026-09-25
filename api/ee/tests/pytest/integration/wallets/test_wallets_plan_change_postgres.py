"""Real-Postgres coverage for plan changes: which allowance credit a change claws back,
that the choice is made under the same lock as the writes, that it never reaches another
organization's credit, and that the subscription lock serializes changes for one
organization. The in-memory fake cannot prove any of these: it has no clock-ordered ids,
no row locks and no concurrent sessions.
"""

import asyncio
import uuid
from datetime import datetime, timezone

import pytest
from alembic import command
from sqlalchemy import text

import oss.src.dbs.postgres.shared.engine as engine_module
from ee.databases.postgres.migrations.core_ee.utils import alembic_cfg
from ee.src.core.wallets.service import WalletsService
from ee.src.core.wallets.types import WalletCreditBalanceNotFoundError
from ee.src.dbs.postgres.subscriptions.dao import SubscriptionsDAO
from ee.src.dbs.postgres.wallets.dao import WalletsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine

pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.integration,
    pytest.mark.xdist_group(name="wallets-integration"),
]

DOWN_REVISION = "ee0000000003"
SCHEMA_REVISION = "ee0000000004"

# One 31-day billing period, as Stripe would report it.
PERIOD_START = datetime(2026, 1, 1, tzinfo=timezone.utc)
PERIOD_END = datetime(2026, 2, 1, tzinfo=timezone.utc)
JAN_11 = datetime(2026, 1, 11, tzinfo=timezone.utc)
JAN_22 = datetime(2026, 1, 22, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


@pytest.fixture
async def wallet_schema():
    await asyncio.to_thread(command.upgrade, alembic_cfg, SCHEMA_REVISION)
    try:
        yield
    finally:
        await asyncio.to_thread(command.downgrade, alembic_cfg, DOWN_REVISION)


async def _cleanup(*organization_ids: uuid.UUID):
    async with get_transactions_engine().session() as session:
        for table in ("wallet_debits", "wallet_balances", "wallet_credits"):
            await session.execute(
                text(f"DELETE FROM {table} WHERE organization_id = ANY(:ids)"),
                {"ids": list(organization_ids)},
            )


async def _change(service, organization_id, *, key, plan, now):
    return await service.apply_plan_change(
        organization_id=organization_id,
        idempotency_key=key,
        subscription_id="sub_123",
        incoming_plan=plan,
        period_start=PERIOD_START,
        period_end=PERIOD_END,
        now=now,
    )


async def _credit_balance(credit_id: uuid.UUID) -> int:
    async with get_transactions_engine().session() as session:
        return (
            await session.execute(
                text(
                    "SELECT balance_musd FROM wallet_balances "
                    "WHERE wallet_credit_id = :credit_id"
                ),
                {"credit_id": credit_id},
            )
        ).scalar_one()


async def _plan_change_debits_against(credit_id: uuid.UUID) -> int:
    async with get_transactions_engine().session() as session:
        return (
            await session.execute(
                text(
                    "SELECT count(*) FROM wallet_debits "
                    "WHERE wallet_credit_id = :credit_id "
                    "AND resource_key = 'wallet:plan_change'"
                ),
                {"credit_id": credit_id},
            )
        ).scalar_one()


async def _assert_general_equals_sum_of_credits(organization_id: uuid.UUID):
    """No deficit and no usage in these tests, so the general projection must equal the
    sum of the per-credit balances exactly."""
    async with get_transactions_engine().session() as session:
        general, credits = (
            await session.execute(
                text(
                    "SELECT "
                    "sum(balance_musd) FILTER (WHERE wallet_credit_id IS NULL), "
                    "sum(balance_musd) FILTER (WHERE wallet_credit_id IS NOT NULL) "
                    "FROM wallet_balances WHERE organization_id = :organization_id"
                ),
                {"organization_id": organization_id},
            )
        ).one()
    assert general == credits


async def test_successive_changes_in_one_period_claw_back_the_newest_allowance(
    wallet_schema,
):
    """Pro on 1 January, Business on the 11th, Hobby on the 22nd. The Pro and Business
    credits both expire on 1 February, so an expiry-ordered lookup could claw the
    downgrade out of the Pro credit (a few dollars at most) and leave the Business
    credit's remainder with an organization that now pays nothing."""
    organization_id = uuid.uuid4()
    service = WalletsService(wallets_dao=WalletsDAO())

    try:
        pro = await _change(
            service,
            organization_id,
            key="pc:pro",
            plan="cloud_v0_pro",
            now=PERIOD_START,
        )
        business = await _change(
            service,
            organization_id,
            key="pc:business",
            plan="cloud_v0_business",
            now=JAN_11,
        )
        hobby = await _change(
            service, organization_id, key="pc:hobby", plan="cloud_v0_hobby", now=JAN_22
        )

        assert pro.incoming_credit_amount_musd == 5_000_000
        # 10 of the 31 days of Pro were used: 21/31 of $5 clawed back.
        assert business.outgoing_credit_id == pro.incoming_credit_id
        assert business.outgoing_debit_amount_musd == 5_000_000 * 21 // 31
        assert business.incoming_credit_amount_musd == 50_000_000 * 21 // 31

        assert hobby.outgoing_credit_id == business.incoming_credit_id
        # 10 of the Business credit's 21 days are left.
        assert hobby.outgoing_debit_amount_musd == (50_000_000 * 21 // 31) * 10 // 21
        assert hobby.incoming_credit_id is None

        # The Pro credit keeps exactly its earned share; it was clawed once only.
        assert await _credit_balance(pro.incoming_credit_id) == (
            5_000_000 - 5_000_000 * 21 // 31
        )
        assert await _plan_change_debits_against(pro.incoming_credit_id) == 1
        assert await _plan_change_debits_against(business.incoming_credit_id) == 1
        await _assert_general_equals_sum_of_credits(organization_id)
    finally:
        await _cleanup(organization_id)


async def test_a_credit_already_clawed_back_is_not_clawed_again(wallet_schema):
    """Pro, then Hobby (clawed, nothing minted), then Pro again, in one period. What is
    left on the first Pro credit after the Hobby change was earned; the third change
    must not treat that credit as its outgoing allowance."""
    organization_id = uuid.uuid4()
    service = WalletsService(wallets_dao=WalletsDAO())

    try:
        pro = await _change(
            service,
            organization_id,
            key="pc:pro",
            plan="cloud_v0_pro",
            now=PERIOD_START,
        )
        await _change(
            service, organization_id, key="pc:hobby", plan="cloud_v0_hobby", now=JAN_11
        )
        earned = await _credit_balance(pro.incoming_credit_id)

        again = await _change(
            service,
            organization_id,
            key="pc:pro-again",
            plan="cloud_v0_pro",
            now=JAN_22,
        )

        assert again.outgoing_debit_amount_musd == 0
        assert again.incoming_credit_amount_musd == 5_000_000 * 10 // 31
        assert await _credit_balance(pro.incoming_credit_id) == earned
        await _assert_general_equals_sum_of_credits(organization_id)
    finally:
        await _cleanup(organization_id)


async def test_overlapping_changes_never_claw_the_same_allowance_twice(wallet_schema):
    """Two different changes applied at the same moment, from separate sessions: an
    upgrade to Business and a cancellation to Hobby, both starting from Pro. The
    outgoing credit is chosen under the general-balance lock, so whichever runs second
    sees the first one's writes. Selected outside the lock, both would read the Pro
    credit, both would claw it, and the organization would lose the share it earned.
    Repeated to give the interleaving every chance to happen."""
    for attempt in range(10):
        organization_id = uuid.uuid4()
        setup = WalletsService(wallets_dao=WalletsDAO())
        try:
            pro = await _change(
                setup,
                organization_id,
                key=f"pc:pro:{attempt}",
                plan="cloud_v0_pro",
                now=PERIOD_START,
            )

            results = await asyncio.gather(
                _change(
                    WalletsService(wallets_dao=WalletsDAO()),
                    organization_id,
                    key=f"pc:business:{attempt}",
                    plan="cloud_v0_business",
                    now=JAN_11,
                ),
                _change(
                    WalletsService(wallets_dao=WalletsDAO()),
                    organization_id,
                    key=f"pc:hobby:{attempt}",
                    plan="cloud_v0_hobby",
                    now=JAN_11,
                ),
            )

            assert await _plan_change_debits_against(pro.incoming_credit_id) == 1
            assert await _credit_balance(pro.incoming_credit_id) == (
                5_000_000 - 5_000_000 * 21 // 31
            )
            business, hobby = results
            if hobby.outgoing_credit_id == business.incoming_credit_id:
                # Business applied first; Hobby then clawed the Business credit, all of
                # it, since no time passed between the two.
                assert hobby.outgoing_debit_amount_musd == (
                    business.incoming_credit_amount_musd
                )
            else:
                # Hobby applied first and clawed Pro; Business found nothing to claw.
                assert hobby.outgoing_credit_id == pro.incoming_credit_id
                assert business.outgoing_debit_amount_musd == 0
            await _assert_general_equals_sum_of_credits(organization_id)
        finally:
            await _cleanup(organization_id)


async def test_a_plan_change_never_selects_another_organizations_allowance(
    wallet_schema,
):
    """The other organization's allowance is newer, so an unscoped newest-first lookup
    would pick it."""
    organization_id = uuid.uuid4()
    other_organization_id = uuid.uuid4()
    service = WalletsService(wallets_dao=WalletsDAO())

    try:
        own = await _change(
            service,
            organization_id,
            key="pc:own",
            plan="cloud_v0_pro",
            now=PERIOD_START,
        )
        foreign = await _change(
            service,
            other_organization_id,
            key="pc:foreign",
            plan="cloud_v0_business",
            now=PERIOD_START,
        )

        result = await _change(
            service, organization_id, key="pc:down", plan="cloud_v0_hobby", now=JAN_11
        )

        assert result.outgoing_credit_id == own.incoming_credit_id
        assert await _credit_balance(foreign.incoming_credit_id) == 50_000_000
        assert await _plan_change_debits_against(foreign.incoming_credit_id) == 0
    finally:
        await _cleanup(organization_id, other_organization_id)


async def test_an_allowance_credit_without_its_balance_row_raises(wallet_schema):
    organization_id = uuid.uuid4()
    service = WalletsService(wallets_dao=WalletsDAO())

    try:
        pro = await _change(
            service,
            organization_id,
            key="pc:pro",
            plan="cloud_v0_pro",
            now=PERIOD_START,
        )
        async with get_transactions_engine().session() as session:
            await session.execute(
                text("DELETE FROM wallet_balances WHERE wallet_credit_id = :credit_id"),
                {"credit_id": pro.incoming_credit_id},
            )

        with pytest.raises(WalletCreditBalanceNotFoundError):
            await _change(
                service,
                organization_id,
                key="pc:down",
                plan="cloud_v0_hobby",
                now=JAN_11,
            )
    finally:
        await _cleanup(organization_id)


async def test_the_subscription_lock_serializes_one_organization_only():
    """Two holders for one organization run one after the other; a holder for another
    organization is not held up."""
    organization_id = str(uuid.uuid4())
    other_organization_id = str(uuid.uuid4())
    dao = SubscriptionsDAO()
    first_holds = asyncio.Event()
    release_first = asyncio.Event()
    order = []

    async def first():
        async with dao.lock(organization_id=organization_id):
            order.append("first:acquired")
            first_holds.set()
            await release_first.wait()
            order.append("first:released")

    async def second():
        await first_holds.wait()
        async with dao.lock(organization_id=organization_id):
            order.append("second:acquired")

    async def other():
        await first_holds.wait()
        async with dao.lock(organization_id=other_organization_id):
            order.append("other:acquired")

    tasks = [asyncio.create_task(fn()) for fn in (first, second, other)]
    await first_holds.wait()
    await asyncio.wait_for(tasks[2], timeout=5)
    await asyncio.sleep(0.2)
    assert "second:acquired" not in order

    release_first.set()
    await asyncio.wait_for(asyncio.gather(*tasks), timeout=5)

    assert order.index("first:released") < order.index("second:acquired")
