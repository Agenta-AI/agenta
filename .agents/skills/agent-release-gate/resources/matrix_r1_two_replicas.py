# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx>=0.27"]
# ///
"""TIER: coached (every prompt names the exact command or reply; no cell asserts model prose).

R1: the runner-replicas cells. A deployment with TWO runner containers behind one Service URL,
checked turn by turn for WHICH container served each turn. Every other cell in the gate runs
against one runner, where "the turn reached the pod that holds the session" is true by
construction and therefore never tested.

HOW A CELL KNOWS WHICH CONTAINER SERVED A TURN. Never from the stream. The evidence is:

- each runner container's own log (`docker logs -t --since`), filtered by session id. A turn's
  heartbeat line `[sessions/alive] heartbeat OK session=<s> turn=<t>` names the turn, so a turn
  is attributed to the container that beat it. `[keepalive] hit-continue key=<project>:<s>` is
  the warm hit, `stage=sandbox_start ... mode=create` a fresh sandbox;
- the STORED turn ledger (`POST /sessions/turns/query`): one `sandbox_id` per turn, so one
  distinct id means the sandbox was never replaced;
- the streams read with the runner token (`runner_address`, `runner_replica_id`): the binding
  the api stores for the session's latest turn;
- the `session_commands` rows in Postgres: `claimed_by` is the replica id of the runner that
  accepted a Stop or a continuation.

Each container's replica id is its hostname and its address `http://<container IPv4>:8765`
(the compose entry shim; a Helm pod gets its name and IP the same way). The driver finds the
containers by the compose project label, reads both, and checks them against `/health`.

PHASE 1 cells (no container is killed, stopped, or recreated):

- `warm-holder`: turn 1 on a new session, then a follow-up. Both turns run on the same
  container, the follow-up logs `hit-continue` there, the other container never logs the
  session, and the ledger holds one sandbox id.
- `approval-warm`: policy ask; turn 1 parks an approval on container A; the driver answers it the
  way the app does (`POST /sessions/interactions/{id}/respond` with an `Idempotency-Key`, see
  `web/mobile/src/features/chat/useApprovalActions.ts`). The continuation runs on A, warm (the
  coordinator's `resume ... approve=1` line, no sandbox create after the answer), the tool
  output carries the token, and the interaction row is no longer pending.
- `queued-input`: while a turn runs on A, a second message is queued the way the composer does
  (`on_busy: "queue"` on the invoke POST, with an `Idempotency-Key`). The promoted input runs on
  A after the first turn ends.
- `stop-on-b`: two long turns in two sessions, one on each container (new sessions are opened
  until the holders differ, at most 8). Stop on B's turn while A's runs: B's turn ends within
  5 s, the Stop command row is claimed by B's replica id, B logs the abort, and A's turn
  finishes normally.
- `kill-from-non-holder`: two sessions, so each half is the only deleter of its sandbox. Half 1:
  after a turn on A, `/kill` is posted directly to the NON-holder B with the runner token; B
  logs `kill: ... listed>=1 deleted>=1`. Half 2: the product Kill (`DELETE /sessions/streams/`)
  alone on a second session; the container that took it deleted the sandbox (label sweep
  `deleted>=1`, or its own pool `evict ... reason=kill` when it was the holder). Each answers
  in under 8 s, and no sandbox labelled `agenta.conversation=<session>` is left alive.
- `duplicate-turn-id`: the same session id and turn id posted to `/run` on both containers
  (direct POST with the runner token; the mock harness on Daytona, `slow` behaviour, so no model
  is involved). The second container is refused at admission, its final beat leaves the first
  turn running, and the first turn finishes.
- `inprocess-warm`: in-process Pi; turn 1 runs a bash echo, so a command sandbox is created;
  the follow-up stays on the same container and is warm.

PHASE 2 cells (DESTRUCTIVE: they kill, stop, start or recreate runner containers). They SKIP
unless `--allow-destructive` is given, and `all` never implies it:

- `kill-holder-parked-approval`: park an approval on A, `docker kill -s KILL` A and keep it
  down, answer. The continuation runs cold on B through the stored decision, with no second
  approval card. Then `docker start` A and wait for health.
- `sigterm-drain`: two long turns on A, then `docker stop -t 160` A in the background. While A
  drains: A's `/run` answers 503, a Stop of A's second turn still works, new sessions run on B
  and never on A (a refused one must carry A's drain answer, "Runner is shutting down"), and
  A's first turn runs its long command to the end. The `docker stop` is waited for before A is
  started again; a container that does not come back healthy fails the cell.
- `holder-killed-followup`: a warm session on A, `docker kill` A, the follow-up runs cold on B,
  the next follow-up is warm on B. Then `docker start` A.
- `inprocess-holder-killed`: an in-process session on A with a codeword in turn 1, kill A; turn 2
  runs on B, recalls the codeword (the transcript was restored), and B creates its own command
  sandbox. Then `docker start` A.
- `identity-mismatch`: record the bindings of a warm session and a parked approval, recreate the
  runner service (`run.sh --license L --STAGE --env-file F --no-tunnel --recreate runner`; all
  three are required flags, `--recreate-license`, `--recreate-stage`, `--recreate-env-file`,
  plus `--worktree`). If a new container answers at the bound address, the Stop of the parked
  turn and the follow-up both refuse it (a log line "answers as replica '<new>', not ...
  '<old replica>'" sent after the action) and the follow-up falls back to the Service URL. A
  failed recreate is a FAIL; no reused address, or a Stop half that could not be exercised, is
  a SKIP that says so, never a PASS.

REQUIREMENTS. The three gate variables (`AGENTA_BASE`, `AGENTA_PROJECT_ID`, `AGENTA_API_KEY`) for
a project whose vault holds an Anthropic key (Claude cells) and the custom provider named by
`--custom-name` (in-process cells, OpenRouter on this box). `--project <compose project>` for
docker and Postgres access, with exactly two runner containers. `--stack-env <env file>` (or
`AGENTA_QA_STACK_ENV`) for the runner token and the Daytona key; the cells that need them SKIP
without it. Runs and log excerpts land under `AGENTA_QA_RUNS_DIR` (default
`~/agenta-qa-evidence`), plus `--excerpts-dir` when given.

    uv run resources/matrix_r1_two_replicas.py --project <compose project> \\
        --stack-env <env file> --cells phase1
    uv run resources/matrix_r1_two_replicas.py --project <compose project> \\
        --stack-env <env file> --cells all --allow-destructive --worktree <checkout> \\
        --recreate-license ee --recreate-stage dev --recreate-env-file <run.sh env file>

A release record needs BOTH phases: `--cells all --allow-destructive`. A cell that fails while a
runner container restarted under it (another process killed it, read from `State.StartedAt`)
is run once more, and both attempts are recorded. A cell whose own failing turn was refused by
the sandbox provider on capacity is run once more after 120 s, and is a SKIP if refused again.
Exit code: 1 when any cell FAILs, 2 when every selected cell is SKIP, 0 otherwise.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import re
import subprocess
import sys
import threading
import time
import traceback
import uuid
from dataclasses import dataclass

import httpx

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import qa_matrix_lib as lib  # noqa: E402
import session_control as sc  # noqa: E402

# session_control talks through its own module state (it normally mints an account). Point it at
# the gate project instead, so its Stop, stream, records and async-invoke helpers reuse the same
# credentials as qa_matrix_lib.
sc.BASE = lib.BASE
sc.STATE.update(credentials=f"ApiKey {lib.KEY}", project_id=lib.PROJECT)
# Daytona sandboxes take 10 to 20 s to start; every session_control wait gets this much slack.
sc.SANDBOX_STARTUP_SLACK_S = 30.0

RUNS = pathlib.Path(
    os.environ.get(
        "AGENTA_QA_RUNS_DIR", str(pathlib.Path.home() / "agenta-qa-evidence")
    )
).expanduser()

PHASE1 = (
    "warm-holder",
    "approval-warm",
    "queued-input",
    "stop-on-b",
    "kill-from-non-holder",
    "duplicate-turn-id",
    "inprocess-warm",
)
PHASE2 = (
    "kill-holder-parked-approval",
    "sigterm-drain",
    "holder-killed-followup",
    "inprocess-holder-killed",
    "identity-mismatch",
)

STOP_BUDGET_S = 5.0
KILL_BUDGET_S = 8.0
TURN_WAIT_S = 300.0
# The runner's user-facing text when Daytona refuses a create on capacity.
CAPACITY_TEXT = "at its capacity limit"
CAPACITY_WAIT_S = 120.0
INSTRUCTIONS = "Be terse. Do exactly what is asked, nothing more."
# The api as the runner containers reach it on the compose network.
API_INTERNAL_URL = "http://api:8000"


def _pass(why: str) -> dict:
    return {"pass": True, "skip": False, "why": why}


def _fail(why: str, errors: list | None = None) -> dict:
    """`errors` are the failing turn's own error frames; the capacity retry reads only these
    and `why`, never the rest of the evidence."""
    verdict = {"pass": False, "skip": False, "why": why}
    if errors:
        verdict["errors"] = errors
    return verdict


def _skip(why: str) -> dict:
    return {"pass": False, "skip": True, "why": why}


def _verdict_word(v: dict) -> str:
    return "SKIP" if v["skip"] else ("PASS" if v["pass"] else "FAIL")


def _iso(epoch: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(epoch))


def _line_epoch(line: str) -> float | None:
    """Epoch of a `docker logs -t` line (`2026-10-06T06:01:02.123456789Z text`)."""
    stamp = line.split(" ", 1)[0]
    try:
        whole, _, frac = stamp.rstrip("Z").partition(".")
        base = dt.datetime.strptime(whole, "%Y-%m-%dT%H:%M:%S").replace(
            tzinfo=dt.timezone.utc
        )
        return base.timestamp() + (float(f"0.{frac}") if frac else 0.0)
    except ValueError:
        return None


def _read_env_file(path: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in pathlib.Path(path).read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            out[key.strip()] = value.strip().strip('"').strip("'")
    return out


def _new_token(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:8].upper()}"


def _mutating_prompt(token: str) -> str:
    """A command that WRITES. Claude Code auto-approves a read-only `echo` whatever the policy
    says (qa_product.py MUTATE_PROMPT), so an approval probe must mutate to raise the card."""
    return (
        "Use the bash tool to run exactly: "
        f"echo {token} > /tmp/qa-r1-{token}.txt && cat /tmp/qa-r1-{token}.txt "
        "and reply with only its stdout."
    )


def _long_prompt(marker: str, seconds: int) -> str:
    """A turn that stays in one foreground tool call for `seconds`.

    NOT `session_control.sleep_prompt`: Claude Code refuses a standalone `sleep N` ("Blocked:
    standalone sleep 120 ... use run_in_background"), and the model then backgrounds it and ends
    the turn in about ten seconds, so "a long turn" silently becomes a short one. A `timeout`
    around a blocking `tail` is not a sleep and runs in the foreground.
    """
    return (
        f"The codeword is {marker}. Use the bash tool to run exactly this one command, in the "
        f"foreground and not in the background: timeout {seconds} tail -f /dev/null; echo "
        "FINISHED. Do not run anything else. When it finishes, reply with the single word DONE."
    )


# --------------------------------------------------------------------------- #
# The stack: containers, logs, Postgres, Daytona, the runner's own routes.
# --------------------------------------------------------------------------- #


@dataclass
class Runner:
    name: str
    replica_id: str
    address: str
    started_at: str
    status: str
    health: str


class Stack:
    def __init__(self, project: str, stack_env: str | None) -> None:
        self.project = project
        self.env = _read_env_file(stack_env) if stack_env else {}
        self.hooks = sc.DockerComposeHooks(project)

    # -- docker ----------------------------------------------------------- #

    def docker(self, *args: str, timeout: float = 60.0) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["docker", *args], capture_output=True, text=True, timeout=timeout
        )

    def runner_names(self) -> list[str]:
        out = self.docker(
            "ps",
            "-a",
            "--filter",
            f"label=com.docker.compose.project={self.project}",
            "--filter",
            "label=com.docker.compose.service=runner",
            "--format",
            "{{.Names}}",
        ).stdout
        return sorted(n for n in out.split() if n)

    def runners(self) -> list[Runner]:
        found = []
        for name in self.runner_names():
            raw = self.docker("inspect", name).stdout
            try:
                info = json.loads(raw)[0]
            except (ValueError, IndexError):
                continue
            state = info.get("State") or {}
            nets = (info.get("NetworkSettings") or {}).get("Networks") or {}
            ip = next(
                (n.get("IPAddress") for n in nets.values() if n.get("IPAddress")), ""
            )
            address = self._entry_address(name, state.get("StartedAt", "")) or (
                f"http://{ip}:8765" if ip else ""
            )
            found.append(
                Runner(
                    name=name,
                    replica_id=(info.get("Config") or {}).get("Hostname", ""),
                    address=address,
                    started_at=state.get("StartedAt", ""),
                    status=state.get("Status", ""),
                    health=(state.get("Health") or {}).get("Status", ""),
                )
            )
        return found

    def _entry_address(self, name: str, started_at: str) -> str:
        """The address the entry shim announced at the container's latest start."""
        args = ["logs", name]
        if started_at:
            args[1:1] = ["--since", started_at[:19] + "Z"]
        res = self.docker(*args, timeout=90)
        lines = (res.stdout + res.stderr).splitlines()
        address = ""
        for line in lines:
            if "[replica-entry]" in line and "AGENTA_RUNNER_REPLICA_ADDRESS=" in line:
                address = line.split("AGENTA_RUNNER_REPLICA_ADDRESS=", 1)[1].split()[0]
        return address

    def started_at(self) -> dict[str, str]:
        return {r.name: r.started_at for r in self.runners()}

    def wait_ready(self, timeout: float = 180.0) -> list[Runner]:
        """Both runners running and healthy. Waits; never starts a container itself."""
        deadline = time.time() + timeout
        runners: list[Runner] = []
        while time.time() < deadline:
            runners = self.runners()
            if len(runners) >= 2 and all(
                r.status == "running" and r.health in ("healthy", "") for r in runners
            ):
                return runners
            time.sleep(5)
        raise RuntimeError(
            "runner containers not ready: "
            + ", ".join(f"{r.name}={r.status}/{r.health}" for r in runners)
        )

    def by_replica(self, replica_id: str) -> Runner | None:
        return next((r for r in self.runners() if r.replica_id == replica_id), None)

    def logs_since(self, container: str, since: float) -> list[str]:
        res = self.docker(
            "logs", "-t", "--since", _iso(since - 2), container, timeout=120
        )
        return (res.stdout + res.stderr).splitlines()

    def session_lines(self, since: float, *session_ids: str) -> dict[str, list[str]]:
        """Container name -> its log lines (with timestamps) that name any of the sessions."""
        out: dict[str, list[str]] = {}
        for name in self.runner_names():
            lines = self.logs_since(name, since)
            out[name] = [ln for ln in lines if any(s in ln for s in session_ids)]
        return out

    def service_lines(self, service: str, since: float, *needles: str) -> list[str]:
        lines = self.logs_since(f"{self.project}-{service}-1", since)
        return [ln for ln in lines if any(n in ln for n in needles)]

    # -- Postgres --------------------------------------------------------- #

    def command_rows(self, session_id: str) -> list[dict]:
        rows = self.hooks.psql(
            "agenta_ee_core",
            "select id::text, kind, state, coalesce(outcome,''), coalesce(claimed_by,''), "
            "claim_count, coalesce(target_turn_id,''), "
            "to_char(created_at,'YYYY-MM-DD\"T\"HH24:MI:SS.MS'), "
            "coalesce(to_char(settled_at,'YYYY-MM-DD\"T\"HH24:MI:SS.MS'),'') "
            f"from session_commands where session_id = '{session_id}' order by created_at",
        )
        keys = (
            "id",
            "kind",
            "state",
            "outcome",
            "claimed_by",
            "claim_count",
            "target_turn_id",
            "created_at",
            "settled_at",
        )
        return [dict(zip(keys, r)) for r in rows if len(r) >= len(keys)]

    def stream_row(self, session_id: str) -> dict:
        return self.hooks.stream_row(session_id)

    # -- the api, as the runner sees it ----------------------------------- #

    @property
    def runner_token(self) -> str:
        return self.env.get("AGENTA_RUNNER_TOKEN", "")

    def binding(self, session_id: str) -> dict:
        """The streams read with the runner token: the turn's stored pod address and replica."""
        r = httpx.get(
            f"{lib.BASE}/api/sessions/streams/",
            params={"session_id": session_id, "project_id": lib.PROJECT},
            headers={
                "Authorization": f"ApiKey {lib.KEY}",
                "X-Agenta-Runner-Token": self.runner_token,
            },
            timeout=30.0,
        )
        try:
            body = r.json()
        except ValueError:
            body = {}
        stream = body.get("stream") or {}
        return {
            "status": r.status_code,
            "turn_id": stream.get("turn_id"),
            "is_running": (stream.get("flags") or {}).get("is_running"),
            "runner_address": body.get("runner_address"),
            "runner_replica_id": body.get("runner_replica_id"),
        }

    def wait_binding(self, session_id: str, turn_id: str | None = None, timeout=90.0):
        deadline = time.time() + timeout
        last: dict = {}
        while time.time() < deadline:
            last = self.binding(session_id)
            if last.get("runner_replica_id") and (
                turn_id is None or last.get("turn_id") == turn_id
            ):
                return last
            time.sleep(1)
        return last

    # -- the runner's own routes ------------------------------------------ #

    def runner_post(
        self, runner: Runner, path: str, body: dict, timeout: float = 30.0
    ) -> dict:
        started = time.time()
        try:
            r = httpx.post(
                runner.address.rstrip("/") + path,
                json=body,
                headers={"X-Agenta-Runner-Token": self.runner_token},
                timeout=timeout,
            )
            status, text = r.status_code, r.text[:400]
        except httpx.HTTPError as exc:
            status, text = None, f"{type(exc).__name__}: {exc}"
        return {
            "runner": runner.name,
            "path": path,
            "status": status,
            "body": text,
            "elapsed_s": round(time.time() - started, 3),
        }

    # -- Daytona ---------------------------------------------------------- #

    def labelled_sandboxes(self, session_id: str) -> list[dict] | None:
        """Every Daytona sandbox labelled `agenta.conversation=<session>`, or None (no key)."""
        key = self.env.get("AGENTA_RUNNER_DAYTONA_API_KEY") or self.env.get(
            "DAYTONA_API_KEY"
        )
        if not key:
            return None
        base = (
            self.env.get("AGENTA_RUNNER_DAYTONA_API_URL")
            or "https://app.daytona.io/api"
        ).rstrip("/")
        items: list[dict] = []
        cursor = None
        with httpx.Client(
            headers={"Authorization": f"Bearer {key}"}, timeout=60.0
        ) as client:
            while True:
                params: dict = {
                    "limit": 100,
                    "labels": json.dumps({"agenta.conversation": session_id}),
                }
                if cursor:
                    params["cursor"] = cursor
                r = client.get(f"{base}/sandbox", params=params)
                r.raise_for_status()
                body = r.json()
                page = body if isinstance(body, list) else body.get("items", [])
                items.extend(page)
                cursor = None if isinstance(body, list) else body.get("nextCursor")
                if not cursor:
                    break
        return [
            {"id": sb.get("id"), "state": sb.get("state")}
            for sb in items
            if (sb.get("labels") or {}).get("agenta.conversation") == session_id
        ]

    # -- destructive (phase 2 only) --------------------------------------- #

    def kill(self, runner: Runner) -> str:
        return self.docker("kill", "-s", "KILL", runner.name).stderr.strip()

    def start(self, runner: Runner) -> str:
        return self.docker("start", runner.name).stderr.strip()

    def wait_healthy(self, name: str, timeout: float = 180.0) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            r = next((r for r in self.runners() if r.name == name), None)
            if r and r.status == "running" and r.health in ("healthy", ""):
                return True
            time.sleep(2)
        return False


# --------------------------------------------------------------------------- #
# Turn plumbing over the product endpoint.
# --------------------------------------------------------------------------- #


class Ctx:
    def __init__(self, args, stack: Stack, outdir: pathlib.Path) -> None:
        self.args = args
        self.stack = stack
        self.outdir = outdir
        self._configs: dict[str, tuple[dict, dict]] = {}
        self._custom_slug: str | None = args.custom_slug

    def custom_slug(self) -> str:
        if self._custom_slug:
            return self._custom_slug
        r = lib.api_call("GET", "/vault/v1/secrets/")
        r.raise_for_status()
        for secret in r.json():
            if (secret.get("header") or {}).get("name") == self.args.custom_name and (
                secret.get("kind") == "custom_provider"
            ):
                self._custom_slug = secret.get("slug")
                return self._custom_slug
        raise RuntimeError(
            f"no custom_provider secret named {self.args.custom_name!r} in the vault"
        )

    def config(self, shape: str) -> tuple[dict, dict]:
        """(agent config, references) for a named shape, committed once per run."""
        if shape in self._configs:
            return self._configs[shape]
        if shape.startswith("claude-"):
            permission = shape.split("-", 1)[1]
            cfg = {
                "instructions": {"agents_md": INSTRUCTIONS},
                "llm": {
                    "model": self.args.claude_model,
                    "provider": "anthropic",
                    "connection": {"mode": "agenta", "slug": None},
                    "extras": {},
                },
                "tools": [],
                "mcps": [],
                "skills": [],
                "harness": {"kind": "claude"},
                "sandbox": {"kind": "daytona"},
                "runner": {"kind": "sidecar", "permissions": {"default": permission}},
            }
        elif shape == "inprocess":
            cfg = {
                "instructions": {"agents_md": INSTRUCTIONS},
                "llm": {
                    "model": f"{self.args.custom_name}/custom/{self.args.custom_model}",
                    "provider": None,
                    "connection": {"mode": "agenta", "slug": self.custom_slug()},
                    "extras": {},
                },
                "tools": [],
                "mcps": [],
                "skills": [],
                "harness": {"kind": "pi_core"},
                "sandbox": {"kind": "inprocess"},
                "runner": {"kind": "sidecar", "permissions": {"default": "allow"}},
            }
        else:
            raise ValueError(f"unknown config shape {shape}")
        hexid = uuid.uuid4().hex[:8]
        wf, var = lib.create_workflow(hexid, f"qa-r1-{shape}")
        rev, _ = lib.seed_and_baseline(wf, var, cfg, hexid)
        self._configs[shape] = (cfg, lib.refs(wf, var, rev))
        return self._configs[shape]


def turn_summary(turn: lib.Turn) -> dict:
    return {
        "frames": turn.frames[:40],
        "reply": turn.reply[:300],
        "tool_calls": [c.get("toolName") for c in turn.tool_calls],
        "tool_outcomes": turn.tool_outcomes,
        "approvals": turn.approvals,
        "errors": turn.errors,
        "finish_reason": turn.finish_reason,
    }


def tool_output_text(turn: lib.Turn) -> str:
    return json.dumps(turn.tool_payloads)


def start_async(session_id: str, messages: list, cfg: dict, refs: dict, label: str):
    """session_control's async invoke, plus the wall-clock time the stream ended."""
    handle = sc.invoke_async(session_id, messages, cfg, refs, label)
    handle["started_at"] = time.time()
    handle["ended_at"] = None

    def watch() -> None:
        handle["thread"].join()
        handle["ended_at"] = time.time()

    threading.Thread(target=watch, daemon=True).start()
    return handle


def wait_async(handle: dict, timeout: float) -> bool:
    deadline = time.time() + timeout
    while handle["ended_at"] is None and time.time() < deadline:
        time.sleep(0.1)
    return handle["ended_at"] is not None


def wait_long_tool(handle: dict, timeout: float) -> bool:
    """True once the async turn has an OPEN tool call running the `_long_prompt` command."""
    deadline = time.time() + timeout + sc.SANDBOX_STARTUP_SLACK_S
    live = handle["live"]
    while time.time() < deadline:
        outcomes = live.get("tool_outcomes") or {}
        for call in live.get("tool_calls") or []:
            if call["toolCallId"] not in outcomes and "tail -f" in json.dumps(
                call.get("input")
            ):
                return True
        if handle["ended_at"] is not None:
            return False
        time.sleep(0.2)
    return False


def ledger_oldest_first(session_id: str) -> list[dict]:
    rows = lib.turn_ledger(session_id)
    return sorted(rows, key=lambda r: r.get("turn_index") or 0)


def turn_holders(lines: dict[str, list[str]], session_id: str, turn_id) -> list[str]:
    """The containers whose log carries a heartbeat for this exact turn."""
    needle = f"heartbeat OK session={session_id} turn={turn_id}"
    return sorted(name for name, ls in lines.items() if any(needle in ln for ln in ls))


def lines_matching(lines: list[str], *needles: str, after: float | None = None):
    out = []
    for ln in lines:
        if not all(n in ln for n in needles):
            continue
        if after is not None:
            when = _line_epoch(ln)
            if when is not None and when < after:
                continue
        out.append(ln)
    return out


def sandbox_creates(lines: dict[str, list[str]], session_id: str, after: float):
    return {
        name: lines_matching(
            ls, "stage=sandbox_start", "mode=create", session_id, after=after
        )
        for name, ls in lines.items()
    }


def wait_turn_settled(session_id: str, turn_id: str | None, timeout: float) -> dict:
    """Poll until the session is idle and `turn_id` (when given) has a terminal record."""
    deadline = time.time() + timeout
    stream: dict = {}
    terminal: list = []
    while time.time() < deadline:
        stream = sc.session_stream(session_id)
        running = (stream.get("flags") or {}).get("is_running")
        if turn_id:
            terminal = sc.terminal_records(session_id, turn_id)
        if not running and (turn_id is None or terminal):
            return {"settled": True, "stream": stream, "terminal": terminal}
        time.sleep(2)
    return {"settled": False, "stream": stream, "terminal": terminal}


def wait_new_ledger_turn(session_id: str, known: set, timeout: float) -> dict | None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        for row in ledger_oldest_first(session_id):
            if row.get("turn_id") and str(row["turn_id"]) not in known:
                return row
        time.sleep(2)
    return None


def records_with(session_id: str, record_type: str, needle: str) -> list[dict]:
    return [
        {"turn_id": r.get("turn_id"), "type": r.get("record_type")}
        for r in sc.records(session_id)
        if r.get("record_type") == record_type and needle in json.dumps(r)
    ]


def other_runner(stack: Stack, name: str) -> Runner | None:
    return next((r for r in stack.runners() if r.name != name), None)


def holder_runner(stack: Stack, binding: dict) -> Runner | None:
    replica = binding.get("runner_replica_id")
    return stack.by_replica(replica) if replica else None


def respond_like_the_app(interaction: dict, tool_call_id: str | None) -> dict:
    """Answer an approval the way `web/mobile` does: the durable respond route plus a key."""
    answer: dict = {"approved": True}
    if tool_call_id:
        answer["tool_call_id"] = tool_call_id
    body: dict = {"answer": answer}
    if interaction.get("turn_id"):
        body["expected_execution_id"] = interaction["turn_id"]
    sent = time.time()
    r = sc.api(
        "POST",
        f"/sessions/interactions/{interaction['id']}/respond",
        json=body,
        headers={"Idempotency-Key": f"approval:{interaction['id']}:approve"},
        timeout=60.0,
    )
    try:
        payload = r.json()
    except ValueError:
        payload = {"raw": r.text[:400]}
    return {"status": r.status_code, "body": payload, "sent_at": sent}


def pending_approval(session_id: str, timeout: float = 30.0) -> dict | None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        for row in lib.interactions(session_id):
            if row.get("status") == "pending":
                return row
        time.sleep(1)
    return None


def queue_input(session_id: str, messages: list, cfg: dict, refs: dict) -> dict:
    """Queue a message behind a running turn, the way the composer's Queue does."""
    message_id = messages[-1]["id"]
    r = httpx.post(
        f"{lib.SERVICE_BASE}/agent/v0/invoke",
        params={"project_id": lib.PROJECT, "application_id": refs["application"]["id"]},
        json={
            "session_id": session_id,
            "references": refs,
            "data": {"inputs": {"messages": messages}, "parameters": {"agent": cfg}},
            "on_busy": "queue",
        },
        headers={
            "Authorization": f"ApiKey {lib.KEY}",
            "Accept": "text/event-stream",
            "x-ag-messages-format": "vercel",
            "Content-Type": "application/json",
            "Idempotency-Key": message_id,
        },
        timeout=60.0,
    )
    try:
        body = r.json()
    except ValueError:
        body = {"raw": r.text[:400]}
    return {"status": r.status_code, "body": body}


# --------------------------------------------------------------------------- #
# Phase 1 cells.
# --------------------------------------------------------------------------- #


def cell_warm_holder(ctx: Ctx) -> tuple[dict, dict]:
    stack = ctx.stack
    cfg, refs = ctx.config("claude-allow")
    s = str(uuid.uuid4())
    since = time.time()
    m1 = lib.user_msg("Reply with exactly: ONE")
    t1 = lib.invoke(s, [m1], {"agent": cfg}, refs)
    ev: dict = {"sessions": [s], "turn1": turn_summary(t1)}
    if t1.errors:
        return ev, _fail(f"turn 1 errored: {t1.errors[:1]}")
    ev["binding_after_turn1"] = stack.wait_binding(s, timeout=30)
    msgs = [m1, t1.assistant_message(), lib.user_msg("Reply with exactly: TWO")]
    t2 = lib.invoke(s, msgs, {"agent": cfg}, refs)
    ev["turn2"] = turn_summary(t2)
    time.sleep(3)
    ev["binding_after_turn2"] = stack.binding(s)
    ledger = ledger_oldest_first(s)
    lines = stack.session_lines(since, s)
    ev["ledger"] = [
        {k: row.get(k) for k in ("turn_index", "turn_id", "sandbox_id")}
        for row in ledger
    ]
    holders = [turn_holders(lines, s, row.get("turn_id")) for row in ledger]
    ev["turn_holders"] = holders
    ev["lines_per_container"] = {n: len(ls) for n, ls in lines.items()}
    silent = lib.check_no_silent_turn([t1, t2])
    if t2.errors or silent["violations"]:
        return ev, _fail(f"turn 2 errored or a turn was silent: {t2.errors[:1]}")
    if len(ledger) < 2:
        return ev, _fail(f"the ledger holds {len(ledger)} turn rows, expected 2")
    flat = {h for hs in holders for h in hs}
    if any(len(hs) != 1 for hs in holders) or len(flat) != 1:
        return ev, _fail(f"turns were not served by one container: {holders}")
    holder = flat.pop()
    others = [n for n in lines if n != holder]
    hits = lines_matching(lines[holder], "hit-continue", s)
    ev["holder"] = holder
    ev["hit_continue"] = hits
    sandboxes = {row.get("sandbox_id") for row in ledger if row.get("sandbox_id")}
    replica = ev["binding_after_turn2"].get("runner_replica_id")
    holder_replica = next(
        (r.replica_id for r in stack.runners() if r.name == holder), None
    )
    problems = []
    if not hits:
        problems.append(f"no hit-continue line on {holder}")
    if any(lines[n] for n in others):
        problems.append(f"the other container logged the session: {others}")
    if len(sandboxes) != 1:
        problems.append(f"{len(sandboxes)} distinct sandbox ids, expected 1")
    if replica != holder_replica:
        problems.append(
            f"the stored binding names replica {replica!r}, the holder is {holder_replica!r}"
        )
    if problems:
        return ev, _fail("; ".join(problems))
    return ev, _pass(
        f"both turns on {holder} (replica {holder_replica}), follow-up hit-continue, the "
        "other container never logged the session, one sandbox id, binding matches"
    )


def cell_approval_warm(ctx: Ctx) -> tuple[dict, dict]:
    stack = ctx.stack
    cfg, refs = ctx.config("claude-ask")
    s = str(uuid.uuid4())
    since = time.time()
    token = _new_token("QAR1")
    t1 = lib.invoke(s, [lib.user_msg(_mutating_prompt(token))], {"agent": cfg}, refs)
    ev: dict = {"sessions": [s], "token": token, "turn1": turn_summary(t1)}
    if t1.errors or not t1.approvals:
        return ev, _fail(
            f"turn 1 did not park an approval (errors={t1.errors[:1]}, "
            f"approvals={len(t1.approvals)})"
        )
    binding = stack.wait_binding(s, timeout=30)
    ev["binding_at_park"] = binding
    holder = holder_runner(stack, binding)
    if holder is None:
        return ev, _fail(f"no stored binding for the parked turn: {binding}")
    row = pending_approval(s)
    ev["interaction"] = row
    if row is None:
        return ev, _fail("no pending interaction row after the park")
    answer = respond_like_the_app(row, t1.approvals[-1].get("toolCallId"))
    ev["answer"] = {k: answer[k] for k in ("status", "body")}
    if answer["status"] not in (200, 202):
        return ev, _fail(f"the respond route answered HTTP {answer['status']}")
    continuation = ((answer["body"] or {}).get("execution") or {}).get("id")
    ev["continuation_execution_id"] = continuation
    settled = wait_turn_settled(s, continuation, TURN_WAIT_S)
    ev["settled"] = {"settled": settled["settled"], "terminal": settled["terminal"]}
    time.sleep(3)
    lines = stack.session_lines(since, s)
    ledger = ledger_oldest_first(s)
    ev["ledger"] = [
        {k: row.get(k) for k in ("turn_index", "turn_id", "sandbox_id")}
        for row in ledger
    ]
    cont_turn = continuation or (ledger[-1].get("turn_id") if ledger else None)
    cont_holders = turn_holders(lines, s, cont_turn)
    ev["continuation_holders"] = cont_holders
    creates = sandbox_creates(lines, s, after=answer["sent_at"])
    ev["sandbox_creates_after_answer"] = creates
    tool_ran = records_with(s, "tool_result", token)
    ev["tool_result_records_with_token"] = tool_ran
    rows_after = lib.interactions(s)
    ev["interactions_after"] = [
        {k: r.get(k) for k in ("id", "kind", "status", "turn_id")} for r in rows_after
    ]
    ev["commands"] = stack.command_rows(s)
    ev["keepalive_after_answer"] = {
        n: lines_matching(ls, "[keepalive]", after=answer["sent_at"])
        for n, ls in lines.items()
    }
    # The continuation writes no ledger row of its own (the ledger holds the parked turn), so a
    # sandbox-id count proves nothing here. The warm evidence is the `resume ... approve=1`
    # line and no sandbox create after the answer.
    status = next(
        (r.get("status") for r in rows_after if r.get("id") == row["id"]), None
    )
    problems = []
    if not settled["settled"]:
        problems.append("the continuation did not settle")
    if cont_holders != [holder.name]:
        problems.append(f"the continuation ran on {cont_holders}, not {holder.name}")
    if any(creates.values()):
        problems.append("a sandbox was created after the answer")
    if not tool_ran:
        problems.append("no tool_result record carries the token")
    if status not in ("resolved", "responded"):
        problems.append(f"the interaction row is {status!r}")
    # The awaiting_approval branch of the coordinator logs `resume ... approve=1` when the
    # parked prompt is answered in place; a miss or an evict here would be a cold resume.
    resumed = [
        ln
        for ln in ev["keepalive_after_answer"].get(holder.name, [])
        if "[keepalive] resume key=" in ln and "approve=1" in ln
    ]
    if not resumed:
        problems.append(
            f"no warm `[keepalive] resume ... approve=1` line on {holder.name}"
        )
    cont_cmd = next(
        (c for c in ev["commands"] if c["kind"] == "continue_interaction"), None
    )
    if not cont_cmd or cont_cmd["claimed_by"] != holder.replica_id:
        problems.append(
            f"the continue_interaction row is claimed by "
            f"{cont_cmd and cont_cmd['claimed_by']!r}, not {holder.replica_id!r}"
        )
    if problems:
        return ev, _fail("; ".join(problems))
    return ev, _pass(
        f"parked on {holder.name}; the answer resumed the parked prompt there warm "
        f"(`resume approve=1`, no sandbox create after the answer), continue_interaction "
        f"claimed by "
        f"{holder.replica_id}, the tool ran, the row is {status}"
    )


def cell_queued_input(ctx: Ctx) -> tuple[dict, dict]:
    stack = ctx.stack
    cfg, refs = ctx.config("claude-allow")
    s = str(uuid.uuid4())
    since = time.time()
    m1 = lib.user_msg(_long_prompt(_new_token("QUEUE"), 45))
    handle = start_async(s, [m1], cfg, refs, "queued-turn1")
    turn1 = sc.wait_for_turn(s, timeout=90)
    tool = wait_long_tool(handle, timeout=120)
    ev: dict = {"sessions": [s], "turn1_id": turn1, "turn1_tool_open": bool(tool)}
    if not turn1 or not tool:
        wait_async(handle, TURN_WAIT_S)
        ev["turn1"] = handle.get("out")
        return ev, _fail(
            "turn 1 never entered its long command, nothing to queue behind",
            errors=(handle.get("out") or {}).get("errors"),
        )
    binding = stack.wait_binding(s, turn1, timeout=30)
    ev["binding_turn1"] = binding
    holder = holder_runner(stack, binding)
    if holder is None:
        return ev, _fail(f"no stored binding for turn 1: {binding}")
    word = _new_token("QUEUED")
    m2 = lib.user_msg(f"Reply with exactly: {word}")
    # The browser sends only the trailing user message on a fresh user turn of a session
    # (`agentRequest.ts`); the runner rebuilds the rest from the record log. A full history sent
    # while turn 1 is still running cannot match the runner's record, so it evicts and goes cold.
    queued = queue_input(s, [m2], cfg, refs)
    ev["queue_response"] = queued
    if queued["status"] in (400, 404, 405, 422) and "on_busy" in json.dumps(
        queued["body"]
    ):
        wait_async(handle, TURN_WAIT_S)
        return ev, _skip(
            f"the product refused on_busy=queue for this path: HTTP {queued['status']}"
        )
    if queued["status"] != 202:
        wait_async(handle, TURN_WAIT_S)
        return ev, _fail(
            f"the queue POST answered HTTP {queued['status']}, expected 202"
        )
    wait_async(handle, TURN_WAIT_S)
    ev["turn1_frames"] = (handle.get("out") or {}).get("frames", [])[-10:]
    row = wait_new_ledger_turn(s, {turn1}, TURN_WAIT_S)
    turn2 = str(row["turn_id"]) if row else None
    ev["turn2_id"] = turn2
    settled = wait_turn_settled(s, turn2, TURN_WAIT_S) if turn2 else {"settled": False}
    ev["turn2_settled"] = settled.get("settled")
    time.sleep(3)
    lines = stack.session_lines(since, s)
    ledger = ledger_oldest_first(s)
    ev["ledger"] = [
        {k: r.get(k) for k in ("turn_index", "turn_id", "sandbox_id")} for r in ledger
    ]
    ev["turn2_holders"] = turn_holders(lines, s, turn2) if turn2 else []
    ev["hit_continue_on_holder"] = lines_matching(lines[holder.name], "hit-continue", s)
    ev["keepalive_lines"] = lines_matching(lines[holder.name], "[keepalive]", s)
    ev["commands"] = stack.command_rows(s)
    ev["reply_records_with_word"] = records_with(s, "message", word)
    snapshot = sc.api("GET", f"/sessions/{s}")
    ev["pending_inputs_after"] = (
        ((snapshot.json() or {}).get("pending") or {}).get("inputs")
        if snapshot.status_code == 200
        else f"HTTP {snapshot.status_code}"
    )
    others = [n for n in lines if n != holder.name and lines[n]]
    sandboxes = {r.get("sandbox_id") for r in ledger if r.get("sandbox_id")}
    ev["distinct_sandboxes"] = len(sandboxes)
    problems = []
    if not turn2:
        problems.append("the queued input never became a turn")
    elif ev["turn2_holders"] != [holder.name]:
        problems.append(
            f"the queued turn ran on {ev['turn2_holders']}, not {holder.name}"
        )
    if others:
        problems.append(f"the other container logged the session: {others}")
    promoted = next((c for c in ev["commands"] if c["kind"] == "continue_input"), None)
    if not promoted or promoted["claimed_by"] != holder.replica_id:
        problems.append(
            f"the continue_input row is claimed by "
            f"{promoted and promoted['claimed_by']!r}, not {holder.replica_id!r}"
        )
    if not ev["reply_records_with_word"]:
        problems.append("no stored reply carries the queued word")
    if ev["pending_inputs_after"] != []:
        problems.append(f"pending inputs after the run: {ev['pending_inputs_after']}")
    if not ev["hit_continue_on_holder"] or len(sandboxes) != 1:
        problems.append(
            f"the queued turn was not warm on the holder (hit-continue="
            f"{bool(ev['hit_continue_on_holder'])}, {len(sandboxes)} sandbox ids)"
        )
    if problems:
        return ev, _fail("; ".join(problems))
    return ev, _pass(
        f"the queued input ran warm on the holder {holder.name} (hit-continue, one sandbox "
        f"id), continue_input claimed by {holder.replica_id}, the queue drained"
    )


def cell_stop_on_b(ctx: Ctx) -> tuple[dict, dict]:
    stack = ctx.stack
    cfg, refs = ctx.config("claude-allow")
    since = time.time()
    by_container: dict[str, dict] = {}
    extras: list[dict] = []
    tries: list[dict] = []
    for i in range(8):
        s = str(uuid.uuid4())
        handle = start_async(
            s,
            [lib.user_msg(_long_prompt(_new_token("STOPB"), 90))],
            cfg,
            refs,
            f"stopb-{i}",
        )
        turn = sc.wait_for_turn(s, timeout=90)
        binding = stack.wait_binding(s, turn, timeout=30) if turn else {}
        holder = holder_runner(stack, binding)
        entry = {
            "session": s,
            "turn": turn,
            "handle": handle,
            "holder": holder.name if holder else None,
            "replica": holder.replica_id if holder else None,
        }
        tries.append({k: v for k, v in entry.items() if k != "handle"})
        if holder and holder.name not in by_container:
            by_container[holder.name] = entry
        else:
            extras.append(entry)
            if turn:
                sc.cancel(s, expected=turn, label=f"stopb-extra-{i}")
        if len(by_container) == 2:
            break
    ev: dict = {"tries": tries, "sessions": [t["session"] for t in tries]}
    if len(by_container) < 2:
        for entry in by_container.values():
            sc.cancel(entry["session"], expected=entry["turn"], label="stopb-cleanup")
        turn_errors = [
            err
            for entry in [*by_container.values(), *extras]
            for err in (entry["handle"]["live"].get("errors") or [])
        ]
        return ev, _fail(
            f"8 new sessions never reached both containers: {tries}", errors=turn_errors
        )
    a, b = list(by_container.values())
    ev["a"] = {k: v for k, v in a.items() if k != "handle"}
    ev["b"] = {k: v for k, v in b.items() if k != "handle"}
    # Both turns must be INSIDE their long command when the Stop goes out, or "A runs while B
    # is stopped" is a race the cell cannot see.
    ev["b_in_long_command"] = wait_long_tool(b["handle"], timeout=120)
    ev["a_in_long_command"] = wait_long_tool(a["handle"], timeout=10)
    ev["a_running_before_stop"] = stack.binding(a["session"]).get("is_running") is True
    stop = sc.cancel(b["session"], expected=b["turn"], label="stop-on-b")
    ev["stop"] = {k: stop[k] for k in ("status", "body", "round_trip_s", "sent_iso")}
    ended = wait_async(b["handle"], 60)
    b_end = round(b["handle"]["ended_at"] - stop["sent_at"], 2) if ended else None
    ev["b_ended_after_stop_s"] = b_end
    ev["b_frames"] = (b["handle"].get("out") or {}).get("frames", [])[-8:]
    settle = sc.assert_command_settled(stack.hooks, b["session"], b["turn"])
    a_done = wait_async(a["handle"], TURN_WAIT_S)
    a_out = a["handle"].get("out") or {}
    ev["a_frames"] = a_out.get("frames", [])[-8:]
    ev["a_errors"] = a_out.get("errors")
    ev["a_text"] = (a_out.get("text") or "")[:200]
    ev["a_tool_finished"] = "FINISHED" in json.dumps(a_out.get("tool_payloads"))
    ev["a_ended_after_stop_s"] = (
        round(a["handle"]["ended_at"] - stop["sent_at"], 2) if a_done else None
    )
    time.sleep(3)
    commands = stack.command_rows(b["session"])
    ev["b_commands"] = commands
    ev["b_command_settled"] = {k: settle[k] for k in ("settled", "why", "note")}
    cancel_cmd = next((c for c in reversed(commands) if c["kind"] == "cancel"), None)
    lines = stack.session_lines(since, b["session"], a["session"])
    b_abort = lines_matching(lines[b["holder"]], "[control]", b["session"])
    ev["b_control_lines"] = b_abort
    ev["a_control_lines"] = lines_matching(
        lines[a["holder"]], "[control]", a["session"]
    )
    problems = []
    if not (ev["a_running_before_stop"] and ev["a_in_long_command"]):
        problems.append("A's turn was not inside its long command when B was stopped")
    if not ev["b_in_long_command"]:
        problems.append("B's turn never entered its long command")
    if not ev["a_tool_finished"] or (ev["a_ended_after_stop_s"] or 0) < 10:
        problems.append(
            f"A's long command did not run to the end after the Stop (ended "
            f"{ev['a_ended_after_stop_s']}s after it, FINISHED={ev['a_tool_finished']})"
        )
    if stop["status"] not in (200, 202):
        problems.append(f"Stop answered HTTP {stop['status']}")
    if b_end is None or b_end > STOP_BUDGET_S:
        problems.append(
            f"B's turn ended {b_end}s after the Stop (budget {STOP_BUDGET_S}s)"
        )
    if not cancel_cmd or cancel_cmd["claimed_by"] != b["replica"]:
        problems.append(
            f"the Stop row is claimed by {cancel_cmd and cancel_cmd['claimed_by']!r}, "
            f"not B's replica {b['replica']!r}"
        )
    if not any("aborted command=" in ln for ln in b_abort):
        problems.append(f"no abort line on {b['holder']}")
    if not a_done or a_out.get("errors") or "finish" not in a_out.get("frames", []):
        problems.append("A's turn did not finish normally")
    if ev["a_control_lines"]:
        problems.append("A logged a control command for its own session")
    if problems:
        return ev, _fail("; ".join(problems))
    return ev, _pass(
        f"Stop on B ({b['holder']}) ended its turn in {b_end}s, claimed_by={b['replica']}, "
        f"B logged the abort, A ({a['holder']}) finished normally"
    )


_KILL_LINE_RE = re.compile(
    r"kill: session=(\S+) listed=(\d+) deleted=(\d+) failed=(\d+)"
)


def _kill_lines(lines: list[str], session_id: str) -> list[dict]:
    """The runner's `[daytona] kill: session=<s> listed=N deleted=N failed=N` lines."""
    found = []
    for ln in lines:
        m = _KILL_LINE_RE.search(ln)
        if m and m.group(1) == session_id:
            found.append(
                {
                    "listed": int(m.group(2)),
                    "deleted": int(m.group(3)),
                    "failed": int(m.group(4)),
                    "line": ln,
                }
            )
    return found


def _alive(sandboxes: list[dict] | None) -> list[dict]:
    return [
        sb for sb in sandboxes or [] if sb["state"] not in ("destroyed", "destroying")
    ]


def _wait_gone(stack: Stack, session_id: str, timeout: float = 90.0) -> list[dict]:
    deadline = time.time() + timeout
    left = stack.labelled_sandboxes(session_id) or []
    while time.time() < deadline and _alive(left):
        time.sleep(5)
        left = stack.labelled_sandboxes(session_id) or []
    return left


def _session_with_sandbox(ctx: Ctx, label: str) -> tuple[str, lib.Turn, dict]:
    """A new session whose one turn ran a tool, so a labelled Daytona sandbox exists."""
    cfg, refs = ctx.config("claude-allow")
    s = str(uuid.uuid4())
    t1 = lib.invoke(
        s,
        [
            lib.user_msg(
                "Run exactly this one shell command and nothing else: "
                f"echo {_new_token(label)}"
            )
        ],
        {"agent": cfg},
        refs,
    )
    return s, t1, ctx.stack.wait_binding(s, timeout=30)


def cell_kill_from_non_holder(ctx: Ctx) -> tuple[dict, dict]:
    """Two halves, two sessions, so each half is the only thing that can delete its sandbox:
    `/kill` posted directly to the NON-holder's address, and the product Kill alone."""
    stack = ctx.stack
    if not stack.runner_token:
        return {}, _skip("no runner token: pass --stack-env")
    since = time.time()
    ev: dict = {"sessions": []}
    problems = []

    # Half 1: the non-holder's own /kill deletes the holder's sandbox by its labels.
    s1, t1, binding1 = _session_with_sandbox(ctx, "KILLA")
    ev["sessions"].append(s1)
    ev["direct"] = {"turn1": turn_summary(t1), "binding": binding1}
    if t1.errors:
        return ev, _fail(f"turn 1 errored: {t1.errors[:1]}")
    holder = holder_runner(stack, binding1)
    if holder is None:
        return ev, _fail(f"no stored binding: {binding1}")
    non_holder = other_runner(stack, holder.name)
    ev["direct"].update(holder=holder.name, non_holder=non_holder.name)
    before1 = stack.labelled_sandboxes(s1)
    if before1 is None:
        return ev, _skip("no Daytona key in the stack env file")
    ev["direct"]["labelled_before"] = before1
    direct = stack.runner_post(
        non_holder, "/kill", {"sessionId": s1, "projectId": lib.PROJECT}, timeout=30.0
    )
    ev["direct"]["kill"] = direct
    ev["direct"]["labelled_after"] = _wait_gone(stack, s1)
    lines1 = stack.session_lines(since, s1)
    non_holder_kill = _kill_lines(lines1[non_holder.name], s1)
    ev["direct"]["non_holder_kill_lines"] = non_holder_kill
    ev["direct"]["holder_kill_lines"] = _kill_lines(lines1[holder.name], s1)
    if not _alive(before1):
        problems.append("half 1: turn 1 left no live labelled sandbox to kill")
    if direct["status"] != 200 or direct["elapsed_s"] >= KILL_BUDGET_S:
        problems.append(
            f"half 1: /kill on the non-holder answered {direct['status']} in "
            f"{direct['elapsed_s']}s"
        )
    if not any(k["listed"] >= 1 and k["deleted"] >= 1 for k in non_holder_kill):
        problems.append(
            f"half 1: no `kill: listed>=1 deleted>=1` line on {non_holder.name}"
        )
    if _alive(ev["direct"]["labelled_after"]):
        problems.append("half 1: the non-holder's /kill left a labelled sandbox alive")

    # Half 2: the product Kill on its own session; nothing else deletes this sandbox.
    s2, t2, binding2 = _session_with_sandbox(ctx, "KILLB")
    ev["sessions"].append(s2)
    ev["product"] = {"turn1": turn_summary(t2), "binding": binding2}
    if t2.errors:
        return ev, _fail(
            "; ".join(problems + [f"half 2: turn 1 errored: {t2.errors[:1]}"])
        )
    before2 = stack.labelled_sandboxes(s2) or []
    ev["product"]["labelled_before"] = before2
    since2 = time.time()
    r = sc.api("DELETE", "/sessions/streams/", params={"session_id": s2}, timeout=30.0)
    ev["product"]["kill"] = {
        "status": r.status_code,
        "body": r.text[:200],
        "elapsed_s": round(time.time() - since2, 3),
    }
    ev["product"]["labelled_after"] = _wait_gone(stack, s2)
    lines2 = stack.session_lines(since2, s2)
    handled = {
        n: _kill_lines(ls, s2) for n, ls in lines2.items() if _kill_lines(ls, s2)
    }
    pool_evicts = {
        n: lines_matching(ls, "evict key=", s2, "reason=kill")
        for n, ls in lines2.items()
    }
    ev["product"]["kill_lines"] = handled
    ev["product"]["pool_evicts_by_kill"] = pool_evicts
    # The container that took the Kill deleted the sandbox either through its label sweep
    # (`deleted>=1`) or, when it was the holder, through its own pool (`evict ... reason=kill`),
    # after which the sweep finds the sandbox already being destroyed and deletes nothing.
    deleters = [
        n
        for n, ks in handled.items()
        if any(k["deleted"] >= 1 for k in ks) or pool_evicts.get(n)
    ]
    ev["product"]["deleted_by"] = deleters
    if not _alive(before2):
        problems.append("half 2: turn 1 left no live labelled sandbox to kill")
    if r.status_code != 200 or ev["product"]["kill"]["elapsed_s"] >= KILL_BUDGET_S:
        problems.append(
            f"half 2: product Kill answered {r.status_code} in "
            f"{ev['product']['kill']['elapsed_s']}s"
        )
    if not handled:
        problems.append("half 2: no container logged the product Kill")
    elif not deleters:
        problems.append(
            f"half 2: the container that took the Kill deleted nothing: {handled}"
        )
    if _alive(ev["product"]["labelled_after"]):
        problems.append("half 2: the product Kill left a labelled sandbox alive")
    if problems:
        return ev, _fail("; ".join(problems))
    return ev, _pass(
        f"/kill on the non-holder {non_holder.name} answered in {direct['elapsed_s']}s and "
        f"deleted {holder.name}'s sandbox by label; the product Kill on its own session "
        f"answered in {ev['product']['kill']['elapsed_s']}s and {deleters} deleted the "
        "sandbox; no labelled sandbox is left"
    )


def _mock_run_body(session_id: str, turn_id: str, ms: int) -> dict:
    mock = {"behavior": "slow", "kwargs": {"ms": ms, "then": "reply", "text": "DONE"}}
    return {
        "harness": "mock",
        "sandbox": "daytona",
        "sessionId": session_id,
        "turnId": turn_id,
        "projectId": lib.PROJECT,
        "agentsMd": INSTRUCTIONS,
        "model": "mock",
        # A multi-turn history: a lone fresh user message makes the runner rebuild the
        # conversation from the record log, which a brand-new session does not have.
        "messages": [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "hi"},
            {"role": "user", "content": "go"},
        ],
        "harnessFiles": [{"path": ".agenta/mock.json", "content": json.dumps(mock)}],
        "modelConnection": {
            "provider": "anthropic",
            "deployment": "direct",
            "credentialMode": "none",
            "credentials": [],
        },
        # The run credential rides the OTLP exporter headers; the runner authenticates its
        # heartbeats (the admission beat included) with it.
        "telemetry": {
            "exporters": {
                "otlp": {
                    "endpoint": API_INTERNAL_URL + "/otlp/v1/traces",
                    "headers": {"authorization": f"ApiKey {lib.KEY}"},
                }
            }
        },
    }


