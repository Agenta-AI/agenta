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


class TestSettleDeadlineBoundsEachProbe:
    """The deadline must bound the probes themselves, not only the gaps (CodeRabbit, major)."""

    def test_each_probe_gets_the_remaining_budget_as_its_timeout(self, monkeypatch):
        m = _mod(monkeypatch, "check_secrets_teardown")
        seen: list[float] = []

        def fake_get(path, params=None, timeout=30.0):
            seen.append(timeout)

            class _R:
                status_code = 404

            return _R()

        monkeypatch.setattr(m, "_get", fake_get)
        assert m.secret_exists("id-1", timeout=3.0) is False
        assert seen == [3.0]

    def test_a_probe_cannot_be_given_more_than_the_settle_budget(self, monkeypatch):
        # A fixed 30s probe inside a 1s budget could return long after the deadline and let the
        # loop claim a within-budget deletion it never observed within budget.
        m = _mod(monkeypatch, "check_secrets_teardown")
        assert m.INITIAL_PROBE_SECONDS <= 10.0
        assert m.SETTLE_POLL_SECONDS <= 5.0


class TestC5TreatsDeliveryFailureAsReal:
    """A delivery failure is what C5 tests, so it can never excuse a SKIP (CodeRabbit, major)."""

    def test_a_textual_delivery_failure_is_not_a_vault_miss(self, monkeypatch):
        m = _mod(monkeypatch, "matrix_c5_first_call_race")
        for text in [
            "credential_delivery_failed: no connections for provider 'anthropic'",
            "A temporary issue kept this run's credentials from reaching the model.",
        ]:
            assert m.missing_vault_credential(text) is False, text

    def test_the_two_cells_agree_on_what_counts_as_a_real_failure(self, monkeypatch):
        # These lists drifted once already: the teardown check carried the delivery markers and
        # C5 did not, which is exactly how the SKIP hole opened.
        c5 = _mod(monkeypatch, "matrix_c5_first_call_race")
        teardown = _mod(monkeypatch, "check_secrets_teardown")
        assert set(c5.TRANSPORT_FAILURE_MARKERS) == set(
            teardown.TRANSPORT_FAILURE_MARKERS
        )

    def test_a_plain_vault_miss_still_skips(self, monkeypatch):
        m = _mod(monkeypatch, "matrix_c5_first_call_race")
        assert m.missing_vault_credential("no connections for provider 'anthropic'")


class TestLedgerPayloadValidation:
    """A 200 is not an answer until the payload has the promised shape (CodeRabbit, major)."""

    def _lib_returning(self, monkeypatch, payload, status=200):
        lib = _mod(monkeypatch, "qa_matrix_lib")

        class _Resp:
            status_code = status

            def json(self):
                if isinstance(payload, Exception):
                    raise payload
                return payload

        monkeypatch.setattr(lib, "api_call", lambda *a, **k: _Resp())
        return lib

    @pytest.mark.parametrize(
        "payload",
        [
            {},
            {"turns": None},
            {"turns": "nope"},
            {"turns": [1, 2]},
            [],
            "nope",
            None,
            ValueError("not json"),
        ],
    )
    def test_a_malformed_200_is_unavailable(self, monkeypatch, payload):
        # The load-bearing one: `{}` and `{"turns": null}` would otherwise be ([], True), which
        # h1 turns into a PASS asserting nothing was stored.
        lib = self._lib_returning(monkeypatch, payload)
        assert lib.turn_ledger_or_unavailable("s") == ([], False), payload

    def test_a_well_formed_empty_ledger_is_available(self, monkeypatch):
        lib = self._lib_returning(monkeypatch, {"turns": []})
        assert lib.turn_ledger_or_unavailable("s") == ([], True)

    def test_rows_are_returned_when_the_shape_is_right(self, monkeypatch):
        lib = self._lib_returning(monkeypatch, {"turns": [{"sandbox_id": "sb-1"}]})
        rows, available = lib.turn_ledger_or_unavailable("s")
        assert available is True
        assert rows == [{"sandbox_id": "sb-1"}]

    def test_the_back_compat_wrapper_still_returns_a_list(self, monkeypatch):
        lib = self._lib_returning(monkeypatch, {})
        assert lib.turn_ledger("s") == []

    def test_h1_fails_on_a_malformed_200_rather_than_passing(self, monkeypatch):
        # End to end: the seam change is only worth anything if h1 refuses the PASS.
        probe = TestH1Probe()
        d = probe._drive(
            monkeypatch,
            commit_status=422,
            turn=probe.FakeTurn(),
            rows=[],
            available=False,
        )
        assert d["status"] == "FAIL"
        assert "did not answer" in d["why"]


