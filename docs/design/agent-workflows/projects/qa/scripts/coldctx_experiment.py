# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""Host-only experiment, not part of the release gate (kept here as release-night evidence).

DECISIVE experiment: does a COLD turn lose a token buried past the runner's 4000-char
tool-result cap (transcript.ts TOOL_RESULT_RENDER_MAX_CHARS), while an EARLY token (within the
cap) survives?

Turn 1 (same session): agent runs ONE bash command emitting an EARLY token near the start of a
large tool output and a LATE token thousands of chars later. Agent reports both immediately
(control -- proves both were visible in turn 1).

Wait ~75s (> the 60s keepalive pool TTL) so the session goes cold.

Turn 2 (same session, FAITHFUL replay via Turn.assistant_message()): ask the agent to recall
both tokens. Corroborate the model's answer against the runner's own log lines for that exact
session id + time window: keepalive miss/cold, create_session mode=create|load, and the
"[HITL] cold replay: transcript X->Y chars, evicted N/M messages" line.

Run on:
  - claude / local  (connection self_managed -- subscription auth)
  - pi_core / local (model openrouter/deepseek/deepseek-v4-flash, provider openrouter)

Each harness run >=2 times (nondeterminism). Container uptime is checked before/after each run;
a run that overlaps a restart is discarded.

  uv run coldctx_experiment.py
"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import subprocess
import time
import uuid
from datetime import datetime, timezone

REPO = pathlib.Path("/home/mahmoud/code/agenta")
QA_PRODUCT = REPO / "docs/design/agent-workflows/projects/qa/scripts/qa_product.py"
CONTAINER = "agenta-oss-team-runner-1"
COLD_WAIT_S = 75  # keepalive pool TTL is 60_000ms; wait past it

_spec = importlib.util.spec_from_file_location("qa", QA_PRODUCT)
qa = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(qa)

BASH_TOOL = {"type": "builtin", "name": "bash"}

CELLS = {
    "claude": {
        "harness": "claude",
        "sandbox": "local",
        "model": "sonnet",
        "provider": "anthropic",
        "connection": {"mode": "self_managed", "slug": None},
    },
    "pi": {
        "harness": "pi_core",
        "sandbox": "local",
        "model": "openrouter/deepseek/deepseek-v4-flash",
        "provider": "openrouter",
    },
}

