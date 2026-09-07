# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27", "pytest>=8"]
# ///
"""Offline tests for the `burst` and `crosstalk` journeys. No deployment, no network.

Run either way:

    uv run test_qa_product_concurrency.py     # standalone, runs through pytest
    uv run --no-sync pytest test_qa_product_concurrency.py

Every case fakes the wire. `invoke` is replaced with a function that builds a `Turn` by hand, so
the tests pin the JOURNEY's reasoning: what it calls a failure, what it refuses to call a pass,
and what it does when a stream never ends. The one thing they cannot check is whether the product
works, which is what the live gate is for.
"""

import gzip
import importlib
import json
import os
import sys
import threading
import time
from pathlib import Path

import pytest

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
    """The same guarantee one level down: a well-formed stream that simply never ends."""
    _reset()
    response = _RawResponse([b'data: {"type": "text-delta", "delta": "x"}\n'])
    real = qa.httpx.Client
    qa.httpx.Client = _fake_httpx(response)
    try:
        t = qa.invoke(
            "s", [qa.user_msg("hi")], {}, timeout=30.0, deadline=time.monotonic() + 0.3
        )
    finally:
        qa.httpx.Client = real
    assert t.hung and t.hung_reason == qa.HUNG_AT_DEADLINE, (t.hung, t.hung_reason)
    assert t.summary()["hung"] is True
    assert t.frames, "the frames it did receive are kept"
    assert response.closed


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


def _session_control_result(status="PASS"):
    import session_control

    return {
        "cells": {
            name: {
                "verdict": {
                    "pass": status == "PASS",
                    "skip": status == "SKIP",
                    "why": status.lower(),
                }
            }
            for name in session_control.CELLS
        }
    }


def test_session_control_result_consumer_accepts_a_complete_pass(tmp_path):
    path = tmp_path / "results.json"
    path.write_text(json.dumps(_session_control_result()))

    result = qa._load_session_control_result(str(path))

    assert result["status"] == "PASS"
    assert result["failed"] == []
    assert result["skipped"] == []


def test_session_control_result_consumer_carries_a_failure(tmp_path):
    payload = _session_control_result()
    payload["cells"]["stop-warm"]["verdict"] = {
        "pass": False,
        "skip": False,
        "why": "regression",
    }
    path = tmp_path / "results.json"
    path.write_text(json.dumps(payload))

    result = qa._load_session_control_result(str(path))

    assert result["status"] == "FAIL"
    assert result["failed"] == ["stop-warm"]


def test_session_control_result_consumer_marks_skips_incomplete(tmp_path):
    path = tmp_path / "results.json"
    path.write_text(json.dumps(_session_control_result("SKIP")))

    result = qa._load_session_control_result(str(path))

    assert result["status"] == "INCOMPLETE"
    assert result["skipped"]
    label = qa._session_control_result_label(result)
    assert "SKIPPED, UNTESTED" in label
    assert result["skipped"][0] in label


def test_session_control_result_consumer_rejects_an_incomplete_run(tmp_path):
    payload = _session_control_result()
    del payload["cells"]["stop-warm"]
    path = tmp_path / "results.json"
    path.write_text(json.dumps(payload))

    with pytest.raises(SystemExit, match="missing cells: stop-warm"):
        qa._load_session_control_result(str(path))


def test_driver_requires_mandatory_session_control_results(monkeypatch):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "qa_product.py",
            "--cell",
            "C3",
            "--only",
            "chat",
            "--changed-path",
            "api/oss/src/core/sessions/service.py",
        ],
    )

    with pytest.raises(SystemExit, match="session_control.py mandatory"):
        qa.main()


