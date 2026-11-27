"""Unit test: the internal ScoreMetricSpec reaches the analytics SQL intact.

No live DB: the DAO stops at `build_specs_values`, which is captured.
"""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from oss.src.apis.fastapi.tracing.utils import parse_specs_from_body_request
from oss.src.core.shared.dtos import Windowing
from oss.src.core.tracing.dtos import (
    MetricSpec,
    MetricType,
    ScoreMetricSpec,
    TracingQuery,
)
from oss.src.dbs.postgres.tracing import dao as tracing_dao
from oss.src.dbs.postgres.tracing.dao import TracingDAO
from oss.src.dbs.postgres.tracing.utils import build_specs_values

_PATH = "attributes.ag.data.outputs.score"


def _query() -> TracingQuery:
    newest = datetime.now(timezone.utc)
    return TracingQuery(
        windowing=Windowing(oldest=newest - timedelta(days=1), newest=newest)
    )


async def test_dao_keeps_score_spec_class_and_bounds(monkeypatch):
    captured = {}

    def fake_build_specs_values(*, metric_specs):
        captured["specs"] = metric_specs
        return None

    monkeypatch.setattr(tracing_dao, "build_specs_values", fake_build_specs_values)

    specs = [
        ScoreMetricSpec(
            type=MetricType.NUMERIC_CONTINUOUS,
            path=_PATH,
            declared_min=1,
            declared_max=5,
        ),
        MetricSpec(type=MetricType.NUMERIC_CONTINUOUS, path=_PATH),
    ]

    result = await TracingDAO(engine=object()).analytics(
        project_id=uuid4(), query=_query(), specs=specs
    )

    assert result == []
    score, plain = captured["specs"]
    assert type(score) is ScoreMetricSpec
    assert (score.path, score.declared_min, score.declared_max) == (
        "ag.data.outputs.score",
        1,
        5,
    )
    assert type(plain) is MetricSpec
    assert plain.path == "ag.data.outputs.score"


def test_specs_values_carry_score_rule_and_declared_bounds():
    specs_values = build_specs_values(
        metric_specs=[
            ScoreMetricSpec(
                type=MetricType.NUMERIC_CONTINUOUS,
                path="ag.data.outputs.score",
                declared_min=1,
                declared_max=5,
            ),
            MetricSpec(type=MetricType.NUMERIC_CONTINUOUS, path="ag.metrics.costs"),
        ]
    )

    rows = specs_values._data[0]
    columns = [c.name for c in specs_values.c]

    score, plain = (dict(zip(columns, row)) for row in rows)
    assert (score["score_rule"], score["declared_min"], score["declared_max"]) == (
        True,
        1,
        5,
    )
    assert (plain["score_rule"], plain["declared_min"], plain["declared_max"]) == (
        False,
        None,
        None,
    )


def test_public_analytics_request_takes_no_score_fields():
    (spec,) = parse_specs_from_body_request(
        [
            {
                "type": "numeric/continuous",
                "path": _PATH,
                "declared_min": 0,
                "declared_max": 1,
            }
        ]
    )

    assert type(spec) is MetricSpec
    assert "declared_min" not in MetricSpec.model_fields
    assert "declared_min" not in spec.model_dump()
