"""Tests for the CodeRabbit review follow-ups on the gate checks (#6402).

Each class pins one finding. The theme running through them: a check that turns a real failure
into a green SKIP, or infers a strong claim from missing evidence, is worse than no check — it
spends a reviewer's trust and returns nothing for it.
"""

import importlib
import sys
from pathlib import Path

import pytest


def _mod(monkeypatch, name):
    monkeypatch.setenv("AGENTA_BASE", "http://localhost:9999")
    monkeypatch.setenv("AGENTA_PROJECT_ID", "proj-1")
    monkeypatch.setenv("AGENTA_API_KEY", "test-key")
    monkeypatch.setenv("DAYTONA_API_KEY", "test-daytona-key")
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    for cached in ("qa_matrix_lib", name):
        sys.modules.pop(cached, None)
    return importlib.import_module(name)


class TestNarrowSkipClassification:
    """A transport failure must never become a green SKIP (CodeRabbit, major)."""

    REAL_FAILURES = [
        "ECONNRESET while contacting the credential service",
        "connection error: upstream refused",
        "credential_delivery_failed: the run's credentials did not reach the model",
        "the request timed out after 120s",
        "502 Bad Gateway from the connection broker",
    ]
    VAULT_DIAGNOSTICS = [
        "connection 'x' not found for provider 'anthropic'",
        "multiple connections for provider 'openai'",
        "no connections for provider 'anthropic'",
    ]

    @pytest.mark.parametrize("text", REAL_FAILURES)
    def test_teardown_keeps_a_real_failure(self, monkeypatch, text):
        m = _mod(monkeypatch, "check_secrets_teardown")
        assert m.environment_cause(text) is None, text

    @pytest.mark.parametrize("text", VAULT_DIAGNOSTICS)
    def test_teardown_still_skips_a_real_vault_miss(self, monkeypatch, text):
        m = _mod(monkeypatch, "check_secrets_teardown")
        assert m.environment_cause(text) is not None, text

    def test_a_transport_failure_wins_over_a_vault_phrase_beside_it(self, monkeypatch):
        # The mixed case: a credential word next to a real error must not excuse the error.
        m = _mod(monkeypatch, "check_secrets_teardown")
        assert (
            m.environment_cause(
                "ECONNRESET; also: no connections for provider 'anthropic'"
            )
            is None
        )

    @pytest.mark.parametrize("text", REAL_FAILURES)
    def test_c5_keeps_a_real_failure(self, monkeypatch, text):
        m = _mod(monkeypatch, "matrix_c5_first_call_race")
        assert m.missing_vault_credential(text) is False, text

    @pytest.mark.parametrize("text", VAULT_DIAGNOSTICS)
    def test_c5_still_skips_a_real_vault_miss(self, monkeypatch, text):
        m = _mod(monkeypatch, "matrix_c5_first_call_race")
        assert m.missing_vault_credential(text) is True, text


class TestMixedCauses:
    """SKIP only when EVERY error frame is an environment cause (CodeRabbit, major)."""

    def test_a_credit_frame_does_not_excuse_a_transport_frame(self, monkeypatch):
        m = _mod(monkeypatch, "check_secrets_teardown")
        frames = [
            "Your free Agenta credits are used up.",
            "ECONNRESET talking to the sandbox",
        ]
        unexplained = [e for e in frames if m.environment_cause(e) is None]
        assert unexplained == ["ECONNRESET talking to the sandbox"]

    def test_all_credit_frames_are_still_a_skip(self, monkeypatch):
        m = _mod(monkeypatch, "check_secrets_teardown")
        frames = [
            "Your free Agenta credits are used up.",
            "the model provider account has insufficient credit",
        ]
        assert [e for e in frames if m.environment_cause(e) is None] == []


class TestHttpsGuard:
    """A bearer token must never go over cleartext (CodeRabbit, security)."""

    def test_an_http_base_is_refused_before_any_request(self, monkeypatch):
        m = _mod(monkeypatch, "check_secrets_teardown")
        monkeypatch.setenv("DAYTONA_API_URL", "http://daytona.internal/api")
        with pytest.raises(m.SkipCheck) as e:
            m.daytona_api_url()
        assert "not HTTPS" in str(e.value)

    def test_an_https_base_is_accepted(self, monkeypatch):
        m = _mod(monkeypatch, "check_secrets_teardown")
        monkeypatch.setenv("DAYTONA_API_URL", "https://app.daytona.io/api")
        assert m.daytona_api_url() == "https://app.daytona.io/api"


class TestMalformedPayloadShapes:
    """A malformed page is a SKIP naming the shape, never a stack trace (CodeRabbit, minor)."""

    def test_a_non_object_body_is_a_skip(self, monkeypatch):
        m = _mod(monkeypatch, "check_secrets_teardown")
        for body in (None, [], "nope", 7):
            with pytest.raises(m.SkipCheck):
                m.list_secret_ids_by_name(fetch=lambda cursor, b=body: b)

    def test_an_unhashable_next_cursor_is_a_skip(self, monkeypatch):
        # `cursor in seen_cursors` would raise TypeError on a list, aborting the whole gate.
        m = _mod(monkeypatch, "check_secrets_teardown")
        for bad in ([], {}, 7):
            with pytest.raises(m.SkipCheck):
                m.list_secret_ids_by_name(
                    fetch=lambda cursor, c=bad: {"items": [], "nextCursor": c}
                )


class TestSweepHostParsing:
    """`localhost` as a substring is not a local deployment (CodeRabbit, major)."""

    @pytest.mark.parametrize(
        "base,expected",
        [
            ("http://localhost:8480", True),
            ("http://127.0.0.1:9", True),
            ("localhost:8480", True),
            ("https://runner-localhost.example", False),
            ("https://localhost.attacker.com", False),
            ("https://cloud.agenta.ai", False),
            ("", False),
        ],
    )
    def test_only_a_real_local_host_counts(self, monkeypatch, base, expected):
        monkeypatch.setenv("AGENTA_BASE", base)
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        sys.modules.pop("sweep_disagree", None)
        m = importlib.import_module("sweep_disagree")
        assert m.base_is_local() is expected, base


class TestLedgerAvailability:
    """An unanswered ledger query is not proof that nothing was stored (CodeRabbit, major)."""

    def test_the_library_reports_availability_separately(self, monkeypatch):
        lib = _mod(monkeypatch, "qa_matrix_lib")

        class _Resp:
            status_code = 503

            def json(self):  # pragma: no cover - never reached on a 503
                return {}

        monkeypatch.setattr(lib, "api_call", lambda *a, **k: _Resp())
        rows, available = lib.turn_ledger_or_unavailable("s")
        assert rows == []
        assert available is False
        # The old signature cannot tell the caller which of the two it got.
        assert lib.turn_ledger("s") == []

    def test_an_empty_but_answered_ledger_is_available(self, monkeypatch):
        lib = _mod(monkeypatch, "qa_matrix_lib")

        class _Resp:
            status_code = 200

            def json(self):
                return {"turns": []}

        monkeypatch.setattr(lib, "api_call", lambda *a, **k: _Resp())
        assert lib.turn_ledger_or_unavailable("s") == ([], True)
