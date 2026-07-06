"""Unit tests for the known-value redaction pass (`agenta.sdk.redaction.Redactor`).

Slice 1 only: exact-match against a seeded deny-set. No shape/entropy assertions here — those
extension points (`_shape_pass` / `_entropy_pass`) are asserted as no-ops.
"""

from __future__ import annotations

import base64

import pytest

from agenta.sdk.redaction import Redactor, metrics, redaction_mode


@pytest.fixture(autouse=True)
def _reset_metrics():
    metrics.reset()
    yield
    metrics.reset()


class TestRedactionMode:
    def test_defaults_to_known(self, monkeypatch):
        monkeypatch.delenv("AGENTA_REDACTION_MODE", raising=False)
        assert redaction_mode() == "known"

    def test_off_is_live(self, monkeypatch):
        monkeypatch.setenv("AGENTA_REDACTION_MODE", "off")
        assert redaction_mode() == "off"

    def test_pattern_and_full_are_inert_and_warn(self, monkeypatch):
        monkeypatch.setenv("AGENTA_REDACTION_MODE", "full")
        with pytest.warns(UserWarning, match="inert"):
            assert redaction_mode() == "known"

    def test_off_disables_the_known_value_pass(self, monkeypatch):
        monkeypatch.setenv("AGENTA_REDACTION_MODE", "off")
        r = Redactor().with_known_secrets(
            ["ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a"]
        )
        assert (
            r.redact_string("ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a")
            == "ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a"
        )


class TestKnownValuePass:
    def test_redacts_exact_match_with_kind_and_last4(self):
        r = Redactor().with_known_secrets(
            ["ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a"]
        )
        out = r.redact_string("leaked: ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a end")
        assert out == "leaked: [ag:redacted:secret:5b4a] end"

    def test_leaves_untouched_string_unchanged(self):
        r = Redactor().with_known_secrets(
            ["ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a"]
        )
        assert r.redact_string("nothing sensitive here") == "nothing sensitive here"

    def test_does_not_redact_a_user_pasted_lookalike_not_in_deny_set(self):
        r = Redactor().with_known_secrets(
            ["ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a"]
        )
        pasted = "sk-user-pasted-this-on-purpose-000"
        assert r.redact_string(pasted) == pasted

    def test_redacts_url_encoded_variant(self):
        r = Redactor().with_known_secrets(["sk live/secret"])
        out = r.redact_string("token=sk%20live%2Fsecret here")
        assert "[ag:redacted:secret:" in out
        assert "sk%20live%2Fsecret" not in out

    def test_redacts_base64_variant(self):
        secret = "ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a"
        encoded = base64.b64encode(secret.encode()).decode()
        r = Redactor().with_known_secrets([secret])
        out = r.redact_string(f"blob={encoded}")
        assert encoded not in out
        assert "[ag:redacted:secret:" in out

    def test_decomposes_dsn_userinfo_password(self):
        r = Redactor().with_known_secrets(
            ["postgres://admin:hunter2pass@db.internal:5432/agenta"]
        )
        out = r.redact_string("connecting with hunter2pass now")
        assert out == "connecting with [ag:redacted:secret:pass] now"

    def test_decomposed_part_uses_word_boundary_not_substring(self):
        # A short/generic decomposed part (username) never registers below the length floor,
        # so it cannot clip into unrelated user content.
        r = Redactor().with_known_secrets(
            ["postgres://user:hunter2pass@db.internal:5432/agenta"]
        )
        pasted = "sk-user-pasted-this-on-purpose-000"
        assert r.redact_string(pasted) == pasted

    def test_redacts_run_credential_header_value(self):
        r = Redactor().with_known_secrets(["ApiKey ag-run-cred-9f8e7d6c5b4a"])
        out = r.redact_string("used ApiKey ag-run-cred-9f8e7d6c5b4a to call back")
        assert "ag-run-cred-9f8e7d6c5b4a" not in out
        assert "[ag:redacted:secret:5b4a]" in out

    def test_redact_json_deep_walks_dicts_lists_and_leaves_keys_alone(self):
        r = Redactor().with_known_secrets(
            ["ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a"]
        )
        payload = {
            "a": ["plain", "ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a"],
            "b": {"c": "ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a"},
            "d": 42,
            "e": None,
        }
        out = r.redact_json(payload)
        assert out["a"] == ["plain", "[ag:redacted:secret:5b4a]"]
        assert out["b"]["c"] == "[ag:redacted:secret:5b4a]"
        assert out["d"] == 42
        assert out["e"] is None

    def test_redact_json_untouched_when_no_secrets_seeded(self):
        r = Redactor()
        payload = {"password": "hunter2", "note": "plain"}
        # No key-based rule in Slice 1: an unseeded value is left untouched even under a
        # credential-shaped key name.
        assert r.redact_json(payload) == payload

    def test_redact_error_strips_stack_and_redacts(self):
        r = Redactor().with_known_secrets(
            ["ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a"]
        )
        err = ValueError(
            'auth failed for ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a\nTraceback (most recent call last):\n  File "x.py", line 1'
        )
        out = r.redact_error(err)
        assert "\n" not in out
        assert "ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a" not in out
        assert "[ag:redacted:secret:5b4a]" in out

    def test_redact_error_none_is_safe(self):
        r = Redactor()
        assert r.redact_error(None) == "agent run failed"

    def test_redact_string_none_passthrough(self):
        r = Redactor()
        assert r.redact_string(None) is None

    def test_multiple_secrets_all_registered(self):
        r = Redactor().with_known_secrets(["secret-one-value", "secret-two-value"])
        out = r.redact_string("has secret-one-value and secret-two-value")
        assert "secret-one-value" not in out
        assert "secret-two-value" not in out

    def test_ignores_falsy_values_in_seed_list(self):
        r = Redactor().with_known_secrets(
            [None, "", "ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a"]
        )
        out = r.redact_string("ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a")
        assert out == "[ag:redacted:secret:5b4a]"

    def test_increments_metric_on_redaction_never_the_value(self):
        r = Redactor().with_known_secrets(
            ["ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a"]
        )
        r.redact_string("ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a", sink="logs")
        snap = metrics.snapshot()
        assert snap.get(("logs", "secret")) == 1
        # The metric carries only sink/kind counts, never the redacted value itself.
        assert "ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a" not in str(snap)

    def test_no_metric_when_nothing_redacted(self):
        r = Redactor().with_known_secrets(
            ["ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a"]
        )
        r.redact_string("clean text", sink="logs")
        assert metrics.snapshot() == {}


