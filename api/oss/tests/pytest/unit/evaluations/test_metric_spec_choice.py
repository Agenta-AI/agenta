from oss.src.core.evaluations.service import DEFAULT_METRICS, _metric_spec
from oss.src.core.tracing.dtos import MetricSpec, ScoreMetricSpec

_SCORE = "attributes.ag.data.outputs.score"


def test_default_metrics_keep_plain_specs():
    for metric in DEFAULT_METRICS:
        assert type(_metric_spec(metric)) is MetricSpec


def test_continuous_evaluator_score_gets_score_spec_with_range():
    spec = _metric_spec(
        {
            "path": _SCORE,
            "type": "numeric/continuous",
            "score": True,
            "minimum": 1,
            "maximum": 5,
        }
    )

    assert type(spec) is ScoreMetricSpec
    assert (spec.declared_min, spec.declared_max) == (1, 5)


def test_continuous_evaluator_score_without_range_gets_score_spec():
    spec = _metric_spec(
        {
            "path": _SCORE,
            "type": "numeric/continuous",
            "score": True,
            "minimum": None,
            "maximum": None,
        }
    )

    assert type(spec) is ScoreMetricSpec
    assert (spec.declared_min, spec.declared_max) == (None, None)


def test_other_evaluator_outputs_keep_plain_specs():
    for metric_type in ("numeric/discrete", "binary", "categorical/single"):
        spec = _metric_spec({"path": _SCORE, "type": metric_type, "score": True})

        assert type(spec) is MetricSpec
