"""Real-Postgres coverage for `AccountTombstonesDAO.exists_live_email_variant`, the
lookup that keeps a second sign-up into the same Gmail inbox from collecting another
signup grant. The unit tests use a fake DAO; this runs the real SQL against `users`.

Self-skips via `conftest.py` when `env.postgres.uri_core` is unreachable.
"""

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import text

import oss.src.dbs.postgres.shared.engine as engine_module
from ee.src.dbs.postgres.accounts.dao import AccountTombstonesDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine

pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.integration,
    pytest.mark.xdist_group(name="wallets-integration"),
]


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


@pytest.fixture
async def live_users():
    """Insert users under a unique local part and delete them afterwards."""
    engine = get_transactions_engine()
    inserted: list[uuid.UUID] = []

    async def _insert(email: str, *, deleted: bool = False) -> None:
        user_id = uuid.uuid4()
        now = datetime.now(timezone.utc)
        async with engine.session() as session:
            await session.execute(
                text(
                    "INSERT INTO users (id, uid, username, email, created_at,"
                    " updated_at, deleted_at)"
                    " VALUES (:id, :uid, 'variant-test', :email, :now, :now, :deleted)"
                ),
                {
                    "id": user_id,
                    "uid": str(user_id),
                    "email": email,
                    "now": now,
                    "deleted": now if deleted else None,
                },
            )
        inserted.append(user_id)

    yield _insert

    async with engine.session() as session:
        await session.execute(
            text("DELETE FROM users WHERE id = ANY(:ids)"), {"ids": inserted}
        )


@pytest.fixture
def local() -> str:
    """A local part no other run uses, so rows of other tests never match."""
    return f"variant{uuid.uuid4().hex[:12]}"


async def test_dotted_and_plus_tag_gmail_signups_match_a_live_account(
    live_users, local
):
    await live_users(f"{local[:4]}.{local[4:]}@gmail.com")
    dao = AccountTombstonesDAO()

    assert await dao.exists_live_email_variant(email=f"{local}@gmail.com")
    assert await dao.exists_live_email_variant(
        email=f"{local[:2]}.{local[2:]}+promo@gmail.com"
    )
    assert await dao.exists_live_email_variant(email=f"{local.upper()}@googlemail.com")


async def test_the_signup_does_not_match_its_own_row(live_users, local):
    await live_users(f"{local}@gmail.com")
    dao = AccountTombstonesDAO()

    assert not await dao.exists_live_email_variant(email=f" {local.upper()}@Gmail.com ")


async def test_a_deleted_account_is_not_a_live_variant(live_users, local):
    await live_users(f"{local[:3]}.{local[3:]}@gmail.com", deleted=True)
    dao = AccountTombstonesDAO()

    assert not await dao.exists_live_email_variant(email=f"{local}@gmail.com")


async def test_non_gmail_addresses_stay_distinct(live_users, local):
    await live_users(f"{local[:4]}.{local[4:]}@acme.test")
    await live_users(f"{local}+test@acme.test")
    dao = AccountTombstonesDAO()

    assert not await dao.exists_live_email_variant(email=f"{local}@acme.test")
    assert not await dao.exists_live_email_variant(
        email=f"{local[:4]}.{local[4:]}+promo@acme.test"
    )
