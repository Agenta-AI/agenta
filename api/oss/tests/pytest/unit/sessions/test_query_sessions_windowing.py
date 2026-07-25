"""Unit tests (statement-compilation only, no DB) for `apply_windowing` support of
`updated_at` ordering — the sessions list must sort by last activity, not by the
uuid7 `id` creation order (WP0-R1)."""

from datetime import datetime, timezone

from sqlalchemy import select

from uuid_utils.compat import uuid7

from oss.src.core.shared.dtos import Windowing
from oss.src.dbs.postgres.sessions.streams.dbes import SessionStreamDBE
from oss.src.dbs.postgres.shared.utils import apply_windowing


def _compile(stmt) -> str:
    return str(stmt.compile(compile_kwargs={"literal_binds": True}))


def test_updated_at_attribute_orders_by_updated_at_with_id_tiebreak():
    stmt = apply_windowing(
        stmt=select(SessionStreamDBE),
        DBE=SessionStreamDBE,
        attribute="updated_at",
        order="descending",
        windowing=Windowing(limit=20),
    )
    sql = _compile(stmt)

    assert "ORDER BY session_streams.updated_at DESC, session_streams.id" in sql
    # Must NOT silently fall back to created_at ordering.
    assert "session_streams.created_at DESC" not in sql


def test_updated_at_cursor_rides_updated_at_not_created_at():
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

    assert "session_streams.updated_at <=" in where
    assert "session_streams.updated_at <" in where
    assert "session_streams.id <" in where
    # The cursor must not be anchored on created_at at all.
    assert "created_at" not in where


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
        "ORDER BY session_streams.created_at DESC, session_streams.id" in no_cursor_sql
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
