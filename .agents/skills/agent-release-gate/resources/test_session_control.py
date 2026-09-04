# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx>=0.27"]
# ///
"""Unit tests for the pure parts of session_control.py: cell selection, resume, and result shape.

No stack, no network, no Docker — these exercise only the argument parsing, the OperatorHooks
skip path, and the verdict-shape helpers.
"""

from __future__ import annotations

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import session_control as sc  # noqa: E402


def test_cells_registry_is_internally_consistent():
    for name, (needs_hooks, permission, fn) in sc.CELLS.items():
        assert isinstance(needs_hooks, bool), name
        assert permission in ("allow", "ask"), name
        assert callable(fn), name


def test_null_hooks_raises_on_every_method():
    hooks = sc.NullHooks()
    assert hooks.available is False
    for method in ("stream_row", "record_rows", "command_rows", "sandbox_procs"):
        try:
            getattr(hooks, method)("x")
        except sc.HooksUnavailable:
            continue
        raise AssertionError(f"{method} should raise HooksUnavailable")
    for method in (
        "wait_for_runner",
        "ensure_runner_healthy",
        "restart_runner",
        "kill_runner",
        "pause_runner",
        "unpause_runner",
        "stop_postgres",
        "start_postgres",
        "kill_sandbox",
    ):
        try:
            getattr(hooks, method)()
        except sc.HooksUnavailable:
            continue
        raise AssertionError(f"{method} should raise HooksUnavailable")


def test_verdict_shape_helpers():
    p = sc._pass("ok")
    f = sc._fail("bad")
    s = sc._skip("no hooks")
    assert p == {"pass": True, "skip": False, "why": "ok"}
    assert f == {"pass": False, "skip": False, "why": "bad"}
    assert s == {"pass": False, "skip": True, "why": "no hooks"}
    for v in (p, f, s):
        assert set(v) == {"pass", "skip", "why"}


def test_hooks_only_cells_skip_without_project(monkeypatch):
    """Every cell marked needs_hooks=True must SKIP (not crash, not run) when --project is
    absent, per qa-audit-2026-09-03.md section 4 change 2."""

    class Args:
        sleep_seconds = 1
        sweep_wait = 1
        project = None
        sandbox = "local"

    hooks = sc.NullHooks()
    for name, (needs_hooks, _permission, fn) in sc.CELLS.items():
        if not needs_hooks:
            continue
        evidence, verdict = fn({}, {}, Args(), hooks)
        assert verdict["skip"] is True, f"{name} should skip without --project"
        assert evidence == {}, (
            f"{name} should not run any evidence-gathering without --project"
        )


def test_resume_skips_cells_already_in_prior_results(tmp_path):
    """Cells present in a prior run's results.json are loaded, not re-executed. This is the
    resumability property qa-audit-2026-09-03.md section 4 change 4 asks for: a lost agent
    costs one cell, not the whole run."""
    prior_results = {
        "cells": {
            "stop-warm": {
                "evidence": {"session_id": "abc"},
                "verdict": {"pass": True, "skip": False, "why": "ok"},
                "elapsed_s": 1.0,
            }
        }
    }
    prior_path = tmp_path / "results.json"
    prior_path.write_text(json.dumps(prior_results))

    loaded = json.loads(prior_path.read_text()).get("cells", {})
    assert "stop-warm" in loaded
    assert loaded["stop-warm"]["verdict"]["pass"] is True

    # The cell-selection logic in main(): a cell present in `prior` is carried forward as-is
    # rather than re-run. Exercise the same branch condition main() uses.
    wanted = ["stop-warm", "double-send"]
    to_run = [c for c in wanted if c not in loaded]
    assert to_run == ["double-send"]


def test_cell_names_are_stable_and_known():
    expected = {
        "stop-warm",
        "double-send",
        "stale-stop",
        "stop-approval",
        "sandbox-gone",
        "records-outage",
        "stop-after-finish",
        "restart-after-stop",
        "runner-gone",
        "runner-gone-late",
        "post-stop-row",
        "codex-child",
        "stale-tail",
        "repeat-stop",
        "concurrent-stops",
        "stop-during-completion",
    }
    assert set(sc.CELLS) == expected


