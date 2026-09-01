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


class TestH1Probe:
    """`probe`'s two new decisions, driven through the five outcomes verified by hand.

    Lifted from the cross-reviewer's driver. The decisions under test are (a) execution evidence
    outranks a later refusal, and (b) an unanswered ledger cannot support a PASS that asserts
    nothing was stored. Both were correct but untested, which is how the first version of this
    rule shipped with a hole in it.
    """

    ERROR_FRAME = [
        {
            "type": "data-agent-error",
            "data": {
                "code": "agent_run_failed",
                "errorText": "harness kind is invalid",
            },
        }
    ]

    class FakeTurn:
        def __init__(self, reply="", raw=None, errors=None):
            self.reply = reply
            self.frames = [f.get("type", "") for f in (raw or [])]
            self.raw_frames = raw or []
            self.tool_calls = []
            self.errors = errors or []

    def _drive(
        self,
        monkeypatch,
        *,
        commit_status,
        turn,
        rows,
        available,
        harness=None,
    ):
        import types

        h1 = _mod(monkeypatch, "matrix_h1_bad_harness")
        monkeypatch.setattr(
            h1,
            "commit_direct",
            lambda *a, **k: types.SimpleNamespace(
                status_code=commit_status,
                text='{"detail":{"code":"invalid_harness_kind","message":"invalid harness.kind"}}',
            ),
        )
        monkeypatch.setattr(h1, "invoke", lambda *a, **k: turn)
        monkeypatch.setattr(
            h1, "turn_ledger_or_unavailable", lambda *a, **k: (rows, available)
        )
        monkeypatch.setattr(h1.time, "sleep", lambda *a: None)
        return h1.probe("wf", "var", {}, "case", harness or {"kind": 12345})

    def test_1_commit_refusal_with_nothing_stored_passes(self, monkeypatch):
        d = self._drive(
            monkeypatch,
            commit_status=422,
            turn=self.FakeTurn(),
            rows=[],
            available=True,
        )
        assert d["status"] == "PASS", d["why"]
        assert d["refused_by"] == "commit_api"

    def test_2_runner_stream_error_with_nothing_stored_passes(self, monkeypatch):
        d = self._drive(
            monkeypatch,
            commit_status=200,
            turn=self.FakeTurn(raw=self.ERROR_FRAME, errors=["harness kind bad"]),
            rows=[],
            available=True,
        )
        assert d["status"] == "PASS", d["why"]
        assert d["refused_by"] == "runner_stream"

    def test_3_output_plus_a_streamed_error_fails(self, monkeypatch):
        # THE BUG THIS RULE FIXES. The old condition required `not error_text`, so a streamed
        # refusal arriving after the turn had already spoken let a defaulted run pass.
        d = self._drive(
            monkeypatch,
            commit_status=200,
            turn=self.FakeTurn(
                reply="READY", raw=self.ERROR_FRAME, errors=["harness kind bad"]
            ),
            rows=[],
            available=True,
        )
        assert d["status"] == "FAIL", d["why"]
        assert "RAN" in d["why"]

    def test_4_stored_harness_kind_with_no_output_fails(self, monkeypatch):
        # The same evidence read from the other side: the row proves a turn was persisted under a
        # real harness even though the stream said nothing.
        d = self._drive(
            monkeypatch,
            commit_status=200,
            turn=self.FakeTurn(raw=self.ERROR_FRAME, errors=["e"]),
            rows=[{"harness_kind": "pi_core"}],
            available=True,
        )
        assert d["status"] == "FAIL", d["why"]
        assert "pi_core" in d["why"]

    def test_5_unanswered_ledger_with_a_refusal_present_fails(self, monkeypatch):
        # A refusal alone is not enough: this PASS asserts nothing was stored, and a query that
        # never answered cannot support that.
        d = self._drive(
            monkeypatch,
            commit_status=422,
            turn=self.FakeTurn(),
            rows=[],
            available=False,
        )
        assert d["status"] == "FAIL", d["why"]
        assert "did not answer" in d["why"]


class TestSF2IsNamedNotSoftened:
    """The cleared-harness FAIL is real, and it is the filed finding SF2 (W5 handling)."""

    def test_the_cleared_harness_fail_names_sf2(self, monkeypatch):
        probe = TestH1Probe()
        d = probe._drive(
            monkeypatch,
            commit_status=200,
            turn=probe.FakeTurn(reply="READY"),
            rows=[{"harness_kind": "pi_core"}],
            available=True,
            harness={"kind": None},
        )
        # Still a FAIL. The invariant really is broken; only the reader's context improves.
        assert d["status"] == "FAIL"
        assert d["known_finding"] == "SF2"
        assert "silently defaults to pi_core" in d["why"]
        assert "filed for the next release" in d["why"]

    def test_a_wrong_type_harness_that_runs_is_not_sf2(self, monkeypatch):
        # A different, UNFILED defect must read as new breakage, not borrow SF2's excuse.
        probe = TestH1Probe()
        d = probe._drive(
            monkeypatch,
            commit_status=200,
            turn=probe.FakeTurn(reply="READY"),
            rows=[{"harness_kind": "pi_core"}],
            available=True,
            harness={"kind": 12345},
        )
        assert d["status"] == "FAIL"
        assert "known_finding" not in d
        assert "SF2" not in d["why"]

    def test_a_cleared_harness_defaulting_elsewhere_is_not_sf2(self, monkeypatch):
        # SF2 is specifically the pi_core default. A cleared harness running as claude would be a
        # different finding and must not be filed under this one.
        probe = TestH1Probe()
        d = probe._drive(
            monkeypatch,
            commit_status=200,
            turn=probe.FakeTurn(reply="READY"),
            rows=[{"harness_kind": "claude"}],
            available=True,
            harness={"kind": None},
        )
        assert d["status"] == "FAIL"
        assert "known_finding" not in d
