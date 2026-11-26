"""memberships_check plans every statement for its own batch.

It runs the same statements once per batch or page. Postgres may switch a prepared
statement to a cached generic plan after five executions, and on a batch with a very
large organization that plan took about 15 minutes instead of 0.3 s. Every transaction
of the job must start with `SET LOCAL plan_cache_mode = force_custom_plan`.
"""

from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest

from entrypoints import memberships_check


class _Result(SimpleNamespace):
    def __iter__(self):
        return iter(())

    def scalar(self):
        return self.value

    def scalars(self):
        return SimpleNamespace(all=lambda: [])

    def all(self):
        return []


class _Connection:
    def __init__(self, log):
        self.log = log

    async def execute(self, statement, params=None):
        self.log.append(str(statement))
        # `SELECT to_regclass(...)` checks; None means "missing" where it matters.
        return _Result(value="present", rowcount=0)


class _Engine:
    def __init__(self):
        self.transactions = []

    @asynccontextmanager
    async def transaction(self):
        log = []
        self.transactions.append(log)
        yield _Connection(log)


@pytest.fixture
def engine(monkeypatch):
    engine = _Engine()
    monkeypatch.setattr(memberships_check, "get_transactions_engine", lambda: engine)
    monkeypatch.setattr(memberships_check, "is_ee", lambda: False)
    return engine


def _every_transaction_forces_custom_plans(engine):
    assert engine.transactions
    for statements in engine.transactions:
        assert statements[0] == memberships_check.FORCE_CUSTOM_PLANS_SQL


async def test_report_forces_custom_plans(engine, tmp_path):
    await memberships_check.run_report(out_dir=tmp_path, organization_ids=[])
    _every_transaction_forces_custom_plans(engine)


async def test_apply_forces_custom_plans(engine):
    await memberships_check.run_apply(organization_ids=[])
    _every_transaction_forces_custom_plans(engine)


async def test_materialize_forces_custom_plans(engine):
    await memberships_check.run_materialize(organization_ids=[])
    _every_transaction_forces_custom_plans(engine)


def test_the_setting_is_transaction_local():
    # LOCAL: a pooled connection never keeps the setting after the job's transaction.
    assert memberships_check.FORCE_CUSTOM_PLANS_SQL == (
        "SET LOCAL plan_cache_mode = force_custom_plan"
    )
