"""
Unit tests for the match_v0 evaluator (agenta:builtin:match:v0).

Tests are organized into two categories:

1. Standalone match_v0 mode tests — verify each match (valid, regex, similarity,
   diff) and their options directly.

2. Legacy parity tests — for each legacy evaluator that collapses into match,
   run both the legacy handler and an equivalent match_v0 configuration on the
   same inputs, and assert the results agree.

async helpers are called via asyncio.run() so no pytest-asyncio marker is needed.
"""

import asyncio
import json
import re
from typing import Any, Dict, List

import pytest

from agenta.sdk.workflows.handlers import (
    # _execute_match_contains,
    # _execute_match_ends_with,
    # _execute_match_exact,
    _execute_match_node,
    # _execute_match_overlap,
    # _execute_match_regex,
    _execute_match_similarity_sync,
    # _execute_match_starts_with,
    # _execute_match_valid,
    auto_contains_all_v0,
    auto_contains_any_v0,
    auto_contains_json_v0,
    auto_contains_v0,
    auto_ends_with_v0,
    auto_exact_match_v0,
    auto_json_diff_v0,
    auto_levenshtein_distance_v0,
    auto_regex_test_v0,
    auto_similarity_match_v0,
    auto_starts_with_v0,
    field_match_test_v0,
    json_multi_field_match_v0,
)

# Legacy handlers are decorated with @instrument(annotate=True) which requires
# an active tracing context.  Access the original unwrapped function via
# __wrapped__ so the parity tests can run without a full ag.init() setup.
_exact_match = auto_exact_match_v0.__wrapped__
_regex_test = auto_regex_test_v0.__wrapped__
_starts_with = auto_starts_with_v0.__wrapped__
_ends_with = auto_ends_with_v0.__wrapped__
_contains = auto_contains_v0.__wrapped__
_contains_any = auto_contains_any_v0.__wrapped__
_contains_all = auto_contains_all_v0.__wrapped__
_contains_json = auto_contains_json_v0.__wrapped__
_json_diff = auto_json_diff_v0.__wrapped__
_levenshtein = auto_levenshtein_distance_v0.__wrapped__
_similarity_match = auto_similarity_match_v0.__wrapped__
_field_match = field_match_test_v0.__wrapped__
_json_multi_field = json_multi_field_match_v0.__wrapped__


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def run(coro):
    """Run an async coroutine synchronously."""
    return asyncio.get_event_loop().run_until_complete(coro)


def match(matchers: List[Dict], inputs=None, outputs=None, trace=None) -> Dict:
    """Call _execute_match_node for each matcher and return the flat result dict."""
    request: Dict[str, Any] = {}
    if inputs is not None:
        request["inputs"] = inputs
    if outputs is not None:
        request["outputs"] = outputs
    if trace is not None:
        request["trace"] = trace

    return {
        str(m.get("key", "")): run(_execute_match_node(m, request)) for m in matchers
    }


def first_result(matchers, inputs=None, outputs=None, trace=None) -> Dict:
    """Convenience: run match() and return the first result node."""
    return next(
        iter(match(matchers, inputs=inputs, outputs=outputs, trace=trace).values())
    )


def escaped_exact(value: str) -> str:
    """Build an anchored, escaped regex for exact-match semantics."""
    return "^" + re.escape(str(value)) + "$"


# ---------------------------------------------------------------------------
# 1. mode=valid
# ---------------------------------------------------------------------------


class TestMatchValid:
    def test_text_valid_string(self):
        r = first_result(
            [{"key": "k", "target": "$.outputs", "mode": "text", "match": "valid"}],
            outputs="hello",
        )
        assert r["success"] is True
        assert r["score"] == 1.0
        assert r["error"] is False

    def test_text_invalid_non_string(self):
        r = first_result(
            [{"key": "k", "target": "$.outputs", "mode": "text", "match": "valid"}],
            outputs={"key": "val"},
        )
        assert r["success"] is False
        assert r["score"] == 0.0

    def test_json_valid_dict(self):
        r = first_result(
            [{"key": "k", "target": "$.outputs", "mode": "json", "match": "valid"}],
            outputs={"name": "Alice"},
        )
        assert r["success"] is True

    def test_json_valid_json_string(self):
        r = first_result(
            [{"key": "k", "target": "$.outputs", "mode": "json", "match": "valid"}],
            outputs='{"name": "Alice"}',
        )
        assert r["success"] is True

    def test_json_invalid_plain_string(self):
        r = first_result(
            [{"key": "k", "target": "$.outputs", "mode": "json", "match": "valid"}],
            outputs="not json",
        )
        assert r["success"] is False


# ---------------------------------------------------------------------------
# 2. mode=regex
# ---------------------------------------------------------------------------


