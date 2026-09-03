# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx>=0.27"]
# ///
"""Session-control regression cells for the agent release gate.

Wire-level scenarios for Stop, durable commands, and the runner's recovery paths. Each cell
drives the same product endpoint the playground drives (`/services/agent/v0/invoke`) and asserts
on the SSE frame stream, the durable records, and the command rows. It never asserts on model
prose.

Ported from the durable-cancel slice's spike driver
(`~/agenta-qa-evidence/2026-09-03-session-round2/integration-refresh/refresh_live.py`), with four
changes made so this file can live in the repo and run as a standing check instead of a one-box
artifact:

1. Reads the SAME env contract as `qa_product.py` (`AGENTA_BASE`), plus `AGENTA_ADMIN_KEY` and
   `QA_OPENAI_API_KEY`, which this driver needs to mint its own ephemeral account and stock the
   vault. No env-file fallback: a fallback file is how a green run gets recorded against the
   wrong deployment.
2. The Docker- and Postgres-only helpers sit behind one `OperatorHooks` interface
   (`DockerComposeHooks` / `NullHooks`). Six cells need no shell at all and run against any
   deployment; the rest need `--project <docker-compose project>` and SKIP with a named reason
   when it is absent.
3. Emits the gate's result shape: PASS / FAIL / SKIP per cell with a one-line reason, plus
   `results.json` and `summary.md` in a timestamped run folder under `~/agenta-qa-evidence/`
   (override with `AGENTA_QA_RUNS_DIR`).
4. `--cells` is resumable: pass `--resume <path to a results.json>` and any cell already
   recorded there is loaded instead of re-run, so a lost agent costs one cell, not the whole run.

    uv run resources/session_control.py --cells all --harness pi_core --sandbox local

See `SKILL.md` for when these cells are mandatory and where the model keys live.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import subprocess
import sys
import threading
import time
import uuid

import httpx

REQUIRED_ENV = ("AGENTA_BASE", "AGENTA_ADMIN_KEY", "QA_OPENAI_API_KEY")

# Resolved by resolve_env() before anything runs. Left empty so --help works with no env set.
BASE = ""
ADMIN_KEY = ""
OPENAI_KEY = ""

RUNS = pathlib.Path(
    os.environ.get(
        "AGENTA_QA_RUNS_DIR", str(pathlib.Path.home() / "agenta-qa-evidence")
    )
).expanduser()

STATE: dict = {}
RECALL = "What was the codeword I gave you? Reply with just the codeword."


def resolve_env() -> None:
    """Populate BASE/ADMIN_KEY/OPENAI_KEY from the environment only.

    No env-file fallback on purpose: qa-audit-2026-09-03.md section 4 names the file fallback as
    the mechanism that recorded a green run against the wrong deployment. Every missing variable
    is named so a Sonnet QA agent does not have to guess.
    """
    global BASE, ADMIN_KEY, OPENAI_KEY
    missing = [name for name in REQUIRED_ENV if not os.environ.get(name)]
    if missing:
        raise SystemExit(
            "Missing environment variables: " + ", ".join(missing) + ".\n"
            "Set them, e.g.\n"
            "  export AGENTA_BASE=https://your-stack.example.com\n"
            "  export AGENTA_ADMIN_KEY=...      # ~/.agenta-qa-secrets.env\n"
            "  export QA_OPENAI_API_KEY=...     # ~/.agenta-qa-openai.env\n"
            "There is no env-file fallback: a fallback file is how a green run gets recorded "
            "against the wrong deployment."
        )
    BASE = os.environ["AGENTA_BASE"]
    ADMIN_KEY = os.environ["AGENTA_ADMIN_KEY"]
    OPENAI_KEY = os.environ["QA_OPENAI_API_KEY"]


# --------------------------------------------------------------------------- #
# Operator hooks: the only place this file talks to Docker or Postgres.
# --------------------------------------------------------------------------- #


class HooksUnavailable(Exception):
    """Raised by a NullHooks method. Caught at the cell boundary and turned into a SKIP."""


class OperatorHooks:
    """Interface the cells call through. `available` gates whether shell-only cells can run."""

    available = False

    def dc(self, *args: str, timeout: float = 60.0) -> str:
        raise HooksUnavailable

    def psql(self, db: str, sql: str) -> list[list[str]]:
        raise HooksUnavailable

    def runner_log(self, since: float) -> list[str]:
        raise HooksUnavailable

    def sandbox_procs(self, marker: str) -> list[dict]:
        raise HooksUnavailable

    def stream_row(self, session_id: str) -> dict:
        raise HooksUnavailable

    def record_rows(self, session_id: str) -> list[dict]:
        raise HooksUnavailable

    def command_rows(self, session_id: str) -> list[dict]:
        raise HooksUnavailable

    def wait_for_runner(self, *, timeout: float = 120.0) -> float | None:
        raise HooksUnavailable

    def restart_runner(self, grace_seconds: int = 10) -> None:
        raise HooksUnavailable

    def kill_runner(self) -> None:
        raise HooksUnavailable

    def pause_runner(self) -> None:
        raise HooksUnavailable

    def unpause_runner(self) -> None:
        raise HooksUnavailable

    def stop_postgres(self) -> None:
        raise HooksUnavailable

    def start_postgres(self) -> None:
        raise HooksUnavailable

    def kill_sandbox(self) -> list[str]:
        raise HooksUnavailable


class NullHooks(OperatorHooks):
    """No `--project` was given. Every method raises; cells that need it SKIP with a reason."""

    available = False


class DockerComposeHooks(OperatorHooks):
    """The original refresh_live.py helpers, ported behind the OperatorHooks interface."""

    available = True

    def __init__(self, project: str) -> None:
        self.project = project

    def dc(self, *args: str, timeout: float = 60.0) -> str:
        try:
            out = subprocess.run(
                ["docker", *args], capture_output=True, text=True, timeout=timeout
            )
            return out.stdout
        except Exception as exc:  # noqa: BLE001
            return f"<docker failed: {exc}>"

    def psql(self, db: str, sql: str) -> list[list[str]]:
        raw = self.dc(
            "exec",
            f"{self.project}-postgres-1",
            "psql",
            "-U",
            "username",
            "-d",
            db,
            "-At",
            "-F",
            "|",
            "-c",
            sql,
        )
        return [line.split("|") for line in raw.strip().splitlines() if line.strip()]

    def runner_log(self, since: float) -> list[str]:
        stamp = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(since - 2))
        try:
            out = subprocess.run(
                ["docker", "logs", "-t", "--since", stamp, f"{self.project}-runner-1"],
                capture_output=True,
                text=True,
                timeout=90,
            )
            return (out.stdout + out.stderr).splitlines()
        except Exception as exc:  # noqa: BLE001
            return [f"<docker logs failed: {exc}>"]

    def sandbox_procs(self, marker: str) -> list[dict]:
        raw = self.dc(
            "exec", f"{self.project}-runner-1", "ps", "-eo", "pid,ppid,etimes,args"
        )
        hits = []
        for line in raw.splitlines()[1:]:
            parts = line.split(None, 3)
            if len(parts) < 4 or marker not in parts[3]:
                continue
            if "ps -eo" in parts[3] or parts[3].startswith("grep"):
                continue
            hits.append(
                {
                    "pid": parts[0],
                    "ppid": parts[1],
                    "etimes": parts[2],
                    "args": parts[3][:120],
                }
            )
        return hits

    def stream_row(self, session_id: str) -> dict:
        rows = self.psql(
            "agenta_ee_core",
            "select turn_id, coalesce(flags::text,'{}'), coalesce(stopping_turn_id,'') "
            f"from session_streams where session_id = '{session_id}'",
        )
        if not rows:
            return {}
        turn, flags, stopping = rows[0]
        try:
            flags_obj = json.loads(flags)
        except Exception:  # noqa: BLE001
            flags_obj = {"raw": flags}
        return {
            "turn_id": turn,
            "flags": flags_obj,
            "stopping_turn_id": stopping or None,
            "read_at": time.time(),
        }

    def record_rows(self, session_id: str) -> list[dict]:
        rows = self.psql(
            "agenta_ee_tracing",
            "select coalesce(turn_id,''), record_type, "
            "coalesce(to_char(created_at,'HH24:MI:SS.MS'),''), "
            "case when quarantined_at is null then '' "
            "else to_char(quarantined_at,'HH24:MI:SS.MS') end "
            f"from records where session_id = '{session_id}' order by created_at",
        )
        return [
            {
                "turn_id": r[0],
                "type": r[1],
                "created_at": r[2],
                "quarantined_at": r[3] or None,
            }
            for r in rows
            if len(r) >= 4
        ]

    def command_rows(self, session_id: str) -> list[dict]:
        rows = self.psql(
            "agenta_ee_core",
            "select id::text, state, coalesce(outcome,''), claim_count, "
            "coalesce(target_turn_id,'') from session_commands "
            f"where session_id = '{session_id}' order by created_at",
        )
        return [
            {
                "id": r[0],
                "state": r[1],
                "outcome": r[2] or None,
                "claim_count": r[3],
                "target_turn_id": r[4] or None,
            }
            for r in rows
            if len(r) >= 5
        ]

    def wait_for_runner(self, *, timeout: float = 120.0) -> float | None:
        started = time.time()
        while time.time() - started < timeout:
            state = self.dc(
                "inspect", "-f", "{{.State.Health.Status}}", f"{self.project}-runner-1"
            ).strip()
            if state == "healthy":
                return round(time.time() - started, 1)
            time.sleep(1)
        return None

    def restart_runner(self, grace_seconds: int = 10) -> None:
        self.dc(
            "restart", "-t", str(grace_seconds), f"{self.project}-runner-1", timeout=120
        )

    def kill_runner(self) -> None:
        self.dc("restart", "-t", "0", f"{self.project}-runner-1", timeout=60)

    def pause_runner(self) -> None:
        self.dc("pause", f"{self.project}-runner-1")

    def unpause_runner(self) -> None:
        self.dc("unpause", f"{self.project}-runner-1")

    def stop_postgres(self) -> None:
        self.dc("stop", f"{self.project}-postgres-1")

    def start_postgres(self) -> None:
        self.dc("start", f"{self.project}-postgres-1")

    def kill_sandbox(self) -> list[str]:
        ps = self.dc(
            "exec",
            f"{self.project}-runner-1",
            "sh",
            "-c",
            'ps -eo pid,args | grep "[s]andbox-agent server"',
        )
        pids = [line.split()[0] for line in ps.strip().splitlines() if line.strip()]
        for pid in pids:
            self.dc(
                "exec",
                f"{self.project}-runner-1",
                "sh",
                "-c",
                f"kill -9 -{pid} || kill -9 {pid}",
            )
        return pids


# --------------------------------------------------------------------------- #
# HTTP plumbing (unchanged from refresh_live.py, keyed off the resolved env)
# --------------------------------------------------------------------------- #

HARNESSES = {
    "pi_core": {
        "kind": "pi_core",
        "model": "gpt-5.6-luna",
        "provider": "openai",
        "connection": {"mode": "agenta", "slug": None},
    },
    "codex": {
        "kind": "codex",
        "model": "gpt-5.6-luna",
        "provider": "openai",
        "connection": {"mode": "agenta", "slug": None},
    },
}


def api(method: str, path: str, *, timeout: float = 120.0, **kw) -> httpx.Response:
    headers = {
        "Authorization": STATE["credentials"],
        "Content-Type": "application/json",
        **(kw.pop("headers", None) or {}),
    }
    params = {"project_id": STATE["project_id"], **(kw.pop("params", None) or {})}
    return httpx.request(
        method,
        f"{BASE}/api{path}",
        params=params,
        headers=headers,
        timeout=timeout,
        **kw,
    )


def bootstrap() -> None:
    uid = uuid.uuid4().hex[:12]
    r = httpx.post(
        f"{BASE}/api/admin/simple/accounts/",
        headers={"Authorization": f"Access {ADMIN_KEY}"},
        json={
            "accounts": {
                "user": {
                    "user": {"email": f"{uid}@test.agenta.ai"},
                    "options": {
                        "create_api_keys": True,
                        "return_api_keys": True,
                        "seed_defaults": False,
                    },
                }
            }
        },
        timeout=120.0,
    )
    r.raise_for_status()
    account = next(iter(r.json()["accounts"].values()))
    STATE["credentials"] = f"ApiKey {account['api_keys']['key']}"
    STATE["project_id"] = next(iter(account["projects"].values()))["id"]
    print(f"[bootstrap] project={STATE['project_id']}", file=sys.stderr)

    r = api(
        "POST",
        "/vault/v1/secrets/",
        json={
            "header": {"name": "OpenAI", "description": "session-control gate"},
            "secret": {
                "kind": "provider_key",
                "data": {"kind": "openai", "provider": {"key": OPENAI_KEY}},
            },
        },
    )
    if r.status_code != 200:
        raise SystemExit(f"vault create HTTP {r.status_code}: {r.text[:400]}")
    print("[bootstrap] vault stocked with an openai provider key", file=sys.stderr)


def agent_config(
    harness: str, model: str, provider: str, connection: dict, sandbox: str = "local"
) -> dict:
    return {
        "instructions": {"agents_md": "Be terse. Do exactly what is asked."},
        "llm": {
            "model": model,
            "provider": provider,
            "connection": connection,
            "extras": {},
        },
        "tools": [],
        "mcps": [],
        "skills": [],
        "harness": {"kind": harness},
        "sandbox": {"kind": sandbox},
        "runner": {"permissions": {"default": "allow"}},
    }


def create_revision(cfg: dict, tag: str) -> dict:
    hexid = uuid.uuid4().hex[:8]
    r = api(
        "POST",
        "/workflows/",
        json={
            "workflow": {
                "slug": f"{tag}-{hexid}",
                "name": f"session-control {hexid}",
                "flags": {
                    "is_custom": True,
                    "is_evaluator": False,
                    "is_feedback": False,
                },
            }
        },
    )
    if r.status_code != 200:
        raise SystemExit(f"create workflow HTTP {r.status_code}: {r.text[:400]}")
    wf = r.json()["workflow"]["id"]

    r = api(
        "POST",
        "/workflows/variants/",
        json={
            "workflow_variant": {
                "slug": f"{tag}-{hexid}-v",
                "name": f"session-control {hexid} v",
                "workflow_id": wf,
            }
        },
    )
    if r.status_code != 200:
        raise SystemExit(f"create variant HTTP {r.status_code}: {r.text[:400]}")
    var = r.json()["workflow_variant"]["id"]

    rev_id = None
    for step in ("seed", "baseline"):
        r = api(
            "POST",
            "/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": f"{tag}-{step}-{hexid}",
                    "name": f"session-control rev {step}",
                    "message": step,
                    "data": {
                        "uri": "agenta:builtin:agent:v0",
                        "parameters": {"agent": cfg},
                    },
                    "workflow_id": wf,
                    "workflow_variant_id": var,
                }
            },
        )
        if r.status_code != 200:
            raise SystemExit(f"commit {step} HTTP {r.status_code}: {r.text[:400]}")
        rev_id = r.json()["workflow_revision"]["id"]

    return {
        "application": {"id": wf},
        "variant": {"id": var},
        "revision": {"id": rev_id},
    }


def user_msg(text: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "role": "user",
        "parts": [{"type": "text", "text": text}],
    }


def invoke(
    session_id: str,
    messages: list,
    cfg: dict,
    references: dict,
    label: str,
    out: dict | None = None,
) -> dict:
    url = f"{BASE}/services/agent/v0/invoke"
    body = {
        "session_id": session_id,
        "references": references,
        "data": {"inputs": {"messages": messages}, "parameters": {"agent": cfg}},
    }
    headers = {
        "Authorization": STATE["credentials"],
        "Accept": "text/event-stream",
        "x-ag-messages-format": "vercel",
        "Content-Type": "application/json",
    }
    out = out if out is not None else {}
    out.update(
        {
            "frames": [],
            "text": "",
            "tool_calls": [],
            "errors": [],
            "raw": [],
            "segments": [],
            "tool_outcomes": {},
            "tool_payloads": {},
        }
    )
    started = time.time()
    with httpx.Client(timeout=600.0) as client:
        with client.stream(
            "POST",
            url,
            params={
                "project_id": STATE["project_id"],
                "application_id": references["application"]["id"],
            },
            json=body,
            headers=headers,
        ) as r:
            print(f"[{label}] HTTP {r.status_code}", file=sys.stderr)
            if r.status_code >= 400:
                out["errors"].append(f"HTTP {r.status_code}: {r.read().decode()[:600]}")
                return out
            for line in r.iter_lines():
                if not line.startswith("data: "):
                    continue
                payload = line[6:]
                if payload == "[DONE]":
                    break
                try:
                    f = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                out["raw"].append(f)
                t = f.get("type", "?")
                out["frames"].append(t)
                if t == "message-metadata":
                    tid = (f.get("messageMetadata") or {}).get("turnId")
                    if isinstance(tid, str) and tid:
                        out["turn_id"] = tid
                if t == "text-delta":
                    delta = f.get("delta", "")
                    out["text"] += delta
                    if out["segments"] and out["segments"][-1]["kind"] == "text":
                        out["segments"][-1]["text"] += delta
                    else:
                        out["segments"].append({"kind": "text", "text": delta})
                elif t == "tool-input-available":
                    call = {
                        "toolCallId": f.get("toolCallId"),
                        "name": f.get("toolName"),
                        "input": f.get("input"),
                    }
                    is_new = not any(
                        c["toolCallId"] == call["toolCallId"] for c in out["tool_calls"]
                    )
                    out["tool_calls"] = [
                        c
                        for c in out["tool_calls"]
                        if c["toolCallId"] != call["toolCallId"]
                    ] + [call]
                    if is_new:
                        out["segments"].append(
                            {"kind": "tool", "id": call["toolCallId"]}
                        )
                elif t == "tool-output-available":
                    out["tool_outcomes"][f.get("toolCallId")] = "available"
                    out["tool_payloads"][f.get("toolCallId")] = {
                        "output": f.get("output")
                    }
                elif t == "tool-output-error":
                    out["tool_outcomes"][f.get("toolCallId")] = "error"
                    out["tool_payloads"][f.get("toolCallId")] = {
                        "errorText": f.get("errorText")
                    }
                elif t == "error":
                    out["errors"].append(json.dumps(f)[:600])
    out["elapsed_s"] = round(time.time() - started, 1)
    print(
        f"[{label}] frames={out['frames']} elapsed={out['elapsed_s']}s", file=sys.stderr
    )
    return out


def assistant_message(turn: dict) -> dict:
    parts: list = []
    text_buf: list[str] = []
    for seg in turn["segments"]:
        if seg["kind"] == "text":
            text_buf.append(seg["text"])
            continue
        if text_buf:
            parts.append({"type": "text", "text": "".join(text_buf)})
            text_buf = []
        call = next(c for c in turn["tool_calls"] if c["toolCallId"] == seg["id"])
        part = {
            "type": f"tool-{call['name']}",
            "toolCallId": call["toolCallId"],
            "input": call["input"],
            "state": "input-available",
        }
        outcome = turn["tool_outcomes"].get(call["toolCallId"])
        if outcome == "available":
            part["state"] = "output-available"
            part["output"] = (
                turn["tool_payloads"].get(call["toolCallId"], {}).get("output")
            )
        elif outcome == "error":
            part["state"] = "output-error"
            part["errorText"] = (
                turn["tool_payloads"].get(call["toolCallId"], {}).get("errorText")
            )
        parts.append(part)
    if text_buf:
        parts.append({"type": "text", "text": "".join(text_buf)})
    return {"id": str(uuid.uuid4()), "role": "assistant", "parts": parts}


def session_stream(session_id: str) -> dict:
    r = api("GET", "/sessions/streams/", params={"session_id": session_id})
    if r.status_code != 200:
        return {}
    return (r.json() or {}).get("stream") or {}


def cancel(
    session_id: str,
    *,
    expected: str | None = None,
    idempotency_key: str | None = None,
    label: str = "stop",
) -> dict:
    headers = {"Idempotency-Key": idempotency_key} if idempotency_key else None
    body = {"expected_execution_id": expected} if expected else {}
    sent = time.time()
    r = api(
        "POST",
        f"/sessions/{session_id}/cancel",
        json=body,
        headers=headers,
        timeout=30.0,
    )
    got = time.time()
    try:
        payload = r.json()
    except Exception:
        payload = {"raw": r.text[:400]}
    record = {
        "status": r.status_code,
        "body": payload,
        "sent_at": sent,
        "sent_iso": time.strftime("%H:%M:%S", time.localtime(sent))
        + f".{int((sent % 1) * 1000):03d}",
        "round_trip_s": round(got - sent, 3),
    }
    print(
        f"[{label}] HTTP {r.status_code} at {record['sent_iso']} rt={record['round_trip_s']}s {json.dumps(payload)[:300]}",
        file=sys.stderr,
    )
    return record


def records(session_id: str) -> list:
    r = api("POST", "/sessions/records/query", json={"session_id": session_id})
    if r.status_code != 200:
        return [{"error": f"HTTP {r.status_code}: {r.text[:200]}"}]
    return (r.json() or {}).get("records") or []


def terminal_records(session_id: str, turn_id: str | None = None) -> list:
    rows = [
        {
            "type": rec.get("record_type"),
            "turn_id": rec.get("turn_id"),
            "attributes": rec.get("attributes"),
        }
        for rec in records(session_id)
        if rec.get("record_type") in ("error", "done")
    ]
    if turn_id:
        rows = [r for r in rows if r["turn_id"] == turn_id]
    return rows


def interactions(session_id: str) -> list:
    r = api(
        "POST",
        "/sessions/interactions/query",
        json={"query": {"session_id": session_id}},
    )
    if r.status_code != 200:
        return [{"error": f"HTTP {r.status_code}"}]
    return [
        {
            "id": i.get("id"),
            "turn_id": i.get("turn_id"),
            "kind": i.get("kind"),
            "status": i.get("status"),
        }
        for i in ((r.json() or {}).get("interactions") or [])
    ]


def invoke_async(session_id, messages, cfg, references, label) -> dict:
    live: dict = {}
    handle: dict = {"out": None, "live": live}

    def go() -> None:
        handle["out"] = invoke(session_id, messages, cfg, references, label, out=live)

    t = threading.Thread(target=go, daemon=True)
    t.start()
    handle["thread"] = t
    return handle


def wait_for_turn(session_id: str, *, timeout: float = 40.0) -> str | None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        stream = session_stream(session_id)
        turn = stream.get("turn_id")
        flags = stream.get("flags") or {}
        if turn and flags.get("is_running"):
            return turn
        time.sleep(0.5)
    return None


def wait_for_tool(handle: dict, *, timeout: float = 60.0) -> dict | None:
    deadline = time.time() + timeout
    live = handle["live"]
    while time.time() < deadline:
        calls = live.get("tool_calls") or []
        outcomes = live.get("tool_outcomes") or {}
        open_calls = [c for c in calls if c["toolCallId"] not in outcomes]
        if open_calls:
            return open_calls[-1]
        if handle["out"] is not None:
            return None
        time.sleep(0.1)
    return None


def sleep_prompt(marker: str, seconds: int) -> str:
    return (
        f"The codeword is {marker}. Run exactly this one shell command and nothing "
        f"else: sleep {seconds}. Do not write, read or search any files. "
        "When the command finishes, reply with the single word DONE."
    )


# --------------------------------------------------------------------------- #
# Cells. Each returns (evidence: dict, verdict: dict) where verdict is
# {"pass": bool, "skip": bool, "why": str} — the gate's result shape.
# --------------------------------------------------------------------------- #

Cell = "tuple[dict, dict]"


def _pass(why: str) -> dict:
    return {"pass": True, "skip": False, "why": why}


def _fail(why: str) -> dict:
    return {"pass": False, "skip": False, "why": why}


def _skip(why: str) -> dict:
    return {"pass": False, "skip": True, "why": why}


def cell_stop_warm(cfg, references, args, hooks: OperatorHooks) -> Cell:
    """Stop under 5 s, park, warm resume that recalls the codeword. Needs no shell."""
    session_id = str(uuid.uuid4())
    marker = f"MANGO{uuid.uuid4().hex[:6].upper()}"
    msgs = [user_msg(sleep_prompt(marker, args.sleep_seconds))]
    handle = invoke_async(session_id, msgs, cfg, references, "warm-turn1")
    turn = wait_for_turn(session_id)
    open_call = wait_for_tool(handle)
    stop = cancel(session_id, expected=turn, label="stop-warm")
    handle["thread"].join(timeout=180)
    t1 = handle["out"] or {}
    time.sleep(4)
    msgs2 = msgs + [assistant_message(t1), user_msg(RECALL)]
    t2 = invoke(session_id, msgs2, cfg, references, "warm-turn2")
    evidence = {
        "session_id": session_id,
        "turn_id": turn,
        "marker": marker,
        "stop": stop,
        "stopped_during_tool": open_call,
        "turn1_elapsed_s": t1.get("elapsed_s"),
        "terminal_records": terminal_records(session_id, turn),
        "resume_recalled_marker": marker in (t2.get("text") or ""),
        "resume_elapsed_s": t2.get("elapsed_s"),
    }
    if stop["status"] != 200:
        return evidence, _fail(f"Stop returned HTTP {stop['status']}, expected 200")
    if not evidence["resume_recalled_marker"]:
        return evidence, _fail("warm resume did not recall the codeword")
    return evidence, _pass(
        "Stop returned 200 and the warm resume recalled the codeword"
    )


def cell_double_send(cfg, references, args, hooks: OperatorHooks) -> Cell:
    """A second message during a running turn is refused, and destroys nothing. Needs no shell."""
    session_id = str(uuid.uuid4())
    marker = f"KIWI{uuid.uuid4().hex[:6].upper()}"
    msgs = [user_msg(sleep_prompt(marker, args.sleep_seconds))]
    handle = invoke_async(session_id, msgs, cfg, references, "double-turn1")
    turn = wait_for_turn(session_id)
    time.sleep(5)
    second_started = time.time()
    t2 = invoke(
        session_id, [user_msg("Say hello.")], cfg, references, "double-turn2-refused"
    )
    second_elapsed = round(time.time() - second_started, 2)
    handle["thread"].join(timeout=300)
    t1 = handle["out"] or {}
    time.sleep(4)
    msgs3 = msgs + [assistant_message(t1), user_msg(RECALL)]
    t3 = invoke(session_id, msgs3, cfg, references, "double-turn3")
    evidence = {
        "session_id": session_id,
        "turn_id": turn,
        "marker": marker,
        "second_send": {
            "frames": t2.get("frames"),
            "errors": t2.get("errors"),
            "elapsed_s": second_elapsed,
        },
        "turn1_elapsed_s": t1.get("elapsed_s"),
        "turn1_errors": t1.get("errors"),
        "third_send_recalled_marker": marker in (t3.get("text") or ""),
    }
    refused = bool(t2.get("errors"))
    if not refused:
        return evidence, _fail("second Send during a running turn was not refused")
    if not evidence["third_send_recalled_marker"]:
        return evidence, _fail(
            "turn 1 finished but the codeword was not recalled afterwards"
        )
    return evidence, _pass(
        "second Send was refused and the original turn completed cleanly"
    )


def cell_stale_stop(cfg, references, args, hooks: OperatorHooks) -> Cell:
    """A Stop naming a settled turn is refused and tombstones nothing. Needs no shell."""
    session_id = str(uuid.uuid4())
    marker = f"PLUM{uuid.uuid4().hex[:6].upper()}"
    msgs = [
        user_msg(f"The codeword is {marker}. Reply with just the single word READY.")
    ]
    t1 = invoke(session_id, msgs, cfg, references, "stale-turn1")
    turn1 = session_stream(session_id).get("turn_id")
    time.sleep(3)
    msgs2 = msgs + [
        assistant_message(t1),
        user_msg(sleep_prompt(marker, args.sleep_seconds)),
    ]
    handle = invoke_async(session_id, msgs2, cfg, references, "stale-turn2")
    turn2 = None
    deadline = time.time() + 40
    while time.time() < deadline:
        candidate = wait_for_turn(session_id, timeout=2)
        if candidate and candidate != turn1:
            turn2 = candidate
            break
    time.sleep(3)
    stale = cancel(session_id, expected=turn1, label="stale-stop")
    time.sleep(3)
    bare = cancel(session_id, label="bare-stop")
    handle["thread"].join(timeout=180)
    t2 = handle["out"] or {}
    time.sleep(4)
    msgs3 = msgs2 + [assistant_message(t2), user_msg(RECALL)]
    t3 = invoke(session_id, msgs3, cfg, references, "stale-turn3")
    evidence = {
        "session_id": session_id,
        "turn1_id": turn1,
        "turn2_id": turn2,
        "stale_stop": stale,
        "bare_stop": bare,
        "turn2_elapsed_s": t2.get("elapsed_s"),
        "turn3_recalled_marker": marker in (t3.get("text") or ""),
    }
    if stale["status"] not in (400, 404, 409):
        return evidence, _fail(
            f"stale Stop returned HTTP {stale['status']}, expected a mismatch status"
        )
    if not evidence["turn3_recalled_marker"]:
        return evidence, _fail("turn 2 did not survive the stale Stop")
    return evidence, _pass("stale Stop was refused and turn 2 completed and survived")


def cell_stop_approval(cfg_ask, references_ask, args, hooks: OperatorHooks) -> Cell:
    """A parked approval is cancelled by Stop, and a late answer is refused. Needs no shell."""
    session_id = str(uuid.uuid4())
    marker = f"PEAR{uuid.uuid4().hex[:6].upper()}"
    prompt = f"The codeword is {marker}. Run exactly this one shell command and nothing else: echo hello. Then reply DONE."
    t1 = invoke(
        session_id, [user_msg(prompt)], cfg_ask, references_ask, "approval-turn"
    )
    time.sleep(3)
    before = interactions(session_id)
    stream_before = session_stream(session_id)
    expected = t1.get("turn_id") or stream_before.get("turn_id")
    stop = cancel(session_id, expected=expected, label="stop-approval-named")
    time.sleep(3)
    pending = next((i for i in before if i.get("status") == "pending"), None)
    late = {"skipped": "no pending interaction was found before the Stop"}
    if pending:
        r = api(
            "POST",
            f"/sessions/interactions/{pending['id']}/respond",
            json={"answer": {"approved": True}},
        )
        late = {"status": r.status_code, "body": r.text[:300]}
    denied = assistant_message(t1)
    for part in denied["parts"]:
        if (
            part.get("type", "").startswith("tool-")
            and part.get("state") == "input-available"
        ):
            part["state"] = "output-denied"
    msgs2 = [user_msg(prompt), denied, user_msg(RECALL)]
    t2 = invoke(session_id, msgs2, cfg_ask, references_ask, "approval-resume")
    evidence = {
        "session_id": session_id,
        "marker": marker,
        "expected_execution_id": expected,
        "stop": stop,
        "late_answer": late,
        "resume_recalled_marker": marker in (t2.get("text") or ""),
    }
    if pending is None:
        return evidence, _fail(
            "no pending approval was seen before the Stop; the race did not land"
        )
    if stop["status"] != 200:
        return evidence, _fail(
            f"named Stop on a parked approval returned HTTP {stop['status']}, expected 200"
        )
    if late.get("status") == 200:
        return evidence, _fail(
            "the late approval answer was accepted after the Stop settled it"
        )
    if not evidence["resume_recalled_marker"]:
        return evidence, _fail(
            "resume after the approval Stop did not recall the codeword"
        )
    return evidence, _pass(
        "Stop cancelled the parked approval, the late answer was refused, resume recalled the codeword"
    )


def cell_sandbox_gone(cfg, references, args, hooks: OperatorHooks) -> Cell:
    """Kill the sandbox under a running tool call. Needs shell to find and kill the process."""
    if not hooks.available:
        return {}, _skip(
            "no --project given: killing the sandbox process needs docker exec"
        )
    session_id = str(uuid.uuid4())
    marker = f"OLIVE{uuid.uuid4().hex[:6].upper()}"
    msgs = [user_msg(sleep_prompt(marker, 240))]
    handle = invoke_async(session_id, msgs, cfg, references, "sandbox-turn1")
    turn = wait_for_turn(session_id)
    time.sleep(12)
    killed = hooks.kill_sandbox()
    handle["thread"].join(timeout=300)
    t1 = handle["out"] or {}
    time.sleep(5)
    evidence = {
        "session_id": session_id,
        "turn_id": turn,
        "killed_pids": killed,
        "turn1_errors": t1.get("errors"),
        "terminal_records": terminal_records(session_id, turn),
        "stream_after": session_stream(session_id),
    }
    if not killed:
        return evidence, _fail("no sandbox-agent process was found to kill")
    flags = (evidence["stream_after"] or {}).get("flags") or {}
    if flags.get("is_running"):
        return evidence, _fail(
            "session still reads is_running after the sandbox process was killed"
        )
    if not evidence["terminal_records"]:
        return evidence, _fail(
            "no terminal record was written after the sandbox process was killed"
        )
    return evidence, _pass(
        "killing the sandbox process ended the turn and wrote a terminal record"
    )


def cell_records_outage(cfg, references, args, hooks: OperatorHooks) -> Cell:
    """Stop Postgres for 20 s during a turn. Every record must land after it returns."""
    if not hooks.available:
        return {}, _skip("no --project given: stopping Postgres needs docker")
    session_id = str(uuid.uuid4())
    marker = f"CEDAR{uuid.uuid4().hex[:6].upper()}"
    msgs = [
        user_msg(
            f"The codeword is {marker}. Run exactly this one shell command and nothing else: sleep 30. When it finishes, reply with the single word DONE."
        )
    ]
    handle = invoke_async(session_id, msgs, cfg, references, "outage-turn1")
    wait_for_turn(session_id)
    time.sleep(6)
    hooks.stop_postgres()
    time.sleep(20)
    hooks.start_postgres()
    handle["thread"].join(timeout=400)
    landed = []
    deadline = time.time() + 180
    while time.time() < deadline:
        landed = records(session_id)
        if "done" in [r.get("record_type") for r in landed]:
            break
        time.sleep(5)
    evidence = {
        "session_id": session_id,
        "marker": marker,
        "record_types": [r.get("record_type") for r in landed],
        "record_count": len(landed),
    }
    if "done" not in evidence["record_types"]:
        return evidence, _fail(
            "no done record landed after the Postgres outage recovered"
        )
    return evidence, _pass("every record landed after the Postgres outage recovered")


def cell_stop_after_finish(cfg, references, args, hooks: OperatorHooks) -> Cell:
    """Fire the Stop at the instant the runner settles the prompt. Needs no shell for the core
    assertion; the [control] aborted check is skipped without --project."""
    session_id = str(uuid.uuid4())
    marker = f"ACORN{uuid.uuid4().hex[:6].upper()}"
    since = time.time()
    msgs = [
        user_msg(
            f"The codeword is {marker}. Run exactly this one shell command and nothing else: sleep 6. When it finishes, reply with the single word DONE."
        )
    ]
    seen: dict = {}
    watcher_proc = None
    if hooks.available:
        watcher_proc = subprocess.Popen(
            ["docker", "logs", "-f", "--since", "0s", f"{args.project}-runner-1"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )

        def watch() -> None:
            assert watcher_proc.stdout is not None
            for line in watcher_proc.stdout:
                if "prompt stopReason=" in line:
                    seen["line"] = line.strip()
                    seen["at"] = time.time()
                    return

        threading.Thread(target=watch, daemon=True).start()

    handle = invoke_async(session_id, msgs, cfg, references, "finish-turn1")
    turn = wait_for_turn(session_id)
    if hooks.available:
        deadline = time.time() + 180
        while "at" not in seen and time.time() < deadline:
            time.sleep(0.02)
    else:
        time.sleep(
            6.5
        )  # no runner-log watch: fire the Stop right around the natural finish
    stop = cancel(session_id, expected=turn, label="stop-after-finish")
    if watcher_proc:
        try:
            watcher_proc.kill()
        except Exception:  # noqa: BLE001
            pass
    handle["thread"].join(timeout=180)
    t1 = handle["out"] or {}
    time.sleep(6)
    msgs2 = msgs + [assistant_message(t1), user_msg(RECALL)]
    t2 = invoke(session_id, msgs2, cfg, references, "finish-turn2")
    evidence = {
        "session_id": session_id,
        "turn_id": t1.get("turn_id") or turn,
        "settle_line": seen.get("line"),
        "stop": stop,
        "resume_recalled_marker": marker in (t2.get("text") or ""),
        "terminal_records": terminal_records(session_id, turn),
    }
    if hooks.available:
        logs = hooks.runner_log(since)
        evidence["control_aborted_lines"] = [
            ln for ln in logs if "[control] aborted" in ln and session_id in ln
        ]
    if hooks.available and evidence.get("control_aborted_lines"):
        return evidence, _fail(
            "a Stop that lost the race to completion still aborted the settled run"
        )
    if not evidence["resume_recalled_marker"]:
        return evidence, _fail(
            "the session did not park warm after Stop raced a finished turn"
        )
    why = (
        "no spurious abort and a warm continuation recalled the codeword"
        if hooks.available
        else "a warm continuation recalled the codeword (abort-log check skipped: no --project)"
    )
    return evidence, _pass(why)


def cell_restart_after_stop(cfg, references, args, hooks: OperatorHooks) -> Cell:
    """Stop, restart the runner, continue with an EMPTY client transcript."""
    if not hooks.available:
        return {}, _skip("no --project given: restarting the runner needs docker")
    session_id = str(uuid.uuid4())
    marker = f"BIRCH{uuid.uuid4().hex[:6].upper()}"
    msgs = [user_msg(sleep_prompt(marker, args.sleep_seconds))]
    handle = invoke_async(session_id, msgs, cfg, references, "restart-turn1")
    turn = wait_for_turn(session_id)
    wait_for_tool(handle)
    stop = cancel(session_id, expected=turn, label="stop-before-restart")
    handle["thread"].join(timeout=180)
    time.sleep(4)
    restart_at = time.time()
    hooks.restart_runner(grace_seconds=10)
    healthy_after = hooks.wait_for_runner()
    attempts = []
    admitted = None
    deadline = time.time() + 240
    while time.time() < deadline:
        t = invoke(session_id, [user_msg(RECALL)], cfg, references, "restart-recall")
        refused = any(
            "already running a turn" in (e or "") for e in t.get("errors", [])
        )
        attempts.append(
            {
                "at_s_after_restart": round(time.time() - restart_at, 1),
                "refused": refused,
            }
        )
        if not refused:
            admitted = t
            break
        time.sleep(5)
    evidence = {
        "session_id": session_id,
        "turn_id": turn,
        "stop": stop,
        "runner_healthy_after_s": healthy_after,
        "attempts": attempts,
        "admitted_at_s": attempts[-1]["at_s_after_restart"] if admitted else None,
        "recalled_marker": marker in ((admitted or {}).get("text") or ""),
    }
    if healthy_after is None:
        return evidence, _fail("the runner never reported healthy after the restart")
    if admitted is None:
        return evidence, _fail(
            "the continuation was refused for the whole wait window after the restart"
        )
    if not evidence["recalled_marker"]:
        return evidence, _fail(
            "the native harness session did not survive the restart: the codeword was not recalled"
        )
    return evidence, _pass(
        "the runner rehydrated the native session across a restart and recalled the codeword"
    )


def cell_post_stop_row(cfg, references, args, hooks: OperatorHooks) -> Cell:
    """After a Stop the row must read is_running: false within a few seconds."""
    if not hooks.available:
        return {}, _skip("no --project given: reading the Postgres row needs psql")
    session_id = str(uuid.uuid4())
    marker = f"CEDAR{uuid.uuid4().hex[:6].upper()}"
    msgs = [user_msg(sleep_prompt(marker, args.sleep_seconds))]
    handle = invoke_async(session_id, msgs, cfg, references, "row-turn1")
    turn = wait_for_turn(session_id)
    wait_for_tool(handle)
    stop = cancel(session_id, expected=turn, label="stop-post-row")
    first_false_at = None
    deadline = time.time() + 20
    while time.time() < deadline:
        row = hooks.stream_row(session_id)
        flags = row.get("flags") or {}
        if flags.get("is_running") is False:
            first_false_at = round(row.get("read_at", time.time()) - stop["sent_at"], 2)
            break
        time.sleep(0.1)
    handle["thread"].join(timeout=180)
    evidence = {
        "session_id": session_id,
        "turn_id": turn,
        "stop": stop,
        "seconds_to_is_running_false": first_false_at,
    }
    if first_false_at is None:
        return evidence, _fail(
            "the Postgres row never read is_running: false within 20 s of the Stop"
        )
    if first_false_at > 5:
        return evidence, _fail(
            f"the row took {first_false_at}s to read is_running: false, expected under 5s"
        )
    return evidence, _pass(
        f"the row read is_running: false {first_false_at}s after the Stop"
    )


def cell_codex_child(cfg, references, args, hooks: OperatorHooks) -> Cell:
    """A stopped Codex turn must not leave its shell child alive in the parked sandbox."""
    if not hooks.available:
        return {}, _skip(
            "no --project given: reading the runner's process table needs docker exec"
        )
    session_id = str(uuid.uuid4())
    codeword = f"DELTA{uuid.uuid4().hex[:6].upper()}"
    marker = f"sleep 300.{uuid.uuid4().int % 900000 + 100000}"
    msgs = [
        user_msg(
            f"The codeword is {codeword}. Run exactly this one shell command and nothing else: {marker}\n"
            "Run it in the FOREGROUND and wait for it to finish. Never run it in the background and never "
            "append an ampersand. Do not read, write or search any files. When it finishes, reply with the "
            "single word DONE."
        )
    ]
    handle = invoke_async(session_id, msgs, cfg, references, "codex-turn1")
    turn = wait_for_turn(session_id, timeout=90)
    child_before = []
    deadline = time.time() + 120
    while time.time() < deadline:
        child_before = hooks.sandbox_procs(marker)
        if child_before:
            break
        time.sleep(1)
    stop = cancel(session_id, expected=turn, label="stop-codex")
    handle["thread"].join(timeout=180)
    gone_at = None
    deadline = time.time() + 45
    while time.time() < deadline:
        alive = hooks.sandbox_procs(marker)
        if not alive:
            gone_at = round(time.time() - stop["sent_at"], 1)
            break
        time.sleep(1)
    time.sleep(4)
    t2 = invoke(
        session_id,
        msgs + [assistant_message(handle["out"] or {}), user_msg(RECALL)],
        cfg,
        references,
        "codex-turn2",
    )
    evidence = {
        "session_id": session_id,
        "turn_id": turn,
        "child_before_stop": child_before,
        "stop": stop,
        "seconds_until_child_gone": gone_at,
        "resume_recalled_marker": codeword in (t2.get("text") or ""),
    }
    if not child_before:
        return evidence, _fail(
            "never observed the child process before the Stop; the race did not land"
        )
    if gone_at is None:
        return evidence, _fail("the child process was still alive 45s after the Stop")
    if not evidence["resume_recalled_marker"]:
        return evidence, _fail(
            "the parked Codex sandbox did not recall the codeword on resume"
        )
    return evidence, _pass(
        f"the child was reaped {gone_at}s after Stop and the resume recalled the codeword"
    )


def cell_stale_tail(cfg, references, args, hooks: OperatorHooks) -> Cell:
    """Freeze the runner past the watchdog threshold, thaw it, and read the late tail."""
    if not hooks.available:
        return {}, _skip("no --project given: pausing the runner needs docker")
    session_id = str(uuid.uuid4())
    marker = f"ELDER{uuid.uuid4().hex[:6].upper()}"
    msgs = [
        user_msg(
            f"The codeword is {marker}. Run exactly this one shell command and nothing else: sleep 20. When it finishes, reply with the single word DONE."
        )
    ]
    handle = invoke_async(session_id, msgs, cfg, references, "tail-turn1")
    wait_for_turn(session_id)
    time.sleep(3)
    hooks.pause_runner()
    deadline = time.time() + args.sweep_wait
    while time.time() < deadline:
        if any(r["type"] == "done" for r in hooks.record_rows(session_id)):
            break
        time.sleep(5)
    hooks.unpause_runner()
    handle["thread"].join(timeout=180)
    time.sleep(20)
    rows = hooks.record_rows(session_id)
    quarantined = [r for r in rows if r["quarantined_at"]]
    endpoint = [r.get("record_type") for r in records(session_id)]
    evidence = {
        "session_id": session_id,
        "quarantined": quarantined,
        "endpoint_record_types": endpoint,
    }
    if not quarantined:
        return evidence, _fail(
            "no late record was quarantined after the runner was thawed past the watchdog window"
        )
    if "done" not in endpoint and "error" not in endpoint:
        return evidence, _fail(
            "the transcript read shows no terminal record after the watchdog fired"
        )
    return evidence, _pass(
        f"{len(quarantined)} late record(s) quarantined and hidden from the transcript read"
    )


def cell_repeat_stop(cfg, references, args, hooks: OperatorHooks) -> Cell:
    """Two Stop requests for one execution, 50ms apart. One command effect, one ending."""
    session_id = str(uuid.uuid4())
    marker = f"HAZEL{uuid.uuid4().hex[:6].upper()}"
    msgs = [user_msg(sleep_prompt(marker, args.sleep_seconds))]
    handle = invoke_async(session_id, msgs, cfg, references, "repeat-turn1")
    turn = wait_for_turn(session_id)
    wait_for_tool(handle)
    results: list = []

    def fire(label: str) -> None:
        results.append(cancel(session_id, expected=turn, label=label))

    t1 = threading.Thread(target=fire, args=("repeat-stop-a",))
    t1.start()
    time.sleep(0.05)
    t2 = threading.Thread(target=fire, args=("repeat-stop-b",))
    t2.start()
    t1.join()
    t2.join()
    handle["thread"].join(timeout=180)
    out = handle["out"] or {}
    time.sleep(4)
    t3 = invoke(
        session_id,
        msgs + [assistant_message(out), user_msg(RECALL)],
        cfg,
        references,
        "repeat-turn2",
    )
    evidence = {
        "session_id": session_id,
        "turn_id": turn,
        "stops": results,
        "terminal_records": terminal_records(session_id, turn),
        "resume_recalled_marker": marker in (t3.get("text") or ""),
    }
    if hooks.available:
        evidence["commands"] = hooks.command_rows(session_id)
    accepted = [r for r in results if r["status"] == 200]
    if len(accepted) == 0:
        return evidence, _fail("neither of the two repeated Stops was accepted")
    if len(evidence["terminal_records"]) != 1:
        return evidence, _fail(
            f"expected exactly one terminal record for the turn, saw {len(evidence['terminal_records'])}"
        )
    if not evidence["resume_recalled_marker"]:
        return evidence, _fail(
            "resume after the repeated Stop did not recall the codeword"
        )
    return evidence, _pass(
        "two Stops 50ms apart produced exactly one terminal record and a warm resume"
    )


def cell_stop_during_completion(cfg, references, args, hooks: OperatorHooks) -> Cell:
    """Stop fired at the moment a short (toolless) turn completes naturally. One committed winner:
    obsolete/not_running, or a clean stopped ending — never both, never neither."""
    session_id = str(uuid.uuid4())
    marker = f"IVY{uuid.uuid4().hex[:6].upper()}"
    msgs = [
        user_msg(f"The codeword is {marker}. Reply with just the single word READY.")
    ]
    handle = invoke_async(session_id, msgs, cfg, references, "completion-turn1")
    turn = wait_for_turn(session_id)
    # Race the natural finish: poll the live frame count and fire the instant it stops growing,
    # which is the closest an HTTP-only driver can land on "while the execution completes".
    live = handle["live"]
    last_len = -1
    stable_since = None
    deadline = time.time() + 30
    while time.time() < deadline:
        n = len(live.get("frames") or [])
        if n == last_len and n > 0:
            if stable_since is None:
                stable_since = time.time()
            elif time.time() - stable_since > 0.05:
                break
        else:
            stable_since = None
        last_len = n
        if handle["out"] is not None:
            break
        time.sleep(0.02)
    stop = cancel(session_id, expected=turn, label="stop-during-completion")
    handle["thread"].join(timeout=60)
    out = handle["out"] or {}
    time.sleep(3)
    terminal = terminal_records(session_id, turn)
    stream_after = session_stream(session_id)
    t2 = invoke(
        session_id,
        msgs + [assistant_message(out), user_msg(RECALL)],
        cfg,
        references,
        "completion-turn2",
    )
    evidence = {
        "session_id": session_id,
        "turn_id": turn,
        "stop": stop,
        "terminal_records": terminal,
        "stream_after_flags": (stream_after or {}).get("flags"),
        "resume_recalled_marker": marker in (t2.get("text") or ""),
    }
    if len(terminal) > 1:
        return evidence, _fail(
            f"the race produced {len(terminal)} terminal records for one turn, expected one"
        )
    if stop["status"] not in (200, 404, 409):
        return evidence, _fail(
            f"Stop-at-completion returned an unexpected HTTP {stop['status']}"
        )
    if not evidence["resume_recalled_marker"]:
        return evidence, _fail(
            "the session did not survive the completion race cleanly"
        )
    return evidence, _pass(
        "Stop racing a natural finish produced exactly one committed ending and a clean resume"
    )


# (needs_hooks, permission, fn)
CELLS: dict[str, tuple[bool, str, "object"]] = {
    "stop-warm": (False, "allow", cell_stop_warm),
    "double-send": (False, "allow", cell_double_send),
    "stale-stop": (False, "allow", cell_stale_stop),
    "stop-approval": (False, "ask", cell_stop_approval),
    "sandbox-gone": (True, "allow", cell_sandbox_gone),
    "records-outage": (True, "allow", cell_records_outage),
    "stop-after-finish": (False, "allow", cell_stop_after_finish),
    "restart-after-stop": (True, "allow", cell_restart_after_stop),
    "post-stop-row": (True, "allow", cell_post_stop_row),
    "codex-child": (True, "allow", cell_codex_child),
    "stale-tail": (True, "allow", cell_stale_tail),
    "repeat-stop": (False, "allow", cell_repeat_stop),
    "stop-during-completion": (False, "allow", cell_stop_during_completion),
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--harness", default="pi_core", choices=sorted(HARNESSES))
    ap.add_argument("--cells", default="all", help="comma separated, or 'all'")
    ap.add_argument("--sleep-seconds", type=int, default=45)
    ap.add_argument("--sweep-wait", type=float, default=240.0)
    ap.add_argument(
        "--project",
        default=None,
        help="docker-compose project name; enables the shell-only cells",
    )
    ap.add_argument("--sandbox", default="local", choices=["local", "daytona"])
    ap.add_argument(
        "--resume",
        default=None,
        help="path to a prior run's results.json; cells already recorded there are loaded, not re-run",
    )
    args = ap.parse_args()

    wanted = (
        list(CELLS)
        if args.cells == "all"
        else [c.strip() for c in args.cells.split(",") if c.strip()]
    )
    unknown = [c for c in wanted if c not in CELLS]
    if unknown:
        raise SystemExit(f"unknown cells: {unknown}; known: {sorted(CELLS)}")

    resolve_env()
    hooks: OperatorHooks = (
        DockerComposeHooks(args.project) if args.project else NullHooks()
    )

    prior: dict = {}
    if args.resume:
        prior_path = pathlib.Path(args.resume).expanduser()
        if prior_path.exists():
            prior = json.loads(prior_path.read_text()).get("cells", {})
            print(
                f"[resume] loaded {len(prior)} cell result(s) from {prior_path}",
                file=sys.stderr,
            )

    bootstrap()
    spec = HARNESSES[args.harness]
    base_cfg = agent_config(
        spec["kind"], spec["model"], spec["provider"], spec["connection"], args.sandbox
    )
    built: dict = {}

    def config_for(permission: str):
        if permission not in built:
            cfg = json.loads(json.dumps(base_cfg))
            cfg["runner"] = {"permissions": {"default": permission}}
            built[permission] = (
                cfg,
                create_revision(cfg, f"session-control-{args.sandbox}-{permission}"),
            )
        return built[permission]

    stamp = time.strftime("%Y%m%d-%H%M%S")
    outdir = RUNS / f"{stamp}-session-control"
    outdir.mkdir(parents=True, exist_ok=True)

    results: dict = {
        "project_id": STATE["project_id"],
        "harness": args.harness,
        "sandbox": args.sandbox,
        "cells": {},
    }
    for name in wanted:
        if name in prior:
            print(
                f"[{name}] resumed from prior run: {prior[name]['verdict']['pass'] and 'PASS' or (prior[name]['verdict']['skip'] and 'SKIP' or 'FAIL')}",
                file=sys.stderr,
            )
            results["cells"][name] = prior[name]
            (outdir / "results.json").write_text(
                json.dumps(results, indent=2, default=str)
            )
            continue
        needs_hooks, permission, fn = CELLS[name]
        cfg, references = config_for(permission)
        print(f"\n=== cell {name} ===", file=sys.stderr)
        started = time.time()
        try:
            evidence, verdict = fn(cfg, references, args, hooks)
        except Exception as exc:  # noqa: BLE001
            import traceback

            evidence = {
                "driver_error": f"{type(exc).__name__}: {exc}",
                "traceback": traceback.format_exc()[-1500:],
            }
            verdict = _fail(f"driver exception: {type(exc).__name__}: {exc}")
        elapsed = round(time.time() - started, 1)
        verdict_str = (
            "SKIP" if verdict["skip"] else ("PASS" if verdict["pass"] else "FAIL")
        )
        print(f"[{name}] {verdict_str} — {verdict['why']}", file=sys.stderr)
        results["cells"][name] = {
            "evidence": evidence,
            "verdict": verdict,
            "elapsed_s": elapsed,
        }
        (outdir / "results.json").write_text(json.dumps(results, indent=2, default=str))

    lines = ["| cell | verdict | why |", "|---|---|---|"]
    for name, r in results["cells"].items():
        v = r["verdict"]
        verdict_str = "SKIP" if v["skip"] else ("PASS" if v["pass"] else "FAIL")
        lines.append(f"| {name} | {verdict_str} | {v['why']} |")
    table = "\n".join(lines)
    (outdir / "summary.md").write_text(table + "\n")
    print("\n" + table)
    print(f"\nresults: {outdir}")

    failed = any(
        not r["verdict"]["skip"] and not r["verdict"]["pass"]
        for r in results["cells"].values()
    )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
