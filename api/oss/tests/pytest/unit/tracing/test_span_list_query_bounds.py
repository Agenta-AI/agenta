"""Unit tests for the memory bounds of span list queries (#7496).

1. `TracingDAO.query_page` selects `attributes` without
   `ag.data.parameters.agent.skills` (removed in SQL) and returns the windowing of
   the next page; `TracingDAO.fetch` still selects the whole column.
2. `TracingService.bound_query_windowing` applies the default and maximum limit.

No live DB: a fake session captures the statements and returns canned rows.
"""

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy.dialects import postgresql

from oss.src.core.shared.dtos import Windowing
from oss.src.core.tracing.dtos import (
    Focus,
    Formatting,
    TracingQuery,
    TraceType,
    SpanType,
)
from oss.src.core.tracing.service import TracingService
from oss.src.dbs.postgres.tracing.dao import TracingDAO
from oss.src.dbs.postgres.tracing.dbes import SpanDBE
from oss.src.utils.env import env

SKILLS_PATH = "#- '{ag,data,parameters,agent,skills}'"


@pytest.fixture
def anyio_backend():
    return "asyncio"


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows

    def scalars(self):
        return self

    def mappings(self):
        return self


class _Session:
    def __init__(self, engine):
        self._engine = engine

    async def execute(self, stmt):
        self._engine.executed.append(stmt)
        # The first statement sets the statement timeout.
        if len(self._engine.executed) == 1:
            return _Result([])
        return _Result(self._engine.rows)


class _Engine:
    def __init__(self, rows):
        self.rows = rows
        self.executed = []

    @asynccontextmanager
    async def session(self):
        yield _Session(self)


def _sql(stmt) -> str:
    return str(
        stmt.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )


def _dbe(*, trace_id=None, start_time=None) -> SpanDBE:
    now = start_time or datetime.now(timezone.utc)
    return SpanDBE(
        project_id=uuid4(),
        trace_id=trace_id or uuid4(),
        span_id=uuid4(),
        parent_id=None,
        trace_type=TraceType.INVOCATION,
        span_type=SpanType.WORKFLOW,
        span_kind="SPAN_KIND_SERVER",
        span_name="agent",
        start_time=now,
        end_time=now,
        status_code="STATUS_CODE_OK",
        created_at=now,
    )


def _query(*, focus: Focus, windowing: Windowing) -> TracingQuery:
    return TracingQuery(formatting=Formatting(focus=focus), windowing=windowing)


# 1. The list query removes the skills in SQL -------------------------------------


@pytest.mark.anyio
async def test_list_query_selects_attributes_without_skills(anyio_backend):
    trimmed = {"ag": {"data": {"parameters": {"agent": {"llm": {"model": "m"}}}}}}
    engine = _Engine(rows=[(_dbe(), trimmed)])

    spans, _ = await TracingDAO(engine=engine).query_page(
        project_id=uuid4(),
        query=_query(focus=Focus.SPAN, windowing=Windowing(limit=10)),
    )

    sql = _sql(engine.executed[-1])
    assert SKILLS_PATH in sql
    # Guarded: `#-` raises on an array or scalar on the path.
    assert "jsonb_typeof(spans.attributes #> '{ag,data,parameters,agent}')" in sql
    # The whole column is not selected next to the trimmed one.
    assert "spans.attributes AS" not in sql.replace("\n", " ")
    assert spans[0].attributes == trimmed


@pytest.mark.anyio
async def test_trace_focus_list_query_selects_attributes_without_skills(
    anyio_backend,
):
    engine = _Engine(rows=[(_dbe(), datetime.now(timezone.utc), {"ag": {}})])

    await TracingDAO(engine=engine).query_page(
        project_id=uuid4(),
        query=_query(focus=Focus.TRACE, windowing=Windowing(limit=10)),
    )

    sql = _sql(engine.executed[-1])
    assert SKILLS_PATH in sql
    # The outer statement is scoped to the project, not only the inner one.
    assert sql.count("spans.project_id =") >= 2


@pytest.mark.anyio
async def test_fetch_keeps_the_whole_attributes(anyio_backend):
    engine = _Engine(rows=[])

    await TracingDAO(engine=engine).fetch(project_id=uuid4(), trace_ids=[uuid4()])

    sql = _sql(engine.executed[-1])
    assert SKILLS_PATH not in sql
    assert "spans.attributes" in sql


# 1b. The next page -----------------------------------------------------------------


@pytest.mark.anyio
async def test_span_focus_full_page_returns_next_windowing(anyio_backend):
    now = datetime.now(timezone.utc)
    dbes = [_dbe(start_time=now - timedelta(seconds=i)) for i in range(3)]
    engine = _Engine(rows=[(dbe, {}) for dbe in dbes])
    oldest = now - timedelta(days=7)

    _, next_windowing = await TracingDAO(engine=engine).query_page(
        project_id=uuid4(),
        query=_query(
            focus=Focus.SPAN,
            windowing=Windowing(limit=3, oldest=oldest, newest=now),
        ),
    )

    assert next_windowing == Windowing(
        newest=dbes[-1].start_time,
        oldest=oldest,
        next=dbes[-1].span_id,
        limit=3,
    )


@pytest.mark.anyio
async def test_span_focus_ascending_full_page_moves_oldest(anyio_backend):
    now = datetime.now(timezone.utc)
    dbes = [_dbe(start_time=now + timedelta(seconds=i)) for i in range(2)]
    engine = _Engine(rows=[(dbe, {}) for dbe in dbes])

    _, next_windowing = await TracingDAO(engine=engine).query_page(
        project_id=uuid4(),
        query=_query(
            focus=Focus.SPAN,
            windowing=Windowing(
                limit=2, newest=now + timedelta(days=1), order="ascending"
            ),
        ),
    )

    assert next_windowing.oldest == dbes[-1].start_time
    assert next_windowing.newest == now + timedelta(days=1)
    assert next_windowing.next == dbes[-1].span_id
    assert next_windowing.order == "ascending"