class TestSweepIPv6Hosts:
    """The base parser must not crash, and must not mangle IPv6 (CodeRabbit, two minors)."""

    def _host(self, monkeypatch, base):
        monkeypatch.setenv("AGENTA_BASE", base)
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        sys.modules.pop("sweep_disagree", None)
        return importlib.import_module("sweep_disagree")

    def test_a_malformed_bracketed_ipv6_does_not_crash(self, monkeypatch):
        # `urlparse("http://[::1").hostname` raises ValueError; this helper decides whether the
        # sweep runs at all, so a crash here takes the check down before it can even SKIP.
        m = self._host(monkeypatch, "http://[::1")
        assert m.base_is_local() is False
        assert m.base_host() == ""

    @pytest.mark.parametrize(
        "base,expected",
        [
            ("http://[::1]:8480", True),
            ("http://[::1]", True),
            ("[::1]:8480", True),
            ("[::1]", True),
            ("::1", True),
            ("http://localhost:8480", True),
            ("localhost:8480", True),
            ("https://runner-localhost.example", False),
            ("http://[2001:db8::1]:8480", False),
            ("2001:db8::1", False),
            ("", False),
        ],
    )
    def test_ipv6_and_named_hosts_classify_correctly(self, monkeypatch, base, expected):
        m = self._host(monkeypatch, base)
        assert m.base_is_local() is expected, f"{base} -> {m.base_host()!r}"


class TestAbsenceObservedAfterTheDeadline:
    """An absence first SEEN after the budget is not an in-budget deletion (CodeRabbit, major).

    The first probe carries a floor so it can complete at all, which means on a short budget it
    can itself finish after the deadline. Without timestamping the observation, that floor quietly
    reopened the deadline hole the polling fix had just closed: a slow 404 came back, the loop saw
    an empty leftover, and the cell reported `deleted within 0s` — a number nobody measured.
    """

    RUN_SECRET = "agenta_" + "a" * 36 + "_0"

    def _drive(self, monkeypatch, *, settle, probe_seconds, present=False):
        m = _mod(monkeypatch, "check_secrets_teardown")

        clock = {"now": 0.0}
        monkeypatch.setattr(m.time, "monotonic", lambda: clock["now"])
        monkeypatch.setattr(
            m.time, "sleep", lambda s: clock.__setitem__("now", clock["now"] + s)
        )

        def slow_secret_exists(secret_id, timeout=30.0):
            # Every probe costs wall-clock time, which is the whole point: a probe is not free
            # and can outlast the budget it was meant to respect.
            clock["now"] += probe_seconds
            return present

        monkeypatch.setattr(m, "secret_exists", slow_secret_exists)

        inventories = [{}, {self.RUN_SECRET: "id-1"}]
        monkeypatch.setattr(
            m, "list_secret_ids_by_name", lambda *a, **k: inventories.pop(0)
        )
        monkeypatch.setattr(m, "create_workflow", lambda *a, **k: ("wf-1", "var-1"))
        monkeypatch.setattr(m, "seed_and_baseline", lambda *a, **k: ("rev-1", 1))
        monkeypatch.setattr(m, "refs", lambda *a, **k: {})
        monkeypatch.setattr(m, "archive", lambda *a, **k: None)

        class _Turn:
            errors: list = []

        monkeypatch.setattr(m, "invoke", lambda *a, **k: _Turn())
        return m

    def test_settle_zero_with_a_slow_404_does_not_pass(self, monkeypatch):
        # CodeRabbit's exact regression: the Secret IS gone, but the read that proved it landed
        # 2s into a 0s budget.
        m = self._drive(monkeypatch, settle=0, probe_seconds=2.0)
        with pytest.raises(m.SkipCheck) as e:
            m.secrets_teardown(0)
        why = str(e.value)
        assert "AFTER the 0s settle budget" in why
        assert "unproven" in why
        # And it says plainly that nothing leaked, so a reader does not chase a leak that is not
        # there: this is a measurement gap, not a violated invariant.
        assert "No Secret outlived its run" in why

    def test_a_short_probe_inside_a_real_budget_still_passes(self, monkeypatch):
        # The positive control. Without it, "never PASS" would satisfy the test above.
        m = self._drive(monkeypatch, settle=60, probe_seconds=2.0)
        r = m.secrets_teardown(60)
        assert r["status"] == "PASS", r["why"]
        assert "deleted within 60s" in r["why"]

    def test_a_secret_that_really_survives_still_fails(self, monkeypatch):
        # The distinction that matters: an unproven-but-clean run is a SKIP, a genuine leftover is
        # a FAIL. Conflating them either way would break the check.
        m = self._drive(monkeypatch, settle=1, probe_seconds=2.0, present=True)
        r = m.secrets_teardown(1)
        assert r["status"] == "FAIL", r
        assert self.RUN_SECRET in r["leftover_secret_names"]


