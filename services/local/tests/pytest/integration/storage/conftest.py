import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from agenta_local.dbs.sqlite.shared.engine import build_engine

MIGRATIONS_DIR = (
    Path(__file__).resolve().parents[4] / "databases" / "sqlite" / "migrations"
)


@pytest.fixture(scope="session")
def migrations_dir() -> Path:
    return MIGRATIONS_DIR


@pytest.fixture(scope="session")
def migration_runner():
    name = "agenta_local_migration_runner"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, MIGRATIONS_DIR / "runner.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
async def storage(tmp_path, migration_runner):
    """Migrated file-backed database with one engine and session factory."""
    db_path = tmp_path / "local.db"
    migration_runner.upgrade_database(db_path)
    engine, factory = build_engine(db_path)
    yield SimpleNamespace(engine=engine, factory=factory, db_path=db_path)
    await engine.dispose()
