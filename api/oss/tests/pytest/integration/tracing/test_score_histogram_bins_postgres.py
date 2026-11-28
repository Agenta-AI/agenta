"""The score histogram bin rule, run by `TracingDAO.analytics` against Postgres.

`unit/tracing/test_score_metric_spec.py` pins how the specs are built. These cases run the
SQL: a `ScoreMetricSpec` gets 10 bins on the declared range when every value fits it, else
on 0 to 1 when every value fits, else on the values' own min to max. A plain `MetricSpec`
keeps ceil(sqrt(n)) bins on the values' own range.

Requires the tracing chain applied, with POSTGRES_URI_TRACING pointed at that database.
"""

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import delete

from oss.src.core.tracing.dtos import (
    MetricSpec,
    MetricType,
    ScoreMetricSpec,
    TracingQuery,
    Windowing,
)
from oss.src.dbs.postgres.shared.engine import get_analytics_engine
from oss.src.dbs.postgres.tracing.dao import TracingDAO
from oss.src.dbs.postgres.tracing.dbes import SpanDBE


pytestmark = pytest.mark.integration

PATH = "attributes.ag.data.outputs.score"


def _score(declared_min=None, declared_max=None) -> ScoreMetricSpec:
    return ScoreMetricSpec(
        type=MetricType.NUMERIC_CONTINUOUS,
        path=PATH,
        declared_min=declared_min,
        declared_max=declared_max,
    )


_PLAIN = MetricSpec(type=MetricType.NUMERIC_CONTINUOUS, path=PATH)


def _span(project_id, value) -> SpanDBE:
    now = datetime.now(timezone.utc)
    return SpanDBE(
        project_id=project_id,
        trace_id=uuid4(),
        span_id=uuid4(),
        span_kind="SPAN_KIND_SERVER",
        span_name="evaluator",
        start_time=now,
        end_time=now,
        status_code="STATUS_CODE_OK",
        created_at=now,
        attributes={"ag": {"data": {"outputs": {"score": value}}}},
    )


async def _histogram(values, spec):
    project_id = uuid4()
    engine = get_analytics_engine()
    async with engine.session() as session:
        session.add_all([_span(project_id, value) for value in values])
    try:
        buckets = await TracingDAO(engine=engine).analytics(
            project_id=project_id,
            query=TracingQuery(
                windowing=Windowing(oldest=datetime(1970, 1, 1, tzinfo=timezone.utc))
            ),
            specs=[spec],
        )
    finally:
        async with engine.session() as session:
            await session.execute(
                delete(SpanDBE).where(SpanDBE.project_id == project_id)
            )
    metrics = [bucket.metrics for bucket in buckets if bucket.metrics]
    assert len(metrics) == 1, metrics
    return next(iter(metrics[0].values()))["hist"]


# (case, values, spec, bins, range low, range high, a 1-based bin that holds a value)
CASES = [
    ("declared 1..5, values fit", [2, 3, 4], _score(1, 5), 10, 1, 5, None),
    ("declared 1..5, values fit 0..1", [0.2, 0.5, 0.8], _score(1, 5), 10, 0, 1, None),
    ("no range, values fit 0..1", [0.45, 0.8, 1], _score(), 10, 0, 1, 10),
    ("no range, values 0..7", [0, 3.5, 7], _score(), 10, 0, 7, None),
    ("declared 1..5, maximum in last bin", [2, 5], _score(1, 5), 10, 1, 5, 10),
    (
        "declared 0.1..0.3, values on both bounds",
        [0.1, 0.3],
        _score(0.1, 0.3),
        10,
        0.1,
        0.3,
        10,
    ),
    (
        "declared 0..1, one value above",
        [0.3, 0.9, 1.2],
        _score(0, 1),
        10,
        0.3,
        1.2,
        None,
    ),
    ("no range, one value", [0.7], _score(), 10, 0, 1, 8),
    ("no range, all equal outside 0..1", [3, 3, 3], _score(), 10, 3, 3, 1),
    ("declared 1..5, all equal", [3, 3], _score(1, 5), 10, 1, 5, 6),
    ("no range, values 2..40", [2, 10, 20, 30, 40], _score(), 10, 2, 40, None),
    ("plain spec keeps ceil(sqrt(n)) bins", [0.2, 0.5, 0.8], _PLAIN, 2, 0.2, 0.8, None),
    ("plain spec, one value, one bin", [0.7], _PLAIN, 1, 0.7, 0.7, None),
]


@pytest.mark.parametrize(
    "values, spec, bins, low, high, filled_bin",
    [case[1:] for case in CASES],
    ids=[case[0] for case in CASES],
)
async def test_score_histogram_bins(values, spec, bins, low, high, filled_bin):
    histogram = await _histogram(values, spec)

    assert len(histogram) == bins
    assert float(histogram[0]["interval"][0]) == pytest.approx(low)
    assert float(histogram[-1]["interval"][1]) == pytest.approx(high)
    assert sum(entry["count"] for entry in histogram) == len(values)
    if filled_bin is not None:
        assert histogram[filled_bin - 1]["count"] >= 1