def _stream_run(stack: Stack, runner: Runner, body: dict, out: dict) -> None:
    out.update(
        {"records": [], "status": None, "error": None, "started_at": time.time()}
    )
    try:
        with httpx.Client(timeout=httpx.Timeout(300.0, connect=5.0)) as client:
            with client.stream(
                "POST",
                runner.address.rstrip("/") + "/run",
                json=body,
                headers={
                    "X-Agenta-Runner-Token": stack.runner_token,
                    "Accept": "application/x-ndjson",
                },
            ) as r:
                out["status"] = r.status_code
                for line in r.iter_lines():
                    if line.strip():
                        try:
                            out["records"].append(json.loads(line))
                        except ValueError:
                            out["records"].append({"raw": line[:300]})
    except httpx.HTTPError as exc:
        out["error"] = f"{type(exc).__name__}: {exc}"
    out["ended_at"] = time.time()


def _run_result(out: dict) -> dict | None:
    for rec in reversed(out.get("records") or []):
        if rec.get("kind") == "result":
            return rec.get("result")
    return None


def cell_duplicate_turn_id(ctx: Ctx) -> tuple[dict, dict]:
    stack = ctx.stack
    if not stack.runner_token:
        return {}, _skip("no runner token: pass --stack-env")
    runners = stack.runners()
    a, b = runners[0], runners[1]
    s, t = str(uuid.uuid4()), str(uuid.uuid4())
    since = time.time()
    body = _mock_run_body(s, t, ms=45000)
    ev: dict = {
        "method": "direct /run on both container addresses (mock harness, slow 45 s)",
        "sessions": [s],
        "turn_id": t,
        "a": a.name,
        "b": b.name,
    }
    out_a: dict = {}
    thread = threading.Thread(
        target=_stream_run, args=(stack, a, body, out_a), daemon=True
    )
    thread.start()
    admitted = None
    deadline = time.time() + 60
    needle = f"heartbeat OK session={s} turn={t}"
    while time.time() < deadline and thread.is_alive():
        lines = stack.session_lines(since, s)
        hit = lines_matching(lines[a.name], needle)
        if hit:
            admitted = hit[0]
            break
        time.sleep(1)
    ev["a_admission_beat"] = admitted
    if not admitted:
        thread.join(timeout=120)
        ev["a_run"] = {k: out_a.get(k) for k in ("status", "error")}
        ev["a_records"] = (out_a.get("records") or [])[-5:]
        return ev, _fail("A never admitted the turn; the direct /run body may be wrong")
    out_b: dict = {}
    _stream_run(stack, b, body, out_b)
    b_done = time.time()
    ev["b_run"] = {
        "status": out_b.get("status"),
        "error": out_b.get("error"),
        "elapsed_s": round(out_b["ended_at"] - out_b["started_at"], 2),
        "result": _run_result(out_b),
        "error_events": [
            r.get("event")
            for r in out_b.get("records") or []
            if (r.get("event") or {}).get("type") == "error"
        ],
    }
    time.sleep(2)
    stream_after_b = stack.stream_row(s)
    ev["stream_row_after_b"] = stream_after_b
    ev["a_alive_after_b"] = thread.is_alive()
    thread.join(timeout=180)
    ev["a_run"] = {
        "status": out_a.get("status"),
        "error": out_a.get("error"),
        "elapsed_s": round(
            (out_a.get("ended_at") or time.time()) - out_a["started_at"], 2
        ),
        "result": _run_result(out_a),
    }
    time.sleep(3)
    lines = stack.session_lines(since, s)
    ev["b_refusal_lines"] = lines_matching(lines[b.name], "admission REFUSED", s)
    ev["b_lines"] = lines[b.name][-20:]
    ev["a_beats_after_b"] = lines_matching(lines[a.name], needle, after=b_done)
    ev["a_interrupted"] = lines_matching(lines[a.name], "INTERRUPTED", s)
    # The admission beat AND the final `is_running: false` beat of B must both be refused. The
    # api logs `extra={..., 'replica_id': '<beating pod>', 'bound_replica_id': '<holder>'}`;
    # the leading quote keeps `'bound_replica_id'` from matching.
    b_beat = f"'replica_id': '{b.replica_id}'"
    a_bound = f"'bound_replica_id': '{a.replica_id}'"
    ev["api_refused_beats"] = [
        ln
        for ln in stack.service_lines("api", since, s)
        if "bound to another replica" in ln and b_beat in ln and a_bound in ln
    ]
    result_b = ev["b_run"]["result"] or {}
    result_a = ev["a_run"]["result"] or {}
    problems = []
    if result_b.get("ok") is not False or "already running" not in str(
        result_b.get("error")
    ):
        problems.append(f"B was not refused at admission: {result_b}")
    if not ev["b_refusal_lines"]:
        problems.append(f"no 'admission REFUSED' line on {b.name}")
    if stream_after_b.get("turn_id") != t or not (
        (stream_after_b.get("flags") or {}).get("is_running")
    ):
        problems.append(f"after B's refusal the stream row reads {stream_after_b}")
    if not ev["a_alive_after_b"]:
        problems.append("A's run had already ended when B was refused (timing)")
    if result_a.get("ok") is not True:
        problems.append(f"A's turn did not finish ok: {result_a}")
    if ev["a_interrupted"]:
        problems.append("A's turn was interrupted")
    if len(ev["api_refused_beats"]) < 2:
        problems.append(
            f"the api refused {len(ev['api_refused_beats'])} of B's beats, expected the "
            "admission beat and the final beat"
        )
    if problems:
        return ev, _fail("; ".join(problems))
    return ev, _pass(
        f"B ({b.name}) was refused at admission; the api refused its admission and final "
        f"beats; A's turn stayed running (stream row turn={t[:8]}) and A ({a.name}) "
        f"finished ok with {len(ev['a_beats_after_b'])} beat(s) after the refusal"
    )


