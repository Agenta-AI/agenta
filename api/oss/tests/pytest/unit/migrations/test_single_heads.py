from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


def test_oss_core_migrations_have_a_single_head():
    api_root = Path(__file__).resolve().parents[5]
    migrations = api_root / "oss/databases/postgres/migrations/core_oss"
    config = Config(str(migrations / "alembic.ini"))
    config.set_main_option("script_location", str(migrations))

    heads = ScriptDirectory.from_config(config).get_heads()

    assert len(heads) == 1, f"expected one OSS core migration head, found {heads}"
