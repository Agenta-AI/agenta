"""alembic upgrade/downgrade round-trip for oss000000021 against a live DB.

Runs against whatever database the reachable Postgres already has migrated
to oss000000020 (the dev/CI stack keeps it there) — upgrades to head, checks
every table+index from entities.md §3 exists, downgrades, checks they are
gone, then upgrades again to leave the DB as this test found it.
"""

import socket
from functools import lru_cache
from urllib.parse import urlparse

import pytest
from sqlalchemy import inspect

from oss.src.utils.env import env


pytestmark = pytest.mark.integration

_TABLES = [
    "channel_agents",
    "channel_spaces",
    "channel_grants",
    "channel_threads",
    "channel_inbox_events",
    "channel_inbox_triggers",
    "channel_outbox_events",
]

_INDEXES = {
    "channel_agents": {
        "uq_channel_agents_connection_slug",
        "uq_channel_agents_default",
    },
    "channel_spaces": {
        "uq_channel_spaces_connection_external_key",
        "ix_channel_spaces_flags",
    },
    "channel_grants": {"uq_channel_grants_agent_space", "uq_channel_grants_default"},
    "channel_threads": {"ix_channel_threads_current"},
    "channel_inbox_events": {
        "uq_channel_inbox_connection_external",
        "ix_channel_inbox_events_log",
    },
    "channel_inbox_triggers": {
        "uq_channel_inbox_triggers_thread_event",
        "ix_channel_inbox_triggers_latest",
    },
    "channel_outbox_events": {"uq_channel_outbox_key", "ix_channel_outbox_created"},
}


@lru_cache(maxsize=1)
def _postgres_reachable() -> bool:
    parsed = urlparse(env.postgres.uri_core)
    host = parsed.hostname or "postgres"
    port = parsed.port or 5432
    try:
        with socket.create_connection((host, port), timeout=0.5):
            return True
    except OSError:
        return False


def _alembic_config():
    from alembic.config import Config

    cfg = Config("oss/databases/postgres/migrations/core_oss/alembic.ini")
    cfg.set_main_option("script_location", "oss/databases/postgres/migrations/core_oss")
    return cfg


def _index_names(inspector, table: str) -> set:
    names = {ix["name"] for ix in inspector.get_indexes(table)}
    names |= {uc["name"] for uc in inspector.get_unique_constraints(table)}
    return names


async def test_upgrade_then_downgrade_round_trips_cleanly():
    if not _postgres_reachable():
        pytest.skip("Postgres not reachable — skipping migration integration test")

    from alembic import command
    from sqlalchemy import create_engine

    cfg = _alembic_config()
    sync_url = env.postgres.uri_core.replace("+asyncpg", "")
    sync_engine = create_engine(sync_url)

    command.upgrade(cfg, "oss000000021")

    with sync_engine.connect() as conn:
        inspector = inspect(conn)
        existing_tables = set(inspector.get_table_names())
        for table in _TABLES:
            assert table in existing_tables, f"{table} missing after upgrade"
            found = _index_names(inspector, table)
            missing = _INDEXES[table] - found
            assert not missing, f"{table} missing indexes/constraints: {missing}"

    command.downgrade(cfg, "oss000000020")

    with sync_engine.connect() as conn:
        inspector = inspect(conn)
        existing_tables = set(inspector.get_table_names())
        for table in _TABLES:
            assert table not in existing_tables, (
                f"{table} still present after downgrade"
            )

    # leave the DB where this test found it, and prove upgrade is re-runnable
    command.upgrade(cfg, "oss000000021")
    command.downgrade(cfg, "oss000000020")

    sync_engine.dispose()
