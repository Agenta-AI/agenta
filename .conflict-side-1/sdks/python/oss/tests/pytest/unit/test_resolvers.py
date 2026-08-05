"""Unit tests for the shared selector-resolution helpers.

Pure logic, no network or database. These live in ``agenta.sdk.utils.resolvers``
so API-side code (webhook delivery, trigger dispatch) can reuse them; this suite
gives the SDK home its own coverage instead of relying on the api-side callers.
"""

from agenta.sdk.utils.resolvers import (
    MAX_RESOLVE_DEPTH,
    detect_scheme,
    resolve_dot_notation,
    resolve_json_selector,
    resolve_target_fields,
)

_CONTEXT = {
    "event": {
        "data": {"issue": {"number": 7}},
        "type": "github.issue.opened",
        "timestamp": "2024-01-01T00:00:00Z",
    },
    "subscription": {"id": "sub-1", "name": "watch"},
    "scope": {"project_id": "proj-1"},
}


class TestDetectScheme:
    def test_json_path(self):
        assert detect_scheme("$.event.type") == "json-path"

    def test_json_pointer(self):
        assert detect_scheme("/event/type") == "json-pointer"

    def test_dot_notation(self):
        assert detect_scheme("event.type") == "dot-notation"


class TestResolveJsonSelector:
    def test_json_path_leaf(self):
        assert resolve_json_selector("$.event.type", _CONTEXT) == "github.issue.opened"

    def test_json_pointer_leaf(self):
        assert resolve_json_selector("/scope/project_id", _CONTEXT) == "proj-1"

    def test_nested_path(self):
        assert resolve_json_selector("$.event.data.issue.number", _CONTEXT) == 7

    def test_plain_string_returned_literally(self):
        assert resolve_json_selector("just a string", _CONTEXT) == "just a string"

    def test_non_string_returned_literally(self):
        assert resolve_json_selector(42, _CONTEXT) == 42

    def test_missing_path_returns_none(self):
        assert resolve_json_selector("$.event.nope", _CONTEXT) is None

    def test_malformed_path_returns_none(self):
        assert resolve_json_selector("$.bad[", _CONTEXT) is None


class TestResolveDotNotation:
    def test_literal_key_with_dots(self):
        assert resolve_dot_notation("a.b", {"a.b": "literal"}) == "literal"

    def test_nested_traversal(self):
        assert resolve_dot_notation("a.b", {"a": {"b": "nested"}}) == "nested"

    def test_empty_expr_raises_keyerror(self):
        try:
            resolve_dot_notation("", {})
            assert False, "expected KeyError"
        except KeyError:
            pass

    def test_bracket_syntax_raises_valueerror(self):
        try:
            resolve_dot_notation("a[0]", {"a": [1]})
            assert False, "expected ValueError"
        except ValueError:
            pass


class TestResolveTargetFields:
    def test_whole_context_passthrough(self):
        assert resolve_target_fields("$", _CONTEXT) == _CONTEXT

    def test_dict_template_resolves_each_leaf(self):
        template = {"number": "$.event.data.issue.number", "kind": "$.event.type"}
        assert resolve_target_fields(template, _CONTEXT) == {
            "number": 7,
            "kind": "github.issue.opened",
        }

    def test_list_template_resolves_each_item(self):
        assert resolve_target_fields(["$.scope.project_id", "literal"], _CONTEXT) == [
            "proj-1",
            "literal",
        ]

    def test_nested_structure(self):
        template = {"outer": {"inner": ["$.subscription.id"]}}
        assert resolve_target_fields(template, _CONTEXT) == {
            "outer": {"inner": ["sub-1"]}
        }

    def test_missing_leaf_becomes_none_without_dropping_siblings(self):
        template = {"ok": "$.event.type", "miss": "$.event.nope"}
        assert resolve_target_fields(template, _CONTEXT) == {
            "ok": "github.issue.opened",
            "miss": None,
        }

    def test_depth_over_limit_returns_none(self):
        assert (
            resolve_target_fields(
                "$.event.type", _CONTEXT, _depth=MAX_RESOLVE_DEPTH + 1
            )
            is None
        )

    def test_depth_at_limit_still_resolves(self):
        assert (
            resolve_target_fields("$.event.type", _CONTEXT, _depth=MAX_RESOLVE_DEPTH)
            == "github.issue.opened"
        )
