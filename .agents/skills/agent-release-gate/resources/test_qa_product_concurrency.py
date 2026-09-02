# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""Offline tests for the `burst` and `crosstalk` journeys. No deployment, no network.

Run either way:

    uv run test_qa_product_concurrency.py     # standalone, prints a line per case
    uv run --no-sync pytest test_qa_product_concurrency.py

Every case fakes the wire. `invoke` is replaced with a function that builds a `Turn` by hand, so
the tests pin the JOURNEY's reasoning: what it calls a failure, what it refuses to call a pass,
and what it does when a stream never ends. The one thing they cannot check is whether the product
works, which is what the live gate is for.
"""

import importlib
import os
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent

CELL = {"harness": "pi_core", "sandbox": "daytona", "model": "m", "provider": "openai"}


def _qa():
    os.environ.setdefault("AGENTA_BASE", "https://qa.example")
    os.environ.setdefault("AGENTA_PROJECT_ID", "proj-1")
    os.environ.setdefault("AGENTA_API_KEY", "test-key")
    sys.path.insert(0, str(HERE))
    return importlib.import_module("qa_product")


qa = _qa()
# The real functions, so a case that replaced one cannot leak into the next.
_REAL_INVOKE = qa.invoke
_REAL_LEDGER_IDS = qa._ledger_ids


def _reset():
    """Small, fast defaults so a test never waits on a real bound."""
    qa.invoke = _REAL_INVOKE
    qa._ledger_ids = _REAL_LEDGER_IDS
    qa.BURST_SIZE = 3
    qa.CROSSTALK_CONVERSATIONS = 2
    qa.CROSSTALK_APPROVALS = 0
    qa.CONCURRENCY_EVERYWHERE = False
    qa.CONCURRENCY_TURN_TIMEOUT_SECONDS = 30.0
    qa.CONCURRENCY_WAIT_MARGIN_SECONDS = 5.0
    qa.LEDGER_POLL_SECONDS = 0.0
    qa.LEDGER_SETTLE_SECONDS = 0.0
    qa._ledger_ids = lambda session: (["agent-1"], ["sandbox-1"])


def _turn(reply="", deltas=40, code=None, finish="stop", hung=False):
    t = qa.Turn()
    t.http_status, t.ms = 200, 12
    t.finish_reason = finish
    t.frames = ["start"] + ["text-delta"] * deltas + ["finish"]
    t.text = [reply]
    if code:
        t.error_codes.append(code)
        t.error_texts.append("model authentication failed: 401 unauthorized")
        t.errors.append('{"type": "error"}')
        t.finish_reason = "error"
    if hung:
        t.hung = True
        t.hung_reason = qa.HUNG_AT_DEADLINE
        t.finish_reason = None
    return t


def _nonce_of(messages):
    text = messages[-1]["parts"][0]["text"]
    tokens = [w for w in text.replace("\n", " ").split() if w.startswith("QA-")]
    return tokens[-1] if tokens else ""


def _long(nonce, lines=150):
    return "\n".join(str(n) for n in range(1, lines + 1)) + "\n" + nonce


def _healthy(session, messages, params, timeout=300.0, deadline=None):
    return _turn(_long(_nonce_of(messages)))


# ---------------------------------------------------------------------------


def test_burst_passes_when_every_cold_start_answers():
    _reset()
    qa.invoke = _healthy
    r = qa.j_burst(CELL)
    assert r["pass"], r
    assert r["total"] == 3 and len(r["runs"]) == 3
    assert all(run["session_id"] for run in r["runs"]), r["runs"]
    # A pass states its own sampling power rather than implying the fault is gone.
    assert "probabilistic" in r["why"], r["why"]


def test_burst_names_the_credential_code_and_fails():
    _reset()
    state = {"n": 0}

    def flaky(session, messages, params, timeout=300.0, deadline=None):
        state["n"] += 1
        if state["n"] == 2:
            return _turn(code="credential_delivery_failed")
        return _healthy(session, messages, params)

    qa.invoke = flaky
    r = qa.j_burst(CELL)
    assert not r["pass"]
    assert "CREDENTIAL DELIVERY FAILED" in r["why"], r["why"]
    assert "credential_delivery_failed" in r["error_codes"]
    assert any(run["error_code"] == "credential_delivery_failed" for run in r["runs"])


def test_burst_fails_on_a_turn_that_only_errored():
    """An error-only turn has no reply, no stop reason and no nonce. It is never a pass."""
    _reset()
    qa.invoke = lambda s, m, p, timeout=300.0, deadline=None: _turn(
        code="runner_error", finish="error"
    )
    r = qa.j_burst(CELL)
    assert not r["pass"] and r["failed"] == 3, r
    assert all(run["ok"] is False for run in r["runs"])
    assert "AUTHENTICATION" in r["why"], r["why"]


def test_burst_fails_on_nonce_bleed():
    _reset()
    seen = {}

    def bleeding(session, messages, params, timeout=300.0, deadline=None):
        t = _healthy(session, messages, params)
        seen.setdefault("first", _nonce_of(messages))
        t.text = [t.reply + "\n" + seen["first"]]
        return t

    qa.invoke = bleeding
    r = qa.j_burst(CELL)
    assert not r["pass"] and r["nonce_bleed"], r


def test_a_stream_that_never_ends_is_abandoned_not_followed():
    """The MUST from the review: a job that never returns must not hold the journey open.

    The fake `invoke` here ignores its deadline entirely and blocks forever, which is the worst
    case (a real stream that keeps emitting bytes never trips an HTTPX read timeout either). The
    journey has to come back on its own, mark the runs hung, and fail.
    """
    _reset()
    qa.BURST_SIZE = 2
    qa.CONCURRENCY_TURN_TIMEOUT_SECONDS = 1.0
    qa.CONCURRENCY_WAIT_MARGIN_SECONDS = 1.0
    release = threading.Event()

    def never_ends(session, messages, params, timeout=300.0, deadline=None):
        release.wait(120)
        return _turn("too late")

    qa.invoke = never_ends
    started = time.monotonic()
    r = qa.j_burst(CELL)
    took = time.monotonic() - started
    release.set()
    assert not r["pass"], r
    assert took < 10, f"the journey waited {took:.1f}s for a job that never returns"
    assert all(run.get("hung") for run in r["runs"]), r["runs"]
    assert all(run.get("session_id") for run in r["runs"]), (
        "a hung run still names its session"
    )
    assert all(run.get("phase") == "turn" for run in r["runs"]), r["runs"]
    assert "Abandoned at the deadline" in r["why"], r["why"]


def test_invoke_marks_a_turn_hung_at_its_deadline():
    """The same guarantee one level down, on the real `invoke` with a fake HTTPX stream."""
    _reset()

    class _Response:
        status_code = 200

        def __init__(self):
            self.closed = False

        def iter_lines(self):
            while True:
                yield 'data: {"type": "text-delta", "delta": "x"}'
                time.sleep(0.01)

        def close(self):
            self.closed = True

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    class _Client:
        def __init__(self, timeout=None):
            self.response = _Response()

        def stream(self, *a, **k):
            return self.response

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    real_client = qa.httpx.Client
    qa.httpx.Client = _Client
    try:
        t = qa.invoke(
            "s", [qa.user_msg("hi")], {}, timeout=30.0, deadline=time.monotonic() + 0.3
        )
    finally:
        qa.httpx.Client = real_client
    assert t.hung and t.hung_reason == qa.HUNG_AT_DEADLINE, (t.hung, t.hung_reason)
    assert t.summary()["hung"] is True


def test_crosstalk_requires_the_long_reply_it_asked_for():
    _reset()
    qa.invoke = lambda s, m, p, timeout=300.0, deadline=None: _turn(
        _nonce_of(m), deltas=40
    )
    r = qa.j_crosstalk(CELL)
    assert not r["pass"] and r["too_short"], r
    assert "below the size the prompt asked for" in r["why"], r["why"]


def test_crosstalk_nonce_exclusivity_covers_the_other_turn_of_the_same_conversation():
    _reset()
    qa.CROSSTALK_CONVERSATIONS = 1
    first = {}

    def echo_both(session, messages, params, timeout=300.0, deadline=None):
        nonce = _nonce_of(messages)
        first.setdefault("a", nonce)
        # Turn 2 repeats turn 1's nonce. Same session, so a per-session check would miss it.
        return _turn(_long(nonce) + "\n" + first["a"])

    qa.invoke = echo_both
    r = qa.j_crosstalk(CELL)
    assert not r["pass"] and r["nonce_bleed"], r


def test_crosstalk_records_warm_reuse_without_failing_on_it():
    """A rebuilt sandbox is evidence here, never a verdict: the preflight rebuilds on purpose."""
    _reset()
    qa.invoke = _healthy
    qa._ledger_ids = lambda session: (["agent-1"], ["sandbox-1", "sandbox-2"])
    r = qa.j_crosstalk(CELL)
    assert r["pass"], r
    warm = r["runs"][0]["warm_reuse"]
    assert warm["ids_stable"] is False and warm["sandbox_ids"] == [
        "sandbox-1",
        "sandbox-2",
    ]
    assert "not_warm" not in r


def test_crosstalk_records_a_one_row_ledger_as_stable_and_still_passes():
    _reset()
    qa.invoke = _healthy
    qa._ledger_ids = lambda session: (["agent-1"], ["sandbox-1"])
    r = qa.j_crosstalk(CELL)
    assert r["pass"], r
    assert r["runs"][0]["warm_reuse"]["ids_stable"] is True


def test_crosstalk_records_an_empty_ledger_without_failing():
    _reset()
    qa.invoke = _healthy
    qa._ledger_ids = lambda session: ([], [])
    r = qa.j_crosstalk(CELL)
    assert r["pass"], r
    warm = r["runs"][0]["warm_reuse"]
    assert warm["ledger_rows_seen"] is False and warm["ids_stable"] is False


def test_each_approval_flow_proves_its_own_output():
    """Approval isolation: every flow carries its own nonce and must not see another's."""
    _reset()
    qa.CROSSTALK_CONVERSATIONS = 0
    qa.CROSSTALK_APPROVALS = 2
    flows: dict = {}

    def gated(session, messages, params, timeout=300.0, deadline=None):
        text = messages[0]["parts"][0]["text"]
        nonce = [w for w in text.split() if w.startswith("QA-XTAP")][0]
        if session not in flows:  # turn 1: park the gate
            flows[session] = nonce
            t = _turn(finish="other", deltas=0)
            t.tool_calls = [
                {"toolCallId": f"c-{nonce}", "toolName": "Bash", "input": {"c": nonce}}
            ]
            t._segments = [{"kind": "tool", "id": f"c-{nonce}"}]
            t.approval = {"approvalId": f"a-{nonce}", "toolCallId": f"c-{nonce}"}
            return t
        t = _turn(nonce, deltas=3)  # turn 2: the approved command ran
        t.tool_calls = [
            {"toolCallId": f"c-{nonce}", "toolName": "Bash", "input": {"c": nonce}}
        ]
        t.tool_outcomes = {f"c-{nonce}": "available"}
        t.tool_payloads = {f"c-{nonce}": {"output": nonce}}
        return t

    qa.invoke = gated
    r = qa.j_crosstalk(CELL)
    assert r["pass"], r
    records = [run for run in r["runs"] if run["kind"] == "approval"]
    assert len(records) == 2
    for run in records:
        assert run["own_nonce_in_output"] is True and not run["other_nonces_in_output"]
        assert run["nonce_checked"] is True
        assert run["turn_paused"] and run["turn_resumed"], "both turns are persisted"
        assert run["started_s"] is not None and run["ended_s"] is not None

    # Now make one flow echo the OTHER flow's nonce, from the same journey run. The first flow
    # to arrive publishes its nonce; the second one appends it, which is a foreign nonce in its
    # output and must fail the journey.
    flows.clear()
    real = qa.invoke
    published: dict = {}

    def leaky(session, messages, params, timeout=300.0, deadline=None):
        text = messages[0]["parts"][0]["text"]
        nonce = [w for w in text.split() if w.startswith("QA-XTAP")][0]
        published.setdefault("first", nonce)
        t = real(session, messages, params, timeout, deadline)
        for payload in t.tool_payloads.values():
            payload["output"] = f"{payload['output']} {published['first']}"
        return t

    qa.invoke = leaky
    r = qa.j_crosstalk(CELL)
    assert not r["pass"] and r["nonce_bleed"], r