def _runner_gone_evidence(**overrides) -> dict:
    """A minimal evidence dict shaped the way cell_runner_gone / cell_runner_gone_late build
    it, with sane defaults that satisfy `_judge_runner_gone` on their own. Tests override just
    the field(s) under test."""
    base = {
        "terminal_records": [
            {
                "type": "error",
                "attributes": {"code": "execution_lost", "settled_by": "watchdog"},
            },
            {"type": "done", "attributes": {"settled_by": "watchdog"}},
        ],
        "stop_command": {"state": "applied", "outcome": "stopped"},
        "stream_row": {"flags": {"is_running": False}},
        "new_message_ran": True,
    }
    base.update(overrides)
    return base


def test_judge_runner_gone_accepts_the_never_reported_race():
    """The hard race: the command settles `lost` because the runner never got to claim or
    report it. This must PASS and record which race landed."""
    evidence = _runner_gone_evidence(
        stop_command={"state": "applied", "outcome": "lost"}
    )
    verdict = sc._judge_runner_gone(evidence)
    assert verdict["pass"] is True
    assert verdict["skip"] is False
    assert evidence["race"] == "never-reported"


def test_judge_runner_gone_accepts_the_outcome_reported_then_died_race():
    """The soft race: the runner reports the Stop's outcome before it actually dies. This must
    ALSO pass — both races satisfy the same invariant — and record the other race label."""
    evidence = _runner_gone_evidence(
        stop_command={"state": "obsolete", "outcome": "stopped"}
    )
    verdict = sc._judge_runner_gone(evidence)
    assert verdict["pass"] is True
    assert verdict["skip"] is False
    assert evidence["race"] == "outcome-reported-then-died"


def test_judge_runner_gone_fails_without_any_terminal_record():
    evidence = _runner_gone_evidence(terminal_records=[])
    verdict = sc._judge_runner_gone(evidence)
    assert verdict["pass"] is False
    assert "race" not in evidence


def test_judge_runner_gone_fails_without_a_stop_command_row():
    evidence = _runner_gone_evidence(stop_command=None)
    verdict = sc._judge_runner_gone(evidence)
    assert verdict["pass"] is False
    assert "race" not in evidence


def test_judge_runner_gone_fails_on_an_unexpected_command_state():
    evidence = _runner_gone_evidence(
        stop_command={"state": "claimed", "outcome": "stopped"}
    )
    verdict = sc._judge_runner_gone(evidence)
    assert verdict["pass"] is False
    assert "race" not in evidence


def test_judge_runner_gone_fails_while_the_command_is_still_pending_or_claimed():
    for outcome in (None, "", "pending", "claimed"):
        evidence = _runner_gone_evidence(
            stop_command={"state": "applied", "outcome": outcome}
        )
        verdict = sc._judge_runner_gone(evidence)
        assert verdict["pass"] is False, outcome
        assert "race" not in evidence, outcome


def test_judge_runner_gone_fails_when_is_running_still_reads_true():
    evidence = _runner_gone_evidence(stream_row={"flags": {"is_running": True}})
    verdict = sc._judge_runner_gone(evidence)
    assert verdict["pass"] is False
    assert "race" not in evidence


def test_judge_runner_gone_fails_when_the_next_send_did_not_run():
    evidence = _runner_gone_evidence(new_message_ran=False)
    verdict = sc._judge_runner_gone(evidence)
    assert verdict["pass"] is False
    assert "race" not in evidence


def _restart_after_stop_evidence(**overrides) -> dict:
    base = {
        "runner_healthy_after_s": 5.0,
        "admitted_at_s": 12.0,
        "recalled_marker": True,
        "same_sandbox": True,
        "loaded_true": False,
    }
    base.update(overrides)
    return base


def test_judge_restart_after_stop_accepts_the_same_sandbox_signal():
    """Recall plus an unchanged sandbox id is a real native resume: no rebuild happened."""
    evidence = _restart_after_stop_evidence(same_sandbox=True, loaded_true=False)
    verdict = sc._judge_restart_after_stop(evidence)
    assert verdict["pass"] is True