class TestMatchRegex:
    def test_exact_pattern_match(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "regex",
                    "reference": "^Paris$",
                }
            ],
            outputs="Paris",
        )
        assert r["success"] is True

    def test_exact_pattern_no_match(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "regex",
                    "reference": "^Paris$",
                }
            ],
            outputs="London",
        )
        assert r["success"] is False

    def test_case_sensitive_default(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "regex",
                    "reference": "^paris$",
                }
            ],
            outputs="Paris",
        )
        assert r["success"] is False

    def test_case_insensitive(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "regex",
                    "reference": "^paris$",
                    "case_sensitive": False,
                }
            ],
            outputs="Paris",
        )
        assert r["success"] is True

    def test_reference_resolved_as_jsonpath(self):
        # reference is a JSONPath — resolves to the correct_answer string
        correct = "42"
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "regex",
                    "reference": "$.inputs.correct_answer",
                }
            ],
            inputs={"correct_answer": correct},
            outputs="42",
        )
        # "42" matches regex "42" (substring match)
        assert r["success"] is True

    def test_starts_with_pattern(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "regex",
                    "reference": "^Hello",
                }
            ],
            outputs="Hello, world!",
        )
        assert r["success"] is True

    def test_ends_with_pattern(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "regex",
                    "reference": "world!$",
                }
            ],
            outputs="Hello, world!",
        )
        assert r["success"] is True

    def test_contains_pattern(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "regex",
                    "reference": "foo",
                }
            ],
            outputs="this is foo bar",
        )
        assert r["success"] is True

    def test_contains_any_pattern(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "regex",
                    "reference": "(apple|banana|cherry)",
                }
            ],
            outputs="I like banana",
        )
        assert r["success"] is True

    def test_contains_all_pattern(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "regex",
                    "reference": "(?=.*apple)(?=.*banana).*",
                }
            ],
            outputs="I like apple and banana",
        )
        assert r["success"] is True

    def test_contains_all_pattern_missing_one(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "regex",
                    "reference": "(?=.*apple)(?=.*banana).*",
                }
            ],
            outputs="I only like apple",
        )
        assert r["success"] is False

    def test_path_into_json_field(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs.name",
                    "mode": "text",
                    "match": "regex",
                    "reference": "^Alice$",
                }
            ],
            outputs={"name": "Alice", "age": 30},
        )
        assert r["success"] is True

    def test_result_on_missing_path(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs.nonexistent",
                    "mode": "text",
                    "match": "regex",
                    "reference": "^x$",
                }
            ],
            outputs={"name": "Alice"},
        )
        # JSONPath returns empty list [] for a missing key; the regex won't match
        # that serialized value so success is False (no error raised)
        assert r["success"] is False


# ---------------------------------------------------------------------------
# 3. mode=similarity
# ---------------------------------------------------------------------------


class TestMatchSimilarity:
    def test_jaccard_identical(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "similarity",
                    "reference": "$.inputs.correct_answer",
                    "similarity": "jaccard",
                    "threshold": 0.9,
                }
            ],
            inputs={"correct_answer": "hello world"},
            outputs="hello world",
        )
        assert r["success"] is True
        assert r["score"] == pytest.approx(1.0)

    def test_jaccard_low_similarity(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "similarity",
                    "reference": "hello world",
                    "similarity": "jaccard",
                    "threshold": 0.9,
                }
            ],
            outputs="completely different text here",
        )
        assert r["success"] is False
        assert r["score"] < 0.9

    def test_levenshtein_identical(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "similarity",
                    "reference": "test string",
                    "similarity": "levenshtein",
                    "threshold": 0.8,
                }
            ],
            outputs="test string",
        )
        assert r["success"] is True
        assert r["score"] == pytest.approx(1.0)

    def test_levenshtein_one_edit(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "similarity",
                    "reference": "abc",
                    "similarity": "levenshtein",
                    "threshold": 0.5,
                }
            ],
            outputs="abx",  # 1 substitution out of 3 → score ≈ 0.67
        )
        assert r["success"] is True
        assert 0.6 < r["score"] < 0.8

    def test_levenshtein_empty_strings(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "similarity",
                    "reference": "",
                    "similarity": "levenshtein",
                    "threshold": 0.5,
                }
            ],
            outputs="",
        )
        assert r["score"] == pytest.approx(1.0)

    def test_similarity_case_insensitive(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "similarity",
                    "reference": "HELLO",
                    "similarity": "jaccard",
                    "threshold": 0.9,
                    "case_sensitive": False,
                }
            ],
            outputs="hello",
        )
        assert r["success"] is True

    def test_threshold_boundary(self):
        score = _execute_match_similarity_sync("abc", "abd", "levenshtein", True)
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "similarity",
                    "reference": "abd",
                    "similarity": "levenshtein",
                    "threshold": score,
                }
            ],
            outputs="abc",
        )
        assert r["success"] is True  # score >= threshold (equal)


