from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.dialects import postgresql

from oss.src.core.tracing.dtos import Focus
from oss.src.dbs.postgres.tracing.utils import (
    build_base_cte,
    fill_empty_buckets,
    get_sampling_percent,
    scale_sampled_value,
)


UTC = timezone.utc
OLDEST = datetime(2026, 9, 1, 0, 0, tzinfo=UTC)
NEWEST = datetime(2026, 9, 1, 3, 0, tzinfo=UTC)


def _sql(focus=None) -> str:
    cte = build_base_cte(
        project_id=uuid4(),
        oldest=OLDEST,
        newest=NEWEST,
        stride="1 hour",
        focus=focus,
    )
    stmt = select(cte)
    return str(stmt.compile(dialect=postgresql.dialect()))


def test_base_cte_buckets_and_windows_by_start_time():
    sql = _sql()

    assert "date_bin('1 hour', spans.start_time" in sql
    assert "spans.start_time >= " in sql
    assert "spans.start_time < " in sql
    assert "spans.created_at >= " not in sql
    assert "date_bin('1 hour', spans.created_at" not in sql


def test_base_cte_reads_root_spans_by_default_and_for_trace_focus():
    assert "spans.parent_id IS NULL" in _sql()
    assert "spans.parent_id IS NULL" in _sql(Focus.TRACE)


def test_base_cte_reads_all_spans_for_span_focus():
    assert "spans.parent_id IS NULL" not in _sql(Focus.SPAN)


def test_get_sampling_percent():
    assert get_sampling_percent(None) is None
    assert get_sampling_percent(0.25) == 25
    assert get_sampling_percent(2.0) == 100
    assert get_sampling_percent(-1.0) == 0


def test_scale_sampled_value_scales_counts_and_sums_only():
    value = {"count": 5, "sum": 2.5, "mean": 0.5, "min": 0.1, "max": 1.0}

    scaled = scale_sampled_value(value, 25)

    assert scaled == {"count": 20.0, "sum": 10.0, "mean": 0.5, "min": 0.1, "max": 1.0}


def test_scale_sampled_value_is_a_no_op_without_sampling():
    assert scale_sampled_value({"count": 5}, None) == {"count": 5}
    assert scale_sampled_value({"count": 5}, 100) == {"count": 5}


def test_fill_empty_buckets_adds_missing_timestamps_only():
    timestamps = [OLDEST + timedelta(hours=h) for h in range(3)]
    per_timestamp = {timestamps[1]: {"attributes.x": {"count": 1}}}

    filled = fill_empty_buckets(per_timestamp, timestamps)

    assert set(filled) == set(timestamps)
    assert filled[timestamps[0]] == {}
    assert filled[timestamps[1]] == {"attributes.x": {"count": 1}}
    assert filled[timestamps[2]] == {}