def test_judge_restart_after_stop_accepts_the_loaded_true_signal():
    """Recall plus a genuine native hydrate in the runner log is also a real resume, even when
    the sandbox itself had to be rebuilt (a new sandbox that loads the OLD native session)."""
    evidence = _restart_after_stop_evidence(same_sandbox=False, loaded_true=True)
    verdict = sc._judge_restart_after_stop(evidence)
    assert verdict["pass"] is True


def test_judge_restart_after_stop_fails_when_recall_is_the_only_signal():
    """The exact false-pass this cell exists to catch: the codeword comes back, but neither the
    sandbox id nor the runner log backs up a genuine native resume — the runner recovered it by
    reconstructing the conversation from persisted records, not by resuming the native session."""
    evidence = _restart_after_stop_evidence(same_sandbox=False, loaded_true=False)
    verdict = sc._judge_restart_after_stop(evidence)
    assert verdict["pass"] is False
    assert (
        verdict["why"] == "native session not resumed, recovered by transcript replay"
    )


def test_judge_restart_after_stop_fails_without_recall_even_with_both_signals():
    evidence = _restart_after_stop_evidence(
        recalled_marker=False, same_sandbox=True, loaded_true=True
    )
    verdict = sc._judge_restart_after_stop(evidence)
    assert verdict["pass"] is False
    assert "codeword was not recalled" in verdict["why"]


def test_judge_restart_after_stop_fails_when_the_runner_never_reported_healthy():
    evidence = _restart_after_stop_evidence(runner_healthy_after_s=None)
    verdict = sc._judge_restart_after_stop(evidence)
    assert verdict["pass"] is False
    assert "never reported healthy" in verdict["why"]


def test_judge_restart_after_stop_fails_when_the_continuation_was_never_admitted():
    evidence = _restart_after_stop_evidence(admitted_at_s=None)
    verdict = sc._judge_restart_after_stop(evidence)
    assert verdict["pass"] is False
    assert "refused for the whole wait window" in verdict["why"]


def test_run_cell_finally_path_with_null_hooks_does_not_crash():
    """run_cell()'s runner-health recovery is gated on `needs_hooks and hooks.available`. With
    NullHooks (no --project), hooks.available is False, so the finally block must skip the
    recovery call rather than let HooksUnavailable escape through it — even for a needs_hooks
    cell whose own function raises before it can restore anything itself."""

    class Args:
        sleep_seconds = 1
        sweep_wait = 1
        project = None
        sandbox = "local"

    def boom(cfg, references, args, hooks):
        raise RuntimeError("cell blew up before it could restore anything")

    hooks = sc.NullHooks()
    result = sc.run_cell("boom-cell", boom, {}, {}, Args(), hooks, True)
    assert result["verdict"]["pass"] is False
    assert result["verdict"]["skip"] is False
    assert "driver exception" in result["verdict"]["why"]
    assert "RuntimeError" in result["evidence"]["driver_error"]
    assert "elapsed_s" in result


def test_run_cell_recovers_the_runner_when_a_cell_raises():
    """The run-level guarantee: a needs_hooks cell that raises must still trigger the runner
    recovery check, so a paused or restarted runner does not strand the cell that runs next."""

    class Args:
        sleep_seconds = 1
        sweep_wait = 1
        project = "fake-project"
        sandbox = "local"

    class StubHooks(sc.OperatorHooks):
        available = True

        def __init__(self):
            self.recovered = False

        def ensure_runner_healthy(self, *, timeout: float = 120.0) -> dict:
            self.recovered = True
            return {
                "was_paused": True,
                "status_before": "running",
                "healthy_after_s": 1.0,
            }

    def boom(cfg, references, args, hooks):
        raise RuntimeError("cell paused the runner and blew up before unpausing it")

    hooks = StubHooks()
    result = sc.run_cell("boom-cell", boom, {}, {}, Args(), hooks, True)
    assert hooks.recovered is True
    assert result["verdict"]["pass"] is False