# ---------------------------------------------------------------------------
# 4. match=diff
# ---------------------------------------------------------------------------


class TestMatchDiff:
    def test_identical_json(self):
        obj = {"name": "Alice", "age": 30}
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "json",
                    "match": "diff",
                    "reference": "$.inputs.correct_answer",
                    "threshold": 0.9,
                }
            ],
            inputs={"correct_answer": obj},
            outputs=obj,
        )
        assert r["success"] is True
        assert r["score"] == pytest.approx(1.0)

    def test_partial_match(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "json",
                    "match": "diff",
                    "reference": {"name": "Alice", "age": 30},
                    "threshold": 0.4,
                }
            ],
            outputs={"name": "Alice", "age": 99},  # 1/2 fields match
        )
        assert r["score"] == pytest.approx(0.5)

    def test_use_schema_only(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "json",
                    "match": "diff",
                    "reference": {"count": 5},
                    "diff": "schema",
                    "threshold": 0.9,
                }
            ],
            outputs={"count": 99},  # same key + same type (int), different value
        )
        assert r["success"] is True
        assert r["score"] == pytest.approx(1.0)

    def test_include_unexpected_keys_false(self):
        # Only reference keys are scored; extra predicted keys don't affect score
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "json",
                    "match": "diff",
                    "reference": {"name": "Alice"},
                    "diff": "full",
                    "threshold": 0.9,
                }
            ],
            outputs={"name": "Alice", "extra": "ignored"},
        )
        assert r["success"] is True

    def test_include_unexpected_keys_true_lowers_score(self):
        # "extra" key in output has no match in reference → reduces score
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "json",
                    "match": "diff",
                    "reference": {"name": "Alice"},
                    "diff": "strict",
                    "threshold": 0.5,
                }
            ],
            outputs={"name": "Alice", "extra": "surprise"},
        )
        # 1 match (name) out of 2 keys (name, extra) = 0.5
        assert r["score"] == pytest.approx(0.5)

    def test_json_string_inputs_parsed(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "json",
                    "match": "diff",
                    "reference": '{"x": 1}',
                    "threshold": 0.9,
                }
            ],
            outputs='{"x": 1}',
        )
        assert r["success"] is True


# ---------------------------------------------------------------------------
# 5. Recursive matchers / aggregation
# ---------------------------------------------------------------------------


class TestMatchRecursive:
    def test_aggregate_all_both_pass(self):
        r = first_result(
            [
                {
                    "key": "group",
                    "target": "$.outputs",
                    "mode": "json",
                    "match": "valid",
                    "success": "all",
                    "matchers": [
                        {
                            "key": "name",
                            "target": "$.outputs.name",
                            "mode": "text",
                            "match": "regex",
                            "reference": "^Alice$",
                        },
                        {
                            "key": "age",
                            "target": "$.outputs.age",
                            "mode": "text",
                            "match": "regex",
                            "reference": "^30$",
                        },
                    ],
                }
            ],
            outputs={"name": "Alice", "age": "30"},
        )
        assert r["success"] is True
        assert len(r["children"]) == 2
        assert all(c["success"] for c in r["children"])

    def test_aggregate_all_one_fails(self):
        r = first_result(
            [
                {
                    "key": "group",
                    "target": "$.outputs",
                    "mode": "json",
                    "match": "valid",
                    "success": "all",
                    "matchers": [
                        {
                            "key": "name",
                            "target": "$.outputs.name",
                            "mode": "text",
                            "match": "regex",
                            "reference": "^Alice$",
                        },
                        {
                            "key": "age",
                            "target": "$.outputs.age",
                            "mode": "text",
                            "match": "regex",
                            "reference": "^99$",  # fails
                        },
                    ],
                }
            ],
            outputs={"name": "Alice", "age": "30"},
        )
        assert r["success"] is False

    def test_aggregate_any_one_passes(self):
        r = first_result(
            [
                {
                    "key": "group",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "valid",
                    "success": "any",
                    "matchers": [
                        {
                            "key": "a",
                            "target": "$.outputs",
                            "mode": "text",
                            "match": "regex",
                            "reference": "^NO$",
                        },
                        {
                            "key": "b",
                            "target": "$.outputs",
                            "mode": "text",
                            "match": "regex",
                            "reference": "hello",
                        },
                    ],
                }
            ],
            outputs="hello world",
        )
        assert r["success"] is True

    def test_aggregate_weighted(self):
        r = first_result(
            [
                {
                    "key": "group",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "valid",
                    "score": "weighted",
                    "success": "threshold",
                    "threshold": 0.6,
                    "matchers": [
                        {
                            "key": "a",
                            "target": "$.outputs",
                            "mode": "text",
                            "match": "regex",
                            "reference": "^YES$",
                            "weight": 3,
                        },
                        {
                            "key": "b",
                            "target": "$.outputs",
                            "mode": "text",
                            "match": "regex",
                            "reference": "^NO$",
                            "weight": 1,
                        },
                    ],
                }
            ],
            outputs="YES",
        )
        # score = (1.0*3 + 0.0*1) / 4 = 0.75 >= 0.6 → success
        assert r["success"] is True
        assert r["score"] == pytest.approx(0.75)

    def test_multiple_top_level_matchers(self):
        results = match(
            [
                {
                    "key": "a",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "regex",
                    "reference": "hello",
                },
                {
                    "key": "b",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "regex",
                    "reference": "world",
                },
            ],
            outputs="hello world",
        )
        assert len(results) == 2
        assert all(r["success"] for r in results.values())