def test_driver_fails_for_a_failed_session_control_result(monkeypatch, tmp_path):
    payload = _session_control_result()
    payload["cells"]["stop-warm"]["verdict"] = {
        "pass": False,
        "skip": False,
        "why": "regression",
    }
    result_path = tmp_path / "session-control-results.json"
    result_path.write_text(json.dumps(payload))
    monkeypatch.setattr(qa, "RUNS", tmp_path / "runs")
    monkeypatch.setitem(qa.JOURNEYS, "chat", lambda _cell: {"pass": True, "why": "ok"})
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "qa_product.py",
            "--cell",
            "C3",
            "--only",
            "chat",
            "--changed-path",
            "api/oss/src/core/sessions/service.py",
            "--session-control-results",
            str(result_path),
        ],
    )

    assert qa.main() == 1


def test_driver_fails_for_a_skipped_session_control_result(monkeypatch, tmp_path):
    result_path = tmp_path / "session-control-results.json"
    result_path.write_text(json.dumps(_session_control_result("SKIP")))
    monkeypatch.setattr(qa, "RUNS", tmp_path / "runs")
    monkeypatch.setitem(qa.JOURNEYS, "chat", lambda _cell: {"pass": True, "why": "ok"})
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "qa_product.py",
            "--cell",
            "C3",
            "--only",
            "chat",
            "--changed-path",
            "api/oss/src/core/sessions/service.py",
            "--session-control-results",
            str(result_path),
        ],
    )

    assert qa.main() == 1


def test_the_driver_forces_a_mandatory_journey_past_only(tmp_path=None):
    """End to end through main(), with every journey stubbed out."""
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
    session_control_results = Path(outdir) / "session-control-results.json"
    session_control_results.write_text(json.dumps(_session_control_result()))
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
        "--session-control-results",
        str(session_control_results),
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


def _fake_httpx(response):
    """A stand-in httpx.Client whose stream() returns `response` and records that it was asked."""

    class _Client:
        def __init__(self, timeout=None):
            self.timeout = timeout
            response.timeout = timeout

        def stream(self, *a, **k):
            response.stream_started = True
            # Request setup is not free. A fake that returns instantly cannot show what happens
            # when connecting and sending have already spent the turn's budget.
            time.sleep(response.setup_sleep)
            return response

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    return _Client


def _gunzip(chunk: bytes) -> bytes:
    """Decode a chunk the way HTTPX would, so the fake models the real contract."""
    if chunk[:2] == b"\x1f\x8b":
        return gzip.decompress(chunk)
    return chunk


class _RawResponse:
    """A streaming response whose chunks, status and setup cost the test controls."""

    def __init__(
        self,
        chunks,
        sleep=0.01,
        raise_timeout=False,
        repeat=True,
        setup_sleep=0.0,
        status_code=200,
    ):
        self._chunks = chunks
        self._sleep = sleep
        self._raise_timeout = raise_timeout
        self._repeat = repeat
        self.setup_sleep = setup_sleep
        self.status_code = status_code
        self.closed = False
        self.timeout = None
        self.stream_started = False
        self.reads = 0
        self.body_reads = 0

    def read(self):
        """The error-body read. Counted, so a test can prove it never happened."""
        self.body_reads += 1
        return b"upstream said no"

    def _emit(self, chunks):
        self.reads += 1
        if self._raise_timeout:
            time.sleep(self._sleep)
            raise qa.httpx.ReadTimeout("read timed out")
        while True:
            for chunk in chunks:
                yield chunk
                time.sleep(self._sleep)
            if not self._repeat:
                return

    def iter_bytes(self):
        """What HTTPX yields AFTER decoding Content-Encoding. This is what the driver reads."""
        return self._emit([_gunzip(c) for c in self._chunks])

    def iter_raw(self):
        """The bytes exactly as they arrived. Compressed, when the server gzipped them."""
        return self._emit(self._chunks)

    def close(self):
        self.closed = True

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_a_stream_without_newlines_still_hits_the_deadline():
    """`iter_lines()` only yields on a newline, so the check has to sit on raw chunks."""
    _reset()
    response = _RawResponse([b"data: {partial without any newline"])
    real = qa.httpx.Client
    qa.httpx.Client = _fake_httpx(response)
    try:
        started = time.monotonic()
        t = qa.invoke(
            "s", [qa.user_msg("hi")], {}, timeout=30.0, deadline=time.monotonic() + 0.3
        )
        took = time.monotonic() - started
    finally:
        qa.httpx.Client = real
    assert t.hung and t.hung_reason == qa.HUNG_AT_DEADLINE, (t.hung, t.hung_reason)
    assert took < 5, f"a newline-free stream held the turn for {took:.1f}s"
    assert response.closed, "the abandoned response is closed, not left open"