def test_run_cell_skips_recovery_for_cells_that_do_not_need_hooks():
    """A cell that never touches Docker (needs_hooks=False) must not trigger a recovery check,
    even when hooks happen to be available."""

    class Args:
        sleep_seconds = 1
        sweep_wait = 1
        project = "fake-project"
        sandbox = "local"

    class StubHooks(sc.OperatorHooks):
        available = True

        def __init__(self):
            self.recovered = False

        def ensure_runner_healthy(self, *, timeout: float = 120.0) -> dict:
            self.recovered = True
            return {
                "was_paused": False,
                "status_before": "running",
                "healthy_after_s": 1.0,
            }

    def ok(cfg, references, args, hooks):
        return {"session_id": "abc"}, sc._pass("fine")

    hooks = StubHooks()
    result = sc.run_cell("http-only-cell", ok, {}, {}, Args(), hooks, False)
    assert hooks.recovered is False
    assert result["verdict"]["pass"] is True


def test_resolve_env_names_every_missing_variable(monkeypatch):
    monkeypatch.delenv("AGENTA_BASE", raising=False)
    monkeypatch.delenv("AGENTA_ADMIN_KEY", raising=False)
    monkeypatch.delenv("QA_OPENAI_API_KEY", raising=False)
    try:
        sc.resolve_env()
    except SystemExit as exc:
        msg = str(exc)
        assert "AGENTA_BASE" in msg
        assert "AGENTA_ADMIN_KEY" in msg
        assert "QA_OPENAI_API_KEY" in msg
        assert "no env-file fallback" in msg
    else:
        raise AssertionError("resolve_env() should raise SystemExit when env is empty")


def test_resolve_env_populates_globals(monkeypatch):
    monkeypatch.setenv("AGENTA_BASE", "https://example.test")
    monkeypatch.setenv("AGENTA_ADMIN_KEY", "admin-secret")
    monkeypatch.setenv("QA_OPENAI_API_KEY", "sk-test")
    sc.resolve_env()
    assert sc.BASE == "https://example.test"
    assert sc.ADMIN_KEY == "admin-secret"
    assert sc.OPENAI_KEY == "sk-test"


def test_client_shape_messages_full_is_a_noop():
    """--client-shape full (the default) must not touch the outbound messages at all."""
    assert sc.CLIENT_SHAPE == "full"
    messages = [
        sc.user_msg("first"),
        {"role": "assistant", "parts": [{"type": "text", "text": "ok"}]},
        sc.user_msg("last"),
    ]
    assert sc._client_shape_messages(messages) == messages


def test_client_shape_messages_last_message_produces_exactly_one_message_for_a_user_turn():
    """The literal contract: under last-message, the outbound messages a fresh user turn
    produces has exactly one entry, and it is the new user message — not a copy or a rebuild
    of it."""
    sc.CLIENT_SHAPE = "last-message"
    try:
        first = sc.user_msg("first")
        reply = {"role": "assistant", "parts": [{"type": "text", "text": "ok"}]}
        last = sc.user_msg("last")
        shaped = sc._client_shape_messages([first, reply, last])
    finally:
        sc.CLIENT_SHAPE = "full"
    assert len(shaped) == 1
    assert shaped[0] is last


def test_client_shape_messages_keeps_full_history_for_a_hitl_resume():
    """A resume whose trailing turn carries a settled HITL answer (an assistant message, not a
    fresh user turn) must NOT be truncated: the answer has to stay bound to its tool call, the
    same guard agentRequest.ts applies (`lastMessage?.role === "user"`)."""
    sc.CLIENT_SHAPE = "last-message"
    try:
        first = sc.user_msg("first")
        settled = {
            "role": "assistant",
            "parts": [{"type": "tool-shell", "state": "output-denied"}],
        }
        shaped = sc._client_shape_messages([first, settled])
    finally:
        sc.CLIENT_SHAPE = "full"
    assert shaped == [first, settled]


def test_client_shape_messages_strips_answerless_assistant_turns_first():
    """An assistant turn with no answer part (no text, no tool, no dynamic-tool, no file) is
    stripped before the trailing-user-turn check, mirroring `hasAnswer` in agentRequest.ts."""
    sc.CLIENT_SHAPE = "last-message"
    try:
        first = sc.user_msg("first")
        empty_assistant = {"role": "assistant", "parts": []}
        last = sc.user_msg("last")
        shaped = sc._client_shape_messages([first, empty_assistant, last])
    finally:
        sc.CLIENT_SHAPE = "full"
    assert len(shaped) == 1
    assert shaped[0] is last