@pytest.mark.anyio
async def test_span_focus_short_page_has_no_next_windowing(anyio_backend):
    engine = _Engine(rows=[(_dbe(), {})])

    _, next_windowing = await TracingDAO(engine=engine).query_page(
        project_id=uuid4(),
        query=_query(focus=Focus.SPAN, windowing=Windowing(limit=2)),
    )

    assert next_windowing is None


@pytest.mark.anyio
async def test_trace_focus_cursor_uses_the_trace_rank(anyio_backend):
    now = datetime.now(timezone.utc)
    first, second = uuid4(), uuid4()
    rank_first, rank_second = now, now - timedelta(minutes=1)
    rows = [
        # Several spans per trace; limit counts traces.
        (_dbe(trace_id=first, start_time=now - timedelta(minutes=5)), rank_first, {}),
        (_dbe(trace_id=first, start_time=now), rank_first, {}),
        (_dbe(trace_id=second, start_time=now - timedelta(minutes=9)), rank_second, {}),
        (_dbe(trace_id=second, start_time=now - timedelta(minutes=1)), rank_second, {}),
    ]
    engine = _Engine(rows=rows)

    spans, next_windowing = await TracingDAO(engine=engine).query_page(
        project_id=uuid4(),
        query=_query(focus=Focus.TRACE, windowing=Windowing(limit=2)),
    )

    assert len(spans) == 4
    assert next_windowing == Windowing(newest=rank_second, next=second, limit=2)

    _, no_next = await TracingDAO(engine=_Engine(rows=rows)).query_page(
        project_id=uuid4(),
        query=_query(focus=Focus.TRACE, windowing=Windowing(limit=3)),
    )
    assert no_next is None


# 2. Default and maximum limit -------------------------------------------------------


@pytest.fixture
def limits(monkeypatch):
    monkeypatch.setattr(env.agenta.api.tracing, "query_default_limit", 100)
    monkeypatch.setattr(env.agenta.api.tracing, "query_max_limit", 1000)


def test_no_windowing_gets_the_default_limit(limits):
    assert TracingService.bound_query_windowing(None) == Windowing(limit=100)


def test_no_limit_gets_the_default_and_keeps_the_window(limits):
    newest = datetime.now(timezone.utc)
    windowing = Windowing(newest=newest, order="ascending")

    bounded = TracingService.bound_query_windowing(windowing)

    assert bounded == Windowing(newest=newest, order="ascending", limit=100)
    assert windowing.limit is None  # the request object is not changed


@pytest.mark.parametrize(
    "requested, applied",
    [(20, 20), (40, 40), (100, 100), (500, 500), (1000, 1000), (5000, 1000), (0, 1)],
)
def test_limit_is_clamped_to_the_maximum(limits, requested, applied):
    # 20, 40, 100 (/m Analytics runs), 500 (export), 1000 (/m Analytics tool spans)
    # pass unchanged.
    bounded = TracingService.bound_query_windowing(Windowing(limit=requested))

    assert bounded.limit == applied


def test_default_never_exceeds_the_maximum(monkeypatch):
    monkeypatch.setattr(env.agenta.api.tracing, "query_default_limit", 5000)
    monkeypatch.setattr(env.agenta.api.tracing, "query_max_limit", 1000)

    assert TracingService.bound_query_windowing(None).limit == 1000


# 3. Following a returned cursor ------------------------------------------------------


def test_legacy_body_accepts_the_returned_windowing():
    from oss.src.apis.fastapi.tracing.utils import parse_query_from_body_request

    next_id = uuid4()
    query = parse_query_from_body_request(
        focus="span",
        filter={"conditions": [{"field": "span_name", "value": "x"}]},
        windowing={
            "newest": "2026-10-11T09:12:44.120000Z",
            "oldest": "2026-10-04T09:12:44Z",
            "next": str(next_id),
            "limit": 50,
        },
    )

    assert query.windowing.next == next_id
    assert query.windowing.limit == 50
    assert query.windowing.newest == datetime(
        2026, 10, 11, 9, 12, 44, 120000, tzinfo=timezone.utc
    )
    # The filter is kept: the body is not dropped.
    assert query.filtering.conditions[0].field == "span_name"


def test_saved_revision_keeps_the_cursor_time():
    stored = Windowing(
        oldest=datetime(2026, 10, 1, tzinfo=timezone.utc),
        newest=datetime(2026, 10, 10, tzinfo=timezone.utc),
        limit=2,
    )
    cursor = Windowing(
        newest=datetime(2026, 10, 5, tzinfo=timezone.utc),
        oldest=stored.oldest,
        next=uuid4(),
        limit=2,
    )

    merged = TracingService._merge_windowing(
        stored_windowing=stored,
        request_windowing=cursor,
    )

    assert merged.newest == cursor.newest
    assert merged.oldest == stored.oldest
    assert merged.next == cursor.next


def test_saved_revision_without_cursor_keeps_its_window():
    stored = Windowing(newest=datetime(2026, 10, 10, tzinfo=timezone.utc), limit=2)

    merged = TracingService._merge_windowing(
        stored_windowing=stored,
        request_windowing=Windowing(newest=datetime(2026, 1, 1, tzinfo=timezone.utc)),
    )

    assert merged.newest == stored.newest