class TestRowPresenceIsTheEvidence:
    """A stored row refutes PASS even when its harness_kind is unset (CodeRabbit, major).

    `stored_harnesses` keeps only truthy values, so a row with a missing, null or empty
    `harness_kind` collapsed to `[]` and the probe reached PASS with a turn demonstrably
    persisted. Same class as the ledger-availability finding: an absent FIELD was read as an
    absent THING.
    """

    @pytest.mark.parametrize(
        "row",
        [
            {"harness_kind": None},
            {"harness_kind": ""},
            {},
            {"sandbox_id": "sb-1"},
        ],
    )
    def test_a_row_without_a_usable_kind_still_fails(self, monkeypatch, row):
        probe = TestH1Probe()
        d = probe._drive(
            monkeypatch,
            commit_status=422,
            turn=probe.FakeTurn(),
            rows=[row],
            available=True,
        )
        assert d["status"] == "FAIL", d["why"]
        assert "stored_turn_rows=1" in d["why"]

    def test_such_a_row_is_not_labelled_sf2(self, monkeypatch):
        # SF2 is specifically the silent pi_core default. An unset stored kind proves a turn ran
        # but not what it ran AS, so it must read as new breakage rather than the filed finding.
        probe = TestH1Probe()
        d = probe._drive(
            monkeypatch,
            commit_status=422,
            turn=probe.FakeTurn(),
            rows=[{"harness_kind": None}],
            available=True,
            harness={"kind": None},
        )
        assert d["status"] == "FAIL"
        assert "known_finding" not in d
        assert "SF2" not in d["why"]

    def test_output_with_no_stored_kind_is_not_labelled_sf2_either(self, monkeypatch):
        # A cleared harness that visibly ran but stored no kind: still a FAIL, still unlabelled.
        probe = TestH1Probe()
        d = probe._drive(
            monkeypatch,
            commit_status=200,
            turn=probe.FakeTurn(reply="READY"),
            rows=[],
            available=True,
            harness={"kind": None},
        )
        assert d["status"] == "FAIL"
        assert "known_finding" not in d

    def test_an_empty_answered_ledger_with_no_output_still_passes(self, monkeypatch):
        # The positive control: row presence is the evidence, so NO rows must still allow a PASS.
        probe = TestH1Probe()
        d = probe._drive(
            monkeypatch,
            commit_status=422,
            turn=probe.FakeTurn(),
            rows=[],
            available=True,
        )
        assert d["status"] == "PASS", d["why"]