def cell_inprocess_warm(ctx: Ctx) -> tuple[dict, dict]:
    stack = ctx.stack
    cfg, refs = ctx.config("inprocess")
    s = str(uuid.uuid4())
    since = time.time()
    token = _new_token("INPROC")
    m1 = lib.user_msg(
        f"Use your bash tool to run exactly this command: echo {token}. "
        "Then reply with the command output only."
    )
    t1 = lib.invoke(s, [m1], {"agent": cfg}, refs)
    ev: dict = {"sessions": [s], "token": token, "turn1": turn_summary(t1)}
    if t1.errors:
        return ev, _fail(f"turn 1 errored: {t1.errors[:1]}")
    if token not in tool_output_text(t1):
        return ev, _fail("turn 1 ran no tool whose output carries the token")
    t1_done = time.time()
    msgs = [m1, t1.assistant_message(), lib.user_msg("Reply with exactly: TWO")]
    t2 = lib.invoke(s, msgs, {"agent": cfg}, refs)
    ev["turn2"] = turn_summary(t2)
    time.sleep(3)
    lines = stack.session_lines(since, s)
    ledger = ledger_oldest_first(s)
    ev["ledger"] = [
        {k: r.get(k) for k in ("turn_index", "turn_id", "sandbox_id")} for r in ledger
    ]
    holders = [turn_holders(lines, s, r.get("turn_id")) for r in ledger]
    ev["turn_holders"] = holders
    ev["binding"] = stack.binding(s)
    flat = {h for hs in holders for h in hs}
    holder = next(iter(flat)) if len(flat) == 1 else None
    ev["holder"] = holder
    ev["inprocess_lines"] = {
        n: lines_matching(ls, "[inprocess]") for n, ls in lines.items()
    }
    ev["keepalive_lines"] = {
        n: lines_matching(ls, "[keepalive]") for n, ls in lines.items()
    }
    holder_lines = lines.get(holder, [])
    hits = lines_matching(holder_lines, "hit-continue", s, after=t1_done)
    ev["hit_continue_turn2"] = hits
    # The command sandbox is keyed `inprocess:<project>:<session>`, so its create line names
    # the session. Turn 1 creates it; a warm turn 2 neither creates another nor reopens Pi.
    creates = lines_matching(holder_lines, "[inprocess] sandbox created", s)
    late_creates = lines_matching(
        holder_lines, "[inprocess] sandbox created", s, after=t1_done
    )
    resumed = lines_matching(holder_lines, "[inprocess] session resumed", s)
    ev["command_sandbox_creates"] = creates
    ev["pi_session_resumed"] = resumed
    # The ledger stamps the command sandbox id from the turn that first had one, so turn 1
    # (which created it mid-turn) may read null.
    sandboxes = {r.get("sandbox_id") for r in ledger if r.get("sandbox_id")}
    problems = []
    if t2.errors or lib.check_no_silent_turn([t1, t2])["violations"]:
        problems.append(f"turn 2 errored or was silent: {t2.errors[:1]}")
    if len(ledger) < 2:
        problems.append(f"the ledger holds {len(ledger)} turn rows")
    if holder is None or any(len(hs) != 1 for hs in holders):
        problems.append(f"turns were not served by one container: {holders}")
    elif any(lines[n] for n in lines if n != holder):
        problems.append("the other container logged the session")
    if not hits:
        problems.append("no hit-continue line for turn 2 on the holder")
    if len(creates) != 1 or late_creates:
        problems.append(
            f"expected one command sandbox create in turn 1, saw {len(creates)} "
            f"({len(late_creates)} after turn 1)"
        )
    if resumed:
        problems.append("turn 2 reopened the Pi session instead of using the live one")
    if len(sandboxes) > 1:
        problems.append(f"{len(sandboxes)} distinct sandbox ids")
    if problems:
        return ev, _fail("; ".join(problems))
    return ev, _pass(
        f"in-process turns 1 (bash, one command sandbox) and 2 both on {holder}; turn 2 "
        "hit-continue on the live Pi session, no new sandbox; the other container never "
        "logged the session"
    )


