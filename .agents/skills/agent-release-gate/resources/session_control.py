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
# Only required when --harness claude is selected; checked in bootstrap(), not resolve_env(),
# so a pi_core/codex-only run never needs it set.
ANTHROPIC_KEY = ""

# Set in main() from --sandbox: Daytona sandboxes take 10 to 20s to start, on top of whatever a
# local sandbox needs, so every wait that assumes "local" gets this much extra slack.
SANDBOX_STARTUP_SLACK_S = 0.0

# Set in main() from --client-shape. "full" (default) replays the whole transcript on every
# send, like this driver always has, so existing results stay comparable. "last-message"
# reshapes every outbound `messages` list the way the desktop client does — see
# _client_shape_messages() below.
CLIENT_SHAPE = "full"

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
    global ANTHROPIC_KEY
    ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")


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

    def sandbox_procs(self, marker: str, sandbox_id: str | None = None) -> list[dict]:
        raise HooksUnavailable

    def stream_row(self, session_id: str) -> dict:
        raise HooksUnavailable

    def record_rows(self, session_id: str) -> list[dict]:
        raise HooksUnavailable

    def command_rows(self, session_id: str) -> list[dict]:
        raise HooksUnavailable

    def wait_for_runner(self, *, timeout: float = 120.0) -> float | None:
        raise HooksUnavailable

    def ensure_runner_healthy(self, *, timeout: float = 120.0) -> dict:
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

    def kill_sandbox(self, sandbox_id: str | None = None) -> list[str]:
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

    def sandbox_procs(self, marker: str, sandbox_id: str | None = None) -> list[dict]:
        # A local sandbox IS a subprocess of the runner container, so `ps` inside the runner
        # sees it regardless of which session owns it. `sandbox_id` is accepted for interface
        # parity with the Daytona-aware hook (which needs it to pick a remote sandbox) and
        # ignored here.
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

    def ensure_runner_healthy(self, *, timeout: float = 120.0) -> dict:
        """Recover the runner container to running and healthy, whatever a cell left it in.

        `run_cell()` calls this in a `finally` block after every cell that needs hooks, so a
        cell that pauses, stops, or restarts the runner and then raises before its own restore
        code runs does not strand the runner paused or down for the next cell.
        """
        paused = (
            self.dc(
                "inspect", "-f", "{{.State.Paused}}", f"{self.project}-runner-1"
            ).strip()
            == "true"
        )
        if paused:
            self.unpause_runner()
        status = self.dc(
            "inspect", "-f", "{{.State.Status}}", f"{self.project}-runner-1"
        ).strip()
        if status != "running":
            self.restart_runner()
        healthy_after_s = self.wait_for_runner(timeout=timeout)
        return {
            "was_paused": paused,
            "status_before": status,
            "healthy_after_s": healthy_after_s,
        }

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

    def kill_sandbox(self, sandbox_id: str | None = None) -> list[str]:
        # A local sandbox is a subprocess of the runner container: there is only ever one
        # `sandbox-agent server` process family running there per cell, so `sandbox_id` (accepted
        # for interface parity with the Daytona-aware hook) is not needed to target it.
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