def test_a_deadline_with_milliseconds_left_never_starts_the_request():
    """The floor is HTTPX's minimum positive timeout, not a grant of 50ms."""
    _reset()
    response = _RawResponse([b'data: {"type": "finish", "finishReason": "stop"}\n'])
    real = qa.httpx.Client
    qa.httpx.Client = _fake_httpx(response)
    try:
        started = time.monotonic()
        t = qa.invoke(
            "s",
            [qa.user_msg("hi")],
            {},
            timeout=30.0,
            deadline=time.monotonic() + 0.005,
        )
        took = time.monotonic() - started
    finally:
        qa.httpx.Client = real
    assert t.hung and t.hung_reason == qa.HUNG_AT_DEADLINE, t.summary()
    assert response.stream_started is False, (
        "an unaffordable request was started anyway"
    )
    assert took < qa.DEADLINE_FLOOR_SECONDS, f"returned after {took * 1000:.0f}ms"


def test_a_gzip_encoded_stream_is_decoded_and_parsed():
    """`iter_raw()` would hand over compressed bytes: zero frames, no finish, no error."""
    _reset()
    body = (
        b'data: {"type": "text-delta", "delta": "hello"}\n'
        b'data: {"type": "finish", "finishReason": "stop"}\n'
    )
    response = _RawResponse([gzip.compress(body)], sleep=0.0, repeat=False)
    real = qa.httpx.Client
    qa.httpx.Client = _fake_httpx(response)
    try:
        t = qa.invoke("s", [qa.user_msg("hi")], {}, timeout=30.0)
    finally:
        qa.httpx.Client = real
    assert t.reply == "hello", t.summary()
    assert t.finish_reason == "stop", t.summary()
    assert not t.hung


def test_setup_that_eats_the_budget_means_no_read_is_started():
    """The deadline passes between the request starting and the first read."""
    _reset()
    response = _RawResponse(
        [b'data: {"type": "finish", "finishReason": "stop"}\n'], setup_sleep=0.25
    )
    real = qa.httpx.Client
    qa.httpx.Client = _fake_httpx(response)
    try:
        t = qa.invoke(
            "s", [qa.user_msg("hi")], {}, timeout=30.0, deadline=time.monotonic() + 0.15
        )
    finally:
        qa.httpx.Client = real
    assert response.stream_started is True, (
        "the request itself was affordable when it began"
    )
    assert t.hung and t.hung_reason == qa.HUNG_AT_DEADLINE, t.summary()
    assert response.reads == 0, "a read was started with no time left to pay for it"
    assert t.frames == [], t.frames


def test_an_error_body_is_not_read_past_the_deadline():
    """`r.read()` is a read like any other and needs the same check in front of it."""
    _reset()
    response = _RawResponse([], setup_sleep=0.25, status_code=500)
    real = qa.httpx.Client
    qa.httpx.Client = _fake_httpx(response)
    try:
        t = qa.invoke(
            "s", [qa.user_msg("hi")], {}, timeout=30.0, deadline=time.monotonic() + 0.15
        )
    finally:
        qa.httpx.Client = real
    assert t.http_status == 500
    assert t.hung and t.hung_reason == qa.HUNG_AT_DEADLINE, t.summary()
    assert response.body_reads == 0, "the error body was read with no time left"
    assert response.closed