# ---------------------------------------------------------------------------
# 6. mode=exact
# ---------------------------------------------------------------------------


class TestMatchExact:
    def test_exact_match(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "exact",
                    "reference": "Paris",
                }
            ],
            outputs="Paris",
        )
        assert r["success"] is True
        assert r["score"] == 1.0

    def test_exact_no_match(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "exact",
                    "reference": "Paris",
                }
            ],
            outputs="London",
        )
        assert r["success"] is False
        assert r["score"] == 0.0

    def test_exact_case_insensitive(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "exact",
                    "reference": "paris",
                    "case_sensitive": False,
                }
            ],
            outputs="PARIS",
        )
        assert r["success"] is True

    def test_exact_case_sensitive_fails(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "exact",
                    "reference": "paris",
                }
            ],
            outputs="PARIS",
        )
        assert r["success"] is False

    def test_exact_jsonpath_reference(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "exact",
                    "reference": "$.inputs.correct_answer",
                }
            ],
            inputs={"correct_answer": "Paris"},
            outputs="Paris",
        )
        assert r["success"] is True


# ---------------------------------------------------------------------------
# 7. mode=starts_with
# ---------------------------------------------------------------------------


class TestMatchStartsWith:
    def test_starts_with_match(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "starts_with",
                    "reference": "Hello",
                }
            ],
            outputs="Hello, world!",
        )
        assert r["success"] is True

    def test_starts_with_no_match(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "starts_with",
                    "reference": "World",
                }
            ],
            outputs="Hello, world!",
        )
        assert r["success"] is False

    def test_starts_with_case_insensitive(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "starts_with",
                    "reference": "hello",
                    "case_sensitive": False,
                }
            ],
            outputs="Hello, world!",
        )
        assert r["success"] is True

    def test_starts_with_case_sensitive_fails(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "starts_with",
                    "reference": "hello",
                }
            ],
            outputs="Hello, world!",
        )
        assert r["success"] is False


# ---------------------------------------------------------------------------
# 8. mode=ends_with
# ---------------------------------------------------------------------------


class TestMatchEndsWith:
    def test_ends_with_match(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "ends_with",
                    "reference": "world!",
                }
            ],
            outputs="Hello, world!",
        )
        assert r["success"] is True

    def test_ends_with_no_match(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "ends_with",
                    "reference": "Hello",
                }
            ],
            outputs="Hello, world!",
        )
        assert r["success"] is False

    def test_ends_with_case_insensitive(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "ends_with",
                    "reference": "WORLD!",
                    "case_sensitive": False,
                }
            ],
            outputs="Hello, world!",
        )
        assert r["success"] is True


# ---------------------------------------------------------------------------
# 9. mode=contains
# ---------------------------------------------------------------------------


class TestMatchContains:
    def test_contains_single_reference(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "contains",
                    "reference": "quick",
                }
            ],
            outputs="The quick brown fox",
        )
        assert r["success"] is True

    def test_contains_single_not_present(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "contains",
                    "reference": "slow",
                }
            ],
            outputs="The quick brown fox",
        )
        assert r["success"] is False

    def test_contains_case_insensitive(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "contains",
                    "reference": "QUICK",
                    "case_sensitive": False,
                }
            ],
            outputs="The quick brown fox",
        )
        assert r["success"] is True

    def test_contains_any_via_references(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "contains",
                    "references": ["apple", "banana"],
                    "contains": "any",
                }
            ],
            outputs="I love banana",
        )
        assert r["success"] is True

    def test_contains_any_none_present(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "contains",
                    "references": ["apple", "banana"],
                    "contains": "any",
                }
            ],
            outputs="I love oranges",
        )
        assert r["success"] is False

    def test_contains_all_via_references(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "contains",
                    "references": ["apple", "banana"],
                    "contains": "all",
                }
            ],
            outputs="I love apple and banana",
        )
        assert r["success"] is True

    def test_contains_all_missing_one(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "contains",
                    "references": ["apple", "banana"],
                    "contains": "all",
                }
            ],
            outputs="I only love apple",
        )
        assert r["success"] is False

    def test_contains_all_case_insensitive(self):
        r = first_result(
            [
                {
                    "key": "k",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "contains",
                    "references": ["APPLE", "BANANA"],
                    "contains": "all",
                    "case_sensitive": False,
                }
            ],
            outputs="I love apple and banana",
        )
        assert r["success"] is True


