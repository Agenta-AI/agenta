import asyncio
import os
import socket
from functools import lru_cache
from urllib.parse import urlparse

import pytest
from alembic import command
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

import oss.src.dbs.redis.shared.engine as redis_engine_module
from ee.databases.postgres.migrations.core_ee.utils import alembic_cfg
from oss.src.utils.env import env

# A skipped integration suite exits 0 and reports green, so in an environment that is
# supposed to have the infrastructure — CI, above all — an unreachable dependency is
# indistinguishable from a passing run. Setting this variable turns every such skip into
# a hard failure naming the address that could not be reached. It defaults to off so a
# developer running the repo suite on a laptop with no Postgres still skips.
REQUIRE_INFRA_ENV_VAR = "AGENTA_TESTS_REQUIRE_INFRA"

_TRUTHY = {"1", "true", "t", "yes", "y", "on"}


def _infra_is_required() -> bool:
    return (os.getenv(REQUIRE_INFRA_ENV_VAR) or "").strip().lower() in _TRUTHY


def _address_of(uri: str | None, *, default_host: str, default_port: int) -> str:
    """Host:port only — the configured URI carries a password."""
    parsed = urlparse(uri or "")
    return f"{parsed.hostname or default_host}:{parsed.port or default_port}"


def _skip_or_fail(*, dependency: str, address: str) -> None:
    reason = f"{dependency} not reachable at {address}"
    if _infra_is_required():
        pytest.fail(
            f"{reason}; {REQUIRE_INFRA_ENV_VAR} is set, so this is a failure rather than"
            " a skip. Check the service container and the POSTGRES_URI_CORE /"
            " POSTGRES_URI_TRACING / REDIS_URI values pointing at it.",
            pytrace=False,
        )
    pytest.skip(f"{reason} — skipping wallet integration tests")


@lru_cache(maxsize=1)
def _postgres_reachable() -> bool:
    """TCP-probe the configured core Postgres once per session. Mirrors
    `oss/tests/pytest/integration/sessions/conftest.py` — these DAO/migration tests need a
    real Postgres reachable at `env.postgres.uri_core`; skip rather than error when it's
    not (e.g. a native run outside docker-compose), unless `AGENTA_TESTS_REQUIRE_INFRA`
    says the infrastructure is meant to be there."""
    parsed = urlparse(env.postgres.uri_core)
    host = parsed.hostname or "postgres"
    port = parsed.port or 5432
    try:
        with socket.create_connection((host, port), timeout=0.5):
            return True
    except OSError:
        return False


@pytest.fixture(autouse=True)
def _skip_when_postgres_unreachable(request):
    if request.node.get_closest_marker("integration") and not _postgres_reachable():
        _skip_or_fail(
            dependency="Core Postgres",
            address=_address_of(
                env.postgres.uri_core, default_host="postgres", default_port=5432
            ),
        )


# --------------------------------------------------------------------------------------
# Disposable-database guard
#
# Every module in this package drives the `core_ee` alembic chain: each `wallet_schema`
# fixture upgrades to `ee0000000004` and then downgrades again, and `ee0000000004`'s
# downgrade DROPS `wallet_credits`, `wallet_debits` and `wallet_balances`. Pointed at a
# database that holds real wallet rows — a shared dev stack, or a production URI pasted
# into POSTGRES_URI_CORE by accident — that teardown destroys financial records the test
# never created, and the old fixtures both assumed the database was disposable and
# assumed it started at `ee0000000003`, restoring it to that revision whatever it was
# found at.
#
# This autouse guard closes both halves, per test, for every module in the package rather
# than per fixture:
#
#   1. Before the test, it reads the `core_ee` revision and counts the rows in the three
#      wallet tables. Any row at all and it REFUSES, naming the database, the revision and
#      the per-table counts. Emptiness is the disposability test on purpose: it is the
#      exact property that makes dropping these tables lossless, it is checked rather than
#      declared, and unlike an opt-in "yes this is a scratch database" variable it cannot
#      be set once and then forgotten as the database fills up.
#   2. After the test, it puts the chain back at the revision it was found at, instead of
#      leaving it wherever the module's own teardown stopped.
#
# It refuses rather than skipping, for the same reason `AGENTA_TESTS_REQUIRE_INFRA`
# exists: a silent skip here would report green while proving nothing.
#
# It deliberately does NOT normalize the chain downward before the test. A database found
# above `ee0000000004` still fails `test_migration_upgrade_downgrade_upgrade_round_trip`,
# which opens by asserting the wallet tables do not yet exist; park the chain at
# `ee0000000003` first, as section 9 of the wallets acceptance note and the CI job both
# do. Parking automatically here would mean re-running `ee0000000005`'s backfill on the
# way back up, which mints `wallet_balances` rows for every existing organization — the
# guard would then refuse the next test on rows it had created itself.
# --------------------------------------------------------------------------------------