def test_an_error_body_is_still_read_when_there_is_time():
    _reset()
    response = _RawResponse([], status_code=503)
    real = qa.httpx.Client
    qa.httpx.Client = _fake_httpx(response)
    try:
        t = qa.invoke("s", [qa.user_msg("hi")], {}, timeout=30.0)
    finally:
        qa.httpx.Client = real
    assert t.http_status == 503 and response.body_reads == 1
    assert not t.hung and "HTTP 503" in t.errors[0], t.errors


def test_a_silent_read_past_the_deadline_is_hung_not_a_crash():
    """No bytes at all: HTTPX raises its read timeout, and that IS the deadline."""
    _reset()
    response = _RawResponse([], sleep=0.05, raise_timeout=True)
    real = qa.httpx.Client
    qa.httpx.Client = _fake_httpx(response)
    try:
        t = qa.invoke(
            "s", [qa.user_msg("hi")], {}, timeout=30.0, deadline=time.monotonic() + 0.2
        )
    finally:
        qa.httpx.Client = real
    assert t.hung and t.hung_reason == qa.HUNG_AT_DEADLINE, t.summary()
    # The client was never granted the configured 30s: only the time that was left.
    assert response.timeout is not None and response.timeout <= 0.3, response.timeout


def test_a_read_timeout_without_a_deadline_still_raises():
    """No deadline means the caller asked for the old behaviour, and gets it."""
    _reset()
    response = _RawResponse([], sleep=0.0, raise_timeout=True)
    real = qa.httpx.Client
    qa.httpx.Client = _fake_httpx(response)
    try:
        qa.invoke("s", [qa.user_msg("hi")], {}, timeout=1.0)
        raise AssertionError("a read timeout with no deadline must propagate")
    except qa.httpx.ReadTimeout:
        pass
    finally:
        qa.httpx.Client = real


def test_a_capacity_refusal_beside_a_product_failure_is_a_failure():
    """The MUST: one out-of-disk run must never excuse a real fault in the same journey."""
    _reset()
    qa.BURST_SIZE = 2
    state = {"n": 0}

    def mixed(session, messages, params, timeout=300.0, deadline=None):
        state["n"] += 1
        t = qa.Turn()
        t.http_status = 200
        if state["n"] == 1:
            t.errors.append("sandbox create failed: Total disk limit exceeded")
        else:
            return _turn(code="rate_limited")
        return t

    qa.invoke = mixed
    r = qa.j_burst(CELL)
    assert not r.get("skip"), "a product failure was hidden behind a capacity refusal"
    assert r["pass"] is False
    assert r["product_failures"] == 1 and len(r["capacity_refusals"]) == 1, r
    assert "capacity refusal" in r["why"] and "product failure" in r["why"], r["why"]


def test_a_hung_approval_fails():
    _reset()
    qa.CROSSTALK_CONVERSATIONS = 0
    qa.CROSSTALK_APPROVALS = 1
    seen: dict = {}

    def gated_then_hung(session, messages, params, timeout=300.0, deadline=None):
        if session not in seen:  # turn 1 parks the gate
            seen[session] = True
            t = _turn(finish="other", deltas=0)
            t.tool_calls = [{"toolCallId": "c1", "toolName": "Bash", "input": {}}]
            t._segments = [{"kind": "tool", "id": "c1"}]
            t.approval = {"approvalId": "a1", "toolCallId": "c1"}
            return t
        t = _turn(deltas=1, hung=True)  # the resume was abandoned at the deadline
        t.tool_calls = [{"toolCallId": "c1", "toolName": "Bash", "input": {}}]
        t.tool_outcomes = {"c1": "available"}
        return t

    qa.invoke = gated_then_hung
    r = qa.j_crosstalk(CELL)
    assert not r["pass"], r
    record = r["runs"][0]
    assert record["hung"] is True and record["ok"] is False, record