def test_a_capacity_refusal_is_a_skip_not_a_verdict():
    _reset()

    def out_of_disk(session, messages, params, timeout=300.0, deadline=None):
        t = qa.Turn()
        t.http_status = 200
        t.errors.append("sandbox create failed: Total disk limit exceeded")
        return t

    qa.invoke = out_of_disk
    r = qa.j_burst(CELL)
    assert r.get("skip") and "ENVIRONMENT, NOT THE PRODUCT" in r["why"], r
    assert "pass" not in r


def test_an_internal_rate_limit_is_still_a_failure():
    """The capacity SKIP must never swallow `rate_limited`: that is a real finding."""
    _reset()
    qa.invoke = lambda s, m, p, timeout=300.0, deadline=None: _turn(code="rate_limited")
    r = qa.j_burst(CELL)
    assert not r.get("skip") and r["pass"] is False, r
    assert "rate_limited" in r["error_codes"]


def test_results_carry_no_key_material():
    _reset()

    def leaks_a_key(session, messages, params, timeout=300.0, deadline=None):
        t = qa.Turn()
        t.http_status = 200
        t.errors.append(
            "401 from the provider: Incorrect API key provided: "
            "sk-proj-3M1PW0OPU17zAxPi4wTT33ec5L3Tqfq"
        )
        return t

    qa.invoke = leaks_a_key
    r = qa.j_burst(CELL)
    blob = str(r)
    assert "sk-<redacted>" in blob, blob[:300]
    assert "sk-proj-3M1PW" not in blob


