"""Crash-safe programmatic migration runner for the Agenta Local database.

The caller must ensure no connections are open against the target database when
``upgrade_database`` runs (the composition root closes the engine first).
"""

import argparse
import logging
import os
import sqlite3
import sys
import tempfile
from contextlib import closing
from pathlib import Path

from agenta_local.dbs.sqlite.shared.exceptions import MigrationError
from alembic import command
from alembic.config import Config

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parent


def upgrade_database(database_path: Path) -> str:
    """Migrate the database at ``database_path`` to head; returns the applied revision.

    Already at head: returns immediately without touching the database, so any
    pristine pre-upgrade backup from a previous upgrade survives later launches.
    Otherwise backs up the existing database, migrates a candidate copy, and
    atomically replaces the original only after an integrity check passes. On any
    failure the original is left untouched.
    """
    try:
        return _upgrade(Path(database_path))
    except MigrationError:
        raise
    except Exception as exc:
        logger.exception("schema migration failed for %s", database_path)
        raise MigrationError(
            f"schema migration failed for {database_path}: {exc}"
        ) from exc


def current_revision(database_path: Path) -> str | None:
    database_path = Path(database_path)
    if not database_path.exists():
        return None
    with closing(sqlite3.connect(database_path)) as conn:
        stamped = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table'"
            " AND name = 'alembic_version'"
        ).fetchone()
        if not stamped:
            return None
        row = conn.execute("SELECT version_num FROM alembic_version").fetchone()
    return row[0] if row else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Migrate an Agenta Local database to head."
    )
    parser.add_argument(
        "--database",
        type=Path,
        required=True,
        help="path to the SQLite database file",
    )
    args = parser.parse_args(argv)
    try:
        revision = upgrade_database(args.database)
    except MigrationError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(f"database at {args.database} migrated to revision {revision}")
    return 0


def _upgrade(database_path: Path) -> str:
    database_path = Path(database_path)
    revision = current_revision(database_path)
    if revision is not None and revision == _head_revision():
        return revision
    parent = database_path.parent
    parent.mkdir(parents=True, exist_ok=True)
    exists = database_path.exists()
    candidate: Path | None = None
    try:
        if exists:
            _checkpoint_truncate(database_path)
            source_revision = current_revision(database_path) or "fresh"
            backup_path = database_path.with_name(
                f"{database_path.name}.pre-{source_revision}.bak"
            )
            _backup_to(database_path, backup_path)
            candidate = database_path.with_name(f"{database_path.name}.candidate")
            for suffix in ("-wal", "-shm"):
                candidate.with_name(candidate.name + suffix).unlink(missing_ok=True)
            _copy_file(backup_path, candidate)
        else:
            fd, raw = tempfile.mkstemp(
                dir=parent, prefix=f"{database_path.name}.", suffix=".candidate"
            )
            os.close(fd)
            candidate = Path(raw)

        revision = _run_alembic(candidate)
        _verify_integrity(candidate)
        _fsync_file(candidate)

        if exists:
            for suffix in ("-wal", "-shm"):
                sidecar = database_path.with_name(f"{database_path.name}{suffix}")
                sidecar.unlink(missing_ok=True)
        os.replace(candidate, database_path)
        _fsync_dir(parent)
        return revision
    finally:
        if candidate is not None and candidate.exists():
            candidate.unlink()


def _run_alembic(database_path: Path) -> str:
    cfg = Config(str(MIGRATIONS_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    cfg.attributes["database_path"] = database_path
    command.upgrade(cfg, "head")
    revision = current_revision(database_path)
    if revision is None:
        raise MigrationError(f"migration left no version stamp on {database_path}")
    return revision


def _head_revision() -> str:
    from alembic.script import ScriptDirectory

    return ScriptDirectory.from_config(_alembic_config()).get_current_head()


def _alembic_config() -> Config:
    cfg = Config(str(MIGRATIONS_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    cfg.attributes["database_path"] = Path("/dev/null")
    return cfg


def _checkpoint_truncate(database_path: Path) -> None:
    with closing(sqlite3.connect(database_path)) as conn:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")


def _backup_to(source: Path, backup: Path) -> None:
    with (
        closing(sqlite3.connect(source)) as src,
        closing(sqlite3.connect(backup)) as dst,
    ):
        src.backup(dst)
    _fsync_file(backup)


def _copy_file(source: Path, destination: Path) -> None:
    with source.open("rb") as src, destination.open("wb") as dst:
        dst.write(src.read())


def _verify_integrity(database_path: Path) -> None:
    with closing(sqlite3.connect(database_path)) as conn:
        result = conn.execute("PRAGMA integrity_check").fetchone()[0]
    if result != "ok":
        raise MigrationError(f"integrity check failed on {database_path}: {result}")


def _fsync_file(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _fsync_dir(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


if __name__ == "__main__":
    raise SystemExit(main())
