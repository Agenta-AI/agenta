"""Unit tests (statement-compilation only, no DB) for `apply_windowing` support of
`updated_at` ordering — the sessions list must sort by last activity, not by the
uuid7 `id` creation order (WP0-R1).

`updated_at` is nullable (never touched since row creation), so the effective ordering/
cursor attribute is `coalesce(updated_at, created_at)` — a never-updated row degrades to
its creation time instead of sorting first under `ORDER BY ... DESC` (Postgres puts NULLs
first). This mirrors the FE's `activity()` helper (`updated_at ?? created_at`)."""

from datetime import datetime, timezone

import pytest

from sqlalchemy import select

from uuid_utils.compat import uuid7

from oss.src.core.shared.dtos import Windowing
from oss.src.core.sessions.streams.dtos import SessionStreamQuery
from oss.src.dbs.postgres.sessions.streams import dao as dao_module
from oss.src.dbs.postgres.sessions.streams.dbes import SessionStreamDBE
from oss.src.dbs.postgres.shared.utils import apply_windowing

COALESCE_EXPR = "coalesce(session_streams.updated_at, session_streams.created_at)"


def _compile(stmt) -> str:
    return str(stmt.compile(compile_kwargs={"literal_binds": True}))


def _assert_created_at_only_inside_coalesce(sql_fragment: str) -> None:
    """`created_at` may appear, but only as part of the coalesce expression — never as a
    bare `session_streams.created_at` comparison/order-by riding on its own. Callers pass
    a WHERE/ORDER-BY fragment, not a full SELECT (whose column list legitimately lists
    `created_at` as a plain selected column)."""
    stripped = sql_fragment.replace(COALESCE_EXPR, "")
    assert "created_at" not in stripped


def test_updated_at_attribute_orders_by_coalesced_updated_at_with_id_tiebreak():
    stmt = apply_windowing(
        stmt=select(SessionStreamDBE),
        DBE=SessionStreamDBE,
        attribute="updated_at",
        order="descending",
        windowing=Windowing(limit=20),
    )
    sql = _compile(stmt)
    order_by_fragment = sql.split("ORDER BY", 1)[1]

    # Tiebreak direction must match the cursor's DESC semantics (`id <`) — an ASC
    # tiebreak here would split a tie group across the page boundary.
    assert f"ORDER BY {COALESCE_EXPR} DESC, session_streams.id DESC" in sql
    _assert_created_at_only_inside_coalesce(order_by_fragment)


def test_updated_at_attribute_ascending_orders_with_matching_id_tiebreak():
    """Mirror of the descending case: the ascending branch's cursor uses `id >`, so
    the tiebreak must be `id ASC`, not the bare (previously-ASC-by-default) column."""
    stmt = apply_windowing(
        stmt=select(SessionStreamDBE),
        DBE=SessionStreamDBE,
        attribute="updated_at",
        order="ascending",
        windowing=Windowing(limit=20, order="ascending"),
    )
    sql = _compile(stmt)

    assert f"ORDER BY {COALESCE_EXPR} ASC, session_streams.id ASC" in sql


def test_updated_at_cursor_rides_coalesced_updated_at():
    newest = datetime.now(timezone.utc)
    next_id = uuid7()
    stmt = apply_windowing(
        stmt=select(SessionStreamDBE),
        DBE=SessionStreamDBE,
        attribute="updated_at",
        order="descending",
        windowing=Windowing(newest=newest, next=next_id, limit=20),
    )
    # Assert against the WHERE clause specifically: created_at also appears in the
    # SELECT column list (select(SessionStreamDBE) pulls every column), so grepping
    # the full compiled statement would pass even if the cursor were mis-anchored.
    where = str(stmt.whereclause.compile(compile_kwargs={"literal_binds": True}))

    assert f"{COALESCE_EXPR} <=" in where
    assert f"{COALESCE_EXPR} <" in where
    assert "session_streams.id <" in where
    # `created_at` must ride only inside the coalesce expression, never bare.
    _assert_created_at_only_inside_coalesce(where)


def test_created_at_attribute_behavior_is_unchanged():
    """Regression pin: current behavior for `attribute="created_at"` (observed
    directly against `apply_windowing` before this change) must not shift."""
    newest = datetime.now(timezone.utc)
    next_id = uuid7()

    no_cursor_sql = _compile(
        apply_windowing(
            stmt=select(SessionStreamDBE),
            DBE=SessionStreamDBE,
            attribute="created_at",
            order="descending",
            windowing=Windowing(limit=20),
        )
    )
    assert (
        "ORDER BY session_streams.created_at DESC, session_streams.id DESC"
        in no_cursor_sql
    )

    cursor_sql = _compile(
        apply_windowing(
            stmt=select(SessionStreamDBE),
            DBE=SessionStreamDBE,
            attribute="created_at",
            order="descending",
            windowing=Windowing(newest=newest, next=next_id, limit=20),
        )
    )
    assert "session_streams.created_at <=" in cursor_sql
    assert "session_streams.created_at <" in cursor_sql
    assert "session_streams.id <" in cursor_sql


# ---------------------------------------------------------------------------------- #
# DAO fallback (no windowing) — the liveness-index caller (`query_session_streams`)
# hits this branch. Ordering isn't load-bearing there, but it must stay consistent
# with the windowed path rather than silently reverting to bare updated_at/created_at.
# ---------------------------------------------------------------------------------- #


class _DummyScalars:
    def all(self):
        return []


class _DummyResult:
    def scalars(self):
        return _DummyScalars()


class _DummySession:
    def __init__(self):
        self.captured_stmt = None

    async def execute(self, stmt):
        self.captured_stmt = stmt
        return _DummyResult()


class _DummySessionContext:
    def __init__(self, session):
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, exc_type, exc, tb):
        return False


@pytest.mark.asyncio
async def test_dao_query_fallback_orders_by_coalesced_updated_at(monkeypatch):
    from uuid import uuid4

    session = _DummySession()
    mock_engine = type(
        "MockEngine", (), {"session": lambda self: _DummySessionContext(session)}
    )()
    monkeypatch.setattr(dao_module, "get_transactions_engine", lambda: mock_engine)

    await dao_module.SessionStreamsDAO().query(
        project_id=uuid4(),
        filter=SessionStreamQuery(),
        windowing=None,
    )

    sql = str(session.captured_stmt.compile(compile_kwargs={"literal_binds": True}))
    order_by_fragment = sql.split("ORDER BY", 1)[1]

    assert f"ORDER BY {COALESCE_EXPR} DESC, session_streams.id DESC" in sql
    _assert_created_at_only_inside_coalesce(order_by_fragment)