def test_local_cells_skip_unless_asked():
    _reset()
    qa.invoke = _healthy
    local = dict(CELL, sandbox="local")
    assert qa.j_burst(local).get("skip") and qa.j_crosstalk(local).get("skip")
    qa.CONCURRENCY_EVERYWHERE = True
    assert not qa.j_burst(local).get("skip")


def test_a_runner_path_change_makes_the_journeys_mandatory():
    """Trigger + --only: naming the cell is not enough, the journey has to be forced too."""
    sys.path.insert(0, str(HERE))
    triggers = importlib.import_module("path_triggers")
    paths = ["services/runner/src/engines/sandbox_agent/daytona-secrets.ts"]
    cells = triggers.mandatory_cells(paths)
    journeys = triggers.mandatory_journeys(paths)
    assert set(cells) >= {"C2", "C4", "X2"}, cells
    assert set(journeys) == {"burst", "crosstalk"}, journeys
    assert journeys["burst"] == paths
    # The provider path fires the same rule.
    assert set(
        triggers.mandatory_journeys(
            ["services/runner/src/providers/daytona-credential-delivery.ts"]
        )
    ) == {"burst", "crosstalk"}
    # An unrelated change forces nothing.
    assert triggers.mandatory_journeys(["web/oss/src/app/page.tsx"]) == {}