# ---------------------------------------------------------------------------
# 10. Legacy parity — auto_exact_match
# ---------------------------------------------------------------------------


class TestParityExactMatch:
    """auto_exact_match ↔ match(kind=text, mode=exact)."""

    CASES = [
        ("Paris", "Paris", True),
        ("Paris", "London", False),
        ("hello world", "hello world", True),
        ("hello world", "hello  world", False),
    ]

    @pytest.mark.parametrize("output,correct,expected", CASES)
    def test_string_parity(self, output, correct, expected):
        legacy = _exact_match(
            parameters={"correct_answer_key": "ca"},
            inputs={"ca": correct},
            outputs=output,
        )
        m = first_result(
            [
                {
                    "key": "exact_match",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "exact",
                    "reference": correct,
                }
            ],
            outputs=output,
        )
        assert legacy["success"] == expected
        assert m["success"] == expected
        assert legacy["success"] == m["success"]  # direct cross-comparison

    def test_dict_parity_match(self):
        obj = {"a": 1, "b": 2}
        legacy = _exact_match(
            parameters={"correct_answer_key": "ca"},
            inputs={"ca": obj},
            outputs=obj,
        )
        serialized = json.dumps(obj, sort_keys=True)
        m = first_result(
            [
                {
                    "key": "exact_match",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "exact",
                    "reference": serialized,
                }
            ],
            outputs=serialized,
        )
        assert legacy["success"] is True
        assert m["success"] is True
        assert legacy["success"] == m["success"]


# ---------------------------------------------------------------------------
# 11. Legacy parity — auto_regex_test
# ---------------------------------------------------------------------------


class TestParityRegexTest:
    CASES = [
        # (output, pattern, case_sensitive, should_match_flag, expected_success)
        ("Hello World", r"hello", True, True, False),  # case mismatch
        ("Hello World", r"hello", False, True, True),  # case-insensitive
        ("Hello World", r"^Hello", True, True, True),  # starts with
        ("Hello World", r"World$", True, True, True),  # ends with
        ("Hello World", r"xyz", True, False, True),  # should NOT match → success
        ("Hello World", r"xyz", True, True, False),  # should match → failure
    ]

    @pytest.mark.parametrize("output,pattern,cs,should_match,expected", CASES)
    def test_regex_parity(self, output, pattern, cs, should_match, expected):
        legacy = _regex_test(
            parameters={
                "regex_pattern": pattern,
                "case_sensitive": cs,
                "regex_should_match": should_match,
            },
            outputs=output,
        )
        # match_v0 does not natively support "should_not_match" inversion;
        # test only the should_match=True cases for direct parity
        if should_match:
            m = first_result(
                [
                    {
                        "key": "regex",
                        "target": "$.outputs",
                        "mode": "text",
                        "match": "regex",
                        "reference": pattern,
                        "case_sensitive": cs,
                    }
                ],
                outputs=output,
            )
            assert legacy["success"] == expected
            assert m["success"] == expected
            assert legacy["success"] == m["success"]  # direct cross-comparison
        else:
            assert legacy["success"] == expected


# ---------------------------------------------------------------------------
# 12. Legacy parity — auto_starts_with
# ---------------------------------------------------------------------------


class TestParityStartsWith:
    CASES = [
        ("Hello World", "Hello", True, True),
        ("Hello World", "World", True, False),
        ("Hello World", "hello", False, True),  # case-insensitive
        ("Hello World", "hello", True, False),  # case-sensitive mismatch
    ]

    @pytest.mark.parametrize("output,prefix,cs,expected", CASES)
    def test_starts_with_parity(self, output, prefix, cs, expected):
        legacy = _starts_with(
            parameters={"prefix": prefix, "case_sensitive": cs},
            outputs=output,
        )
        m = first_result(
            [
                {
                    "key": "starts_with",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "starts_with",
                    "reference": prefix,
                    "case_sensitive": cs,
                }
            ],
            outputs=output,
        )
        assert legacy["success"] == expected
        assert m["success"] == expected
        assert legacy["success"] == m["success"]


# ---------------------------------------------------------------------------
# 13. Legacy parity — auto_ends_with
# ---------------------------------------------------------------------------


class TestParityEndsWith:
    CASES = [
        ("Hello World", "World", True, True),
        ("Hello World", "Hello", True, False),
        ("Hello World", "world", False, True),
        ("Hello World", "world", True, False),
    ]

    @pytest.mark.parametrize("output,suffix,cs,expected", CASES)
    def test_ends_with_parity(self, output, suffix, cs, expected):
        legacy = _ends_with(
            parameters={"suffix": suffix, "case_sensitive": cs},
            outputs=output,
        )
        m = first_result(
            [
                {
                    "key": "ends_with",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "ends_with",
                    "reference": suffix,
                    "case_sensitive": cs,
                }
            ],
            outputs=output,
        )
        assert legacy["success"] == expected
        assert m["success"] == expected
        assert legacy["success"] == m["success"]