class DaytonaAwareHooks(DockerComposeHooks):
    """`DockerComposeHooks` plus a Daytona-provider-aware `kill_sandbox` and `sandbox_procs`.

    A local sandbox is a subprocess of the runner container, so the base class's `docker exec ps`
    sees it. A Daytona sandbox is a remote machine: `docker exec` into the runner container never
    sees the sandbox's process table, and killing a local process cannot end a remote sandbox. So
    for `--sandbox daytona` this hook ends the sandbox and lists its processes through the same
    Daytona REST API the runner itself uses (`services/runner/src/engines/sandbox_agent/
    daytona-provider.ts`'s `sandbox.delete()`, and the vendored `sandbox-agent/daytona` provider's
    `runProcess`, which `reap-exec.ts` drives with the identical `ps -eo pid=,ppid=,etimes=,args=`
    used below).

    Every call is scoped to the ONE sandbox id the cell observed for its own session
    (`sandbox_ids(session_id)` in the driver, threaded in by the caller) — never a list, never a
    wildcard. Credentials come from `AGENTA_RUNNER_DAYTONA_API_KEY` / `AGENTA_RUNNER_DAYTONA_API_URL`
    (export only; never logged, never put in an exception message).
    """

    def __init__(self, project: str) -> None:
        super().__init__(project)
        missing = [
            name
            for name in (
                "AGENTA_RUNNER_DAYTONA_API_KEY",
                "AGENTA_RUNNER_DAYTONA_API_URL",
            )
            if not os.environ.get(name)
        ]
        if missing:
            raise SystemExit(
                "--sandbox daytona needs " + ", ".join(missing) + " exported (from the "
                "integration env file's AGENTA_RUNNER_DAYTONA_* block) so sandbox-gone and "
                "codex-child can reach the Daytona API directly."
            )
        self._daytona_api_url = os.environ["AGENTA_RUNNER_DAYTONA_API_URL"].rstrip("/")
        self._daytona_api_key = os.environ["AGENTA_RUNNER_DAYTONA_API_KEY"]

    @staticmethod
    def _bare_id(sandbox_id: str) -> str:
        """`sandbox_ids()` returns ids like `daytona/<uuid>`; the Daytona API wants the bare uuid."""
        return sandbox_id.split("/", 1)[1] if "/" in sandbox_id else sandbox_id

    def _daytona_get(self, path: str) -> httpx.Response:
        return httpx.get(
            f"{self._daytona_api_url}{path}",
            headers={"Authorization": f"Bearer {self._daytona_api_key}"},
            timeout=30.0,
        )

    def _daytona_delete(self, path: str) -> httpx.Response:
        return httpx.delete(
            f"{self._daytona_api_url}{path}",
            headers={"Authorization": f"Bearer {self._daytona_api_key}"},
            timeout=30.0,
        )

    def kill_sandbox(self, sandbox_id: str | None = None) -> list[str]:
        if not sandbox_id:
            return []
        bare = self._bare_id(sandbox_id)
        try:
            resp = self._daytona_delete(f"/sandbox/{bare}")
        except Exception as exc:  # noqa: BLE001
            print(
                f"[daytona] delete sandbox={bare} failed: {exc}",
                file=sys.stderr,
            )
            return []
        # DELETE /sandbox/{id} is what `sandbox.delete()` calls on this same SDK/API version
        # (Sandbox.js -> SandboxApi.deleteSandbox); a 404 means it is already gone, also success
        # for "the sandbox is gone" purposes.
        if resp.status_code not in (200, 202, 204, 404):
            print(
                f"[daytona] delete sandbox={bare} returned {resp.status_code}: "
                f"{resp.text[:200]}",
                file=sys.stderr,
            )
            return []
        return [bare]

    def sandbox_procs(self, marker: str, sandbox_id: str | None = None) -> list[dict]:
        if not sandbox_id:
            return []
        bare = self._bare_id(sandbox_id)
        try:
            proxy = self._daytona_get(f"/sandbox/{bare}/toolbox-proxy-url")
            if proxy.status_code != 200:
                print(
                    f"[daytona] toolbox-proxy-url sandbox={bare} returned "
                    f"{proxy.status_code}: {proxy.text[:200]}",
                    file=sys.stderr,
                )
                return []
            proxy_url = (proxy.json() or {}).get("url")
            if not proxy_url:
                print(
                    f"[daytona] toolbox-proxy-url sandbox={bare} returned no url",
                    file=sys.stderr,
                )
                return []
            # Same shape as `reap-exec.ts`'s `PS_ARGS` (`-eo pid=,ppid=,etimes=,args=`): the `=`
            # suffixes drop the header line, so every returned line is a data row.
            exec_resp = httpx.post(
                f"{proxy_url.rstrip('/')}/process/execute",
                json={"command": "ps -eo pid=,ppid=,etimes=,args=", "timeout": 10},
                timeout=20.0,
            )
        except Exception as exc:  # noqa: BLE001
            print(
                f"[daytona] process listing sandbox={bare} failed: {exc}",
                file=sys.stderr,
            )
            return []
        if exec_resp.status_code != 200:
            print(
                f"[daytona] process/execute sandbox={bare} returned "
                f"{exec_resp.status_code}: {exec_resp.text[:200]}",
                file=sys.stderr,
            )
            return []
        raw = (exec_resp.json() or {}).get("result", "") or ""
        hits = []
        for line in raw.splitlines():
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