FILLER_LINES = (
    150  # tuned so LATE lands well past the 4000-char cap (see build_command)
)


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def container_status() -> tuple[str, str]:
    """(StartedAt, Status) -- used to detect a restart straddling our test window."""
    started = subprocess.run(
        ["docker", "inspect", CONTAINER, "--format", "{{.State.StartedAt}}"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    status = subprocess.run(
        ["docker", "ps", "--filter", f"name=^{CONTAINER}$", "--format", "{{.Status}}"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    return started, status


def docker_logs(since_iso: str, until_iso: str) -> str:
    r = subprocess.run(
        ["docker", "logs", "--since", since_iso, "--until", until_iso, CONTAINER],
        capture_output=True,
        text=True,
    )
    return (r.stdout or "") + (r.stderr or "")


def build_command(early: str, late: str) -> tuple[str, dict]:
    """The exact bash command turn 1 runs. Verified by ACTUALLY EXECUTING it locally (this box
    IS the runner host) and measuring where each token lands in the raw stdout, rather than
    hand-computing offsets."""
    filler_line = "filler-%03d-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    cmd = (
        f"printf 'EARLY-{early}\\n'; "
        f"for i in $(seq 1 {FILLER_LINES}); do printf '{filler_line}\\n' $i; done; "
        f"printf 'LATE-{late}\\n'"
    )
    out = subprocess.run(
        ["bash", "-c", cmd], capture_output=True, text=True, check=True
    ).stdout
    early_tok, late_tok = f"EARLY-{early}", f"LATE-{late}"
    meta = {
        "raw_stdout_len": len(out),
        "early_offset": out.index(early_tok),
        "late_offset": out.index(late_tok),
        "cap_chars": 4000,
    }
    assert meta["early_offset"] < 4000, "EARLY token must land inside the cap"
    assert meta["late_offset"] > 4000, "LATE token must land past the cap"
    return cmd, meta


def run_once(label: str, cell: dict, run_idx: int) -> dict:
    session_id = str(uuid.uuid4())
    early = uuid.uuid4().hex
    late = uuid.uuid4().hex
    cmd, meta = build_command(early, late)
    early_tok, late_tok = f"EARLY-{early}", f"LATE-{late}"

    started_before, status_before = container_status()

    turn1_prompt = (
        f"Use the bash tool to run exactly this command:\n{cmd}\n"
        "Then reply with ONLY two lines, verbatim from the command's stdout:\n"
        "EARLY: <the full EARLY-... token>\n"
        "LATE: <the full LATE-... token>\n"
        "Do not write either token to any file. Do not summarize or omit a line."
    )
    params = qa.template(
        cell,
        tools=[BASH_TOOL],
        instructions=(
            "Use the bash tool exactly as instructed. Report only what is asked, verbatim. "
            "Never write secrets/tokens to files."
        ),
        permission_default="allow",
    )
    msgs = [qa.user_msg(turn1_prompt)]
    t1_start = now_iso()
    t1 = qa.invoke(session_id, msgs, params, timeout=300.0)
    t1_end = now_iso()

    control_ok = (
        qa.tool_ran(t1)
        and early_tok in t1.reply
        and late_tok in t1.reply
        and not t1.errors
    )
    result = {
        "label": label,
        "run_idx": run_idx,
        "session_id": session_id,
        "cell": cell,
        "command_meta": meta,
        "early_token": early_tok,
        "late_token": late_tok,
        "container_started_before": started_before,
        "container_status_before": status_before,
        "turn1": {
            "window": [t1_start, t1_end],
            "control_ok": control_ok,
            "reply": t1.reply,
            "summary": t1.summary(),
        },
    }

    if not control_ok:
        result["verdict"] = (
            "VOID: turn 1 control failed (tokens not both visible immediately)"
        )
        return result

    # Faithful replay: full assistant message (text + tool parts), exactly what the real
    # frontend sends back -- a text-only replay itself forces a history-mismatch cold turn and
    # would muddy the result (this is why we import qa_product rather than hand-rolling a client).
    msgs = msgs + [t1.assistant_message()]

    print(
        f"    [{label} run{run_idx}] session={session_id} sleeping {COLD_WAIT_S}s for TTL...",
        flush=True,
    )
    time.sleep(COLD_WAIT_S)

    turn2_prompt = (
        "What was the EARLY token and what was the LATE token from that command's output? "
        "Reply with both, or say MISSING for any you cannot recall."
    )
    msgs = msgs + [qa.user_msg(turn2_prompt)]
    t2_start = now_iso()
    t2 = qa.invoke(session_id, msgs, params, timeout=300.0)
    t2_end = now_iso()

    started_after, status_after = container_status()
    restarted = started_after != started_before

    # Narrow log window around turn 2 only, so concurrent live traffic on this shared box is
    # unlikely to interleave into our slice.
    # Widen the window slightly on both sides: docker's --since/--until timestamp resolution
    # plus our own request round-trip latency can shave a line or two off either edge.
    log_slice = docker_logs(t2_start, now_iso())
    session_lines = [ln for ln in log_slice.splitlines() if session_id in ln]
    # The "[HITL] cold replay: ..." line does not carry the session id -- it is emitted
    # synchronously within the same request's log burst as this session's
    # keepalive miss/evict + create_session lines, so pull it from that neighborhood.
    all_lines = log_slice.splitlines()
    cold_replay_lines = []
    for i, ln in enumerate(all_lines):
        if session_id in ln:
            lo, hi = max(0, i - 3), min(len(all_lines), i + 8)
            for j in range(lo, hi):
                if (
                    "cold replay" in all_lines[j]
                    and all_lines[j] not in cold_replay_lines
                ):
                    cold_replay_lines.append(all_lines[j])
    unattributed_cold_replay = [
        ln for ln in all_lines if "cold replay" in ln and ln not in cold_replay_lines
    ]

    early_recalled = early_tok in t2.reply
    late_recalled = late_tok in t2.reply
    went_cold = any("miss" in ln and "cold" in ln for ln in session_lines) or any(
        "expire" in ln or "evict" in ln for ln in session_lines
    )
    mode_lines = [ln for ln in session_lines if "create_session" in ln]

    result.update(
        {
            "turn2": {
                "window": [t2_start, t2_end],
                "reply": t2.reply,
                "summary": t2.summary(),
                "early_recalled": early_recalled,
                "late_recalled": late_recalled,
            },
            "container_started_after": started_after,
            "container_status_after": status_after,
            "container_restarted_during_run": restarted,
            "runner_log_session_lines": session_lines,
            "runner_log_cold_replay_lines": cold_replay_lines,
            "runner_log_unattributed_cold_replay_lines": unattributed_cold_replay,
            "runner_log_mode_lines": mode_lines,
            "runner_log_full_slice": log_slice,
            "went_cold": went_cold,
        }
    )
    if restarted:
        result["verdict"] = "DISCARD: container restarted during this run"
    elif not went_cold:
        result["verdict"] = (
            "INVALID: no cold/miss/expire evidence for this session in turn-2 log window -- "
            "session likely stayed warm (hit-continue); rerun with a longer wait"
        )
    else:
        result["verdict"] = (
            f"early_recalled={early_recalled} late_recalled={late_recalled} "
            f"(hypothesis predicts early=True, late=False on claude; "
            f"pi may preserve both if it does a native mode=load)"
        )
    return result


def main() -> int:
    import sys

    smoke = "--smoke" in sys.argv
    only = None
    for a in sys.argv[1:]:
        if a in CELLS:
            only = a
    cells = {only: CELLS[only]} if only else CELLS
    runs = (1,) if smoke else (1, 2)

    all_results = []
    for label, cell in cells.items():
        for run_idx in runs:
            print(f"[{label}] run {run_idx} starting...", flush=True)
            r = run_once(label, cell, run_idx)
            all_results.append(r)
            print(f"[{label}] run {run_idx}: {r.get('verdict')}", flush=True)
            print(f"    early={r['early_token']} late={r['late_token']}", flush=True)
            if "turn2" in r:
                print(f"    turn2 reply: {r['turn2']['reply'][:300]!r}", flush=True)
                for ln in r["runner_log_session_lines"]:
                    print(f"    LOG: {ln}", flush=True)
                for ln in r["runner_log_cold_replay_lines"]:
                    print(f"    LOG(cold-replay): {ln}", flush=True)
            print(flush=True)

    stamp = time.strftime("%Y%m%d-%H%M%S")
    d = qa.RUNS / f"coldctx-{stamp}"
    d.mkdir(parents=True, exist_ok=True)
    out = d / "results.json"
    out.write_text(json.dumps(all_results, indent=2))
    print(f"results: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