def test_the_driver_forces_a_mandatory_journey_past_only(tmp_path=None):
    """End to end through main(), with every journey stubbed out."""
    import json
    import tempfile

    _reset()
    ran: list = []
    real_journeys = dict(qa.JOURNEYS)
    qa.JOURNEYS.update(
        {
            name: (
                lambda cell, name=name: (ran.append(name), {"pass": True, "why": name})[
                    1
                ]
            )
            for name in ("chat", "burst", "crosstalk")
        }
    )
    outdir = tempfile.mkdtemp()
    argv = sys.argv
    runs_dir = qa.RUNS
    sys.argv = [
        "qa_product.py",
        "--cell",
        "C4",
        "--only",
        "chat",
        "--changed-path",
        "services/runner/src/engines/sandbox_agent/daytona-secrets.ts",
    ]
    qa.RUNS = Path(outdir)
    try:
        qa.main()
    finally:
        sys.argv = argv
        qa.RUNS = runs_dir
        qa.JOURNEYS.clear()
        qa.JOURNEYS.update(real_journeys)
    assert set(ran) >= {"chat", "burst", "crosstalk"}, ran
    written = sorted(Path(outdir).glob("*/mandatory-journeys.json"))
    assert written, "the run records which journeys a rule forced"
    assert set(json.loads(written[0].read_text())) == {"burst", "crosstalk"}


def test_counts_are_capped():
    argv = sys.argv
    sys.argv = ["qa_product.py", "--cell", "C4", "--burst-size", "99"]
    try:
        qa.main()
        raise AssertionError("a 99-run burst must be refused")
    except SystemExit as e:
        assert "capped at 32" in str(e), e
    finally:
        sys.argv = argv


def main() -> int:
    cases = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for case in cases:
        case()
        print(f"PASS {case.__name__}")
    print(f"\n{len(cases)} offline cases passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
