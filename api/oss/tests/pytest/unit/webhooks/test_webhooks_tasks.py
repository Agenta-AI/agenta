"""Unit tests for webhook task helpers.

Pure logic, no network or database involved.
"""

from unittest.mock import patch

from oss.src.tasks.taskiq.webhooks.tasks import (
    MAX_RESOLVE_DEPTH,
    NON_OVERRIDABLE_HEADERS,
    _merge_headers,
    resolve_payload_fields,
)
from oss.src.core.webhooks.types import (
    EVENT_CONTEXT_FIELDS,
    SUBSCRIPTION_CONTEXT_FIELDS,
)

_MOCK_CONTEXT = {
    "event": {
        "event_id": "abc123",
        "event_type": "environments.revisions.committed",
        "timestamp": "2024-01-01T00:00:00Z",
        "created_at": "2024-01-01T00:00:00Z",
        "attributes": {"env": "production"},
    },
    "subscription": {
        "id": "sub-1",
        "name": "My Webhook",
        "flags": {"is_valid": True},
        "tags": [],
        "meta": {},
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z",
    },
    "scope": {"project_id": "proj-1"},
}

_RESOLVE_PATH = "oss.src.tasks.taskiq.webhooks.tasks.resolve_json_selector"


# ---------------------------------------------------------------------------
# resolve_payload_fields
# ---------------------------------------------------------------------------


class TestResolvePayloadFields:
    def test_dict_recurses_into_values(self):
        with patch(_RESOLVE_PATH, side_effect=lambda expr, ctx: f"resolved:{expr}"):
            result = resolve_payload_fields(
                {"key": "$.event.event_id"},
                _MOCK_CONTEXT,
            )
        assert result == {"key": "resolved:$.event.event_id"}

    def test_list_recurses_into_items(self):
        with patch(_RESOLVE_PATH, side_effect=lambda expr, ctx: f"resolved:{expr}"):
            result = resolve_payload_fields(
                ["$.event.event_id", "$.scope.project_id"],
                _MOCK_CONTEXT,
            )
        assert result == [
            "resolved:$.event.event_id",
            "resolved:$.scope.project_id",
        ]

    def test_primitive_delegates_to_resolve_json_selector(self):
        with patch(_RESOLVE_PATH, return_value="abc123") as mock_resolve:
            result = resolve_payload_fields("$.event.event_id", _MOCK_CONTEXT)
        assert result == "abc123"
        mock_resolve.assert_called_once_with("$.event.event_id", _MOCK_CONTEXT)

    def test_depth_exceeds_limit_returns_none(self):
        result = resolve_payload_fields(
            "$.event.event_id",
            _MOCK_CONTEXT,
            _depth=MAX_RESOLVE_DEPTH + 1,
        )
        assert result is None

    def test_depth_at_limit_still_resolves(self):
        with patch(_RESOLVE_PATH, return_value="ok"):
            result = resolve_payload_fields(
                "$.event.event_id",
                _MOCK_CONTEXT,
                _depth=MAX_RESOLVE_DEPTH,
            )
        assert result == "ok"

    def test_resolve_error_returns_none(self):
        with patch(_RESOLVE_PATH, side_effect=ValueError("bad selector")):
            result = resolve_payload_fields("$.bad[", _MOCK_CONTEXT)
        assert result is None

    def test_error_leaf_in_dict_does_not_affect_other_keys(self):
        def side_effect(expr, ctx):
            if "bad" in expr:
                raise ValueError("bad selector")
            return "good"

        with patch(_RESOLVE_PATH, side_effect=side_effect):
            result = resolve_payload_fields(
                {"ok": "$.event.event_id", "bad": "$.bad["},
                _MOCK_CONTEXT,
            )
        assert result == {"ok": "good", "bad": None}

    def test_dollar_selector_resolves_full_context(self):
        with patch(_RESOLVE_PATH, return_value=_MOCK_CONTEXT) as mock_resolve:
            result = resolve_payload_fields("$", _MOCK_CONTEXT)
        assert result == _MOCK_CONTEXT
        mock_resolve.assert_called_once_with("$", _MOCK_CONTEXT)

    def test_nested_dict_depth_tracking(self):
        # Three levels deep should still work (depth starts at 0)
        with patch(_RESOLVE_PATH, return_value="leaf"):
            result = resolve_payload_fields(
                {"a": {"b": {"c": "$.event.event_id"}}},
                _MOCK_CONTEXT,
            )
        assert result == {"a": {"b": {"c": "leaf"}}}