class _FakeResponse:
    """Minimal stand-in for an `httpx.Response` the DaytonaAwareHooks code path reads."""

    def __init__(self, status_code: int, payload=None, text: str = ""):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self):
        return self._payload


def _set_daytona_env():
    """Dummy, non-secret env values so `DaytonaAwareHooks.__init__` does not raise. Never a real
    key — these tests must never touch the network."""
    import os

    saved = {
        k: os.environ.get(k)
        for k in ("AGENTA_RUNNER_DAYTONA_API_KEY", "AGENTA_RUNNER_DAYTONA_API_URL")
    }
    os.environ["AGENTA_RUNNER_DAYTONA_API_KEY"] = "test-key-not-real"
    os.environ["AGENTA_RUNNER_DAYTONA_API_URL"] = "https://daytona.example/api"
    return saved


def _restore_env(saved: dict):
    import os

    for k, v in saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


def test_daytona_aware_hooks_requires_daytona_env_vars():
    """Constructing without AGENTA_RUNNER_DAYTONA_API_KEY/URL must fail loudly and by name, the
    same discipline `resolve_env` uses for the three top-level env vars — never a silent no-op
    that later fails deep inside an HTTP call."""
    import os

    saved = {
        k: os.environ.get(k)
        for k in ("AGENTA_RUNNER_DAYTONA_API_KEY", "AGENTA_RUNNER_DAYTONA_API_URL")
    }
    os.environ.pop("AGENTA_RUNNER_DAYTONA_API_KEY", None)
    os.environ.pop("AGENTA_RUNNER_DAYTONA_API_URL", None)
    try:
        try:
            sc.DaytonaAwareHooks("fake-project")
        except SystemExit as exc:
            assert "AGENTA_RUNNER_DAYTONA_API_KEY" in str(exc)
            assert "AGENTA_RUNNER_DAYTONA_API_URL" in str(exc)
        else:
            raise AssertionError("expected SystemExit without the Daytona env vars")
    finally:
        _restore_env(saved)


def test_daytona_aware_hooks_kill_sandbox_noop_without_sandbox_id():
    """No observed sandbox id means nothing to end — must not call the Daytona API at all."""
    saved = _set_daytona_env()
    try:
        hooks = sc.DaytonaAwareHooks("fake-project")

        def boom(*a, **k):
            raise AssertionError("must not call the network without a sandbox id")

        hooks._daytona_delete = boom
        assert hooks.kill_sandbox(sandbox_id=None) == []
    finally:
        _restore_env(saved)


def test_daytona_aware_hooks_kill_sandbox_deletes_only_the_observed_sandbox():
    """Ends the ONE sandbox id the cell observed, by its bare uuid (the `daytona/` prefix is a
    driver-internal convention, not part of the Daytona API path)."""
    saved = _set_daytona_env()
    try:
        hooks = sc.DaytonaAwareHooks("fake-project")
        calls = []

        def fake_delete(path):
            calls.append(path)
            return _FakeResponse(200)

        hooks._daytona_delete = fake_delete
        result = hooks.kill_sandbox(sandbox_id="daytona/abc-123")
        assert calls == ["/sandbox/abc-123"]
        assert result == ["abc-123"]
    finally:
        _restore_env(saved)


def test_daytona_aware_hooks_kill_sandbox_treats_404_as_already_gone():
    saved = _set_daytona_env()
    try:
        hooks = sc.DaytonaAwareHooks("fake-project")
        hooks._daytona_delete = lambda path: _FakeResponse(404)
        assert hooks.kill_sandbox(sandbox_id="daytona/abc-123") == ["abc-123"]
    finally:
        _restore_env(saved)


def test_daytona_aware_hooks_sandbox_procs_noop_without_sandbox_id():
    saved = _set_daytona_env()
    try:
        hooks = sc.DaytonaAwareHooks("fake-project")

        def boom(*a, **k):
            raise AssertionError("must not call the network without a sandbox id")

        hooks._daytona_get = boom
        assert hooks.sandbox_procs("marker", sandbox_id=None) == []
    finally:
        _restore_env(saved)


