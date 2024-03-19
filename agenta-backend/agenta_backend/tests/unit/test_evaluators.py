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
    "output, prefix, case_sensitive, expected",
    [
        ("Hello world", "He", True, True),
        ("hello world", "He", False, True),
        ("Hello world", "he", False, True),
        ("Hello world", "world", True, False),
    ],
)
def test_auto_starts_with(output, prefix, case_sensitive, expected):
    result = auto_starts_with(
        {}, output, "", {}, {"prefix": prefix, "case_sensitive": case_sensitive}, {}
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
        {}, output, "", {}, {"suffix": suffix, "case_sensitive": case_sensitive}, {}
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
        "",
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
        "",
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
        "",
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
    result = auto_contains_json({}, output, "", {}, {}, {})
    assert result.value == expected


@pytest.mark.parametrize(
    "output, correct_answer, threshold, expected",
    [
        ("hello world", "hello world", 5, True),
        ("hello world", "hola mundo", 5, False),
        ("hello world", "hello world!", 2, True),
        ("hello world", "hello wor", 10, True),
        ("hello world", "hello worl", None, 1),
        ("hello world", "helo world", None, 1),
    ],
)
def test_auto_levenshtein_distance(output, correct_answer, threshold, expected):
    settings_values = {"threshold": threshold} if threshold is not None else {}
    result = auto_levenshtein_distance(
        {}, output, correct_answer, {}, settings_values, {}
    )
    assert result.value == expected