# ---------------------------------------------------------------------------
# 14. Legacy parity — auto_contains
# ---------------------------------------------------------------------------


class TestParityContains:
    CASES = [
        ("The quick brown fox", "quick", True, True),
        ("The quick brown fox", "slow", True, False),
        ("The quick brown fox", "QUICK", False, True),
        ("The quick brown fox", "QUICK", True, False),
    ]

    @pytest.mark.parametrize("output,substring,cs,expected", CASES)
    def test_contains_parity(self, output, substring, cs, expected):
        legacy = _contains(
            parameters={"substring": substring, "case_sensitive": cs},
            outputs=output,
        )
        m = first_result(
            [
                {
                    "key": "contains",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "contains",
                    "reference": substring,
                    "case_sensitive": cs,
                }
            ],
            outputs=output,
        )
        assert legacy["success"] == expected
        assert m["success"] == expected
        assert legacy["success"] == m["success"]


# ---------------------------------------------------------------------------
# 15. Legacy parity — auto_contains_any
# ---------------------------------------------------------------------------


class TestParityContainsAny:
    CASES = [
        ("I love apples", ["apple", "banana"], True, True),
        ("I love oranges", ["apple", "banana"], True, False),
        ("I LOVE APPLES", ["apple", "banana"], False, True),
    ]

    @pytest.mark.parametrize("output,substrings,cs,expected", CASES)
    def test_contains_any_parity(self, output, substrings, cs, expected):
        legacy = _contains_any(
            parameters={"substrings": substrings, "case_sensitive": cs},
            outputs=output,
        )
        m = first_result(
            [
                {
                    "key": "contains_any",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "contains",
                    "references": substrings,
                    "contains": "any",
                    "case_sensitive": cs,
                }
            ],
            outputs=output,
        )
        assert legacy["success"] == expected
        assert m["success"] == expected
        assert legacy["success"] == m["success"]


# ---------------------------------------------------------------------------
# 16. Legacy parity — auto_contains_all
# ---------------------------------------------------------------------------


class TestParityContainsAll:
    CASES = [
        ("I love apples and bananas", ["apple", "banana"], True, True),
        ("I only love apples", ["apple", "banana"], True, False),
        ("I LOVE APPLES AND BANANAS", ["apple", "banana"], False, True),
    ]

    @pytest.mark.parametrize("output,substrings,cs,expected", CASES)
    def test_contains_all_parity(self, output, substrings, cs, expected):
        legacy = _contains_all(
            parameters={"substrings": substrings, "case_sensitive": cs},
            outputs=output,
        )
        m = first_result(
            [
                {
                    "key": "contains_all",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "contains",
                    "references": substrings,
                    "contains": "all",
                    "case_sensitive": cs,
                }
            ],
            outputs=output,
        )
        assert legacy["success"] == expected
        assert m["success"] == expected
        assert legacy["success"] == m["success"]


# ---------------------------------------------------------------------------
# 17. Legacy parity — auto_similarity_match (jaccard / SequenceMatcher)
# ---------------------------------------------------------------------------


class TestParitySimilarityMatch:
    CASES = [
        ("hello world", "hello world", 0.8, True),
        ("hello world", "completely different", 0.8, False),
        ("abc", "ABc", True, 0.5),  # case_sensitive=True, threshold=0.5
    ]

    def test_identical_strings(self):
        legacy = _similarity_match(
            parameters={
                "correct_answer_key": "ca",
                "threshold": 0.9,
                "case_sensitive": True,
            },
            inputs={"ca": "hello world"},
            outputs="hello world",
        )
        m = first_result(
            [
                {
                    "key": "sim",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "similarity",
                    "reference": "$.inputs.correct_answer",
                    "similarity": "jaccard",
                    "threshold": 0.9,
                    "case_sensitive": True,
                }
            ],
            inputs={"correct_answer": "hello world"},
            outputs="hello world",
        )
        assert legacy["success"] is True
        assert m["success"] is True
        assert legacy["score"] == pytest.approx(m["score"])

    def test_low_similarity(self):
        legacy = _similarity_match(
            parameters={
                "correct_answer_key": "ca",
                "threshold": 0.8,
                "case_sensitive": True,
            },
            inputs={"ca": "completely different"},
            outputs="hello world",
        )
        m = first_result(
            [
                {
                    "key": "sim",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "similarity",
                    "reference": "completely different",
                    "similarity": "jaccard",
                    "threshold": 0.8,
                    "case_sensitive": True,
                }
            ],
            outputs="hello world",
        )
        assert legacy["success"] is False
        assert m["success"] is False
        assert legacy["score"] == pytest.approx(m["score"])


