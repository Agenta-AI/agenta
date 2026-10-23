"""`oss000000046`: one short transaction per table, and a rerun after a failure part-way
completes.

Each table is altered in its own `ALTER TABLE` in an autocommit block, so no table keeps
its `ACCESS EXCLUSIVE` lock while the next one waits. When the hook fails part-way (a
lock timeout on one table), the deploy reruns the revision: the tables already altered
must accept the rerun. The test captures the statements of `upgrade()`, applies the
first few to temp-table copies of the tables without the new columns, then the whole
list again, and rolls back.
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
            self.statements.append("-- autocommit begin")
            yield
            self.statements.append("-- autocommit end")

        return SimpleNamespace(autocommit_block=autocommit_block)


def _upgrade_statements():
    module = load_revision_module(REVISION)
    recorder = _RecordingOp()
    module.op = recorder
    module.upgrade()
    return module, recorder.statements


def test_each_table_is_altered_alone_outside_a_transaction():
    module, statements = _upgrade_statements()
    alters = [s for s in statements if s.startswith("ALTER TABLE")]
    # One statement per table, so each is its own short transaction.
    assert len(alters) == len(module._COLUMNS)
    assert all("ADD COLUMN IF NOT EXISTS" in s for s in alters)
    for table, _ in module._COLUMNS:
        assert sum(s.startswith(f"ALTER TABLE {table} ") for s in alters) == 1
    # The ALTERs run inside an autocommit block, with a bounded lock wait that is
    # reset before the index builds.
    begin = statements.index("-- autocommit begin")
    end = statements.index("-- autocommit end")
    assert statements[begin + 1] == "SET lock_timeout = '5s'"
    assert all(begin < statements.index(s) < end for s in alters)
    assert statements[end - 1] == "RESET lock_timeout"


async def test_rerun_after_a_failure_part_way_completes():
    module, statements = _upgrade_statements()
    alters = [s for s in statements if s.startswith("ALTER TABLE")]

    engine = get_transactions_engine()
    inner = getattr(engine, "_engine", engine)
    async with inner.connect() as connection:
        transaction = await connection.begin()
        try:
            for table, columns in module._COLUMNS:
                await connection.execute(
                    text(
                        f"CREATE TEMP TABLE {table} "
                        f"(LIKE public.{table} INCLUDING DEFAULTS) ON COMMIT DROP"
                    )
                )
                # As before the revision: the new columns do not exist yet.
                for name, _ in columns:
                    await connection.execute(
                        text(f"ALTER TABLE {table} DROP COLUMN IF EXISTS {name}")
                    )
            # The first run fails after three tables.
            for statement in alters[:3]:
                await connection.execute(text(statement))
            # The rerun applies the whole list.
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
                assert {name for name, _ in columns} <= found, table
        finally:
            await transaction.rollback()