class TestFailSafe:
    def test_redact_string_never_raises_and_falls_back_to_placeholder(self):
        r = Redactor().with_known_secrets(
            ["ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a"]
        )

        class Boom(str):
            def __contains__(self, item):
                raise RuntimeError("boom")

        # Force an internal failure path; redact_string must fail-safe, never return raw input.
        broken = Boom("ag-test-fake-secret-DO-NOT-USE-9f8e7d6c5b4a")
        out = r.redact_string(broken)
        assert out == "[ag:redacted]"

    def test_redact_json_never_raises_and_falls_back_to_placeholder(self):
        r = Redactor()

        # A list subclass that blows up mid-walk still yields the fail-safe placeholder shape.
        class BadList(list):
            def __iter__(self):
                raise RuntimeError("boom")

        out = r.redact_json(BadList(["a"]))
        assert out == []

    def test_redact_json_dict_fail_safe_keeps_dict_shape(self):
        r = Redactor()

        # A dict that blows up mid-walk still yields a dict (empty), not a raw dump, so callers
        # that expect Dict[str, Any] (e.g. span attributes) never see a stray string.
        class BadDict(dict):
            def items(self):
                raise RuntimeError("boom")

        out = r.redact_json(BadDict({"a": 1}))
        assert out == {}


class TestSlice2ExtensionPointsAreNoOps:
    def test_shape_pass_is_a_noop(self):
        r = Redactor()
        assert (
            r._shape_pass("sk-anything-not-seeded", sink="test")
            == "sk-anything-not-seeded"
        )

    def test_entropy_pass_is_a_noop(self):
        r = Redactor()
        high_entropy = "aG3x9ZpQ7mN2vT8w"
        assert r._entropy_pass(high_entropy, sink="test") == high_entropy