# ---------------------------------------------------------------------------
# NON_OVERRIDABLE_HEADERS
# ---------------------------------------------------------------------------


class TestNonOverridableHeaders:
    def test_all_entries_are_lowercase(self):
        for h in NON_OVERRIDABLE_HEADERS:
            assert h == h.lower(), f"Header {h!r} must be lowercase"

    def test_required_system_headers_are_protected(self):
        for required in (
            "content-type",
            "content-length",
            "host",
            "user-agent",
            "x-agenta-event-type",
            "x-agenta-delivery-id",
            "x-agenta-event-id",
            "x-agenta-signature",
            "idempotency-key",
            "authorization",
        ):
            assert required in NON_OVERRIDABLE_HEADERS, (
                f"{required!r} must be non-overridable"
            )


# ---------------------------------------------------------------------------
# _merge_headers
# ---------------------------------------------------------------------------


class TestMergeHeaders:
    def test_user_headers_are_included(self):
        result = _merge_headers(
            user_headers={"X-Custom-Token": "tok123"},
            system_headers={"Content-Type": "application/json"},
        )
        assert result["X-Custom-Token"] == "tok123"
        assert result["Content-Type"] == "application/json"

    def test_system_headers_win_over_user_headers(self):
        result = _merge_headers(
            user_headers={"Content-Type": "text/plain"},
            system_headers={"Content-Type": "application/json"},
        )
        assert result["Content-Type"] == "application/json"

    def test_non_overridable_user_headers_are_dropped(self):
        result = _merge_headers(
            user_headers={
                "Authorization": "Bearer token",
                "X-Agenta-Signature": "fake",
                "Idempotency-Key": "client-key",
                "X-Agenta-Event-Id": "fake-event-id",
                "X-Custom": "kept",
            },
            system_headers={},
        )
        assert "Authorization" not in result
        assert "X-Agenta-Signature" not in result
        assert "Idempotency-Key" not in result
        assert "X-Agenta-Event-Id" not in result
        assert result["X-Custom"] == "kept"

    def test_none_user_headers_treated_as_empty(self):
        result = _merge_headers(
            user_headers=None,
            system_headers={"Content-Type": "application/json"},
        )
        assert result == {"Content-Type": "application/json"}


# ---------------------------------------------------------------------------
# EVENT_CONTEXT_FIELDS / SUBSCRIPTION_CONTEXT_FIELDS allowlists
# ---------------------------------------------------------------------------


class TestContextAllowlists:
    def test_event_context_fields_contains_expected_keys(self):
        for key in ("event_id", "event_type", "timestamp", "created_at", "attributes"):
            assert key in EVENT_CONTEXT_FIELDS, (
                f"{key!r} must be in EVENT_CONTEXT_FIELDS"
            )

    def test_subscription_context_fields_contains_expected_keys(self):
        for key in ("id", "name", "flags", "tags", "meta", "created_at", "updated_at"):
            assert key in SUBSCRIPTION_CONTEXT_FIELDS, (
                f"{key!r} must be in SUBSCRIPTION_CONTEXT_FIELDS"
            )

    def test_event_allowlist_excludes_secret_fields(self):
        assert "secret" not in EVENT_CONTEXT_FIELDS
        assert "secret_id" not in EVENT_CONTEXT_FIELDS

    def test_subscription_allowlist_excludes_data_and_secrets(self):
        # subscription.data (URL, headers) and secrets must never leak into context
        assert "data" not in SUBSCRIPTION_CONTEXT_FIELDS
        assert "secret" not in SUBSCRIPTION_CONTEXT_FIELDS
        assert "secret_id" not in SUBSCRIPTION_CONTEXT_FIELDS