def select_hooks(project: str | None, sandbox: str) -> OperatorHooks:
    """The provider switch: no `--project` is NullHooks regardless of `--sandbox`; with a
    project, `--sandbox daytona` needs the Daytona-aware hook (docker exec cannot see or touch a
    remote sandbox), everything else gets the plain docker-compose hook. Pulled out of `main()` so
    it is unit-testable without a live stack.
    """
    if not project:
        return NullHooks()
    if sandbox == "daytona":
        return DaytonaAwareHooks(project)
    return DockerComposeHooks(project)


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
    "claude": {
        # `sonnet` alias, not a full model id: a full id is dropped to the default on the Claude
        # ACP path (qa_product.py F-007). VAULT key (mode "agenta"), not subscription: this
        # driver's cells run on Daytona too, and Daytona rejects subscription auth by design.
        "kind": "claude",
        "model": "sonnet",
        "provider": "anthropic",
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


def bootstrap(harness: str = "pi_core") -> None:
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

    if harness == "claude":
        # The claude harness's vault connection (agent_config mode "agenta") needs a funded
        # Anthropic key, the same way the OpenAI key above covers pi_core and codex. Checked
        # here, not in resolve_env(), so a pi_core/codex-only run never needs it set.
        if not ANTHROPIC_KEY:
            raise SystemExit(
                "Missing environment variable: ANTHROPIC_API_KEY. Required for --harness "
                "claude (the vault connection needs a funded Anthropic key). "
                "e.g. export ANTHROPIC_API_KEY=...   # ~/.agenta-qa-secrets.env"
            )
        r = api(
            "POST",
            "/vault/v1/secrets/",
            json={
                "header": {"name": "Anthropic", "description": "session-control gate"},
                "secret": {
                    "kind": "provider_key",
                    "data": {"kind": "anthropic", "provider": {"key": ANTHROPIC_KEY}},
                },
            },
        )
        if r.status_code != 200:
            raise SystemExit(f"vault create HTTP {r.status_code}: {r.text[:400]}")
        print(
            "[bootstrap] vault stocked with an anthropic provider key", file=sys.stderr
        )


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


def _is_answer_part(part: dict) -> bool:
    """Mirrors `isAnswerPart` in agentRequest.ts (web/packages/agenta-playground/src/state/
    execution/agentRequest.ts): a non-empty text part, a tool part (`tool-*`), a
    `dynamic-tool` part, or a `file` part."""
    t = part.get("type") if isinstance(part, dict) else None
    if not isinstance(t, str):
        return False
    if t == "text":
        text = part.get("text")
        return isinstance(text, str) and text.strip() != ""
    return t.startswith("tool-") or t in ("dynamic-tool", "file")


def _has_answer(message: dict) -> bool:
    """Mirrors `hasAnswer` in agentRequest.ts: a user (non-assistant) message always counts;
    an assistant message counts only if at least one of its parts is an answer part. Strips an
    answer-less assistant turn so it cannot cascade into every later turn failing."""
    if message.get("role") != "assistant":
        return True
    parts = message.get("parts")
    return isinstance(parts, list) and any(_is_answer_part(p) for p in parts)


def _client_shape_messages(messages: list) -> list:
    """Shape the outbound `messages` list the way the desktop client does (agentRequest.ts),
    when `--client-shape last-message` is selected. A no-op under the default `full`.

    Strip answer-less assistant turns, then send only the trailing message when it is a fresh
    user turn — the runner rebuilds prior turns from the durable record log. A resume whose
    trailing turn carries a settled HITL answer (not a user turn) keeps the full history so the
    answer still binds to its tool call.
    """
    if CLIENT_SHAPE != "last-message":
        return messages
    history = [m for m in messages if _has_answer(m)]
    if not history:
        return history
    if history[-1].get("role") == "user":
        return [history[-1]]
    return history


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
        "data": {
            "inputs": {"messages": _client_shape_messages(messages)},
            "parameters": {"agent": cfg},
        },
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
    # `turn` can be `{}` when the driver's own wait for the turn timed out (`handle["out"]` was
    # never set, e.g. because the runner was unhealthy and the stream thread never finished) — a
    # driver-side timeout, not a reason to crash the cell with a KeyError instead of reporting a
    # FAIL. Missing segments means no assistant turn to replay.
    for seg in turn.get("segments") or []:
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


def turn_ledger(session_id: str, limit: int = 20) -> list[dict]:
    """The session's turn rows, newest first, over HTTP only (no docker needed).

    The runner writes `agent_session_id` and `sandbox_id` on every turn, so this is a STORED
    outcome, not an echo of what the client sent. Used to check the resume after a Stop landed
    in the SAME sandbox rather than a rebuilt one.
    """
    r = api(
        "POST",
        "/sessions/turns/query",
        json={
            "query": {"session_id": session_id},
            "windowing": {"limit": limit, "order": "descending"},
        },
    )
    if r.status_code != 200:
        return []
    try:
        body = r.json()
    except Exception:  # noqa: BLE001
        return []
    turns = body.get("turns") if isinstance(body, dict) else None
    return turns if isinstance(turns, list) else []


def sandbox_ids(session_id: str) -> list[str]:
    """Distinct sandbox ids across the session's turn ledger.

    ONE id = the resume reused the same sandbox (warm). TWO or more = the sandbox was rebuilt.
    """
    return sorted(
        {r.get("sandbox_id") for r in turn_ledger(session_id) if r.get("sandbox_id")}
    )


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
    deadline = time.time() + timeout + SANDBOX_STARTUP_SLACK_S
    while time.time() < deadline:
        stream = session_stream(session_id)
        turn = stream.get("turn_id")
        flags = stream.get("flags") or {}
        if turn and flags.get("is_running"):
            return turn
        time.sleep(0.5)
    return None


def wait_for_tool(handle: dict, *, timeout: float = 60.0) -> dict | None:
    deadline = time.time() + timeout + SANDBOX_STARTUP_SLACK_S
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


def _judge_runner_gone(evidence: dict) -> dict:
    """Shared PASS rule for the runner-gone family (`runner-gone`, `runner-gone-late`).

    The invariant: exactly one effective terminal outcome for the execution, no command left
    pending or claimed, is_running false, and the next Send succeeds. Two different races can
    land this — the runner reports the Stop's outcome before it dies (`outcome-reported-then-
    died`), or it never gets the chance and the sweep settles the command `lost`
    (`never-reported`) — and both satisfy the invariant, so both PASS. Which one landed is
    recorded on `evidence["race"]` for visibility, not asserted on. Mutates `evidence` in place.
    """
    if not evidence.get("terminal_records"):
        return _fail("no terminal record settled within the sweep-wait window")
    stop_command = evidence.get("stop_command")
    if stop_command is None:
        return _fail("no session_commands row was found for the Stop")
    if stop_command.get("state") not in ("obsolete", "applied"):
        return _fail(
            f"the Stop command read state {stop_command.get('state')!r}, expected obsolete or applied"
        )
    outcome = stop_command.get("outcome")
    if outcome in (None, "", "pending", "claimed"):
        return _fail(
            f"the Stop command was left {outcome!r}: still pending or claimed, never settled"
        )
    stream_row = evidence.get("stream_row") or {}
    if (stream_row.get("flags") or {}).get("is_running") is not False:
        return _fail(
            "the session_streams row did not read is_running: false after the sweep settled "
            "the command"
        )
    if not evidence.get("new_message_ran"):
        return _fail("the Send sent after recovery did not run cleanly")
    race = "never-reported" if outcome == "lost" else "outcome-reported-then-died"
    evidence["race"] = race
    return _pass(
        f"race {race}: the Stop command settled off pending/claimed, is_running read false, "
        "and the next Send ran"
    )


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
    evidence["sandbox_ids"] = sandbox_ids(session_id)
    evidence["warm_same_sandbox"] = len(evidence["sandbox_ids"]) <= 1
    if stop["status"] not in (200, 202):
        return evidence, _fail(
            f"Stop returned HTTP {stop['status']}, expected 200 or 202"
        )
    if not evidence["resume_recalled_marker"]:
        return evidence, _fail("warm resume did not recall the codeword")
    return evidence, _pass(
        f"Stop returned HTTP {stop['status']} and the warm resume recalled the codeword"
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
    evidence["sandbox_ids"] = sandbox_ids(session_id)
    evidence["warm_same_sandbox"] = len(evidence["sandbox_ids"]) <= 1
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
    evidence["sandbox_ids"] = sandbox_ids(session_id)
    evidence["warm_same_sandbox"] = len(evidence["sandbox_ids"]) <= 1
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
        # Without the actual reply, a FAIL here cannot be told apart from a driver replay bug
        # (the reconstructed `output-denied` part shaped wrong) versus the model genuinely not
        # recalling the codeword -- keep enough of the wire to tell the two apart after the fact.
        "resume_text": (t2.get("text") or "")[:400],
        "resume_frames": t2.get("frames", [])[:20],
        "resume_errors": t2.get("errors"),
    }
    evidence["sandbox_ids"] = sandbox_ids(session_id)
    evidence["warm_same_sandbox"] = len(evidence["sandbox_ids"]) <= 1
    if pending is None:
        return evidence, _fail(
            "no pending approval was seen before the Stop; the race did not land"
        )
    if stop["status"] not in (200, 202):
        return evidence, _fail(
            f"named Stop on a parked approval returned HTTP {stop['status']}, expected 200 or 202"
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
    # The sandbox id this session's own turn ledger observed. On daytona this is the ONE sandbox
    # `kill_sandbox` is allowed to touch (DaytonaAwareHooks); on local it is unused (a local
    # sandbox is a subprocess of the runner container, found by ps regardless of id).
    observed_ids = sandbox_ids(session_id)
    target_sandbox_id = observed_ids[-1] if observed_ids else None
    killed = hooks.kill_sandbox(sandbox_id=target_sandbox_id)
    handle["thread"].join(timeout=300)
    t1 = handle["out"] or {}
    time.sleep(5)
    evidence = {
        "session_id": session_id,
        "turn_id": turn,
        "target_sandbox_id": target_sandbox_id,
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
    try:
        time.sleep(20)
    finally:
        # Restore Postgres even if something above raises: a stopped Postgres left behind
        # strands every cell that runs after this one, not just this one's own assertions.
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
    evidence["sandbox_ids"] = sandbox_ids(session_id)
    evidence["warm_same_sandbox"] = len(evidence["sandbox_ids"]) <= 1
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
    """Stop, restart the runner, continue with an EMPTY client transcript.

    The codeword recall alone is not proof of native continuity: when the native session did not
    truly hydrate, the runner can still answer correctly by reconstructing the conversation from
    the persisted record log (the `[reconstruct]` / `session/load ... loaded=false` path), and a
    driver that ever sent more than the trailing message could paper over the same gap from the
    client side. So this cell forces its resume onto `--client-shape last-message` (the shape the
    desktop actually sends) regardless of the run's own `--client-shape`, and requires a SECOND,
    independent signal beyond the recalled codeword: either the sandbox id after the restart is
    the SAME one the turn ran on before it (true continuity needs no rebuild), or the runner log
    for the resume shows `session/load ... loaded=true` (a genuine native hydrate, not a
    reconstruction). Recall without either is a false pass, not a pass.
    """
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
    sandbox_id_before = (sandbox_ids(session_id) or [None])[-1]
    restart_at = time.time()
    hooks.restart_runner(grace_seconds=10)
    healthy_after = hooks.wait_for_runner()
    attempts = []
    admitted = None
    global CLIENT_SHAPE
    prior_client_shape = CLIENT_SHAPE
    CLIENT_SHAPE = "last-message"
    try:
        deadline = time.time() + 240
        while time.time() < deadline:
            t = invoke(
                session_id, [user_msg(RECALL)], cfg, references, "restart-recall"
            )
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
    finally:
        CLIENT_SHAPE = prior_client_shape
    sandbox_id_after = (sandbox_ids(session_id) or [None])[-1]
    resume_log = [
        line
        for line in hooks.runner_log(restart_at)
        if session_id in line and "session/load" in line
    ]
    loaded_true = any("loaded=true" in line for line in resume_log)
    same_sandbox = bool(sandbox_id_before) and sandbox_id_before == sandbox_id_after
    evidence = {
        "session_id": session_id,
        "turn_id": turn,
        "stop": stop,
        "runner_healthy_after_s": healthy_after,
        "attempts": attempts,
        "admitted_at_s": attempts[-1]["at_s_after_restart"] if admitted else None,
        "recalled_marker": marker in ((admitted or {}).get("text") or ""),
        "sandbox_id_before": sandbox_id_before,
        "sandbox_id_after": sandbox_id_after,
        "same_sandbox": same_sandbox,
        "resume_load_log_lines": resume_log,
        "loaded_true": loaded_true,
    }
    return evidence, _judge_restart_after_stop(evidence)


def _judge_restart_after_stop(evidence: dict) -> dict:
    """PASS rule for `restart-after-stop`. A recalled codeword alone is not proof of native
    continuity — the runner can recover it by reconstructing the conversation from persisted
    records even when the native session did not truly hydrate. Require the recall AND one of:
    the sandbox was not rebuilt (`same_sandbox`), or the runner log shows a genuine native hydrate
    (`loaded_true`). See `cell_restart_after_stop`'s docstring for why."""
    if evidence.get("runner_healthy_after_s") is None:
        return _fail("the runner never reported healthy after the restart")
    if evidence.get("admitted_at_s") is None:
        return _fail(
            "the continuation was refused for the whole wait window after the restart"
        )
    if not evidence.get("recalled_marker"):
        return _fail(
            "the native harness session did not survive the restart: the codeword was not recalled"
        )
    if not (evidence.get("same_sandbox") or evidence.get("loaded_true")):
        return _fail("native session not resumed, recovered by transcript replay")
    return _pass(
        "the runner rehydrated the native session across a restart and recalled the codeword"
    )


def cell_runner_gone(cfg, references, args, hooks: OperatorHooks) -> Cell:
    """Pause the runner BEFORE the Stop, so the command can never be claimed or reported.

    Deterministic version of the hard race: hoping a restart lands between the Stop and the
    runner's own outcome report is timing-dependent and mostly loses the race (see
    `runner-gone-late`). Pausing first removes the timing dependency: the runner cannot claim
    or report the command at all, so it must stay `pending` until the stale threshold and the
    sweep interval both pass (--sweep-wait), at which point the sweep must settle it `lost`
    (state `obsolete` or `applied`, outcome `lost`) and write the execution's own watchdog
    `execution_lost` ending. Unpause, confirm healthy, then send the next message.
    """
    if not hooks.available:
        return {}, _skip("no --project given: pausing the runner needs docker")
    session_id = str(uuid.uuid4())
    marker = f"FIG{uuid.uuid4().hex[:6].upper()}"
    msgs = [user_msg(sleep_prompt(marker, 240))]
    handle = invoke_async(session_id, msgs, cfg, references, "gone-turn1")
    turn = wait_for_turn(session_id)
    time.sleep(5)

    hooks.pause_runner()
    try:
        # The runner is paused: it cannot claim or report the Stop. Fire it anyway — the API
        # accepts and enqueues the command whether or not the runner is reachable.
        stop = cancel(session_id, expected=turn, label="stop-then-pause")
        stop_at = time.time()

        # Wait for the sweep. The plan budgets the stale threshold plus the sweep interval,
        # held in --sweep-wait.
        settled_at = None
        terminal: list = []
        deadline = time.time() + args.sweep_wait
        while time.time() < deadline:
            stream = session_stream(session_id)
            flags = stream.get("flags") or {}
            terminal = terminal_records(session_id, turn)
            if terminal and not flags.get("is_running"):
                settled_at = time.time()
                break
            time.sleep(5)

        time.sleep(3)
        commands = hooks.command_rows(session_id)
        stream_row = hooks.stream_row(session_id)
    finally:
        # Unpause even if the wait above raises: a paused runner left behind strands every
        # cell that runs after this one.
        hooks.unpause_runner()
    healthy_after_s = hooks.wait_for_runner()

    matching = [c for c in commands if turn and c.get("target_turn_id") == turn]
    stop_command = matching[-1] if matching else (commands[-1] if commands else None)

    handle["thread"].join(timeout=60)
    t2 = invoke(
        session_id,
        [user_msg(f"The codeword is {marker}. Reply with just the single word READY.")],
        cfg,
        references,
        "gone-turn2",
    )
    evidence = {
        "session_id": session_id,
        "turn_id": turn,
        "stop": stop,
        "seconds_to_settle": round(settled_at - stop_at, 1) if settled_at else None,
        "terminal_records": terminal,
        "stream_after": session_stream(session_id),
        "commands": commands,
        "stop_command": stop_command,
        "stream_row": stream_row,
        "healthy_after_unpause_s": healthy_after_s,
        "new_message_ran": bool(t2.get("frames")) and not t2.get("errors"),
        "new_message_errors": t2.get("errors"),
    }
    if healthy_after_s is None:
        return evidence, _fail("the runner never reported healthy after the unpause")
    if settled_at is None:
        return evidence, _fail(
            "no terminal record settled within the sweep-wait window while the runner was paused"
        )
    if stop_command is None:
        return evidence, _fail("no session_commands row was found for the Stop")
    if stop_command.get("state") not in ("obsolete", "applied"):
        return evidence, _fail(
            f"the Stop command read state {stop_command.get('state')!r}, expected obsolete or applied"
        )
    if stop_command.get("outcome") != "lost":
        return evidence, _fail(
            f"the Stop command read outcome {stop_command.get('outcome')!r}, expected lost: a "
            "paused runner should never have been able to report it"
        )
    watchdog_ending = [
        r
        for r in terminal
        if r.get("type") == "error"
        and (r.get("attributes") or {}).get("code") == "execution_lost"
        and (r.get("attributes") or {}).get("settled_by") == "watchdog"
    ]
    if not watchdog_ending:
        return evidence, _fail(
            "no watchdog execution_lost ending was found among the terminal records"
        )
    evidence["race"] = "never-reported"
    if (stream_row.get("flags") or {}).get("is_running") is not False:
        return evidence, _fail(
            "the session_streams row did not read is_running: false after the sweep settled the command"
        )
    if not evidence["new_message_ran"]:
        return evidence, _fail("the Send sent after the unpause did not run cleanly")
    return evidence, _pass(
        "pausing the runner first deterministically forced the never-reported race: the sweep "
        "settled the Stop lost with a watchdog execution_lost ending, the stream row read "
        "is_running: false, and the next Send ran"
    )


def cell_runner_gone_late(cfg, references, args, hooks: OperatorHooks) -> Cell:
    """Restart the runner right after a Stop is claimed, hoping it lands before the runner can
    report the outcome. The softer, timing-dependent sibling of `runner-gone`: a restart often
    loses this race (the runner reports the Stop's outcome before it actually dies), so this
    cell accepts either race the sweep can produce — see `_judge_runner_gone`.
    """
    if not hooks.available:
        return {}, _skip("no --project given: restarting the runner needs docker")
    session_id = str(uuid.uuid4())
    marker = f"FIG{uuid.uuid4().hex[:6].upper()}"
    msgs = [user_msg(sleep_prompt(marker, 240))]
    handle = invoke_async(session_id, msgs, cfg, references, "gone-late-turn1")
    turn = wait_for_turn(session_id)
    time.sleep(5)

    # Stop first, then take the runner away before it can (maybe) report the outcome.
    stop = cancel(session_id, expected=turn, label="stop-then-kill")
    kill_at = time.time()
    hooks.kill_runner()
    print(
        f"[runner-gone-late] restarted the runner at {time.strftime('%H:%M:%S')}",
        file=sys.stderr,
    )
    handle["thread"].join(timeout=60)

    # Wait for the sweep. The plan budgets the stale threshold plus the sweep interval, held in
    # --sweep-wait.
    settled_at = None
    terminal: list = []
    deadline = time.time() + args.sweep_wait
    while time.time() < deadline:
        stream = session_stream(session_id)
        flags = stream.get("flags") or {}
        terminal = terminal_records(session_id, turn)
        if terminal and not flags.get("is_running"):
            settled_at = time.time()
            break
        time.sleep(5)

    time.sleep(3)
    commands = hooks.command_rows(session_id)
    stream_row = hooks.stream_row(session_id)
    matching = [c for c in commands if turn and c.get("target_turn_id") == turn]
    stop_command = matching[-1] if matching else (commands[-1] if commands else None)
    t2 = invoke(
        session_id,
        [user_msg(f"The codeword is {marker}. Reply with just the single word READY.")],
        cfg,
        references,
        "gone-late-turn2",
    )
    evidence = {
        "session_id": session_id,
        "turn_id": turn,
        "stop": stop,
        "seconds_to_settle": round(settled_at - kill_at, 1) if settled_at else None,
        "terminal_records": terminal,
        "stream_after": session_stream(session_id),
        "commands": commands,
        "stop_command": stop_command,
        "stream_row": stream_row,
        "new_message_ran": bool(t2.get("frames")) and not t2.get("errors"),
        "new_message_errors": t2.get("errors"),
    }
    return evidence, _judge_runner_gone(evidence)


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
    # The sandbox id this session's turn ledger observed. On daytona, `sandbox_procs` needs this
    # to know which remote sandbox to list processes on (DaytonaAwareHooks); on local it is
    # unused (docker exec into the runner container sees every local sandbox subprocess).
    observed_ids = sandbox_ids(session_id)
    target_sandbox_id = observed_ids[-1] if observed_ids else None
    child_before = []
    deadline = time.time() + 120
    while time.time() < deadline:
        child_before = hooks.sandbox_procs(marker, sandbox_id=target_sandbox_id)
        if child_before:
            break
        if not target_sandbox_id:
            observed_ids = sandbox_ids(session_id)
            target_sandbox_id = observed_ids[-1] if observed_ids else None
        time.sleep(1)
    stop = cancel(session_id, expected=turn, label="stop-codex")
    handle["thread"].join(timeout=180)
    gone_at = None
    deadline = time.time() + 45
    while time.time() < deadline:
        alive = hooks.sandbox_procs(marker, sandbox_id=target_sandbox_id)
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
        "target_sandbox_id": target_sandbox_id,
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
    try:
        deadline = time.time() + args.sweep_wait
        while time.time() < deadline:
            if any(r["type"] == "done" for r in hooks.record_rows(session_id)):
                break
            time.sleep(5)
    finally:
        # A paused runner left behind strands every cell that runs after this one. Restore it
        # even if hooks.record_rows() above raises.
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
    evidence["sandbox_ids"] = sandbox_ids(session_id)
    evidence["warm_same_sandbox"] = len(evidence["sandbox_ids"]) <= 1
    if hooks.available:
        evidence["commands"] = hooks.command_rows(session_id)
    accepted = [r for r in results if r["status"] in (200, 202)]
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


def cell_concurrent_stops(cfg, references, args, hooks: OperatorHooks) -> Cell:
    """Five independent sessions, each with a long turn, all Stopped within one second.

    Every Stop must return HTTP 202, every session must read exactly one terminal record, and
    every session must recall its own codeword on a warm resume. HTTP-only: needs no shell.
    """
    n = 5
    sessions = []
    for i in range(n):
        session_id = str(uuid.uuid4())
        marker = f"NOVA{i}{uuid.uuid4().hex[:5].upper()}"
        msgs = [user_msg(sleep_prompt(marker, args.sleep_seconds))]
        handle = invoke_async(
            session_id, msgs, cfg, references, f"concurrent-turn1-{i}"
        )
        sessions.append(
            {"session_id": session_id, "marker": marker, "msgs": msgs, "handle": handle}
        )

    for s in sessions:
        s["turn_id"] = wait_for_turn(s["session_id"])
    missing_turn = [s["session_id"] for s in sessions if not s["turn_id"]]
    if missing_turn:
        evidence = {"n": n, "missing_turn_sessions": missing_turn}
        return evidence, _fail(
            f"{len(missing_turn)} of {n} sessions never reported a running turn"
        )
    time.sleep(2)

    def fire(s: dict) -> None:
        s["stop"] = cancel(
            s["session_id"],
            expected=s["turn_id"],
            label=f"concurrent-stop-{s['marker']}",
        )

    threads = [threading.Thread(target=fire, args=(s,)) for s in sessions]
    fired_at = time.time()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    stop_window_s = round(time.time() - fired_at, 3)

    for s in sessions:
        s["handle"]["thread"].join(timeout=180)
        s["out"] = s["handle"]["out"] or {}
    time.sleep(4)

    for s in sessions:
        s["terminal_records"] = terminal_records(s["session_id"], s["turn_id"])
        msgs2 = s["msgs"] + [assistant_message(s["out"]), user_msg(RECALL)]
        t2 = invoke(
            s["session_id"], msgs2, cfg, references, f"concurrent-turn2-{s['marker']}"
        )
        s["resume_recalled_marker"] = s["marker"] in (t2.get("text") or "")
        s["resume_text"] = (t2.get("text") or "")[:200]

    evidence = {
        "n": n,
        "stop_window_s": stop_window_s,
        "sessions": [
            {
                "session_id": s["session_id"],
                "turn_id": s["turn_id"],
                "stop_status": s["stop"]["status"],
                "stop_round_trip_s": s["stop"]["round_trip_s"],
                "terminal_record_count": len(s["terminal_records"]),
                "resume_recalled_marker": s["resume_recalled_marker"],
            }
            for s in sessions
        ],
    }
    not_202 = [s["session_id"] for s in sessions if s["stop"]["status"] != 202]
    if not_202:
        return evidence, _fail(
            f"{len(not_202)} of {n} concurrent Stops did not return HTTP 202: {not_202}"
        )
    bad_terminal = [
        s["session_id"] for s in sessions if len(s["terminal_records"]) != 1
    ]
    if bad_terminal:
        return evidence, _fail(
            f"{len(bad_terminal)} of {n} sessions did not read exactly one terminal record: "
            f"{bad_terminal}"
        )
    not_recalled = [
        s["session_id"] for s in sessions if not s["resume_recalled_marker"]
    ]
    if not_recalled:
        return evidence, _fail(
            f"{len(not_recalled)} of {n} sessions did not recall their codeword on resume: "
            f"{not_recalled}"
        )
    return evidence, _pass(
        f"all {n} concurrent Stops returned HTTP 202 within {stop_window_s}s, each session read "
        "exactly one terminal record, and each resumed warm with its own codeword"
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
    evidence["sandbox_ids"] = sandbox_ids(session_id)
    evidence["warm_same_sandbox"] = len(evidence["sandbox_ids"]) <= 1
    if len(terminal) > 1:
        return evidence, _fail(
            f"the race produced {len(terminal)} terminal records for one turn, expected one"
        )
    if stop["status"] not in (200, 202, 404, 409):
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
    "runner-gone": (True, "allow", cell_runner_gone),
    "runner-gone-late": (True, "allow", cell_runner_gone_late),
    "post-stop-row": (True, "allow", cell_post_stop_row),
    "codex-child": (True, "allow", cell_codex_child),
    "stale-tail": (True, "allow", cell_stale_tail),
    "repeat-stop": (False, "allow", cell_repeat_stop),
    "concurrent-stops": (False, "allow", cell_concurrent_stops),
    "stop-during-completion": (False, "allow", cell_stop_during_completion),
}


def run_cell(
    name: str, fn, cfg, references, args, hooks: OperatorHooks, needs_hooks: bool
) -> dict:
    """Run one cell and return its `results["cells"][name]` entry.

    A cell that pauses, stops, or restarts the runner restores it itself in its own `finally`
    block (see `cell_stale_tail` and `cell_records_outage`). This is the second, run-level
    guarantee: a cell that raises BEFORE its own restore code runs must not strand the runner
    paused or down for the cell that runs after it, so the recovery check here runs in a
    `finally` block too, no matter how the cell ends.
    """
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
    finally:
        if needs_hooks and hooks.available:
            try:
                recovery = hooks.ensure_runner_healthy()
            except Exception as exc:  # noqa: BLE001
                print(f"[{name}] runner-health recovery failed: {exc}", file=sys.stderr)
            else:
                if (
                    recovery.get("was_paused")
                    or recovery.get("status_before") != "running"
                ):
                    print(f"[{name}] recovered the runner: {recovery}", file=sys.stderr)
                if recovery.get("healthy_after_s") is None:
                    print(
                        f"[{name}] WARNING: the runner did not report healthy after recovery",
                        file=sys.stderr,
                    )
    elapsed = round(time.time() - started, 1)
    verdict_str = "SKIP" if verdict["skip"] else ("PASS" if verdict["pass"] else "FAIL")
    print(f"[{name}] {verdict_str} — {verdict['why']}", file=sys.stderr)
    return {"evidence": evidence, "verdict": verdict, "elapsed_s": elapsed}


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
        "--client-shape",
        default="full",
        choices=["full", "last-message"],
        help=(
            "full (default) replays the whole transcript on every send, keeping results "
            "comparable with prior runs. last-message sends only the new user message on "
            "every resume and follow-up, the way the desktop client does (agentRequest.ts) — "
            "use it to catch continuity bugs the full transcript masks."
        ),
    )
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
    hooks = select_hooks(args.project, args.sandbox)
    if args.sandbox == "daytona":
        global SANDBOX_STARTUP_SLACK_S
        SANDBOX_STARTUP_SLACK_S = 25.0
    global CLIENT_SHAPE
    CLIENT_SHAPE = args.client_shape

    prior: dict = {}
    if args.resume:
        prior_path = pathlib.Path(args.resume).expanduser()
        if prior_path.exists():
            prior = json.loads(prior_path.read_text()).get("cells", {})
            print(
                f"[resume] loaded {len(prior)} cell result(s) from {prior_path}",
                file=sys.stderr,
            )

    bootstrap(args.harness)
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

    # PID, not just the second-resolution timestamp: two invocations started in the same second
    # (e.g. two harnesses smoke-tested in parallel) would otherwise share a folder and the
    # second writer silently clobbers the first one's results.json mid-run.
    stamp = time.strftime("%Y%m%d-%H%M%S")
    outdir = RUNS / f"{stamp}-{os.getpid()}-session-control"
    outdir.mkdir(parents=True, exist_ok=True)

    results: dict = {
        "project_id": STATE["project_id"],
        "harness": args.harness,
        "sandbox": args.sandbox,
        "client_shape": args.client_shape,
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
        results["cells"][name] = run_cell(
            name, fn, cfg, references, args, hooks, needs_hooks
        )
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
