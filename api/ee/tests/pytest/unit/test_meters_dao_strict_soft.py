"""Regression net for `MetersDAO.adjust` / `check` strict-vs-soft semantics.

The DAO has two predicate branches depending on `quota.strict`. Both modes
reject predictable self-overshoot — a single request whose `delta` alone
exceeds the limit is always denied (Python-side fast-path). The modes
diverge on what happens when the current value is already at-or-over the
limit:

  * strict      → `greatest(value + delta, 0) <= limit`
                  Rejects any request that would cross the limit. The
                  request itself is denied; no "one free overshoot".
  * non-strict  → `value < limit`  (plus the shared `delta <= limit` rule)
                  Permits the request that crosses the line from below.
                  Already-at-or-over-limit rows reject the next write.

`check` is unconditionally strict (`adjusted_value <= quota.limit`).

These tests pin both behaviors so future refactors don't silently flip the
semantics. The DB-execution side is mocked out — what matters is the WHERE
predicate the DAO emits, and the Python-side allow/block decision.
"""

from types import SimpleNamespace
from typing import Any, Optional
from uuid import UUID

import pytest

from ee.src.core.entitlements.types import Quota
from ee.src.core.meters.types import MeterDTO, Meters
from ee.src.dbs.postgres.meters.dao import MetersDAO


ORG = UUID("a1111111-1111-1111-1111-111111111111")
WS = UUID("b2222222-2222-2222-2222-222222222222")
PRJ = UUID("c3333333-3333-3333-3333-333333333333")
USR = UUID("d4444444-4444-4444-4444-444444444444")


def _meter(value: Optional[int] = None, delta: Optional[int] = None) -> MeterDTO:
    return MeterDTO(
        organization_id=ORG,
        workspace_id=WS,
        project_id=PRJ,
        user_id=USR,
        year=2026,
        month=5,
        day=18,
        key=Meters.TRACES_RETRIEVED,
        value=value,
        delta=delta,
    )


# ---------------------------------------------------------------------------
# Session mocks
# ---------------------------------------------------------------------------


class _ExecuteResult:
    """Stand-in for SQLAlchemy `Result`.

    `scalar_one_or_none()` is what `check` calls to read the existing row.
    `fetchone()` is what `adjust` calls on the upsert's RETURNING clause.
    Captures the executed statement so tests can introspect the WHERE clause.
    """

    def __init__(self, *, scalar: Any = None, row: Any = None):
        self._scalar = scalar
        self._row = row

    def scalar_one_or_none(self):
        return self._scalar

    def fetchone(self):
        return self._row


class _Session:
    def __init__(self, *, scalar=None, row=None):
        self._scalar = scalar
        self._row = row
        self.executed_statements: list[Any] = []

    async def execute(self, statement):
        self.executed_statements.append(statement)
        return _ExecuteResult(scalar=self._scalar, row=self._row)

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


# ---------------------------------------------------------------------------
# `check` — always strict (current + delta <= limit)
# ---------------------------------------------------------------------------


class TestCheck:
    @pytest.mark.asyncio
    async def test_below_limit_with_delta_allows(self, monkeypatch):
        """current=5, delta=3, limit=10 → 8 <= 10 → allowed."""
        session = _Session(scalar=SimpleNamespace(value=5, synced=0))
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        allowed, dto = await dao.check(
            meter=_meter(delta=3),
            quota=Quota(limit=10),
        )

        assert allowed is True
        assert dto.value == 5  # returned current value

    @pytest.mark.asyncio
    async def test_at_limit_with_zero_delta_allows(self, monkeypatch):
        """current=10, delta=0, limit=10 → 10 <= 10 → allowed (boundary)."""
        session = _Session(scalar=SimpleNamespace(value=10, synced=0))
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        allowed, _ = await dao.check(
            meter=_meter(delta=0),
            quota=Quota(limit=10),
        )

        assert allowed is True

    @pytest.mark.asyncio
    async def test_would_exceed_limit_blocks(self, monkeypatch):
        """current=10, delta=2, limit=10 → 12 > 10 → blocked."""
        session = _Session(scalar=SimpleNamespace(value=10, synced=0))
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        allowed, _ = await dao.check(
            meter=_meter(delta=2),
            quota=Quota(limit=10),
        )

        assert allowed is False

    @pytest.mark.asyncio
    async def test_negative_delta_clamps_at_zero(self, monkeypatch):
        """current=3, delta=-10, limit=10 → max(-7, 0)=0 <= 10 → allowed."""
        session = _Session(scalar=SimpleNamespace(value=3, synced=0))
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        allowed, _ = await dao.check(
            meter=_meter(delta=-10),
            quota=Quota(limit=10),
        )

        assert allowed is True

    @pytest.mark.asyncio
    async def test_no_existing_row_treats_current_as_zero(self, monkeypatch):
        """No row in DB, delta=5, limit=10 → 0+5=5 <= 10 → allowed."""
        session = _Session(scalar=None)
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        allowed, dto = await dao.check(
            meter=_meter(delta=5),
            quota=Quota(limit=10),
        )

        assert allowed is True
        assert dto.value == 0
        assert dto.synced == 0

    @pytest.mark.asyncio
    async def test_no_limit_always_allows(self, monkeypatch):
        """limit=None → unconditional pass even at huge values."""
        session = _Session(scalar=SimpleNamespace(value=10_000_000, synced=0))
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        allowed, _ = await dao.check(
            meter=_meter(delta=1_000_000),
            quota=Quota(limit=None),
        )

        assert allowed is True


