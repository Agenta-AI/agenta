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
#   2. Immediately before EVERY downgrade, it re-checks — because an entry check alone
#      only proves the database was clean when the suite started, and a live stack
#      pointed at the same database can provision a balance or settle a debit during the
#      test window, after the count was taken. `command.downgrade` is wrapped for the
#      lifetime of each test, so the re-check sits at the destructive operation itself
#      and covers all seven modules' fixtures, the calls made inline in test bodies, and
#      the restore below. It has to be there rather than in this fixture's teardown:
#      autouse conftest fixtures finalize LAST, so by the time this one runs the module's
#      own `wallet_schema` teardown has already downgraded and the tables are already
#      gone. A re-check here would inspect rubble.
#   3. After the test, it puts the chain back at the revision it was found at, instead of
#      leaving it wherever the module's own teardown stopped.
#
# The re-check cannot be the entry check repeated. By teardown the wallet tables
# legitimately hold the rows the test itself just wrote, so "any row at all" would abort
# every single run. What it asks instead is whether any wallet row belongs to a REAL
# organization: the schema carries no foreign key from `wallet_*.organization_id` to
# `organizations` precisely so these tests can mint synthetic owner ids, and they do, so
# a wallet row that does join an `organizations` row was written by something other than
# this suite. (`test_wallets_backfill_migration_postgres.py` is the one module that
# inserts real `organizations` rows, and it deletes them and their balance rows in a
# `finally` before its own downgrade.)
#
# A Postgres advisory lock was considered for this and rejected: advisory locks are
# cooperative, the wallets service and `DebitWorker` never take one, so holding it would
# exclude nothing except another copy of this suite — which `xdist_group` already
# handles. The lock that would actually block an application write is `ACCESS EXCLUSIVE`
# on the three tables, and holding that for the fixture lifetime would block the suite's
# own writes. Detecting the intruder and refusing to drop is the mechanism that fits.
#
# It refuses rather than skipping, for the same reason `AGENTA_TESTS_REQUIRE_INFRA`
# exists: a silent skip here would report green while proving nothing. A refusal at
# downgrade time deliberately leaves the chain ABOVE where it was found — preserving the
# tables is the entire point, so the restore is the thing sacrificed, and the message
# says so.
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


async def _count_foreign_wallet_rows() -> dict[str, int]:
    """Wallet rows owned by a real `organizations` row — that is, rows this suite did not
    write. See the header: the suite mints synthetic organization ids that deliberately
    match no `organizations` row, so a row that joins one came from somewhere else."""
    engine = create_async_engine(url=env.postgres.uri_core)
    try:
        async with engine.connect() as connection:
            organizations_exist = (
                await connection.execute(
                    text("SELECT to_regclass('public.organizations')")
                )
            ).scalar()
            if not organizations_exist:
                return {}

            foreign: dict[str, int] = {}
            for table in WALLET_TABLES:
                exists = (
                    await connection.execute(
                        text(f"SELECT to_regclass('public.{table}')")
                    )
                ).scalar()
                if not exists:
                    continue
                count = (
                    await connection.execute(
                        text(
                            f"SELECT count(*) FROM {table} t"
                            " JOIN organizations o ON o.id = t.organization_id"
                        )
                    )
                ).scalar()
                if count:
                    foreign[table] = count
            return foreign
    finally:
        await engine.dispose()


def _guarded_downgrade(original_downgrade):
    """Wrap `alembic.command.downgrade` so no downgrade runs while wallet rows belonging
    to a real organization are present. Installed per test by the guard fixture."""

    def downgrade(config, revision, *args, **kwargs):
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            pass
        else:
            raise RuntimeError(
                "alembic's command.downgrade must be dispatched with asyncio.to_thread:"
                " core_ee/env.py ends in asyncio.run(), which cannot be called from a"
                " running event loop."
            )

        foreign = asyncio.run(_count_foreign_wallet_rows())
        if foreign:
            inventory = ", ".join(
                f"{table}={count}" for table, count in sorted(foreign.items())
            )
            _refuse(
                "wallet rows owned by real organizations appeared while the test was"
                f" running ({inventory}), so something else is writing to this database."
                f" This run was walking the chain down to {revision}, which crosses"
                " `ee0000000004` — and that downgrade DROPS the wallet tables, taking"
                " those rows with them. The downgrade was refused, so the core_ee chain"
                " is left where it stands rather than restored to where this run found"
                " it: the rows matter more than the revision. Stop whatever is writing"
                " here, or point POSTGRES_URI_CORE at a throwaway database."
            )

        return original_downgrade(config, revision, *args, **kwargs)

    return downgrade


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
async def _guard_disposable_database(
    request, monkeypatch, _skip_when_postgres_unreachable
):
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

    # From here until monkeypatch unwinds, every `command.downgrade` — the module
    # fixtures', the ones test bodies make inline, and the restore below — re-checks for
    # foreign wallet rows first. monkeypatch is set up as this fixture's dependency, so
    # it finalizes after it and the wrapper is still installed during the restore.
    monkeypatch.setattr(command, "downgrade", _guarded_downgrade(command.downgrade))

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
