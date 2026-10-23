"""`oss000000046` is safe to rerun after an interrupted upgrade.

Entering the autocommit block for the concurrent indexes commits the new columns. When
an index build then fails, the deploy reruns the revision against tables that already
have the columns. Each `ADD COLUMN` must accept that. The test captures the statements of
`upgrade()` and runs the column statements twice on temp-table copies of the tables
(the copies already have the columns, as after the interrupted run), then rolls back.
"""

from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from sqlalchemy import text

from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.tests.pytest.utils.membership_seed import load_revision_module


pytestmark = pytest.mark.integration

REVISION = "oss000000046_add_run_principal_columns.py"


class _RecordingOp:
    def __init__(self):
        self.statements = []

    def execute(self, statement):
        self.statements.append(str(statement))

    def get_bind(self):
        result = SimpleNamespace(scalar=lambda: True)
        return SimpleNamespace(execute=lambda *_args, **_kwargs: result)

    def get_context(self):
        @contextmanager
        def autocommit_block():
            self.statements.append("-- autocommit")
            yield

        return SimpleNamespace(autocommit_block=autocommit_block)


def _upgrade_statements():
    module = load_revision_module(REVISION)
    recorder = _RecordingOp()
    module.op = recorder
    module.upgrade()
    return module, recorder.statements


def test_every_add_column_accepts_an_existing_column():
    _, statements = _upgrade_statements()
    alters = [s for s in statements if s.startswith("ALTER TABLE")]
    assert alters
    assert all("ADD COLUMN IF NOT EXISTS" in s for s in alters)
    # The columns come before the block that commits them.
    assert statements.index("-- autocommit") > max(statements.index(s) for s in alters)


async def test_rerun_after_columns_were_committed():
    module, statements = _upgrade_statements()
    alters = [s for s in statements if s.startswith("ALTER TABLE")]
    tables = [table for table, _ in module._COLUMNS]

    engine = get_transactions_engine()
    inner = getattr(engine, "_engine", engine)
    async with inner.connect() as connection:
        transaction = await connection.begin()
        try:
            for table in tables:
                await connection.execute(
                    text(
                        f"CREATE TEMP TABLE {table} "
                        f"(LIKE public.{table} INCLUDING DEFAULTS) ON COMMIT DROP"
                    )
                )
            for _ in range(2):
                for statement in alters:
                    await connection.execute(text(statement))
            for table, columns in module._COLUMNS:
                found = set(
                    (
                        await connection.execute(
                            text(
                                "SELECT column_name FROM information_schema.columns "
                                "WHERE table_schema LIKE 'pg_temp%' "
                                "AND table_name = :table"
                            ),
                            {"table": table},
                        )
                    ).scalars()
                )
                assert {name for name, _ in columns} <= found
        finally:
            await transaction.rollback()
