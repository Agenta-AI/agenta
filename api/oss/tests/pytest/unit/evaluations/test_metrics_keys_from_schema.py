from oss.src.core.evaluations.utils import get_metrics_keys_from_schema


def _schema(**score):
    return {"type": "object", "properties": {"score": score}}


def test_number_keeps_declared_range():
    keys = get_metrics_keys_from_schema(
        _schema(type="number", minimum=1, maximum=5),
    )

    assert keys == [
        {"path": "score", "type": "numeric/continuous", "minimum": 1, "maximum": 5}
    ]


def test_number_without_range_has_no_bounds():
    keys = get_metrics_keys_from_schema(_schema(type="number"))

    assert keys == [{"path": "score", "type": "numeric/continuous"}]


def test_number_with_one_bound_has_no_bounds():
    assert get_metrics_keys_from_schema(_schema(type="number", minimum=0)) == [
        {"path": "score", "type": "numeric/continuous"}
    ]
    assert get_metrics_keys_from_schema(_schema(type="number", maximum=1)) == [
        {"path": "score", "type": "numeric/continuous"}
    ]


def test_number_with_minimum_not_below_maximum_has_no_bounds():
    for minimum, maximum in ((1, 1), (5, 1)):
        keys = get_metrics_keys_from_schema(
            _schema(type="number", minimum=minimum, maximum=maximum),
        )

        assert keys == [{"path": "score", "type": "numeric/continuous"}]


def test_number_with_non_numeric_bounds_has_no_bounds():
    for minimum, maximum in (("0", "1"), (False, True)):
        keys = get_metrics_keys_from_schema(
            _schema(type="number", minimum=minimum, maximum=maximum),
        )

        assert keys == [{"path": "score", "type": "numeric/continuous"}]


def test_only_numbers_keep_the_range():
    keys = get_metrics_keys_from_schema(
        {
            "type": "object",
            "properties": {
                "count": {"type": "integer", "minimum": 0, "maximum": 10},
                "label": {"type": "string", "minimum": 0, "maximum": 1},
            },
        }
    )

    assert keys == [
        {"path": "count", "type": "numeric/discrete"},
        {"path": "label", "type": "string"},
    ]