# --------------------------------------------------------------------------- #
# Phase 2 cells (destructive).
# --------------------------------------------------------------------------- #


def _restore(stack: Stack, runner: Runner) -> dict:
    status = next((r.status for r in stack.runners() if r.name == runner.name), "?")
    started = status != "running"
    if started:
        stack.start(runner)
    return {
        "was": status,
        "started": started,
        "healthy": stack.wait_healthy(runner.name),
    }


def cell_kill_holder_parked_approval(ctx: Ctx) -> tuple[dict, dict]:
    stack = ctx.stack
    cfg, refs = ctx.config("claude-ask")
    s = str(uuid.uuid4())
    since = time.time()
    token = _new_token("PARKKILL")
    t1 = lib.invoke(s, [lib.user_msg(_mutating_prompt(token))], {"agent": cfg}, refs)
    ev: dict = {"sessions": [s], "token": token, "turn1": turn_summary(t1)}
    if t1.errors or not t1.approvals:
        return ev, _fail("turn 1 did not park an approval")
    holder = holder_runner(stack, stack.wait_binding(s, timeout=30))
    if holder is None:
        return ev, _fail("no stored binding for the parked turn")
    other = other_runner(stack, holder.name)
    ev["a"], ev["b"] = holder.name, other.name
    row = pending_approval(s)
    if row is None:
        return ev, _fail("no pending interaction row after the park")
    try:
        ev["kill"] = stack.kill(holder)
        answer = respond_like_the_app(row, t1.approvals[-1].get("toolCallId"))
        ev["answer"] = {k: answer[k] for k in ("status", "body")}
        continuation = ((answer["body"] or {}).get("execution") or {}).get("id")
        settled = wait_turn_settled(s, continuation, TURN_WAIT_S)
        ev["settled"] = settled["settled"]
        time.sleep(3)
        lines = stack.session_lines(since, s)
        ev["continuation_holders"] = turn_holders(lines, s, continuation)
        ev["creates_after_answer"] = sandbox_creates(lines, s, after=answer["sent_at"])
        ev["tool_result_records_with_token"] = records_with(s, "tool_result", token)
        rows = lib.interactions(s)
        ev["interactions_after"] = [(r.get("kind"), r.get("status")) for r in rows]
    finally:
        ev["restore"] = _restore(stack, holder)
    approvals = [r for r in ev["interactions_after"] if "approval" in str(r[0])]
    problems = []
    if not ev["settled"]:
        problems.append("the continuation did not settle")
    if ev["continuation_holders"] != [other.name]:
        problems.append(f"the continuation ran on {ev['continuation_holders']}")
    if not ev["creates_after_answer"].get(other.name):
        problems.append(f"no cold sandbox create on {other.name}")
    if not ev["tool_result_records_with_token"]:
        problems.append("the tool did not run")
    if len(approvals) != 1 or any(st == "pending" for _, st in approvals):
        problems.append(f"a second approval card or a pending row: {approvals}")
    if problems:
        return ev, _fail("; ".join(problems))
    return ev, _pass(
        f"A ({holder.name}) killed with the approval parked; the answer ran cold on "
        f"{other.name} through the stored decision, no second card"
    )