def _deny_flow(resumed_finish="stop", code=None):
    """A correct DENY on the wire, with the resumed turn shaped by the arguments."""
    seen: dict = {}

    def flow(session, messages, params, timeout=300.0, deadline=None):
        if session not in seen:
            seen[session] = True
            t = _turn(finish="other", deltas=0)
            t.tool_calls = [{"toolCallId": "c1", "toolName": "Bash", "input": {}}]
            t._segments = [{"kind": "tool", "id": "c1"}]
            t.approval = {"approvalId": "a1", "toolCallId": "c1"}
            return t
        t = _turn(deltas=1, finish=resumed_finish, code=code)
        t.finish_reason = resumed_finish
        t.tool_calls = [{"toolCallId": "c1", "toolName": "Bash", "input": {}}]
        t.tool_outcomes = {"c1": "denied"}
        return t

    return flow


def test_deny_passes_when_the_resume_ends_cleanly():
    _reset()
    qa.invoke = _deny_flow()
    r = qa.j4_deny(CELL)
    assert r["pass"], r


def test_deny_fails_when_the_resume_did_not_end():
    """Tightened verdict: a correct denied outcome is not enough if the turn never stopped."""
    _reset()
    qa.invoke = _deny_flow(resumed_finish="other")
    r = qa.j4_deny(CELL)
    assert not r["pass"], r
    assert "resumed finish=stop: False" in r["why"], r["why"]


def test_deny_fails_on_a_coded_error_in_the_resume():
    _reset()
    qa.invoke = _deny_flow(code="credential_delivery_failed")
    r = qa.j4_deny(CELL)
    assert not r["pass"], r
    assert "no coded error and neither turn hung: False" in r["why"], r["why"]


def test_the_written_results_file_carries_no_key_material():
    """Redaction at the persistence boundary: a key hidden deep inside a turn summary."""
    import tempfile

    _reset()
    planted = "sk-proj-3M1PW0OPU17zAxPi4wTT33ec5L3Tqfq"
    real_journeys = dict(qa.JOURNEYS)
    qa.JOURNEYS["chat"] = lambda cell: {
        "pass": True,
        "why": "ok",
        "turn": {
            "reply": "fine",
            "errors": [f"401: Incorrect API key provided: {planted}"],
            "nested": [{"deep": {"body": planted}}],
        },
    }
    outdir = tempfile.mkdtemp()
    argv, runs_dir = sys.argv, qa.RUNS
    sys.argv = ["qa_product.py", "--cell", "C4", "--only", "chat"]
    qa.RUNS = Path(outdir)
    try:
        qa.main()
    finally:
        sys.argv, qa.RUNS = argv, runs_dir
        qa.JOURNEYS.clear()
        qa.JOURNEYS.update(real_journeys)
    written = sorted(Path(outdir).glob("*/results.json"))[0].read_text()
    assert planted not in written, "a planted key survived into results.json"
    assert written.count("sk-<redacted>") == 2, written[:400]


def test_the_total_crosstalk_count_is_capped_not_each_half():
    argv = sys.argv
    sys.argv = [
        "qa_product.py",
        "--cell",
        "C4",
        "--crosstalk-conversations",
        "20",
        "--crosstalk-approvals",
        "20",
    ]
    try:
        qa.main()
        raise AssertionError("40 concurrent crosstalk jobs must be refused")
    except SystemExit as e:
        assert "capped at 32 concurrent runs" in str(e), e
    finally:
        sys.argv = argv


def test_a_hung_run_still_reports_when_it_started_and_stopped():
    _reset()
    qa.BURST_SIZE = 2
    qa.CONCURRENCY_TURN_TIMEOUT_SECONDS = 1.0
    qa.CONCURRENCY_WAIT_MARGIN_SECONDS = 1.0
    release = threading.Event()

    def never_ends(session, messages, params, timeout=300.0, deadline=None):
        release.wait(120)
        return _turn("too late")

    qa.invoke = never_ends
    r = qa.j_burst(CELL)
    release.set()
    for run in r["runs"]:
        assert run["started_s"] is not None and run["ended_s"] is not None, run
        assert run["ended_s"] >= run["started_s"], run


def main() -> int:
    return pytest.main([__file__, "-q"])


if __name__ == "__main__":
    raise SystemExit(main())
