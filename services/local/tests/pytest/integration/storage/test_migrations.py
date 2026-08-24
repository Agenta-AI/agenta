import sqlite3
from contextlib import closing
from pathlib import Path

import pytest
from agenta_local.dbs.sqlite.shared.exceptions import MigrationError

TABLES = {"agents", "agent_revisions", "sessions", "turns", "messages"}


def _tables(db_path: Path) -> set[str]:
    with closing(sqlite3.connect(db_path)) as conn:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
    return {row[0] for row in rows}


def test_fresh_first_launch_creates_schema(tmp_path, migration_runner):
    db = tmp_path / "local.db"
    revision = migration_runner.upgrade_database(db)
    assert revision == "0001"
    assert TABLES <= _tables(db)
    with closing(sqlite3.connect(db)) as conn:
        row = conn.execute("SELECT version_num FROM alembic_version").fetchone()
    assert row is not None
    assert row[0] == "0001"
    assert not list(tmp_path.glob("*.candidate"))


def test_noop_rerun_succeeds_without_change(tmp_path, migration_runner):
    db = tmp_path / "local.db"
    migration_runner.upgrade_database(db)
    assert migration_runner.upgrade_database(db) == "0001"
    assert TABLES <= _tables(db)
    assert not list(tmp_path.glob("*.candidate"))


def test_rerun_at_head_preserves_pristine_backup(tmp_path, migration_runner):
    """Rerun-at-head is a fast path: the pristine pre-upgrade backup from the first
    (real) upgrade survives later launches byte-identical, and no new backup or
    candidate is produced."""
    db = tmp_path / "local.db"
    with closing(sqlite3.connect(db)) as conn:
        conn.execute("CREATE TABLE legacy (name TEXT)")
        conn.execute("INSERT INTO legacy (name) VALUES ('keep')")
        conn.commit()

    migration_runner.upgrade_database(db)
    backups = list(tmp_path.glob("*.pre-*.bak"))
    assert [b.name for b in backups] == ["local.db.pre-fresh.bak"]
    with closing(sqlite3.connect(backups[0])) as conn:
        rows = conn.execute("SELECT name FROM legacy").fetchall()
        stamped = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
            " AND name = 'alembic_version'"
        ).fetchone()
    assert rows == [("keep",)]
    assert stamped is None

    backup_bytes = backups[0].read_bytes()
    assert migration_runner.upgrade_database(db) == "0001"

    assert backups[0].read_bytes() == backup_bytes
    assert not list(tmp_path.glob("*.candidate"))
    with closing(sqlite3.connect(db)) as conn:
        row = conn.execute("SELECT version_num FROM alembic_version").fetchone()
    assert row == ("0001",)


def test_failed_migration_preserves_original(tmp_path, migration_runner, monkeypatch):
    db = tmp_path / "local.db"
    with closing(sqlite3.connect(db)) as conn:
        conn.execute("CREATE TABLE legacy (name TEXT)")
        conn.commit()
    original = db.read_bytes()

    def boom(cfg, target):
        raise RuntimeError("injected migration failure")

    monkeypatch.setattr(migration_runner.command, "upgrade", boom)
    with pytest.raises(MigrationError, match="injected migration failure"):
        migration_runner.upgrade_database(db)

    assert db.read_bytes() == original
    assert not list(tmp_path.glob("*.candidate"))


def test_existing_db_rows_preserved_through_upgrade(tmp_path, migration_runner):
    db = tmp_path / "local.db"
    migration_runner.upgrade_database(db)
    with closing(sqlite3.connect(db)) as conn:
        conn.execute(
            "INSERT INTO agents (id, name, current_revision_id, created_at,"
            " updated_at) VALUES (?, ?, ?, ?, ?)",
            (
                "a1",
                "agent",
                "r1",
                "2026-01-01 00:00:00.000000",
                "2026-01-01 00:00:00.000000",
            ),
        )
        conn.commit()

    migration_runner.upgrade_database(db)

    with closing(sqlite3.connect(db)) as conn:
        row = conn.execute("SELECT id, name FROM agents WHERE id = 'a1'").fetchone()
    assert row == ("a1", "agent")