CORE_EE_VERSION_TABLE = "alembic_version_ee"

WALLET_TABLES = ("wallet_credits", "wallet_debits", "wallet_balances")


def _core_database_label() -> str:
    """`host:port/database` — never the URI itself, which carries a password."""
    parsed = urlparse(env.postgres.uri_core or "")
    address = _address_of(
        env.postgres.uri_core, default_host="postgres", default_port=5432
    )
    return f"{address}{parsed.path or ''}"


async def _inspect_core_ee_chain() -> tuple[str | None, dict[str, int]]:
    """Return the current `core_ee` revision (None when the chain has never run here) and
    the row count of each wallet table that exists."""
    engine = create_async_engine(url=env.postgres.uri_core)
    try:
        async with engine.connect() as connection:
            version_table_exists = (
                await connection.execute(
                    text(f"SELECT to_regclass('public.{CORE_EE_VERSION_TABLE}')")
                )
            ).scalar()

            revision = None
            if version_table_exists:
                revision = (
                    await connection.execute(
                        text(f"SELECT version_num FROM {CORE_EE_VERSION_TABLE}")
                    )
                ).scalar()

            counts: dict[str, int] = {}
            for table in WALLET_TABLES:
                exists = (
                    await connection.execute(
                        text(f"SELECT to_regclass('public.{table}')")
                    )
                ).scalar()
                if exists:
                    counts[table] = (
                        await connection.execute(text(f"SELECT count(*) FROM {table}"))
                    ).scalar()

            return revision, counts
    finally:
        await engine.dispose()


def _refuse(message: str) -> None:
    pytest.fail(
        f"Refusing to run the wallet integration suite against {_core_database_label()}:"
        f" {message}",
        pytrace=False,
    )


def _revision_distance_from_head() -> dict[str, int]:
    """Position of every `core_ee` revision, newest first, so a restore knows whether it
    is going up or down without assuming the ids sort."""
    script = ScriptDirectory.from_config(alembic_cfg)
    return {
        revision.revision: position
        for position, revision in enumerate(script.walk_revisions())
    }


async def _restore_core_ee_chain(found_revision: str) -> None:
    current_revision, _ = await _inspect_core_ee_chain()
    if current_revision == found_revision:
        return

    positions = _revision_distance_from_head()
    if current_revision is None or positions.get(current_revision, 0) > positions.get(
        found_revision, 0
    ):
        # Current sits further from head than where we started: climb back up.
        await asyncio.to_thread(command.upgrade, alembic_cfg, found_revision)
    else:
        await asyncio.to_thread(command.downgrade, alembic_cfg, found_revision)


@pytest.fixture(autouse=True)
async def _guard_disposable_database(request, _skip_when_postgres_unreachable):
    if not request.node.get_closest_marker("integration"):
        yield
        return

    found_revision, wallet_row_counts = await _inspect_core_ee_chain()

    if found_revision is None:
        _refuse(
            f"the `{CORE_EE_VERSION_TABLE}` table does not exist, so the core_ee chain has"
            " never been applied here. These fixtures move that chain and must not create"
            " it from scratch on a database that is not theirs. Run"
            " `python -m ee.databases.postgres.migrations.runner` against a throwaway"
            " database first."
        )

    populated = {
        table: count for table, count in wallet_row_counts.items() if count > 0
    }
    if populated:
        inventory = ", ".join(
            f"{table}={wallet_row_counts[table]}" for table in WALLET_TABLES
        )
        _refuse(
            f"it is at core_ee revision {found_revision} and already holds wallet rows"
            f" ({inventory}). These fixtures downgrade the core_ee chain, and"
            " `ee0000000004`'s downgrade DROPS the wallet tables, so this run would"
            " destroy rows it did not create. Point POSTGRES_URI_CORE at a throwaway"
            " database."
        )

    try:
        yield
    finally:
        await _restore_core_ee_chain(found_revision)


@pytest.fixture(autouse=True)
async def _fresh_streams_engine_per_test():
    """The durable-Redis streams engine is a process-wide singleton holding one client,
    and pytest-asyncio gives each test its own event loop — a client built in an earlier
    test's loop fails every publish made here, and `_xadd` swallows that into a bare
    `False`. Rebuild it per test, the way these modules rebuild the Postgres transactions
    engine."""
    redis_engine_module._streams_engine = None
    yield
    if redis_engine_module._streams_engine is not None:
        await redis_engine_module._streams_engine.close()
        redis_engine_module._streams_engine = None
