"""Regression net for `MetersDAO.fetch` filter semantics (PR-48).

When a `MeterScope` or `MeterPeriod` object is supplied, every dimension
is bound — a `None` dimension means `column IS NULL`, not "any value".
Without that, an org-scoped/monthly read would also match finer-scoped
or daily rows for the same `(org, key, year, month)`, because the
canonical meter identity treats `None` dimensions as "not applicable at
this grain".

`scope=None` and `MeterScope()` both skip the scope filter (admin/rollup
escape — a row with no org/workspace/project/user is not a meaningful
canonical identity). `period=None` skips the period filter; `MeterPeriod()`
pins the lifetime/gauge-sentinel grain (a real canonical identity).

These tests pin both the per-dimension `IS NULL` binding and the
all-None / partial-None escape hatches.
"""

from typing import Any
from uuid import UUID

import pytest

from ee.src.core.meters.types import MeterPeriod, MeterScope, Meters
from ee.src.dbs.postgres.meters.dao import MetersDAO
from ee.src.dbs.postgres.subscriptions.dbes import SubscriptionDBE  # noqa: F401


ORG = UUID("a1111111-1111-1111-1111-111111111111")
WRK = UUID("b2222222-2222-2222-2222-222222222222")
PRJ = UUID("c3333333-3333-3333-3333-333333333333")
USR = UUID("d4444444-4444-4444-4444-444444444444")


class _Scalars:
    def all(self):
        return []


class _ExecuteResult:
    def scalars(self):
        return _Scalars()


class _Session:
    def __init__(self):
        self.executed_statements: list[Any] = []

    async def execute(self, statement):
        self.executed_statements.append(statement)
        return _ExecuteResult()

    async def commit(self):
        return None

    async def rollback(self):
        return None


class _SessionContext:
    def __init__(self, session: _Session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _patch_session(monkeypatch, session: _Session):
    from ee.src.dbs.postgres.meters import dao as dao_module

    monkeypatch.setattr(
        dao_module.engine,
        "core_session",
        lambda: _SessionContext(session),
    )


def _where_sql(stmt) -> str:
    """Render just the WHERE clause as a parameter-inlined SQL string.

    The full statement compile includes the SELECT-list with every column
    name (including a joined `subscriptions` relation), which causes
    false-positive substring matches for "year"/"month"/etc. Stripping to
    `whereclause` only keeps the predicate surface we actually want to
    pin.
    """

    where = stmt.whereclause
    if where is None:
        return ""
    return str(
        where.compile(
            compile_kwargs={"literal_binds": True},
            dialect=__import__(
                "sqlalchemy.dialects.postgresql", fromlist=["dialect"]
            ).dialect(),
        )
    )


class TestFetchScopeFilters:
    @pytest.mark.asyncio
    async def test_org_only_scope_binds_finer_dims_to_is_null(self, monkeypatch):
        """`MeterScope(organization_id=X)` → finer dims IS NULL."""
        session = _Session()
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        await dao.fetch(scope=MeterScope(organization_id=ORG))

        assert len(session.executed_statements) == 1
        sql = _where_sql(session.executed_statements[0]).lower()
        assert "workspace_id is null" in sql
        assert "project_id is null" in sql
        assert "user_id is null" in sql

    @pytest.mark.asyncio
    async def test_workspace_scope_binds_below_to_is_null(self, monkeypatch):
        """workspace-scoped read should not match project/user rows."""
        session = _Session()
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        await dao.fetch(
            scope=MeterScope(organization_id=ORG, workspace_id=WRK),
        )

        sql = _where_sql(session.executed_statements[0]).lower()
        assert "workspace_id =" in sql or f"workspace_id = '{WRK}'" in sql
        assert "project_id is null" in sql
        assert "user_id is null" in sql

    @pytest.mark.asyncio
    async def test_user_scope_binds_every_dim(self, monkeypatch):
        """fully-bound user scope → all four dims bound to concrete values."""
        session = _Session()
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        await dao.fetch(
            scope=MeterScope(
                organization_id=ORG,
                workspace_id=WRK,
                project_id=PRJ,
                user_id=USR,
            ),
        )

        sql = _where_sql(session.executed_statements[0]).lower()
        assert "is null" not in sql.replace("project_id is null", "")  # sanity
        # No `IS NULL` should remain when every dim is bound.
        assert "is null" not in sql

    @pytest.mark.asyncio
    async def test_scope_none_applies_no_filter(self, monkeypatch):
        """`scope=None` escape hatch — no scope filter at all."""
        session = _Session()
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        await dao.fetch(scope=None)

        sql = _where_sql(session.executed_statements[0]).lower()
        assert "organization_id" not in sql
        assert "workspace_id" not in sql
        assert "project_id" not in sql
        assert "user_id" not in sql

    @pytest.mark.asyncio
    async def test_empty_scope_is_equivalent_to_scope_none(self, monkeypatch):
        """`MeterScope()` (all dims unset) is treated as the same admin escape as `scope=None`."""
        session = _Session()
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        await dao.fetch(scope=MeterScope())

        sql = _where_sql(session.executed_statements[0]).lower()
        assert "organization_id" not in sql
        assert "workspace_id" not in sql
        assert "project_id" not in sql
        assert "user_id" not in sql


class TestFetchPeriodFilters:
    @pytest.mark.asyncio
    async def test_monthly_period_binds_day_to_is_null(self, monkeypatch):
        """MONTHLY read (year, month, day=None) must not match DAILY rows."""
        session = _Session()
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        await dao.fetch(period=MeterPeriod(year=2026, month=5))

        sql = _where_sql(session.executed_statements[0]).lower()
        assert "year =" in sql
        assert "month =" in sql
        assert "day is null" in sql

    @pytest.mark.asyncio
    async def test_daily_period_binds_every_dim(self, monkeypatch):
        """DAILY read binds year+month+day to concrete values."""
        session = _Session()
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        await dao.fetch(period=MeterPeriod(year=2026, month=5, day=19))

        sql = _where_sql(session.executed_statements[0]).lower()
        assert "year =" in sql
        assert "month =" in sql
        assert "day =" in sql
        # day should not be filtered as IS NULL when bound.
        assert "day is null" not in sql

    @pytest.mark.asyncio
    async def test_empty_period_binds_all_to_is_null(self, monkeypatch):
        """`MeterPeriod()` (no period) → all three IS NULL — pins lifetime rows."""
        session = _Session()
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        await dao.fetch(period=MeterPeriod())

        sql = _where_sql(session.executed_statements[0]).lower()
        assert "year is null" in sql
        assert "month is null" in sql
        assert "day is null" in sql

    @pytest.mark.asyncio
    async def test_period_none_applies_no_filter(self, monkeypatch):
        """`period=None` escape hatch — no period filter at all."""
        session = _Session()
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        await dao.fetch(period=None)

        sql = _where_sql(session.executed_statements[0]).lower()
        assert "year" not in sql
        assert "month" not in sql
        assert "day" not in sql


class TestFetchKeyFilter:
    @pytest.mark.asyncio
    async def test_key_bound(self, monkeypatch):
        session = _Session()
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        await dao.fetch(key=Meters.TRACES_RETRIEVED)

        sql = _where_sql(session.executed_statements[0]).lower()
        assert "key" in sql

    @pytest.mark.asyncio
    async def test_key_none_applies_no_filter(self, monkeypatch):
        session = _Session()
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        await dao.fetch(key=None)

        sql = _where_sql(session.executed_statements[0]).lower()
        # `key` column is filtered only when explicitly passed.
        assert "key =" not in sql and "key in" not in sql