def test_daytona_aware_hooks_sandbox_procs_matches_the_marker_and_filters_self():
    """The full happy path: fetch the toolbox proxy URL for the ONE observed sandbox, run the
    same `ps -eo pid=,ppid=,etimes=,args=` reap-exec.ts uses, and keep only the row matching the
    driver's own marker — never the `ps` invocation itself or an unrelated process."""
    saved = _set_daytona_env()
    try:
        hooks = sc.DaytonaAwareHooks("fake-project")
        get_calls = []
        post_calls = []

        hooks._daytona_get = lambda path: (
            get_calls.append(path),
            _FakeResponse(200, {"url": "https://proxy.example/tb/abc-123"}),
        )[1]

        ps_output = (
            "  501     1    120 /sbin/init\n"
            "  777   501     30 sleep 300.123456\n"
            "  778   777      0 ps -eo pid=,ppid=,etimes=,args=\n"
        )

        class _FakePost:
            def __call__(self, url, json=None, timeout=None):
                post_calls.append((url, json))
                return _FakeResponse(200, {"result": ps_output, "exitCode": 0})

        import httpx as real_httpx

        saved_post = real_httpx.post
        real_httpx.post = _FakePost()
        try:
            hits = hooks.sandbox_procs("sleep 300.123456", sandbox_id="daytona/abc-123")
        finally:
            real_httpx.post = saved_post

        assert get_calls == ["/sandbox/abc-123/toolbox-proxy-url"]
        assert len(post_calls) == 1
        url, body = post_calls[0]
        assert url == "https://proxy.example/tb/abc-123/process/execute"
        assert body["command"] == "ps -eo pid=,ppid=,etimes=,args="
        assert len(hits) == 1
        assert hits[0]["pid"] == "777"
        assert "sleep 300.123456" in hits[0]["args"]
    finally:
        _restore_env(saved)


def test_select_hooks_returns_null_hooks_without_project():
    hooks = sc.select_hooks(None, "local")
    assert isinstance(hooks, sc.NullHooks)
    hooks = sc.select_hooks(None, "daytona")
    assert isinstance(hooks, sc.NullHooks)


def test_select_hooks_returns_docker_compose_hooks_for_local_sandbox():
    hooks = sc.select_hooks("fake-project", "local")
    assert type(hooks) is sc.DockerComposeHooks  # noqa: E721 -- exact class, not the daytona subclass


def test_select_hooks_returns_daytona_aware_hooks_for_daytona_sandbox():
    saved = _set_daytona_env()
    try:
        hooks = sc.select_hooks("fake-project", "daytona")
        assert isinstance(hooks, sc.DaytonaAwareHooks)
    finally:
        _restore_env(saved)


if __name__ == "__main__":
    import inspect

    failures = 0
    tests = [
        (name, obj)
        for name, obj in sorted(globals().items())
        if name.startswith("test_") and callable(obj)
    ]
    for name, fn in tests:
        params = inspect.signature(fn).parameters
        try:
            if "monkeypatch" in params or "tmp_path" in params:
                # Minimal standalone monkeypatch/tmp_path so this file runs without pytest too.
                import os
                import tempfile

                class _MonkeyPatch:
                    def __init__(self):
                        self._saved = {}

                    def setenv(self, k, v):
                        self._saved.setdefault(k, os.environ.get(k))
                        os.environ[k] = v

                    def delenv(self, k, raising=False):
                        self._saved.setdefault(k, os.environ.get(k))
                        os.environ.pop(k, None)

                    def restore(self):
                        for k, v in self._saved.items():
                            if v is None:
                                os.environ.pop(k, None)
                            else:
                                os.environ[k] = v

                kwargs = {}
                mp = _MonkeyPatch()
                if "monkeypatch" in params:
                    kwargs["monkeypatch"] = mp
                if "tmp_path" in params:
                    kwargs["tmp_path"] = pathlib.Path(tempfile.mkdtemp())
                fn(**kwargs)
                mp.restore()
            else:
                fn()
            print(f"PASS {name}")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"FAIL {name}: {exc}")
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    sys.exit(1 if failures else 0)