# ---------------------------------------------------------------------------
# 18. Legacy parity — auto_levenshtein_distance
# ---------------------------------------------------------------------------


class TestParityLevenshtein:
    def test_identical(self):
        legacy = _levenshtein(
            parameters={
                "correct_answer_key": "ca",
                "threshold": 0.8,
                "case_sensitive": True,
            },
            inputs={"ca": "test string"},
            outputs="test string",
        )
        m = first_result(
            [
                {
                    "key": "lev",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "similarity",
                    "reference": "$.inputs.correct_answer",
                    "similarity": "levenshtein",
                    "threshold": 0.8,
                    "case_sensitive": True,
                }
            ],
            inputs={"correct_answer": "test string"},
            outputs="test string",
        )
        assert legacy["success"] is True
        assert m["success"] is True
        assert legacy["score"] == pytest.approx(m["score"])

    def test_one_edit(self):
        legacy = _levenshtein(
            parameters={
                "correct_answer_key": "ca",
                "threshold": 0.5,
                "case_sensitive": True,
            },
            inputs={"ca": "abc"},
            outputs="abx",
        )
        m = first_result(
            [
                {
                    "key": "lev",
                    "target": "$.outputs",
                    "mode": "text",
                    "match": "similarity",
                    "reference": "abc",
                    "similarity": "levenshtein",
                    "threshold": 0.5,
                    "case_sensitive": True,
                }
            ],
            outputs="abx",
        )
        assert legacy["score"] == pytest.approx(m["score"])
        assert legacy["success"] == m["success"]


# ---------------------------------------------------------------------------
# 19. Legacy parity — auto_contains_json
# ---------------------------------------------------------------------------


class TestParityContainsJson:
    def test_valid_json_dict(self):
        legacy = _contains_json(outputs={"key": "value"})
        m = first_result(
            [
                {
                    "key": "contains_json",
                    "target": "$.outputs",
                    "mode": "json",
                    "match": "valid",
                }
            ],
            outputs={"key": "value"},
        )
        assert legacy["success"] is True
        assert m["success"] is True
        assert legacy["success"] == m["success"]

    def test_valid_json_string(self):
        legacy = _contains_json(outputs='{"x": 1}')
        m = first_result(
            [
                {
                    "key": "contains_json",
                    "target": "$.outputs",
                    "mode": "json",
                    "match": "valid",
                }
            ],
            outputs='{"x": 1}',
        )
        assert legacy["success"] is True
        assert m["success"] is True
        assert legacy["success"] == m["success"]

    def test_invalid_json(self):
        legacy = _contains_json(outputs="not json at all")
        m = first_result(
            [
                {
                    "key": "contains_json",
                    "target": "$.outputs",
                    "mode": "json",
                    "match": "valid",
                }
            ],
            outputs="not json at all",
        )
        assert legacy["success"] is False
        assert m["success"] is False
        assert legacy["success"] == m["success"]


# ---------------------------------------------------------------------------
# 20. Legacy parity — auto_json_diff
# ---------------------------------------------------------------------------


class TestParityJsonDiff:
    def test_identical_objects(self):
        obj = {"name": "Alice", "age": 30}
        legacy = _json_diff(
            parameters={
                "correct_answer_key": "ca",
                "threshold": 0.5,
                "compare_schema_only": False,
                "predict_keys": False,
                "case_insensitive_keys": False,
            },
            inputs={"ca": obj},
            outputs=obj,
        )
        m = first_result(
            [
                {
                    "key": "json_diff",
                    "target": "$.outputs",
                    "mode": "json",
                    "match": "diff",
                    "reference": "$.inputs.correct_answer",
                    "threshold": 0.5,
                    "diff": "full",
                    "case_sensitive": True,
                }
            ],
            inputs={"correct_answer": obj},
            outputs=obj,
        )
        assert legacy["success"] is True
        assert m["success"] is True
        assert legacy["score"] == pytest.approx(m["score"])

    def test_partial_match(self):
        reference = {"name": "Alice", "age": 30}
        predicted = {"name": "Alice", "age": 99}
        legacy = _json_diff(
            parameters={
                "correct_answer_key": "ca",
                "threshold": 0.4,
                "compare_schema_only": False,
                "predict_keys": False,
                "case_insensitive_keys": False,
            },
            inputs={"ca": reference},
            outputs=predicted,
        )
        m = first_result(
            [
                {
                    "key": "json_diff",
                    "target": "$.outputs",
                    "mode": "json",
                    "match": "diff",
                    "reference": reference,
                    "threshold": 0.4,
                    "diff": "full",
                    "case_sensitive": True,
                }
            ],
            outputs=predicted,
        )
        assert legacy["score"] == pytest.approx(m["score"])
        assert legacy["success"] == m["success"]

    def test_schema_only_mode(self):
        reference = {"count": 5}
        predicted = {"count": 99}  # same key, same type, different value
        legacy = _json_diff(
            parameters={
                "correct_answer_key": "ca",
                "threshold": 0.9,
                "compare_schema_only": True,
                "predict_keys": False,
                "case_insensitive_keys": False,
            },
            inputs={"ca": reference},
            outputs=predicted,
        )
        m = first_result(
            [
                {
                    "key": "json_diff",
                    "target": "$.outputs",
                    "mode": "json",
                    "match": "diff",
                    "reference": reference,
                    "threshold": 0.9,
                    "diff": "schema",
                    "case_sensitive": True,
                }
            ],
            outputs=predicted,
        )
        assert legacy["success"] is True
        assert m["success"] is True
        assert legacy["score"] == pytest.approx(m["score"])