# ---------------------------------------------------------------------------
# `adjust` — branch on quota.strict
# ---------------------------------------------------------------------------


def _extract_where_sql(statement) -> str:
    """Render the upsert's `ON CONFLICT ... WHERE` predicate as SQL.

    `adjust` builds a Postgres `INSERT ... ON CONFLICT DO UPDATE SET ... WHERE`
    statement. The WHERE clause is what differs between strict and soft modes,
    so compiling the statement and string-matching against it is the most
    direct way to assert "did we emit `value + delta <= limit` or `value <=
    limit`?" without rebuilding the whole DAO around an abstraction we don't
    need anywhere else.
    """
    compiled = statement.compile(
        compile_kwargs={"literal_binds": True},
        dialect=__import__(
            "sqlalchemy.dialects.postgresql", fromlist=["dialect"]
        ).dialect(),
    )
    return str(compiled)


class TestAdjustStrictVsSoft:
    @pytest.mark.asyncio
    async def test_strict_emits_value_plus_delta_predicate(self, monkeypatch):
        """Strict mode must gate on `value + delta <= limit`."""
        session = _Session(row=(7,))  # post-update value
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        await dao.adjust(
            meter=_meter(delta=2),
            quota=Quota(limit=10, strict=True),
        )

        assert session.executed_statements, "adjust should issue at least one statement"
        sql = _extract_where_sql(session.executed_statements[0])

        # Strict: predicate is `greatest(meters.value + delta, 0) <= limit`.
        assert "greatest" in sql.lower()
        assert "+ 2" in sql or "+2" in sql
        assert "<= 10" in sql

    @pytest.mark.asyncio
    async def test_nonstrict_emits_value_strictly_less_than_limit_predicate(
        self, monkeypatch
    ):
        """Non-strict mode gates the SQL predicate on `value < limit`.

        The shared `delta <= limit` rule is enforced Python-side in the
        fast-path above the upsert. The SQL clause is the one that lets
        a request cross the line from below (current=9 + delta=2 with
        limit=10 → SQL says 9 < 10 → allow), while denying any row
        already at-or-over limit.
        """
        session = _Session(row=(7,))
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        await dao.adjust(
            meter=_meter(delta=2),
            quota=Quota(limit=10, strict=False),
        )

        sql = _extract_where_sql(session.executed_statements[0])
        lowered = sql.lower()
        where_idx = lowered.rfind("where")
        assert where_idx != -1, "WHERE clause not emitted"
        where_clause = lowered[where_idx:]
        # Strict-less-than against limit; no `+ delta` term in the WHERE.
        assert "meters.value < 10" in where_clause
        assert "<= 10" not in where_clause
        assert "+ 2" not in where_clause and "+2" not in where_clause

    # ---------------------------------------------------------------------
    # User-defined truth table (2026-05-18): `current + delta` vs `limit=10`
    #
    #   | Case               | Strict | Non-strict |
    #   |--------------------|--------|------------|
    #   | 0 + 12 huge delta  | deny   | deny       |
    #   | 10 + 2 at limit    | deny   | deny       |
    #   |  9 + 2 1-over      | deny   | allow      |
    #   |  8 + 2 fills       | allow  | allow      |
    #
    # Strict denials below the predictable-overshoot rule are decided by
    # the SQL `greatest(value + delta, 0) <= limit` predicate; the test
    # simulates the DB returning no row when the predicate filters the
    # update out (i.e. RETURNING is empty → allowed=False).
    # ---------------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_huge_delta_denied_in_strict(self, monkeypatch):
        """0 + 12 with limit=10 → predictable self-overshoot → deny.

        Python-side fast-path; no DB call should land.
        """
        session = _Session(row=None)
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        allowed, _, _ = await dao.adjust(
            meter=_meter(delta=12),
            quota=Quota(limit=10, strict=True),
        )

        assert allowed is False
        assert session.executed_statements == [], (
            "delta > limit must short-circuit before issuing SQL"
        )

    @pytest.mark.asyncio
    async def test_huge_delta_denied_in_nonstrict(self, monkeypatch):
        """0 + 12 with limit=10 → predictable self-overshoot → deny.

        Non-strict shares the same `delta <= limit` rule as strict.
        """
        session = _Session(row=None)
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        allowed, _, _ = await dao.adjust(
            meter=_meter(delta=12),
            quota=Quota(limit=10, strict=False),
        )

        assert allowed is False
        assert session.executed_statements == []

    @pytest.mark.asyncio
    async def test_at_limit_denied_in_strict(self, monkeypatch):
        """10 + 2 with limit=10 → strict SQL predicate filters the row
        out (greatest(10+2, 0) > 10) → RETURNING empty → deny."""
        session = _Session(row=None)
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        allowed, _, _ = await dao.adjust(
            meter=_meter(delta=2),
            quota=Quota(limit=10, strict=True),
        )

        assert allowed is False
        # The DAO still issues the upsert; the DB-side predicate is what
        # rejects this row. Verify it carried the expected shape.
        assert len(session.executed_statements) == 1

    @pytest.mark.asyncio
    async def test_at_limit_denied_in_nonstrict(self, monkeypatch):
        """10 + 2 with limit=10 → non-strict SQL predicate `value < 10`
        rejects current=10 → RETURNING empty → deny."""
        session = _Session(row=None)
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        allowed, _, _ = await dao.adjust(
            meter=_meter(delta=2),
            quota=Quota(limit=10, strict=False),
        )

        assert allowed is False
        assert len(session.executed_statements) == 1

    @pytest.mark.asyncio
    async def test_one_over_denied_in_strict(self, monkeypatch):
        """9 + 2 with limit=10 → strict SQL predicate `greatest(9+2, 0) > 10`
        rejects → deny."""
        session = _Session(row=None)
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        allowed, _, _ = await dao.adjust(
            meter=_meter(delta=2),
            quota=Quota(limit=10, strict=True),
        )

        assert allowed is False

    @pytest.mark.asyncio
    async def test_one_over_allowed_in_nonstrict(self, monkeypatch):
        """9 + 2 with limit=10 → non-strict SQL predicate `9 < 10` → allow.

        This is the cross-the-line-once case: the request itself crosses
        from below the limit and is permitted; the subsequent at-limit
        request would then be denied by the same predicate.
        """
        session = _Session(row=(11,))  # post-update value
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        allowed, _, _ = await dao.adjust(
            meter=_meter(delta=2),
            quota=Quota(limit=10, strict=False),
        )

        assert allowed is True

    @pytest.mark.asyncio
    async def test_fills_exactly_allowed_in_both_modes(self, monkeypatch):
        """8 + 2 with limit=10 → equal to limit → allowed in both modes."""
        for strict in (True, False):
            session = _Session(row=(10,))
            _patch_session(monkeypatch, session)

            dao = MetersDAO()
            allowed, _, _ = await dao.adjust(
                meter=_meter(delta=2),
                quota=Quota(limit=10, strict=strict),
            )
            assert allowed is True, f"strict={strict}: 8+2 should allow"

    @pytest.mark.asyncio
    async def test_strict_blocks_when_proposed_value_exceeds_limit(self, monkeypatch):
        """`adjust` early-returns False when caller-set value > limit.

        This is the absolute-value pre-check at the top of `adjust` (delta-mode
        callers hit the SQL predicate instead).
        """
        session = _Session(row=None)
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        allowed, _, _ = await dao.adjust(
            meter=_meter(value=20),  # explicit value, no delta
            quota=Quota(limit=10, strict=True),
        )

        assert allowed is False
        # Early-return: no DB statement was executed.
        assert session.executed_statements == []

    @pytest.mark.asyncio
    async def test_returns_false_when_predicate_blocks(self, monkeypatch):
        """When the WHERE clause filters the row out, RETURNING is empty →
        upsert "succeeded" with zero rows → DAO returns allowed=False."""
        session = _Session(row=None)  # RETURNING produced nothing
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        allowed, dto, _ = await dao.adjust(
            meter=_meter(delta=5),
            quota=Quota(limit=10, strict=True),
        )

        assert allowed is False
        # When the row is None, the DAO falls back to the desired value
        # (the value we tried to write); zero rows landed in DB.
        assert dto.value == 5

    @pytest.mark.asyncio
    async def test_returns_true_when_returning_row_present(self, monkeypatch):
        """RETURNING produced a row → upsert succeeded → allowed=True with
        the post-update value coming from RETURNING."""
        session = _Session(row=(7,))
        _patch_session(monkeypatch, session)

        dao = MetersDAO()
        allowed, dto, _ = await dao.adjust(
            meter=_meter(delta=2),
            quota=Quota(limit=10, strict=True),
        )

        assert allowed is True
        assert dto.value == 7