def cell_sigterm_drain(ctx: Ctx) -> tuple[dict, dict]:
    stack = ctx.stack
    if not stack.runner_token:
        return {}, _skip("no runner token: pass --stack-env")
    cfg, refs = ctx.config("claude-allow")
    on_a: list[dict] = []
    a_name = None
    for i in range(10):
        s = str(uuid.uuid4())
        # The first turn must END inside the drain wait (AGENTA_RUNNER_SHUTDOWN_WAIT_SECONDS,
        # 60 s on this stack); the second is Stopped by hand during the drain.
        seconds = 45 if not on_a else 150
        handle = start_async(
            s,
            [lib.user_msg(_long_prompt(_new_token("DRAIN"), seconds))],
            cfg,
            refs,
            f"drain-{i}",
        )
        turn = sc.wait_for_turn(s, timeout=90)
        holder = holder_runner(stack, stack.wait_binding(s, turn, timeout=30))
        if holder and (a_name is None or holder.name == a_name):
            a_name = holder.name
            on_a.append({"session": s, "turn": turn, "handle": handle})
        elif turn:
            sc.cancel(s, expected=turn, label=f"drain-extra-{i}")
        if len(on_a) == 2:
            break
    ev: dict = {"sessions": [e["session"] for e in on_a], "a": a_name}
    if len(on_a) < 2:
        return ev, _fail("could not place two turns on one container")
    a = next(r for r in stack.runners() if r.name == a_name)
    first, second = on_a
    ev["second_in_long_command"] = wait_long_tool(second["handle"], timeout=120)
    ev["first_in_long_command"] = wait_long_tool(first["handle"], timeout=5)
    if not (ev["first_in_long_command"] and ev["second_in_long_command"]):
        for entry in on_a:
            sc.cancel(entry["session"], expected=entry["turn"], label="drain-cleanup")
        return ev, _fail(
            "driver timing: both turns on A were not inside their long command before the "
            "SIGTERM"
        )
    stop_started = time.time()
    stopper = subprocess.Popen(
        ["docker", "stop", "-t", "160", a.name],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    stop_done: dict = {}

    def _watch_stop() -> None:
        stopper.wait()
        stop_done["at"] = time.time()

    threading.Thread(target=_watch_stop, daemon=True).start()
    try:
        time.sleep(3)
        ev["run_during_drain"] = stack.runner_post(a, "/run", {}, timeout=10.0)
        stop = sc.cancel(second["session"], expected=second["turn"], label="drain-stop")
        ended = wait_async(second["handle"], 60)
        ev["second_stopped_after_s"] = (
            round(second["handle"]["ended_at"] - stop["sent_at"], 2) if ended else None
        )
        ev["second_commands"] = stack.command_rows(second["session"])
        # New conversations during the drain. On Kubernetes a terminating pod leaves the
        # Service endpoints; on compose the service DNS name keeps listing the stopping
        # container, so a new session can reach A and meet its 503 at the Service URL, where
        # no fallback applies. Several tries tell the two apart; each refusal is recorded.
        ev["new_sessions"] = []
        for _ in range(4):
            s3 = str(uuid.uuid4())
            ev["sessions"].append(s3)
            sent = time.time()
            t3 = lib.invoke(
                s3, [lib.user_msg("Reply with exactly: NEW")], {"agent": cfg}, refs
            )
            done = time.time()
            new_holder = holder_runner(stack, stack.wait_binding(s3, timeout=15))
            ev["new_sessions"].append(
                {
                    "session": s3,
                    "holder": new_holder.name if new_holder else None,
                    "errors": t3.errors[:1],
                    "sent_at": sent,
                    "done_at": done,
                }
            )
        # A refusal counts as the drain's own only when the services layer logged A's drain
        # answer ("Runner is shutting down") while that session's invoke was open. Only the
        # draining container gives that answer, so it also names A as the refuser.
        drain_refusals = [
            ln
            for ln in stack.logs_since(f"{stack.project}-services-1", stop_started)
            if "Runner is shutting down" in ln
        ]
        ev["services_drain_refusals"] = drain_refusals[-10:]
        for entry in ev["new_sessions"]:
            if not entry["errors"]:
                continue
            entry["drain_refusal"] = any(
                (when := _line_epoch(ln)) is not None
                and entry["sent_at"] - 1 <= when <= entry["done_at"] + 1
                for ln in drain_refusals
            )
        wait_async(first["handle"], TURN_WAIT_S)
        first_out = first["handle"].get("out") or {}
        ev["first_frames"] = first_out.get("frames", [])[-8:]
        ev["first_errors"] = first_out.get("errors")
        ev["first_tool_finished"] = "FINISHED" in json.dumps(
            first_out.get("tool_payloads")
        )
        stopper.wait(timeout=200)
        time.sleep(1)
        ev["a_exit_after_docker_stop_s"] = (
            round(stop_done["at"] - stop_started, 1) if "at" in stop_done else None
        )
        ev["a_finished_at"] = stack.docker(
            "inspect", "-f", "{{.State.FinishedAt}}", a.name
        ).stdout.strip()
        ev["a_shutdown_lines"] = [
            ln
            for ln in stack.logs_since(a.name, stop_started)
            if any(
                k in ln
                for k in (
                    "[shutdown]",
                    "SIGTERM",
                    "draining",
                    "teardown",
                    "[control]",
                    "destroyAll",
                    "deleted",
                )
            )
        ][-60:]
    finally:
        # The background `docker stop` must be over BEFORE the restore: a stop that lands
        # after `docker start` would leave A down for every later cell.
        try:
            stopper.wait(timeout=200)
        except subprocess.TimeoutExpired:
            stopper.kill()
            stopper.wait()
            ev["docker_stop_timed_out"] = True
        ev["restore"] = _restore(stack, a)
    cancel_cmd = next(
        (c for c in reversed(ev["second_commands"]) if c["kind"] == "cancel"), None
    )
    problems = []
    if ev["run_during_drain"]["status"] != 503:
        problems.append(
            f"A's /run answered {ev['run_during_drain']['status']} while draining"
        )
    if (
        ev["second_stopped_after_s"] is None
        or ev["second_stopped_after_s"] > STOP_BUDGET_S
    ):
        problems.append(
            f"the Stop during the drain took {ev['second_stopped_after_s']}s"
        )
    if not cancel_cmd or cancel_cmd["claimed_by"] != a.replica_id:
        problems.append(f"the drain Stop row: {cancel_cmd}")
    on_a_new = [n for n in ev["new_sessions"] if n["holder"] == a.name]
    on_b_new = [n for n in ev["new_sessions"] if n["holder"] and n["holder"] != a.name]
    refused = [n for n in ev["new_sessions"] if n["errors"]]
    other_refusals = [n for n in refused if not n.get("drain_refusal")]
    if on_a_new:
        problems.append(f"a new session ran on the draining container: {on_a_new}")
    if not on_b_new:
        problems.append(
            f"no new session ran on the other container: {ev['new_sessions']}"
        )
    if other_refusals:
        problems.append(
            f"new sessions failed without A's drain refusal: {other_refusals}"
        )
    # A Stopped turn also ends with a clean `finish` frame; only the long command's own
    # completion marker proves the first turn ran to its end during the drain.
    if (
        ev["first_errors"]
        or "finish" not in ev["first_frames"]
        or not ev["first_tool_finished"]
    ):
        problems.append(
            "the first turn did not run its long command to the end during the drain "
            f"(FINISHED in the tool output: {ev['first_tool_finished']})"
        )
    if ev.get("docker_stop_timed_out"):
        problems.append("`docker stop` did not return within 200 s and was killed")
    if problems:
        return ev, _fail("; ".join(problems))
    note = (
        f"; {len(refused)} of {len(ev['new_sessions'])} new sessions were refused (compose "
        "DNS still lists the draining container)"
        if refused
        else ""
    )
    return ev, _pass(
        f"A ({a.name}) drained: /run 503, the Stop still worked, {len(on_b_new)} new "
        f"session(s) ran on the other container, the first turn finished{note}"
    )


def cell_holder_killed_followup(ctx: Ctx) -> tuple[dict, dict]:
    stack = ctx.stack
    cfg, refs = ctx.config("claude-allow")
    s = str(uuid.uuid4())
    since = time.time()
    msgs = [lib.user_msg("Reply with exactly: ONE")]
    turns = []
    t = lib.invoke(s, msgs, {"agent": cfg}, refs)
    turns.append(t)
    msgs += [t.assistant_message(), lib.user_msg("Reply with exactly: TWO")]
    t = lib.invoke(s, msgs, {"agent": cfg}, refs)
    turns.append(t)
    holder = holder_runner(stack, stack.wait_binding(s, timeout=30))
    ev: dict = {"sessions": [s]}
    if holder is None or any(x.errors for x in turns):
        return ev, _fail("the warm session did not establish")
    other = other_runner(stack, holder.name)
    ev["a"], ev["b"] = holder.name, other.name
    try:
        ev["kill"] = stack.kill(holder)
        kill_at = time.time()
        msgs += [t.assistant_message(), lib.user_msg("Reply with exactly: THREE")]
        t3 = lib.invoke(s, msgs, {"agent": cfg}, refs)
        msgs += [t3.assistant_message(), lib.user_msg("Reply with exactly: FOUR")]
        t3_done = time.time()
        t4 = lib.invoke(s, msgs, {"agent": cfg}, refs)
        ev["turn3"], ev["turn4"] = turn_summary(t3), turn_summary(t4)
        time.sleep(3)
        lines = stack.session_lines(since, s)
        ledger = ledger_oldest_first(s)
        ev["ledger"] = [
            {k: r.get(k) for k in ("turn_index", "turn_id", "sandbox_id")}
            for r in ledger
        ]
        ev["holders"] = [turn_holders(lines, s, r.get("turn_id")) for r in ledger]
        ev["creates_after_kill"] = sandbox_creates(lines, s, after=kill_at)
        ev["hit_on_b_turn4"] = lines_matching(
            lines[other.name], "hit-continue", s, after=t3_done
        )
    finally:
        ev["restore"] = _restore(stack, holder)
    sandboxes = [r["sandbox_id"] for r in ev["ledger"]]
    problems = []
    if t3.errors or t4.errors:
        problems.append("a follow-up after the kill errored")
    if ev["holders"][-2:] != [[other.name], [other.name]]:
        problems.append(f"turns 3 and 4 ran on {ev['holders'][-2:]}")
    if not ev["creates_after_kill"].get(other.name):
        problems.append("turn 3 was not cold on B")
    if not ev["hit_on_b_turn4"]:
        problems.append("turn 4 was not warm on B")
    if len(set(sandboxes)) != 2:
        problems.append(f"expected 2 distinct sandbox ids, ledger has {sandboxes}")
    if problems:
        return ev, _fail("; ".join(problems))
    return ev, _pass(
        f"holder {holder.name} killed; turn 3 cold on {other.name}, turn 4 warm there"
    )


def cell_inprocess_holder_killed(ctx: Ctx) -> tuple[dict, dict]:
    stack = ctx.stack
    cfg, refs = ctx.config("inprocess")
    s = str(uuid.uuid4())
    since = time.time()
    word = _new_token("WORD")
    m1 = lib.user_msg(
        f"The codeword is {word}. Use your bash tool to run exactly: echo ready. "
        "Then reply OK."
    )
    t1 = lib.invoke(s, [m1], {"agent": cfg}, refs)
    holder = holder_runner(stack, stack.wait_binding(s, timeout=30))
    ev: dict = {"sessions": [s], "word": word, "turn1": turn_summary(t1)}
    if holder is None or t1.errors:
        return ev, _fail("turn 1 did not run")
    other = other_runner(stack, holder.name)
    ev["a"], ev["b"] = holder.name, other.name
    try:
        ev["kill"] = stack.kill(holder)
        kill_at = time.time()
        # Only the trailing user message, as the browser sends it (`agentRequest.ts`). A full
        # history would carry the codeword itself, so recalling it would prove nothing about
        # the transcript B restored from the store.
        t2 = lib.invoke(
            s,
            [
                lib.user_msg(
                    "Use your bash tool to run exactly: echo again. Then reply with the "
                    "codeword I gave you, nothing else."
                )
            ],
            {"agent": cfg},
            refs,
        )
        ev["turn2"] = turn_summary(t2)
        time.sleep(3)
        lines = stack.session_lines(since, s)
        ledger = ledger_oldest_first(s)
        ev["holders"] = [turn_holders(lines, s, r.get("turn_id")) for r in ledger]
        ev["b_sandbox_created"] = lines_matching(
            lines[other.name], "[inprocess] sandbox created", s, after=kill_at
        )
        ev["b_session_resumed"] = lines_matching(
            lines[other.name], "[inprocess] session resumed", s, "loaded=true"
        )
    finally:
        ev["restore"] = _restore(stack, holder)
    problems = []
    if t2.errors:
        problems.append(f"turn 2 errored: {t2.errors[:1]}")
    if not ev["holders"] or ev["holders"][-1] != [other.name]:
        problems.append(f"turn 2 ran on {ev['holders'][-1:]}")
    if word not in t2.reply:
        problems.append("turn 2 did not recall the codeword (transcript not restored)")
    if not ev["b_session_resumed"]:
        problems.append(
            "B did not load the stored Pi session (`session resumed loaded=true`)"
        )
    if not ev["b_sandbox_created"]:
        problems.append("B created no command sandbox")
    if problems:
        return ev, _fail("; ".join(problems))
    return ev, _pass(
        f"A ({holder.name}) killed; turn 2 on {other.name} loaded the stored Pi session, "
        "recalled the codeword from it (only the new message was sent), and made its own "
        "command sandbox"
    )


def _mismatch_lines(
    stack: Stack, service: str, since: float, old_replica: str, after: float
) -> list[str]:
    """`answers as replica '<new>', not [the bound] '<old>'` lines for THIS old replica, logged
    after the action was sent. Matching on the address alone would also count a refusal of
    some other session's binding to the same reused IP."""
    old_marker = f"'{old_replica}'"
    return [
        ln
        for ln in stack.logs_since(f"{stack.project}-{service}-1", since)
        if "answers as replica" in ln
        and (f"not {old_marker}" in ln or f"not the bound {old_marker}" in ln)
        and (_line_epoch(ln) or 0) >= after - 0.5
    ]


def cell_identity_mismatch(ctx: Ctx) -> tuple[dict, dict]:
    stack = ctx.stack
    args = ctx.args
    missing = [
        flag
        for flag, value in (
            ("--worktree", args.worktree),
            ("--recreate-env-file", args.recreate_env_file),
            ("--recreate-license", args.recreate_license),
            ("--recreate-stage", args.recreate_stage),
        )
        if not value
    ]
    if missing:
        return {}, _fail(
            "identity-mismatch recreates the runner service and needs "
            + ", ".join(missing)
        )
    cfg, refs = ctx.config("claude-allow")
    cfg_ask, refs_ask = ctx.config("claude-ask")
    s = str(uuid.uuid4())
    since = time.time()
    m1 = lib.user_msg("Reply with exactly: ONE")
    t1 = lib.invoke(s, [m1], {"agent": cfg}, refs)
    bound = stack.wait_binding(s, timeout=30)
    # A parked approval gives the Stop something to stop after the recreate: the drain releases
    # the live prompt, but the interaction stays pending and the turn keeps its binding. A Stop
    # of an idle session answers 409 and never reaches the identity check.
    sp = str(uuid.uuid4())
    tp = lib.invoke(
        sp,
        [lib.user_msg(_mutating_prompt(_new_token("MISMATCH")))],
        {"agent": cfg_ask},
        refs_ask,
    )
    bound_parked = stack.wait_binding(sp, timeout=30)
    old = {r.name: (r.replica_id, r.address) for r in stack.runners()}
    ev: dict = {
        "sessions": [s, sp],
        "binding": bound,
        "binding_parked": bound_parked,
        "parked_approvals": len(tp.approvals),
        "before": old,
    }
    if t1.errors or not bound.get("runner_address"):
        return ev, _fail("the warm session did not bind an address")
    res = subprocess.run(
        [
            "bash",
            "./hosting/docker-compose/run.sh",
            "--license",
            args.recreate_license,
            f"--{args.recreate_stage}",
            "--env-file",
            args.recreate_env_file,
            "--no-tunnel",
            "--recreate",
            "runner",
        ],
        cwd=args.worktree,
        capture_output=True,
        text=True,
        timeout=900,
    )
    ev["recreate_rc"] = res.returncode
    ev["recreate_tail"] = (res.stdout + res.stderr)[-800:]
    if res.returncode != 0:
        return ev, _fail(f"`run.sh --recreate runner` exited {res.returncode}")
    stack.wait_ready()
    after = {r.name: (r.replica_id, r.address) for r in stack.runners()}
    ev["after"] = after
    new_ids = {rid for rid, _ in after.values()}
    reused = [
        n
        for n, (rid, addr) in after.items()
        if addr == bound["runner_address"] and rid != bound["runner_replica_id"]
    ]
    ev["reused_address_by"] = reused
    if not reused:
        return ev, _skip(
            f"neither half exercised: no new container answers at the bound address "
            f"{bound['runner_address']}"
        )
    address = bound["runner_address"]

    # Half 1, the Stop of the parked approval, while its binding still names the old replica:
    # the api must check `/health` at the address, see another replica, and post nothing there.
    parked_address = bound_parked.get("runner_address") or ""
    parked_reused = bool(tp.approvals) and any(
        addr == parked_address and rid != bound_parked.get("runner_replica_id")
        for rid, addr in after.values()
    )
    ev["parked_address_reused"] = parked_reused
    stop = sc.cancel(sp, expected=bound_parked.get("turn_id"), label="mismatch-stop")
    ev["stop"] = {k: stop[k] for k in ("status", "body")}
    time.sleep(8)
    ev["commands"] = stack.command_rows(sp)
    ev["api_mismatch"] = _mismatch_lines(
        stack,
        "api",
        since,
        bound_parked.get("runner_replica_id") or "",
        stop["sent_at"],
    )
    stop_delivered = stop["status"] in (200, 202)
    stop_exercised = stop_delivered and parked_reused
    claimed_by_new = [
        c
        for c in ev["commands"]
        if c["kind"] == "cancel" and c["claimed_by"] in new_ids
    ]

    # Half 2, the follow-up: the services layer must refuse the address and use the Service URL.
    followup_sent = time.time()
    t2 = lib.invoke(
        s,
        [m1, t1.assistant_message(), lib.user_msg("Reply with exactly: TWO")],
        {"agent": cfg},
        refs,
    )
    ev["turn2"] = turn_summary(t2)
    ev["services_mismatch"] = _mismatch_lines(
        stack, "services", since, bound["runner_replica_id"], followup_sent
    )

    problems = []
    if t2.errors:
        problems.append("the follow-up failed instead of falling back")
    if not ev["services_mismatch"]:
        problems.append(
            "the services layer logged no identity refusal of the old replica for the "
            "follow-up"
        )
    if stop_exercised:
        if not ev["api_mismatch"]:
            problems.append(
                "the api delivered the Stop without an identity refusal of the old replica"
            )
        if claimed_by_new:
            problems.append(
                f"a new replica claimed the old turn's Stop: {claimed_by_new}"
            )
    if problems:
        return ev, _fail("; ".join(problems))
    if not stop_exercised:
        why_not = (
            f"the Stop answered HTTP {stop['status']} and was not delivered"
            if not stop_delivered
            else "the parked turn's address was not reused (or no approval parked)"
        )
        return ev, _skip(
            f"SKIP, not PASS: the Stop half was not exercised ({why_not}); the follow-up "
            f"half passed ({reused} took {address}, the services layer refused it and fell "
            "back)"
        )
    return ev, _pass(
        f"{reused} took the bound address {address}; the Stop of the parked turn was "
        "refused at the address and claimed by no new replica; the follow-up refused it and "
        "fell back to the Service URL"
    )


CELLS = {
    "warm-holder": cell_warm_holder,
    "approval-warm": cell_approval_warm,
    "queued-input": cell_queued_input,
    "stop-on-b": cell_stop_on_b,
    "kill-from-non-holder": cell_kill_from_non_holder,
    "duplicate-turn-id": cell_duplicate_turn_id,
    "inprocess-warm": cell_inprocess_warm,
    "kill-holder-parked-approval": cell_kill_holder_parked_approval,
    "sigterm-drain": cell_sigterm_drain,
    "holder-killed-followup": cell_holder_killed_followup,
    "inprocess-holder-killed": cell_inprocess_holder_killed,
    "identity-mismatch": cell_identity_mismatch,
}


# --------------------------------------------------------------------------- #
# Runner of cells, evidence excerpts, results.
# --------------------------------------------------------------------------- #


def save_excerpts(ctx: Ctx, name: str, since: float, sessions: list[str]) -> list[str]:
    if not sessions:
        return []
    stack = ctx.stack
    targets = [ctx.outdir / name]
    if ctx.args.excerpts_dir:
        targets.append(pathlib.Path(ctx.args.excerpts_dir) / name)
    blobs = {
        f"{n}.log": "\n".join(ls)
        for n, ls in stack.session_lines(since, *sessions).items()
    }
    for service in ("api", "services"):
        blobs[f"{stack.project}-{service}-1.log"] = "\n".join(
            stack.service_lines(service, since, *sessions)
        )
    written = []
    for target in targets:
        target.mkdir(parents=True, exist_ok=True)
        for fname, text in blobs.items():
            (target / fname).write_text(text + "\n")
        written.append(str(target))
    return written


def run_cell(ctx: Ctx, name: str) -> dict:
    if name in PHASE2 and not ctx.args.allow_destructive:
        verdict = _skip("destructive cell: pass --allow-destructive to run it")
        print(f"[{name}] SKIP — {verdict['why']}", file=sys.stderr)
        return {"evidence": {}, "verdict": verdict, "elapsed_s": 0.0, "attempts": []}
    attempts = []
    for attempt in (1, 2):
        ctx.stack.wait_ready()
        before = ctx.stack.started_at()
        started = time.time()
        print(f"\n=== cell {name} (attempt {attempt}) ===", file=sys.stderr)
        try:
            evidence, verdict = CELLS[name](ctx)
        except Exception as exc:  # noqa: BLE001
            evidence = {
                "driver_error": f"{type(exc).__name__}: {exc}",
                "traceback": traceback.format_exc()[-2000:],
            }
            verdict = _fail(f"driver exception: {type(exc).__name__}: {exc}")
        after = ctx.stack.started_at()
        restarted = sorted(n for n in before if after.get(n) != before[n])
        evidence["runner_started_at"] = {"before": before, "after": after}
        evidence["restarted_mid_cell"] = restarted
        # A destructive cell that could not bring its container back leaves the stack broken
        # for every later cell: that is a FAIL whatever the cell itself observed.
        restore = evidence.get("restore")
        if isinstance(restore, dict) and restore.get("healthy") is False:
            verdict = _fail(
                f"the runner container did not come back healthy after the cell "
                f"({restore}); cell verdict was: {verdict['why']}"
            )
        # The sandbox provider refusing on capacity measures nothing about the product: the
        # gate's rule (SKILL.md, burst) is a loud SKIP, never a FAIL or a PASS. Only the
        # failing check's own reason and errors count, never other evidence text.
        capacity = not verdict["pass"] and CAPACITY_TEXT in (
            verdict["why"] + json.dumps(verdict.get("errors") or [])
        )
        if capacity and attempt == 2:
            verdict = _skip(
                "the sandbox provider refused on capacity twice; nothing about the product "
                f"was measured (first reason: {verdict['why'][:200]})"
            )
        label = name if attempt == 1 else f"{name}-attempt{attempt}"
        try:
            evidence["excerpts"] = save_excerpts(
                ctx, label, started, evidence.get("sessions") or []
            )
        except Exception as exc:  # noqa: BLE001
            evidence["excerpts"] = f"failed: {exc}"
        attempts.append(
            {
                "evidence": evidence,
                "verdict": verdict,
                "elapsed_s": round(time.time() - started, 1),
            }
        )
        print(f"[{name}] {_verdict_word(verdict)} — {verdict['why']}", file=sys.stderr)
        destructive = name in PHASE2
        if capacity and attempt == 1:
            print(
                f"[{name}] the sandbox provider is at capacity; waiting "
                f"{CAPACITY_WAIT_S:.0f}s, then running it once more",
                file=sys.stderr,
            )
            time.sleep(CAPACITY_WAIT_S)
            continue
        if verdict["pass"] or verdict["skip"] or not restarted or destructive:
            break
        print(
            f"[{name}] a runner restarted mid-cell ({restarted}); running it once more",
            file=sys.stderr,
        )
    final = attempts[-1]
    return {**final, "attempts": attempts[:-1]}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument(
        "--cells",
        default="phase1",
        help="comma list of cell names, or `phase1`, `phase2`, `all` "
        f"(cells: {', '.join(CELLS)})",
    )
    ap.add_argument(
        "--project", help="docker-compose project with two runner containers"
    )
    ap.add_argument(
        "--stack-env",
        default=os.environ.get("AGENTA_QA_STACK_ENV"),
        help="the stack's env file (runner token, Daytona key); never printed",
    )
    ap.add_argument("--allow-destructive", action="store_true")
    ap.add_argument("--claude-model", default="haiku")
    ap.add_argument("--custom-name", default="orqa")
    ap.add_argument("--custom-slug", default=None)
    ap.add_argument("--custom-model", default="openai/gpt-4o-mini")
    ap.add_argument("--excerpts-dir", help="also write per-cell log excerpts here")
    ap.add_argument("--worktree", help="checkout root, for identity-mismatch's run.sh")
    # No stack-specific defaults: identity-mismatch recreates the runner service with exactly
    # the stack's own run.sh arguments, so the operator states them.
    ap.add_argument(
        "--recreate-env-file", help="run.sh --env-file for identity-mismatch"
    )
    ap.add_argument(
        "--recreate-license", choices=("ee", "oss"), help="run.sh --license"
    )
    ap.add_argument(
        "--recreate-stage", choices=("dev", "gh"), help="run.sh --dev or --gh"
    )
    args = ap.parse_args()

    if args.cells == "phase1":
        wanted = list(PHASE1)
    elif args.cells == "phase2":
        wanted = list(PHASE2)
    elif args.cells == "all":
        wanted = list(CELLS)
    else:
        wanted = [c.strip() for c in args.cells.split(",") if c.strip()]
    unknown = [c for c in wanted if c not in CELLS]
    if unknown:
        ap.error(f"unknown cells: {unknown}")
    if "identity-mismatch" in wanted and args.allow_destructive:
        missing = [
            flag
            for flag, value in (
                ("--worktree", args.worktree),
                ("--recreate-env-file", args.recreate_env_file),
                ("--recreate-license", args.recreate_license),
                ("--recreate-stage", args.recreate_stage),
            )
            if not value
        ]
        if missing:
            ap.error(f"identity-mismatch needs {', '.join(missing)}")

    stamp = time.strftime("%Y%m%d-%H%M%S")
    outdir = RUNS / f"{stamp}-{os.getpid()}-r1-two-replicas"
    outdir.mkdir(parents=True, exist_ok=True)
    results: dict = {"project_id": lib.PROJECT, "base": lib.BASE, "cells": {}}

    if not args.project:
        for name in wanted:
            results["cells"][name] = {
                "evidence": {},
                "verdict": _skip("needs --project <compose project> for docker access"),
                "elapsed_s": 0.0,
            }
    else:
        stack = Stack(args.project, args.stack_env)
        runners = stack.wait_ready()
        results["runners"] = [r.__dict__ for r in runners]
        if len(runners) != 2:
            raise SystemExit(
                f"expected exactly two runner containers, found {len(runners)}"
            )
        for r in runners:
            try:
                health = httpx.get(r.address + "/health", timeout=5).json()
            except (httpx.HTTPError, ValueError) as exc:
                raise SystemExit(
                    f"{r.name} at {r.address} did not answer /health: {exc}"
                )
            if health.get("replicaId") != r.replica_id:
                raise SystemExit(
                    f"{r.name} answers as {health.get('replicaId')!r}, hostname {r.replica_id!r}"
                )
        print(
            "[r1] runners: "
            + ", ".join(f"{r.name}={r.replica_id}@{r.address}" for r in runners),
            file=sys.stderr,
        )
        ctx = Ctx(args, stack, outdir)
        for name in wanted:
            results["cells"][name] = run_cell(ctx, name)
            (outdir / "results.json").write_text(
                json.dumps(results, indent=2, default=str)
            )

    (outdir / "results.json").write_text(json.dumps(results, indent=2, default=str))
    lines = ["| cell | verdict | why | evidence |", "|---|---|---|---|"]
    for name, r in results["cells"].items():
        excerpts = (r.get("evidence") or {}).get("excerpts") or ""
        where = excerpts[0] if isinstance(excerpts, list) and excerpts else ""
        lines.append(
            f"| {name} | {_verdict_word(r['verdict'])} | {r['verdict']['why']} | {where} |"
        )
    table = "\n".join(lines)
    (outdir / "summary.md").write_text(table + "\n")
    print("\n" + table)
    print(f"\nresults: {outdir}")
    verdicts = [r["verdict"] for r in results["cells"].values()]
    if any(not v["skip"] and not v["pass"] for v in verdicts):
        return 1
    if verdicts and all(v["skip"] for v in verdicts):
        # Nothing was measured. A run that only skipped must never read as a green record.
        print("every selected cell was SKIP: nothing was measured", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