# ---------------------------------------------------------------------------
# 21. Legacy parity — field_match_test
# ---------------------------------------------------------------------------


class TestParityFieldMatchTest:
    def test_matching_field(self):
        legacy = _field_match(
            parameters={"json_field": "city", "correct_answer_key": "ca"},
            inputs={"ca": "Paris"},
            outputs={"city": "Paris", "country": "France"},
        )
        m = first_result(
            [
                {
                    "key": "field_match",
                    "target": "$.outputs.city",
                    "mode": "text",
                    "match": "exact",
                    "reference": "$.inputs.correct_answer",
                }
            ],
            inputs={"correct_answer": "Paris"},
            outputs={"city": "Paris", "country": "France"},
        )
        assert legacy["success"] is True
        assert m["success"] is True
        assert legacy["success"] == m["success"]

    def test_non_matching_field(self):
        legacy = _field_match(
            parameters={"json_field": "city", "correct_answer_key": "ca"},
            inputs={"ca": "London"},
            outputs={"city": "Paris"},
        )
        m = first_result(
            [
                {
                    "key": "field_match",
                    "target": "$.outputs.city",
                    "mode": "text",
                    "match": "exact",
                    "reference": "London",
                }
            ],
            outputs={"city": "Paris"},
        )
        assert legacy["success"] is False
        assert m["success"] is False
        assert legacy["success"] == m["success"]


# ---------------------------------------------------------------------------
# 22. Legacy parity — json_multi_field_match
# ---------------------------------------------------------------------------


class TestParityJsonMultiFieldMatch:
    def test_all_fields_match(self):
        reference = {"name": "Alice", "city": "Paris"}
        predicted = {"name": "Alice", "city": "Paris"}

        legacy = _json_multi_field(
            parameters={
                "fields": ["name", "city"],
                "correct_answer_key": "ca",
            },
            inputs={"ca": reference},
            outputs=predicted,
        )
        m = first_result(
            [
                {
                    "key": "multi_field",
                    "target": "$.outputs",
                    "mode": "json",
                    "match": "diff",
                    "reference": reference,
                    "threshold": 0.9,
                    "success": "all",
                    "matchers": [
                        {
                            "key": "name",
                            "target": "$.outputs.name",
                            "mode": "text",
                            "match": "exact",
                            "reference": reference["name"],
                        },
                        {
                            "key": "city",
                            "target": "$.outputs.city",
                            "mode": "text",
                            "match": "exact",
                            "reference": reference["city"],
                        },
                    ],
                }
            ],
            outputs=predicted,
        )
        assert legacy["aggregate_score"] == pytest.approx(1.0)
        assert m["success"] is True
        assert all(c["success"] for c in m["children"])
        # Both report full success
        assert (legacy["aggregate_score"] == 1.0) == m["success"]

    def test_partial_fields_match(self):
        reference = {"name": "Alice", "city": "Paris"}
        predicted = {"name": "Alice", "city": "London"}

        legacy = _json_multi_field(
            parameters={
                "fields": ["name", "city"],
                "correct_answer_key": "ca",
            },
            inputs={"ca": reference},
            outputs=predicted,
        )
        m = first_result(
            [
                {
                    "key": "multi_field",
                    "target": "$.outputs",
                    "mode": "json",
                    "match": "diff",
                    "reference": reference,
                    "score": "weighted",
                    "success": "threshold",
                    "threshold": 0.4,
                    "matchers": [
                        {
                            "key": "name",
                            "target": "$.outputs.name",
                            "mode": "text",
                            "match": "exact",
                            "reference": reference["name"],
                        },
                        {
                            "key": "city",
                            "target": "$.outputs.city",
                            "mode": "text",
                            "match": "exact",
                            "reference": reference["city"],
                        },
                    ],
                }
            ],
            outputs=predicted,
        )
        assert legacy["aggregate_score"] == pytest.approx(0.5)
        assert m["score"] == pytest.approx(0.5)
        assert legacy["aggregate_score"] == pytest.approx(m["score"])
