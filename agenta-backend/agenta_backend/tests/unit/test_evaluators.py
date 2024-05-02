import pytest

from agenta_backend.services.evaluators_service import (
    auto_levenshtein_distance,
    auto_starts_with,
    auto_ends_with,
    auto_contains,
    auto_contains_any,
    auto_contains_all,
    auto_contains_json,
)


@pytest.mark.parametrize(
    "output, settings_values, expected",
    [
        ("Hello world", {"prefix": "He", "case_sensitive": True}, True),
        ("hello world", {"prefix": "He", "case_sensitive": False}, True),
        ("Hello world", {"prefix": "he", "case_sensitive": False}, True),
        ("Hello world", {"prefix": "world", "case_sensitive": True}, False),
    ],
)
def test_auto_starts_with(output, settings_values, expected):
    result = auto_starts_with(
        inputs={},
        output=output,
        data_point={},
        correct_answer_key="",
        app_params={},
        settings_values=settings_values,
        lm_providers_keys={},
    )
    assert result.value == expected


# Test for auto_ends_with


@pytest.mark.parametrize(
    "output, suffix, case_sensitive, expected",
    [
        ("Hello world", "world", True, True),
        ("hello world", "World", False, True),
        ("Hello world", "World", True, False),
        ("Hello world", "Hello", True, False),
    ],
)
def test_auto_ends_with(output, suffix, case_sensitive, expected):
    result = auto_ends_with(
        {},
        output,
        {},
        "correct_answer",
        {},
        {"suffix": suffix, "case_sensitive": case_sensitive},
        {},
    )
    assert result.value == expected


# Test for auto_contains


@pytest.mark.parametrize(
    "output, substring, case_sensitive, expected",
    [
        ("Hello world", "lo wo", True, True),
        ("Hello world", "LO WO", False, True),
        ("Hello world", "abc", True, False),
    ],
)
def test_auto_contains(output, substring, case_sensitive, expected):
    result = auto_contains(
        {},
        output,
        {},
        "correct_answer",
        {},
        {"substring": substring, "case_sensitive": case_sensitive},
        {},
    )
    assert result.value == expected


# Test for auto_contains_any


@pytest.mark.parametrize(
    "output, substrings, case_sensitive, expected",
    [
        ("Hello world", "hello,world", True, True),
        ("Hello world", "world,universe", True, True),
        ("Hello world", "world,universe", False, True),
        ("Hello world", "abc,xyz", True, False),
    ],
)
def test_auto_contains_any(output, substrings, case_sensitive, expected):
    result = auto_contains_any(
        {},
        output,
        {},
        "correct_answer",
        {},
        {"substrings": substrings, "case_sensitive": case_sensitive},
        {},
    )
    assert result.value == expected


# Test for auto_contains_all


@pytest.mark.parametrize(
    "output, substrings, case_sensitive, expected",
    [
        ("Hello world", "hello,world", True, False),
        ("Hello world", "Hello,world", True, True),
        ("Hello world", "hello,world", False, True),
        ("Hello world", "world,universe", True, False),
    ],
)
def test_auto_contains_all(output, substrings, case_sensitive, expected):
    result = auto_contains_all(
        {},
        output,
        {},
        "correct_answer",
        {},
        {"substrings": substrings, "case_sensitive": case_sensitive},
        {},
    )
    assert result.value == expected


# Test for auto_contains_json
@pytest.mark.parametrize(
    "output, expected",
    [
        ('Some random text {"key": "value"} more text', True),
        ("No JSON here!", False),
        ("{Malformed JSON, nope!}", False),
        ('{"valid": "json", "number": 123}', True),
    ],
)
def test_auto_contains_json(output, expected):
    result = auto_contains_json({}, output, {}, "", {}, {}, {})
    assert result.value == expected


@pytest.mark.parametrize(
    "output, data_point, correct_answer_key, settings_values, expected",
    [
        (
            "hello world",
            {"correct_answer": "hello world"},
            "correct_answer",
            {"threshold": 5},
            True,
        ),
        (
            "hello world",
            {"correct_answer": "hola mundo"},
            "correct_answer",
            {"threshold": 5},
            False,
        ),
        (
            "hello world",
            {"correct_answer": "hello world!"},
            "correct_answer",
            {"threshold": 2},
            True,
        ),
        (
            "hello world",
            {"correct_answer": "hello wor"},
            "correct_answer",
            {"threshold": 10},
            True,
        ),
        ("hello world", {"correct_answer": "hello worl"}, "correct_answer", {}, 1),
        ("hello world", {"correct_answer": "helo world"}, "correct_answer", {}, 1),
    ],
)
def test_auto_levenshtein_distance(
    output, data_point, correct_answer_key, settings_values, expected
):
    result = auto_levenshtein_distance(
        inputs={},
        output=output,
        data_point=data_point,
        correct_answer_key=correct_answer_key,
        app_params={},
        settings_values=settings_values,
        lm_providers_keys={},
    )
    assert result.value == expected
