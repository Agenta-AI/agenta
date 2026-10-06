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

SUBSCRIPTION SHAPES. `--subscription hosted` runs the six routing cells (`warm-holder`,
`approval-warm`, `stop-on-b`, `kill-from-non-holder`, `holder-killed-followup`,
`kill-holder-parked-approval`) on Pi with the project's HOSTED ChatGPT connection: `pi_core`,
provider `openai-codex`, `--pi-model` (default `gpt-5.5`; a ChatGPT account refuses
`gpt-5.4-mini`), `connection {"mode": "self_managed", "slug": <--subscription-slug>}`, on
`--subscription-sandbox daytona` (default) or `inprocess`. The slug must name a
`subscription_provider` vault record in state `ready`; otherwise every cell SKIPs with the reason.
`--subscription mounted` is the operator's Pi login mounted into the runner containers
(`PI_CODING_AGENT_DIR`): the same Pi shape with `slug: None`, `inprocess` only (the runner refuses
an operator mount on Daytona). The other cells SKIP under a subscription shape. On `inprocess`
the cold marker stays `stage=sandbox_start ... mode=create` (the in-process acquire logs it with
`sandbox=-`), and `warm-holder` / `holder-killed-followup` run the in-process checks
(`[inprocess] sandbox created`, one command sandbox) on the shape's config.
Without `--subscription` the run is exactly the Claude-on-Daytona run above.

Three cells are about the hosted login itself and run only under `--subscription hosted`. Their
evidence is each pod's own log in the turn's time window, because the subscription lines name
the connection, not the session: `event=subscription.materialize connection=<id> scope=...
wrote=... reason=...` (the login written into the run's agent dir from the request) and
`event=subscription.publish ... decision=updated|noop|...` (a refreshed login pushed back to the
api), plus the api's `subscription.push ... decision=...` lines and the row's `login_version` /
`login_generation` read off `GET /secrets/`.

- `hosted-both-pods` (phase 1): one short turn on each pod (new sessions are opened until both
  pods hold one, at most 8). Both run on the subscription (`credentialMode=runtime_provided`,
  `connection=self_managed:<slug>`), both pods materialize the login from the request, and no
  pod uses a local copy that outranks it (`reason` is never `older-generation`).
- `hosted-refresh-across-pods` (phase 2, DESTRUCTIVE to the stored login): the stored login is
  put past its expiry in Postgres (`qa_product._expire_stored_login`: pgcrypto in place with
  the stack's AGENTA_CRYPT_KEY, the api's cached vault read cleared in Redis). The next turn, on
  pod A, refreshes, A publishes (`decision=updated`), the api accepts and `login_version` moves
  by one. Then new sessions are opened until one lands on pod B: B's turn runs on the refreshed
  login (`materialize ... wrote=true`), B publishes nothing new, no recovery line, the api logs
  exactly one `decision=accept` for the whole cell, and the version does not move again. When
  both in-process runners mount the same state volume (the compose `runner-state` volume), they
  share one login copy: any pod may publish the refresh, and B's `reason=not-newer` at an equal
  generation also counts as running on it. The gap between A's push and B's turn is recorded.
- `hosted-restart-reconnect` (phase 2): `docker kill` + `docker start` one pod, wait for
  health, then a turn pinned to it (new sessions until it is the holder) runs on the
  subscription with no device login (`login_generation` unchanged, no `subscription.attempt`).

    uv run resources/matrix_r1_two_replicas.py --project <compose project> \\
        --stack-env <env file> --subscription hosted --subscription-sandbox inprocess \\
        --cells warm-holder,approval-warm,stop-on-b,kill-from-non-holder

THE DAYTONA HARNESS. `--daytona-harness pi_core` runs every Daytona cell on Pi instead of Claude
Code, with the custom OpenAI-compatible vault connection named by `--custom-name` and its model
`--custom-model` (the in-process shape's connection). Pi's shell tool is `bash`, it runs the
`timeout N tail -f /dev/null` long command as is, and under permission `ask` it gates every bash
call, so the mutating prompt parks there too. Each cell records `harness` and `model`.

KUBERNETES MODE. `--kube-namespace <ns>` (instead of `--project`) runs the cells against a Helm
release with two runner pods: `--kube-release` (default `agenta`) selects the pods by
`app.kubernetes.io/instance` and `app.kubernetes.io/component`, and every kubectl call carries
`--kubeconfig`, `--kube-context` and the namespace. A runner is a pod: its replica id is the
pod's `AGENTA_RUNNER_REPLICA_ID`, its address `http://<pod IP>:<AGENTA_RUNNER_PORT>`. The pod logs
are followed from the run start (`kubectl logs -f --timestamps`, one file per pod under the run
folder, every runner, api and services pod, a deleted pod's included). Postgres is read with
`psql` inside an api pod against the api's own `POSTGRES_URI_*`, so the URI never leaves the
pod. The runner token and Daytona key come from the Secret the runner pod reads (or
`--kube-secret`); `--stack-env` replaces them. Direct posts to a pod go through one
`kubectl port-forward` per pod. What changes:

- kill is `kubectl delete pod --grace-period=0 --force`, and the Deployment starts a NEW pod
  (new name, new IP) at once. "Restored" means two Ready runner pods again. The killed-holder
  cells accept the follow-up on any one pod other than A (B or A's replacement).
- `sigterm-drain` is a graceful `kubectl delete pod` with the pod's own grace period. The
  terminating pod leaves the Service endpoints, so new sessions must run on other pods.
- `identity-mismatch`, `hosted-refresh-across-pods` and `hosted-restart-reconnect` SKIP
  (compose-only operations: a recreate that reuses an IP, the Postgres and Redis containers, a
  restart in place).
- Two phase 2 cells run only here (they SKIP on compose):
  - `rollout-during-turn`: a long turn on pod A, then `kubectl rollout restart` of the
    Deployment that owns the runner pods. While A terminates its `/run` answers 503; turns
    started once no old pod serves, and after `rollout status`, run on new pods; the long turn
    finishes; at the end both Ready pods are new. Per-step times are recorded.
  - `drain-node-parked-approval`: park an approval on A, `kubectl cordon` its node, `kubectl
    drain` it with a pod selector of this release's runner pods of A's ReplicaSet only (the
    eviction goes through the PodDisruptionBudget, whose `disruptionsAllowed` is recorded), then
    answer. The continuation runs cold on another pod with no second card. The node is always
    uncordoned. A cluster that refuses `cordon` to these credentials is a SKIP.

    uv run resources/matrix_r1_two_replicas.py --kube-namespace <ns> --kube-context <ctx> \\
        --daytona-harness pi_core --custom-name <connection> --custom-model <model> \\
        --cells all --allow-destructive

A release record needs BOTH phases: `--cells all --allow-destructive`. A cell that fails while a
runner container restarted under it (another process killed it, read from `State.StartedAt`)
is run once more, and both attempts are recorded. A cell whose own failing turn was refused by
the sandbox provider on capacity is run once more after 120 s, and is a SKIP if refused again.
Exit code: 1 when any cell FAILs, 2 when every selected cell is SKIP, 0 otherwise.
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import json
import os
import pathlib
import re
import signal
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


class _TimedText(list):
    """A turn's text parts that remember when the first one arrived."""

    first_at: float | None = None

    def append(self, item) -> None:
        if self.first_at is None:
            self.first_at = time.time()
        super().append(item)


class TimedTurn(lib.Turn):
    """`lib.Turn` plus the times `ttft_s` needs. `lib.invoke` builds its turn before it opens
    the request, so `started_at` is the request start."""

    def __init__(self) -> None:
        super().__init__()
        self.started_at = time.time()
        self.text_parts = _TimedText()


# `lib.invoke` builds its turn from the module's `Turn`; every turn of this driver is timed.
lib.Turn = TimedTurn


def _ttft(turn) -> float | None:
    """Seconds from the request start to the first assistant text frame."""
    first = getattr(turn.text_parts, "first_at", None)
    started = getattr(turn, "started_at", None)
    return round(first - started, 2) if first and started else None


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
    "hosted-both-pods",
)
PHASE2 = (
    "kill-holder-parked-approval",
    "sigterm-drain",
    "holder-killed-followup",
    "inprocess-holder-killed",
    "identity-mismatch",
    "hosted-refresh-across-pods",
    "hosted-restart-reconnect",
    "rollout-during-turn",
    "drain-node-parked-approval",
)
# Kubernetes operations with no compose equivalent; they SKIP in docker mode.
KUBE_ONLY_CELLS = ("rollout-during-turn", "drain-node-parked-approval")
# Cells that need a compose-only operation, with the reason they SKIP in kube mode.
DOCKER_ONLY_CELLS = {
    "identity-mismatch": (
        "needs a compose recreate that hands the old container IP to a new container; a "
        "Kubernetes pod never comes back under its old name, so there is no reused address"
    ),
    "hosted-refresh-across-pods": (
        "rewrites the stored login through the compose Postgres and Redis containers"
    ),
    "hosted-restart-reconnect": (
        "restarts one container in place and pins a turn to it; a deleted Kubernetes pod is "
        "replaced by a new pod, never restarted under its old name"
    ),
}

# The cells a `--subscription` shape runs; the rest need the vault key, the mock harness or the
# custom in-process provider and SKIP under it.
SUBSCRIPTION_CELLS = (
    "warm-holder",
    "approval-warm",
    "stop-on-b",
    "kill-from-non-holder",
    "kill-holder-parked-approval",
    "holder-killed-followup",
    "hosted-both-pods",
    "hosted-refresh-across-pods",
    "hosted-restart-reconnect",
)
# The cells about the hosted login itself; they SKIP under any other shape.
HOSTED_CELLS = (
    "hosted-both-pods",
    "hosted-refresh-across-pods",
    "hosted-restart-reconnect",
)
# Pi reaches a ChatGPT subscription, hosted or mounted, through this provider.
PI_SUBSCRIPTION_PROVIDER = "openai-codex"
SUBSCRIPTION_SECRET_KIND = "subscription_provider"

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
    kube = False
    # How the drain cell names the command that stops A gracefully.
    drain_label = "docker stop"
    api_internal_url = API_INTERNAL_URL

    def __init__(self, project: str, stack_env: str | None) -> None:
        self.project = project
        self.env = _read_env_file(stack_env) if stack_env else {}
        self.hooks = sc.DockerComposeHooks(project)

    def close(self) -> None:
        pass

    def base_url(self, runner: Runner) -> str:
        """Where the driver itself reaches a runner's own routes."""
        return runner.address

    def service_log_name(self, service: str) -> str:
        return f"{self.project}-{service}-1"

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
        lines = self.logs_since(self.service_log_name(service), since)
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
                self.base_url(runner).rstrip("/") + path,
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

    def begin_drain(self, runner: Runner) -> subprocess.Popen:
        """Stop `runner` gracefully in the background; the process ends when it is down."""
        return subprocess.Popen(
            ["docker", "stop", "-t", "160", runner.name],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    def drain_timeout_s(self, runner: Runner) -> float:
        return 200.0

    def finished_at(self, runner: Runner) -> str:
        return self.docker(
            "inspect", "-f", "{{.State.FinishedAt}}", runner.name
        ).stdout.strip()


# --------------------------------------------------------------------------- #
# Kubernetes mode: the same surface over a Helm release with two runner pods.
# --------------------------------------------------------------------------- #

RUNNER_PORT_DEFAULT = 8765
KUBE_POLL_S = 3.0
# The workloads whose logs the cells read: Helm component label -> container name.
KUBE_LOGGED = {"runner": "runner", "api": "api", "services": "services"}
# Runs inside an api pod: $1 names the env var holding a Postgres URI, $2 is the SQL. The URI
# carries an async driver suffix (`postgresql+asyncpg://`) and asyncpg's `ssl=` option, which
# libpq spells `sslmode=`; both are rewritten in the pod, so the URI never reaches the driver.
PSQL_IN_POD = (
    'u=$(printenv "$1" | sed -e "s#^\\([a-z]*\\)+[a-z0-9_]*://#\\1://#" '
    '-e "s#\\([?&]\\)ssl=#\\1sslmode=#") && [ -n "$u" ] && '
    'exec psql "$u" -X -At -F "|" -v ON_ERROR_STOP=1 -c "$2"'
)
_FORWARD_RE = re.compile(r"Forwarding from (?:127\.0\.0\.1|\[::1\]):(\d+) ->")


def _psql_rows(raw: str) -> list[list[str]]:
    return [line.split("|") for line in raw.strip().splitlines() if line.strip()]


def _uri_var(db: str) -> str:
    """The api env var for a database the shared psql helpers name by its compose name."""
    return "POSTGRES_URI_TRACING" if "tracing" in db else "POSTGRES_URI_CORE"


def _forward_port(line: str) -> int | None:
    """The local port of `kubectl port-forward`'s first line."""
    m = _FORWARD_RE.search(line)
    return int(m.group(1)) if m else None


def drain_pod_selector(release: str, template_hash: str) -> str:
    """The drain's pod selector: this release's runner pods of one ReplicaSet, nothing else on
    the node (other workloads and namespaces share it, and a full drain can block on their
    single-pod budgets)."""
    return (
        f"app.kubernetes.io/instance={release},app.kubernetes.io/component=runner,"
        f"pod-template-hash={template_hash}"
    )


def drain_foreign_pods(pods: list[dict], namespace: str) -> list[str]:
    """`namespace/name` of every pod outside `namespace` that the drain selector matches."""
    out = []
    for pod in pods:
        meta = pod.get("metadata") or {}
        if meta.get("namespace") != namespace:
            out.append(f"{meta.get('namespace')}/{meta.get('name')}")
    return sorted(out)


def _pod_container(pod: dict, name: str) -> dict:
    containers = (pod.get("spec") or {}).get("containers") or []
    return next((c for c in containers if c.get("name") == name), {})


def _pod_env(pod: dict, container: str, key: str) -> str | None:
    """The value Kubernetes gives `key` in that container: a literal (with `$(VAR)` references
    to other variables expanded) or a pod field. A secret reference reads as None."""
    env = _pod_container(pod, container).get("env") or []
    entry = next((e for e in env if e.get("name") == key), None)
    if entry is None:
        return None
    if "value" in entry:
        return re.sub(
            r"\$\((\w+)\)",
            lambda m: (
                (_pod_env(pod, container, m.group(1)) if m.group(1) != key else None)
                or m.group(0)
            ),
            entry.get("value") or "",
        )
    field = ((entry.get("valueFrom") or {}).get("fieldRef") or {}).get("fieldPath")
    fields = {
        "metadata.name": (pod.get("metadata") or {}).get("name"),
        "metadata.namespace": (pod.get("metadata") or {}).get("namespace"),
        "status.podIP": (pod.get("status") or {}).get("podIP"),
        "spec.nodeName": (pod.get("spec") or {}).get("nodeName"),
    }
    return fields.get(field)


def _secret_ref(pod: dict, container: str, key: str) -> tuple[str, str] | None:
    env = _pod_container(pod, container).get("env") or []
    entry = next((e for e in env if e.get("name") == key), {})
    ref = (entry.get("valueFrom") or {}).get("secretKeyRef") or {}
    return (ref["name"], ref["key"]) if ref.get("name") and ref.get("key") else None


def _decode_secret(secret: dict, key: str) -> str | None:
    raw = (secret.get("data") or {}).get(key)
    return base64.b64decode(raw).decode() if raw else None


def _owner(obj: dict, kind: str) -> str | None:
    refs = (obj.get("metadata") or {}).get("ownerReferences") or []
    return next((o.get("name") for o in refs if o.get("kind") == kind), None)


def runner_from_pod(pod: dict) -> Runner:
    meta, status = pod.get("metadata") or {}, pod.get("status") or {}
    name = meta.get("name", "")
    ip = status.get("podIP") or ""
    port = _pod_env(pod, "runner", "AGENTA_RUNNER_PORT") or str(RUNNER_PORT_DEFAULT)
    container = next(
        (c for c in status.get("containerStatuses") or [] if c.get("name") == "runner"),
        {},
    )
    if meta.get("deletionTimestamp"):
        state = "terminating"
    elif status.get("phase") == "Running":
        state = "running"
    else:
        state = (status.get("phase") or "unknown").lower()
    ready = any(
        c.get("type") == "Ready" and c.get("status") == "True"
        for c in status.get("conditions") or []
    )
    return Runner(
        name=name,
        replica_id=_pod_env(pod, "runner", "AGENTA_RUNNER_REPLICA_ID") or name,
        address=f"http://{ip}:{port}" if ip else "",
        started_at=((container.get("state") or {}).get("running") or {}).get(
            "startedAt", ""
        ),
        status=state,
        health="healthy" if ready else "unhealthy",
    )


def _kube_ready(runners: list[Runner]) -> bool:
    """Exactly two runner pods, both Ready and neither terminating: a cell must never pick a
    pod that is still starting or already draining."""
    return len(runners) == 2 and all(
        r.status == "running" and r.health == "healthy" for r in runners
    )


KILL_GONE_TIMEOUT_S = 60.0
# Runs inside an api pod: prints the replica id that answers `GET <argv[1]>/health`, or DOWN.
HEALTH_PROBE_PY = (
    "import json,sys,urllib.request\n"
    "try:\n"
    "    r=urllib.request.urlopen(sys.argv[1].rstrip('/')+'/health',timeout=2)\n"
    "    print(json.load(r).get('replicaId') or 'DOWN')\n"
    "except Exception:\n"
    "    print('DOWN')\n"
)


def wait_process_gone(
    probe,
    replica_id: str,
    timeout: float = KILL_GONE_TIMEOUT_S,
    interval: float = 1.0,
    clock=time.time,
    sleep=time.sleep,
) -> dict:
    """Probe until the killed runner no longer answers as itself. `probe()` returns the
    replica id that answered, "DOWN", or None when the probe itself could not run (it counts
    as neither). Gone means two failed probes in a row, so one dropped request is not a death.
    Times are seconds from the call."""
    started = clock()
    first_failed = None
    failed_in_row = 0
    probes = 0
    while True:
        answer = probe()
        probes += 1
        now = clock() - started
        if answer is not None and answer != replica_id:
            failed_in_row += 1
            if first_failed is None:
                first_failed = round(now, 1)
            if failed_in_row >= 2:
                return {
                    "gone": True,
                    "first_failed_probe_s": first_failed,
                    "kill_gone_after_s": round(now, 1),
                    "probes": probes,
                }
        elif answer is not None:
            failed_in_row, first_failed = 0, None
        if now >= timeout:
            return {
                "gone": False,
                "first_failed_probe_s": first_failed,
                "kill_gone_after_s": None,
                "probes": probes,
            }
        sleep(interval)


def _read_log_file(path: pathlib.Path, since: float) -> list[str]:
    """The timestamped lines of a followed log from `since - 2` on (the docker reads' margin).
    The last piece is dropped unless it ends in a newline: it may still be being written."""
    try:
        text = path.read_text(errors="replace")
    except FileNotFoundError:
        return []
    out = []
    for line in text.split("\n")[:-1]:
        when = _line_epoch(line)
        if when is not None and when >= since - 2:
            out.append(line)
    return out


class Kubectl:
    """Every kubectl call of a run, pinned to one kubeconfig, context and namespace, so no
    call can reach another cluster."""

    def __init__(
        self, namespace: str, context: str | None = None, kubeconfig: str | None = None
    ) -> None:
        self.namespace = namespace
        self.context = context
        self.kubeconfig = kubeconfig

    def argv(self, *args: str) -> list[str]:
        base = ["kubectl"]
        if self.kubeconfig:
            base += ["--kubeconfig", self.kubeconfig]
        if self.context:
            base += ["--context", self.context]
        return [*base, "--namespace", self.namespace, *args]

    def run(self, *args: str, timeout: float = 60.0) -> subprocess.CompletedProcess:
        try:
            return subprocess.run(
                self.argv(*args), capture_output=True, text=True, timeout=timeout
            )
        except subprocess.TimeoutExpired:
            return subprocess.CompletedProcess(
                args, 124, "", f"kubectl timed out after {timeout:.0f}s"
            )

    def json(self, *args: str, timeout: float = 60.0) -> dict:
        res = self.run(*args, "-o", "json", timeout=timeout)
        if res.returncode != 0:
            raise RuntimeError(f"kubectl {args[0]}: {res.stderr.strip()[:300]}")
        return json.loads(res.stdout)

    def popen(self, *args: str, **kwargs) -> subprocess.Popen:
        return subprocess.Popen(self.argv(*args), **kwargs)


class _LogFollower:
    """`kubectl logs -f --timestamps` of one container into one file. A restarted follower
    reads again from its newest line and skips what it already wrote."""

    def __init__(
        self,
        kube: Kubectl,
        pod: str,
        container: str,
        path: pathlib.Path,
        since: float,
    ) -> None:
        self.kube, self.pod, self.container, self.path = kube, pod, container, path
        self.newest = since
        self.proc: subprocess.Popen | None = None
        self.pump: threading.Thread | None = None

    def alive(self) -> bool:
        return self.pump is not None and self.pump.is_alive()

    def start(self) -> None:
        # Reap (or end) the previous `kubectl logs`, so a restart never leaves a process behind.
        self.stop()
        floor = self.newest
        self.proc = self.kube.popen(
            "logs",
            "-f",
            "--timestamps",
            "-c",
            self.container,
            "--since-time",
            _iso(floor),
            self.pod,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            # One undecodable byte must not end the pump: every later line would be lost.
            errors="replace",
        )
        self.pump = threading.Thread(
            target=self._pump, args=(self.proc, floor), daemon=True
        )
        self.pump.start()

    def _pump(self, proc: subprocess.Popen, floor: float) -> None:
        with self.path.open("a") as fh:
            for line in proc.stdout:
                when = _line_epoch(line)
                if when is not None and when <= floor:
                    continue
                fh.write(line if line.endswith("\n") else line + "\n")
                fh.flush()
                if when is not None:
                    self.newest = max(self.newest, when)

    def stop(self) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()


class KubeLogs:
    """Follows every runner, api and services pod of the release from the run start, so a pod
    deleted by a cell keeps its lines (its logs leave the cluster with it). Pods are listed
    again every few seconds and a follower starts for each new one."""

    def __init__(
        self, kube: Kubectl, release: str, folder: pathlib.Path, since: float
    ) -> None:
        self.kube = kube
        self.selector = (
            f"app.kubernetes.io/instance={release},"
            f"app.kubernetes.io/component in ({','.join(KUBE_LOGGED)})"
        )
        self.folder = folder
        self.since = since
        self.followers: dict[str, _LogFollower] = {}
        self.components: dict[str, str] = {}
        self.lock = threading.Lock()
        self._stopped = threading.Event()
        self._thread: threading.Thread | None = None
        folder.mkdir(parents=True, exist_ok=True)

    def poll(self) -> None:
        try:
            pods = self.kube.json("get", "pods", "-l", self.selector)["items"]
        except (RuntimeError, ValueError):
            return
        with self.lock:
            if self._stopped.is_set():
                return
            for pod in pods:
                meta = pod.get("metadata") or {}
                name = meta.get("name", "")
                component = (meta.get("labels") or {}).get(
                    "app.kubernetes.io/component"
                )
                if component not in KUBE_LOGGED or (pod.get("status") or {}).get(
                    "phase"
                ) in ("Succeeded", "Failed"):
                    continue
                follower = self.followers.get(name)
                if follower is None:
                    follower = _LogFollower(
                        self.kube,
                        name,
                        KUBE_LOGGED[component],
                        self.folder / f"{component}-{name}.log",
                        self.since,
                    )
                    self.followers[name] = follower
                    self.components[name] = component
                if not follower.alive():
                    follower.start()

    def start(self) -> None:
        def loop() -> None:
            while not self._stopped.wait(KUBE_POLL_S):
                self.poll()

        self.poll()
        self._thread = threading.Thread(target=loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        with self.lock:
            self._stopped.set()
            for follower in self.followers.values():
                follower.stop()

    def pods(self, component: str) -> list[str]:
        with self.lock:
            return sorted(n for n, c in self.components.items() if c == component)

    def lines(self, pod: str, since: float) -> list[str]:
        with self.lock:
            follower = self.followers.get(pod)
        return _read_log_file(follower.path, since) if follower else []


class KubeHooks(sc.OperatorHooks):
    """session_control's Postgres reads, run with `psql` inside an api pod against the api's
    own URIs, so no database credential ever leaves the cluster."""

    available = True
    stream_row = sc.DockerComposeHooks.stream_row
    record_rows = sc.DockerComposeHooks.record_rows
    command_rows = sc.DockerComposeHooks.command_rows
    execution_rows = sc.DockerComposeHooks.execution_rows

    def __init__(self, kube: Kubectl, release: str) -> None:
        self.kube = kube
        self.selector = (
            f"app.kubernetes.io/instance={release},app.kubernetes.io/component=api"
        )
        self._pod: str | None = None

    def _api_pod(self) -> str:
        if self._pod is None:
            pods = [
                runner_from_pod(p)
                for p in self.kube.json("get", "pods", "-l", self.selector)["items"]
            ]
            ready = [p.name for p in pods if p.status == "running"]
            if not ready:
                raise RuntimeError("no running api pod to run psql in")
            self._pod = ready[0]
        return self._pod

    def psql(self, db: str, sql: str) -> list[list[str]]:
        res = None
        for _ in (1, 2):
            res = self.kube.run(
                "exec",
                self._api_pod(),
                "-c",
                "api",
                "--",
                "sh",
                "-c",
                PSQL_IN_POD,
                "sh",
                _uri_var(db),
                sql,
            )
            if res.returncode == 0:
                return _psql_rows(res.stdout)
            # The pod may have gone; the next try picks one again.
            self._pod = None
        # psql's own error text names the host and user; only the exit code is printed.
        print(f"[r1] psql in the api pod exited {res.returncode}", file=sys.stderr)
        return []


class KubeStack(Stack):
    """The `Stack` surface over a Helm release: runner pods for containers, followed pod logs
    for `docker logs`, psql in an api pod for the Postgres container, a port-forward per pod for
    the pod IPs the operator's machine cannot reach, and pod deletes for kill and stop."""

    kube = True
    drain_label = "kubectl delete pod"

    def __init__(
        self,
        kube: Kubectl,
        release: str,
        secret: str | None,
        stack_env: str | None,
        folder: pathlib.Path,
    ) -> None:
        self.kubectl = kube
        self.release = release
        self.selector = (
            f"app.kubernetes.io/instance={release},app.kubernetes.io/component=runner"
        )
        self.hooks = KubeHooks(kube, release)
        self.logs = KubeLogs(kube, release, folder / "kube-logs", time.time() - 5)
        self.logs.start()
        self._forwards: dict[str, tuple[subprocess.Popen, int]] = {}
        self._forward_lock = threading.Lock()
        try:
            pods = self._runner_pods()
        except BaseException:
            # A `kubectl logs -f` outlives this process; never leave the followers running.
            self.logs.stop()
            raise
        first = pods[0] if pods else {}
        self.env = (
            _read_env_file(stack_env) if stack_env else self._cluster_env(first, secret)
        )
        self.api_internal_url = (
            _pod_env(first, "runner", "AGENTA_API_INTERNAL_URL")
            or _pod_env(first, "runner", "AGENTA_API_URL")
            or API_INTERNAL_URL
        )

    def _cluster_env(self, pod: dict, secret: str | None) -> dict[str, str]:
        """The runner token and Daytona key from the Secret the runner pod reads them from
        (or `--kube-secret`), plus the Daytona URL from the pod spec. Never printed."""
        env: dict[str, str] = {}
        url = _pod_env(pod, "runner", "AGENTA_RUNNER_DAYTONA_API_URL")
        if url:
            env["AGENTA_RUNNER_DAYTONA_API_URL"] = url
        secrets: dict[str, dict] = {}
        for key in ("AGENTA_RUNNER_TOKEN", "AGENTA_RUNNER_DAYTONA_API_KEY"):
            ref = (secret, key) if secret else _secret_ref(pod, "runner", key)
            if ref is None:
                continue
            if ref[0] not in secrets:
                try:
                    secrets[ref[0]] = self.kubectl.json("get", "secret", ref[0])
                except (RuntimeError, ValueError) as exc:
                    print(f"[r1] cannot read secret {ref[0]}: {exc}", file=sys.stderr)
                    secrets[ref[0]] = {}
            value = _decode_secret(secrets[ref[0]], ref[1])
            if value:
                env[key] = value
        return env

    def close(self) -> None:
        self.logs.stop()
        with self._forward_lock:
            for proc, _ in self._forwards.values():
                if proc.poll() is None:
                    proc.terminate()
            self._forwards.clear()

    def docker(self, *args: str, timeout: float = 60.0) -> subprocess.CompletedProcess:
        raise RuntimeError("a docker command in kube mode")

    # -- pods ------------------------------------------------------------- #

    def _runner_pods(self) -> list[dict]:
        return self.kubectl.json("get", "pods", "-l", self.selector)["items"]

    def pod(self, name: str) -> dict | None:
        try:
            return self.kubectl.json("get", "pod", name)
        except (RuntimeError, ValueError):
            return None

    def runner_names(self) -> list[str]:
        return sorted(r.name for r in self.runners())

    def runners(self) -> list[Runner]:
        # A pod the kubelet evicted or a node shutdown ended stays listed as Failed until it
        # is garbage-collected; it serves nothing and must not count as one of the two.
        return sorted(
            (
                runner_from_pod(p)
                for p in self._runner_pods()
                if (p.get("status") or {}).get("phase") not in ("Succeeded", "Failed")
            ),
            key=lambda r: r.name,
        )

    def runner_nodes(self) -> dict[str, str]:
        return {
            (p.get("metadata") or {}).get("name", ""): (p.get("spec") or {}).get(
                "nodeName", ""
            )
            for p in self._runner_pods()
        }

    def wait_ready(self, timeout: float = 420.0) -> list[Runner]:
        """Exactly two runner pods, both Ready, neither terminating. Waits; never scales."""
        deadline = time.time() + timeout
        runners: list[Runner] = []
        while time.time() < deadline:
            runners = self.runners()
            if _kube_ready(runners):
                return runners
            time.sleep(5)
        raise RuntimeError(
            "runner pods not ready: "
            + ", ".join(f"{r.name}={r.status}/{r.health}" for r in runners)
        )

    def wait_healthy(self, name: str, timeout: float = 420.0) -> bool:
        try:
            self.wait_ready(timeout=timeout)
        except RuntimeError:
            return False
        return True

    def runner_deployment(self) -> str:
        """The Deployment that owns the runner pods, through pod -> ReplicaSet -> Deployment."""
        pods = self._runner_pods()
        replica_set = _owner(pods[0], "ReplicaSet") if pods else None
        if not replica_set:
            raise RuntimeError("the runner pods have no owning ReplicaSet")
        deployment = _owner(
            self.kubectl.json("get", "replicaset", replica_set), "Deployment"
        )
        if not deployment:
            raise RuntimeError(f"ReplicaSet {replica_set} has no owning Deployment")
        return deployment

    def runner_budgets(self) -> list[dict]:
        try:
            items = self.kubectl.json("get", "pdb", "-l", self.selector)["items"]
        except (RuntimeError, ValueError) as exc:
            return [{"error": str(exc)}]
        return [
            {
                "name": (b.get("metadata") or {}).get("name"),
                "spec": {
                    k: v for k, v in (b.get("spec") or {}).items() if k != "selector"
                },
                "disruptions_allowed": (b.get("status") or {}).get(
                    "disruptionsAllowed"
                ),
            }
            for b in items
        ]

    # -- logs ------------------------------------------------------------- #

    def logs_since(self, container: str, since: float) -> list[str]:
        return self.logs.lines(container, since)

    def session_lines(self, since: float, *session_ids: str) -> dict[str, list[str]]:
        """Pod name -> its lines naming any of the sessions, for every runner pod seen in the
        run (a deleted pod included) and every current one (an empty list until followed)."""
        self.logs.poll()
        out: dict[str, list[str]] = {}
        for name in sorted(set(self.logs.pods("runner")) | set(self.runner_names())):
            lines = self.logs_since(name, since)
            out[name] = [ln for ln in lines if any(s in ln for s in session_ids)]
        return out

    def service_lines(self, service: str, since: float, *needles: str) -> list[str]:
        """The lines of every pod of the workload (several replicas), in time order."""
        lines = [
            ln
            for pod in self.logs.pods(service)
            for ln in self.logs_since(pod, since)
            if any(n in ln for n in needles)
        ]
        return sorted(lines, key=lambda ln: _line_epoch(ln) or 0.0)

    def service_log_name(self, service: str) -> str:
        return f"{service}-pods"

    # -- the runner's own routes ------------------------------------------ #

    def base_url(self, runner: Runner) -> str:
        """A local port-forward to the pod, opened once and reused. `runner.address` stays the
        pod's own address, the one the cells compare with the stored binding."""
        port = httpx.URL(runner.address).port if runner.address else None
        with self._forward_lock:
            entry = self._forwards.get(runner.name)
            if entry and entry[0].poll() is None:
                return f"http://127.0.0.1:{entry[1]}"
            proc = self.kubectl.popen(
                "port-forward",
                f"pod/{runner.name}",
                f":{port or RUNNER_PORT_DEFAULT}",
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                errors="replace",
            )
            found: dict[str, int] = {}
            ready = threading.Event()

            def pump() -> None:
                # Read every line: port-forward logs each connection and must never block on
                # a full pipe.
                for line in proc.stdout:
                    if "port" not in found and _forward_port(line):
                        found["port"] = _forward_port(line)
                        ready.set()
                ready.set()

            threading.Thread(target=pump, daemon=True).start()
            ready.wait(20)
            if "port" not in found:
                proc.kill()
                raise httpx.ConnectError(f"no port-forward to pod {runner.name}")
            self._forwards[runner.name] = (proc, found["port"])
            return f"http://127.0.0.1:{found['port']}"

    # -- destructive (phase 2 only) --------------------------------------- #

    def kill(self, runner: Runner) -> dict:
        """The closest to `docker kill`: the pod leaves the API at once and the Deployment
        starts a new pod (new name, new IP). It is not a bare SIGKILL: the kubelet still sends
        SIGTERM and kills the container after its minimum grace of about 2 s, so A's shutdown
        handler gets that long to start its drain.

        The container outlives its pod object (the preStop hook, then that grace), and while it
        answers `/health` as itself the services layer still posts turns to it, which then die
        with it. A crash leaves no such window, so this returns only once A's pod IP stops
        answering as A, probed from an api pod (the operator's machine cannot reach pod IPs,
        and A's port-forward dies with A). Raises when A still answers after the timeout."""
        res = self.kubectl.run(
            "delete", "pod", runner.name, "--grace-period=0", "--force", "--wait=false"
        )
        out = {"rc": res.returncode, "stderr": res.stderr.strip()[:300]}
        out.update(wait_process_gone(lambda: self._probe(runner), runner.replica_id))
        if not out["gone"]:
            raise RuntimeError(
                f"{runner.name} still answered /health as {runner.replica_id} "
                f"{KILL_GONE_TIMEOUT_S:.0f}s after the force delete: {out}"
            )
        return out

    def _probe(self, runner: Runner) -> str | None:
        """The replica id answering at the runner's pod address, seen from an api pod."""
        if not runner.address:
            return "DOWN"
        try:
            pod = self.hooks._api_pod()
        except (RuntimeError, ValueError):
            return None
        res = self.kubectl.run(
            "exec",
            pod,
            "-c",
            "api",
            "--",
            "python",
            "-c",
            HEALTH_PROBE_PY,
            runner.address,
            timeout=15,
        )
        if res.returncode != 0:
            self.hooks._pod = None
            return None
        return res.stdout.strip().splitlines()[-1] if res.stdout.strip() else None

    def start(self, runner: Runner) -> str:
        """A deleted pod never comes back; its Deployment replaces it."""
        return "" if self.wait_healthy(runner.name) else "runner pods not ready"

    def begin_drain(self, runner: Runner) -> subprocess.Popen:
        return self.kubectl.popen(
            "delete",
            "pod",
            runner.name,
            "--wait=true",
            f"--timeout={self.drain_timeout_s(runner):.0f}s",
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    def drain_timeout_s(self, runner: Runner) -> float:
        pod = self.pod(runner.name) or {}
        grace = (pod.get("spec") or {}).get("terminationGracePeriodSeconds") or 30
        return float(grace) + 60.0

    def finished_at(self, runner: Runner) -> str:
        # The pod object is gone once deleted; `a_exit_after_docker_stop_s` holds the time.
        return ""


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
        # (harness, model) of every config a cell asked for; `run_cell` resets it per attempt.
        self.used: list[tuple[str, str]] = []
        self.subscription: str | None = getattr(args, "subscription", None)
        # Set once at startup; a non-empty reason SKIPs every cell of the run.
        self.subscription_skip: str = ""
        self._hosted_slug: str | None = None

    @property
    def harness(self) -> str:
        if self.subscription:
            return "pi_core"
        return getattr(self.args, "daytona_harness", None) or "claude"

    @property
    def sandbox(self) -> str:
        if not self.subscription:
            return "daytona"
        return self.args.subscription_sandbox

    @property
    def inprocess(self) -> bool:
        return self.sandbox == "inprocess"

    def hosted_row(self) -> dict | None:
        """The hosted connection's row off `GET /secrets/`, redacted by the api: id, slug,
        `login_state`, `login_version`, `login_generation`, `login_error`. The login itself
        never leaves the api. None when the project has no connection with the slug."""
        slug = self.args.subscription_slug
        r = lib.api_call("GET", "/secrets/")
        r.raise_for_status()
        for secret in r.json():
            data = secret.get("data") or {}
            kind = secret.get("kind") or data.get("kind")
            if kind == SUBSCRIPTION_SECRET_KIND and secret.get("slug") == slug:
                return {
                    "id": secret.get("id"),
                    "slug": slug,
                    "login_state": data.get("login_state"),
                    "version": data.get("login_version"),
                    "generation": data.get("login_generation"),
                    "error": data.get("login_error"),
                }
        return None

    def resolve_hosted(self) -> dict:
        """The hosted connection the run signs in with. Sets `subscription_skip` when the slug
        is absent or not `ready`."""
        slug = self.args.subscription_slug
        try:
            row = self.hosted_row()
        except httpx.HTTPError as exc:
            self.subscription_skip = f"GET /secrets/ failed: {exc}"
            return {}
        if row is None:
            self.subscription_skip = (
                f"no `{SUBSCRIPTION_SECRET_KIND}` connection with slug {slug!r} in the "
                "project"
            )
            return {}
        if row["login_state"] != "ready":
            self.subscription_skip = (
                f"the hosted connection {slug!r} is {row['login_state']!r}, not `ready`; a "
                "human must sign in before these cells mean anything"
            )
        self._hosted_slug = slug
        return row

    def custom_slug(self, name: str | None = None) -> str:
        name = name or self.args.custom_name
        if name == self.args.custom_name and self._custom_slug:
            return self._custom_slug
        r = lib.api_call("GET", "/vault/v1/secrets/")
        r.raise_for_status()
        for secret in r.json():
            if (secret.get("header") or {}).get("name") == name and (
                secret.get("kind") == "custom_provider"
            ):
                if name == self.args.custom_name:
                    self._custom_slug = secret.get("slug")
                return secret.get("slug")
        raise RuntimeError(f"no custom_provider secret named {name!r} in the vault")

    def claude_llm(self) -> dict:
        """The Claude cells' model: the vault Anthropic key, or a custom Anthropic-protocol
        connection when `--claude-custom-name` names one (when the Anthropic key has no credit)."""
        name = self.args.claude_custom_name
        if not name:
            return {
                "model": self.args.claude_model,
                "provider": "anthropic",
                "connection": {"mode": "agenta", "slug": None},
                "extras": {},
            }
        return {
            "model": f"{name}/custom/{self.args.claude_model}",
            # The playground's shape for a named custom connection: the family the harness speaks.
            "provider": "anthropic",
            "connection": {"mode": "agenta", "slug": self.custom_slug(name)},
            "extras": {},
        }

    def pi_llm(self) -> dict:
        """The subscription shapes' model. Hosted: the vault slug the api resolves to the
        delivered login. Mounted: no slug, so the runner reads the operator's own login."""
        return {
            "model": self.args.pi_model,
            "provider": PI_SUBSCRIPTION_PROVIDER,
            "connection": {
                "mode": "self_managed",
                "slug": self._hosted_slug if self.subscription == "hosted" else None,
            },
            "extras": {},
        }

    def custom_llm(self) -> dict:
        """The custom OpenAI-compatible vault connection named by `--custom-name`."""
        return {
            "model": f"{self.args.custom_name}/custom/{self.args.custom_model}",
            "provider": None,
            "connection": {"mode": "agenta", "slug": self.custom_slug()},
            "extras": {},
        }

    def shape_config(self, shape: str) -> dict:
        """The agent config of a named shape. `allow` and `ask` are the harness under test
        (Claude on Daytona, `--daytona-harness pi_core` on Daytona with the custom connection,
        or the `--subscription` Pi shape) with that runner permission default."""
        if shape in ("allow", "ask"):
            if self.subscription:
                llm = self.pi_llm()
            elif self.harness == "pi_core":
                llm = self.custom_llm()
            else:
                llm = self.claude_llm()
            return {
                "instructions": {"agents_md": INSTRUCTIONS},
                "llm": llm,
                "tools": [],
                "mcps": [],
                "skills": [],
                "harness": {"kind": self.harness},
                "sandbox": {"kind": self.sandbox},
                "runner": {"kind": "sidecar", "permissions": {"default": shape}},
            }
        if shape == "inprocess":
            return {
                "instructions": {"agents_md": INSTRUCTIONS},
                "llm": self.custom_llm(),
                "tools": [],
                "mcps": [],
                "skills": [],
                "harness": {"kind": "pi_core"},
                "sandbox": {"kind": "inprocess"},
                "runner": {"kind": "sidecar", "permissions": {"default": "allow"}},
            }
        raise ValueError(f"unknown config shape {shape}")

    def config(self, shape: str) -> tuple[dict, dict]:
        """(agent config, references) for a named shape, committed once per run."""
        if shape not in self._configs:
            cfg = self.shape_config(shape)
            hexid = uuid.uuid4().hex[:8]
            name = f"{self.harness}-{shape}" if shape in ("allow", "ask") else shape
            wf, var = lib.create_workflow(hexid, f"qa-r1-{name}")
            rev, _ = lib.seed_and_baseline(wf, var, cfg, hexid)
            self._configs[shape] = (cfg, lib.refs(wf, var, rev))
        cfg = self._configs[shape][0]
        self.used.append((cfg["harness"]["kind"], cfg["llm"]["model"]))
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
        "ttft_s": _ttft(turn),
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


def cold_markers(ctx: Ctx, lines: dict[str, list[str]], session_id: str, after: float):
    """Per container, the lines that prove a COLD start of this session after `after`: the
    acquire's `stage=sandbox_start ... mode=create`. The in-process engine logs it too, with
    `sandbox=-` (its command sandbox comes later, on the first tool call); a warm reuse never
    acquires, so it logs none. `[inprocess] session resumed` is not a cold marker: it appears
    only when the store holds a Pi session, and a turn killed while parked on an approval never
    stored one, so its cold continuation opens a new session."""
    return sandbox_creates(lines, session_id, after)


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


def survivor(stack: Stack, holders: list[str], killed: str, other: str) -> str | None:
    """The one runner that served a turn after `killed` went down, or None. Compose keeps A
    down, so it must be the other container. Kubernetes replaces a deleted pod at once, so any
    one pod but A will do: B or A's replacement."""
    if not stack.kube:
        return other if holders == [other] else None
    return holders[0] if len(holders) == 1 and holders[0] != killed else None


def wait_runners(stack: Stack, done, timeout: float) -> list[Runner] | None:
    """Poll the runners until `done(runners)` holds; None on timeout."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        runners = stack.runners()
        if done(runners):
            return runners
        time.sleep(2)
    return None


DRAIN_LINE = "[shutdown] draining"


def wait_drain_began(
    stack: Stack, runner: Runner, since: float, timeout: float = 90.0
) -> float | None:
    """Seconds from `since` until `runner` logged the start of its drain, or None. A pod's
    preStop hook (the chart's default is `sleep 10`) runs BEFORE SIGTERM, and until SIGTERM the
    pod is not draining: a probe of its `/run` then is a real request, not a 503."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        for ln in stack.logs_since(runner.name, since):
            when = _line_epoch(ln)
            if DRAIN_LINE in ln and when is not None and when >= since - 1:
                return round(when - since, 1)
        time.sleep(1)
    return None


def respond_like_the_app(interaction: dict, approval_id: str | None) -> dict:
    """Answer an approval the way `web/mobile` does: the durable respond route plus a key."""
    answer: dict = {"approved": True}
    # The app sends the stream's approval id (the interaction token) as `tool_call_id`, not the
    # harness call id (`interactionAnswer.ts`); the cell must hit the server with that same shape.
    if approval_id:
        answer["tool_call_id"] = approval_id
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
    if ctx.inprocess:
        return inprocess_warm(ctx, "allow")
    stack = ctx.stack
    cfg, refs = ctx.config("allow")
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
    ev["cold_turn1_ttft_s"] = _ttft(t1)
    ev["warm_followup_ttft_s"] = _ttft(t2)
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
    cfg, refs = ctx.config("ask")
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
    answer = respond_like_the_app(row, t1.approvals[-1].get("approvalId"))
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
    creates = cold_markers(ctx, lines, s, after=answer["sent_at"])
    ev["cold_markers_after_answer"] = creates
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
        problems.append("a cold start marker after the answer")
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
    cfg, refs = ctx.config("allow")
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
    cfg, refs = ctx.config("allow")
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
    cfg, refs = ctx.config("allow")
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
        + lines_matching(ls, "destroy key=", s2)
        for n, ls in lines2.items()
    }
    ev["product"]["kill_lines"] = handled
    ev["product"]["pool_evicts_by_kill"] = pool_evicts
    # The container that took the Kill deleted the sandbox either through its label sweep
    # (`deleted>=1`) or, when it was the holder, through its own pool (`destroy key=` from the
    # /kill drain, or `evict ... reason=kill`), after which the sweep finds the sandbox already
    # being destroyed and deletes nothing (the in-process registry's delete and the sweep race,
    # and the sweep then logs `failed=1` for a sandbox that is gone).
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


def _mock_run_body(
    session_id: str, turn_id: str, ms: int, api_url: str = API_INTERNAL_URL
) -> dict:
    """`api_url` is the api as the runner reaches it, where its heartbeats go."""
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
                    "endpoint": api_url.rstrip("/") + "/otlp/v1/traces",
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
                stack.base_url(runner).rstrip("/") + "/run",
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
    body = _mock_run_body(s, t, ms=45000, api_url=stack.api_internal_url)
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
    return inprocess_warm(ctx, "inprocess")


def inprocess_warm(ctx: Ctx, shape: str) -> tuple[dict, dict]:
    """The warm follow-up on the in-process engine, for the custom-provider shape or a
    `--subscription` Pi shape on `inprocess`."""
    stack = ctx.stack
    cfg, refs = ctx.config(shape)
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
    if stack.kube:
        # A deleted pod never comes back: its Deployment starts a new one. Restored means
        # two Ready runner pods again.
        return {
            "was": status,
            "replaced": status != "running",
            "healthy": stack.wait_healthy(runner.name),
        }
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
    cfg, refs = ctx.config("ask")
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
        answer = respond_like_the_app(row, t1.approvals[-1].get("approvalId"))
        ev["answer"] = {k: answer[k] for k in ("status", "body")}
        continuation = ((answer["body"] or {}).get("execution") or {}).get("id")
        settled = wait_turn_settled(s, continuation, TURN_WAIT_S)
        ev["settled"] = settled["settled"]
        time.sleep(3)
        lines = stack.session_lines(since, s)
        ev["continuation_holders"] = turn_holders(lines, s, continuation)
        ev["creates_after_answer"] = cold_markers(
            ctx, lines, s, after=answer["sent_at"]
        )
        ev["tool_result_records_with_token"] = records_with(s, "tool_result", token)
        # A failed tool result is the only place a refusal by the sandbox provider shows on
        # this path (the turn itself ends cleanly), so the capacity retry reads these.
        ev["tool_errors"] = [
            str((r.get("attributes") or {}).get("output"))[:300]
            for r in sc.records(s)
            if r.get("record_type") == "tool_result"
            and (r.get("attributes") or {}).get("isError")
        ]
        rows = lib.interactions(s)
        ev["interactions_after"] = [(r.get("kind"), r.get("status")) for r in rows]
    finally:
        ev["restore"] = _restore(stack, holder)
    approvals = [r for r in ev["interactions_after"] if "approval" in str(r[0])]
    ev["survivor"] = survivor(
        stack, ev["continuation_holders"], holder.name, other.name
    )
    target = ev["survivor"] or other.name
    problems = []
    if not ev["settled"]:
        problems.append("the continuation did not settle")
    if ev["survivor"] is None:
        problems.append(f"the continuation ran on {ev['continuation_holders']}")
    if not ev["creates_after_answer"].get(target):
        problems.append(f"no cold start marker on {target}")
    if not ev["tool_result_records_with_token"]:
        problems.append(f"the tool did not run (tool errors: {ev['tool_errors'][:2]})")
    if len(approvals) != 1 or any(st == "pending" for _, st in approvals):
        problems.append(f"a second approval card or a pending row: {approvals}")
    if problems:
        return ev, _fail("; ".join(problems), errors=ev["tool_errors"])
    return ev, _pass(
        f"A ({holder.name}) killed with the approval parked; the answer ran cold on "
        f"{target} through the stored decision, no second card"
    )


def cell_sigterm_drain(ctx: Ctx) -> tuple[dict, dict]:
    stack = ctx.stack
    if not stack.runner_token:
        return {}, _skip("no runner token: pass --stack-env")
    cfg, refs = ctx.config("allow")
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
    # Kubernetes: a graceful `kubectl delete pod` with the pod's own grace period. The
    # terminating pod leaves the Service endpoints, and its port-forward works while its
    # container runs.
    stop_wait_s = stack.drain_timeout_s(a)
    stop_started = time.time()
    stopper = stack.begin_drain(a)
    stop_done: dict = {}

    def _watch_stop() -> None:
        stopper.wait()
        stop_done["at"] = time.time()

    threading.Thread(target=_watch_stop, daemon=True).start()
    try:
        time.sleep(3)
        if stack.kube:
            ev["a_drain_began_after_s"] = wait_drain_began(stack, a, stop_started)
        if stack.kube and ev["a_drain_began_after_s"] is None:
            ev["run_during_drain"] = {
                "status": None,
                "body": f"{a.name} never logged `{DRAIN_LINE}`; /run not probed",
            }
        else:
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
        drain_refusals = stack.service_lines(
            "services", stop_started, "Runner is shutting down"
        )
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
        stopper.wait(timeout=stop_wait_s)
        time.sleep(1)
        ev["a_exit_after_docker_stop_s"] = (
            round(stop_done["at"] - stop_started, 1) if "at" in stop_done else None
        )
        ev["a_finished_at"] = stack.finished_at(a)
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
            stopper.wait(timeout=stop_wait_s)
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
        problems.append(
            f"`{stack.drain_label}` did not return within {stop_wait_s:.0f} s and was killed"
        )
    if problems:
        return ev, _fail("; ".join(problems))
    why_refused = (
        "A's drain answer before the endpoints update"
        if stack.kube
        else "compose DNS still lists the draining container"
    )
    note = (
        f"; {len(refused)} of {len(ev['new_sessions'])} new sessions were refused "
        f"({why_refused})"
        if refused
        else ""
    )
    return ev, _pass(
        f"A ({a.name}) drained: /run 503, the Stop still worked, {len(on_b_new)} new "
        f"session(s) ran on the other container, the first turn finished{note}"
    )


def cell_holder_killed_followup(ctx: Ctx) -> tuple[dict, dict]:
    if ctx.inprocess:
        return inprocess_holder_killed(ctx, "allow")
    stack = ctx.stack
    cfg, refs = ctx.config("allow")
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
        ev["cold_followup_ttft_s"] = _ttft(t3)
        ev["warm_followup_ttft_s"] = _ttft(t4)
        time.sleep(3)
        lines = stack.session_lines(since, s)
        ledger = ledger_oldest_first(s)
        ev["ledger"] = [
            {k: r.get(k) for k in ("turn_index", "turn_id", "sandbox_id")}
            for r in ledger
        ]
        ev["holders"] = [turn_holders(lines, s, r.get("turn_id")) for r in ledger]
        turn3_holders = ev["holders"][-2] if len(ev["holders"]) >= 2 else []
        ev["survivor"] = survivor(stack, turn3_holders, holder.name, other.name)
        target = ev["survivor"] or other.name
        ev["creates_after_kill"] = sandbox_creates(lines, s, after=kill_at)
        ev["hit_on_b_turn4"] = lines_matching(
            lines.get(target, []), "hit-continue", s, after=t3_done
        )
    finally:
        ev["restore"] = _restore(stack, holder)
    sandboxes = [r["sandbox_id"] for r in ev["ledger"]]
    problems = []
    if t3.errors or t4.errors:
        problems.append("a follow-up after the kill errored")
    if ev["survivor"] is None or ev["holders"][-2:] != [[target], [target]]:
        problems.append(f"turns 3 and 4 ran on {ev['holders'][-2:]}")
    if not ev["creates_after_kill"].get(target):
        problems.append("turn 3 was not cold on B")
    if not ev["hit_on_b_turn4"]:
        problems.append("turn 4 was not warm on B")
    if len(set(sandboxes)) != 2:
        problems.append(f"expected 2 distinct sandbox ids, ledger has {sandboxes}")
    if problems:
        return ev, _fail("; ".join(problems))
    return ev, _pass(
        f"holder {holder.name} killed; turn 3 cold on {target}, turn 4 warm there"
    )


def cell_inprocess_holder_killed(ctx: Ctx) -> tuple[dict, dict]:
    return inprocess_holder_killed(ctx, "inprocess")


def inprocess_holder_killed(ctx: Ctx, shape: str) -> tuple[dict, dict]:
    stack = ctx.stack
    cfg, refs = ctx.config(shape)
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
        ev["survivor"] = survivor(
            stack, ev["holders"][-1] if ev["holders"] else [], holder.name, other.name
        )
        target = ev["survivor"] or other.name
        ev["b_sandbox_created"] = lines_matching(
            lines.get(target, []), "[inprocess] sandbox created", s, after=kill_at
        )
        ev["b_session_resumed"] = lines_matching(
            lines.get(target, []), "[inprocess] session resumed", s, "loaded=true"
        )
    finally:
        ev["restore"] = _restore(stack, holder)
    problems = []
    if t2.errors:
        problems.append(f"turn 2 errored: {t2.errors[:1]}")
    if ev["survivor"] is None:
        problems.append(f"turn 2 ran on {ev['holders'][-1:]}")
    if word not in t2.reply:
        problems.append("turn 2 did not recall the codeword (transcript not restored)")
    if not ev["b_session_resumed"]:
        problems.append(
            "B did not load the stored Pi session (`session resumed loaded=true`)"
        )
    if not ev["b_sandbox_created"]:
        problems.append("B created no command sandbox")
    # A created sandbox is not a working one: the bash call on B must have run. A failed call
    # (for example the agent drive that cannot mount in the sandbox) is named, not hidden.
    tool_states = list(t2.tool_outcomes.values())
    if not tool_states or any(state != "available" for state in tool_states):
        problems.append(
            f"turn 2's bash call on B did not run (outcomes={tool_states}, "
            f"error={json.dumps(t2.tool_payloads)[:200]})"
        )
    if problems:
        return ev, _fail("; ".join(problems))
    return ev, _pass(
        f"A ({holder.name}) killed; turn 2 on {ev['survivor']} loaded the stored Pi session, "
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
    cfg, refs = ctx.config("allow")
    cfg_ask, refs_ask = ctx.config("ask")
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


# --------------------------------------------------------------------------- #
# Kubernetes-only phase 2 cells.
# --------------------------------------------------------------------------- #


def _short_turn(stack: Stack, cfg: dict, refs: dict, label: str) -> dict:
    """One new session, one short turn; where the api bound it."""
    s = str(uuid.uuid4())
    sent = time.time()
    t = lib.invoke(s, [lib.user_msg("Reply with exactly: NEW")], {"agent": cfg}, refs)
    binding = stack.wait_binding(s, timeout=15)
    return {
        "label": label,
        "session": s,
        "turn_id": binding.get("turn_id"),
        "replica": binding.get("runner_replica_id"),
        "errors": t.errors[:1],
        "ttft_s": _ttft(t),
        "sent_at": sent,
    }


def cell_rollout_during_turn(ctx: Ctx) -> tuple[dict, dict]:
    """`kubectl rollout restart` of the runner Deployment while a long turn runs."""
    stack = ctx.stack
    if not stack.runner_token:
        return {}, _skip("no runner token: pass --stack-env or --kube-secret")
    cfg, refs = ctx.config("allow")
    old = {r.name: r.replica_id for r in stack.runners()}
    old_replicas = set(old.values())
    since = time.time()
    s = str(uuid.uuid4())
    # Long enough to outlast the first new pod's start when the holder goes second.
    handle = start_async(
        s, [lib.user_msg(_long_prompt(_new_token("ROLL"), 120))], cfg, refs, "rollout"
    )
    turn = sc.wait_for_turn(s, timeout=90)
    in_tool = wait_long_tool(handle, timeout=120)
    holder = (
        holder_runner(stack, stack.wait_binding(s, turn, timeout=30)) if turn else None
    )
    ev: dict = {
        "sessions": [s],
        "old_pods": sorted(old),
        "long_turn": turn,
        "holder": holder.name if holder else None,
    }
    if not (turn and in_tool and holder):
        if turn:
            sc.cancel(s, expected=turn, label="rollout-cleanup")
        wait_async(handle, 60)
        return ev, _fail(
            "driver timing: the long turn never entered its command on a known pod",
            errors=(handle.get("out") or {}).get("errors"),
        )
    deployment = stack.runner_deployment()
    times: dict[str, float] = {}
    ev["deployment"] = deployment
    ev["times_s"] = times
    t0 = time.time()

    def mark(step: str) -> None:
        times[step] = round(time.time() - t0, 1)

    try:
        res = stack.kubectl.run("rollout", "restart", f"deployment/{deployment}")
        ev["rollout_restart"] = {
            "rc": res.returncode,
            "out": (res.stdout + res.stderr).strip()[:300],
        }
        if res.returncode != 0:
            sc.cancel(s, expected=turn, label="rollout-cleanup")
            return ev, _fail(f"`kubectl rollout restart` exited {res.returncode}")
        mark("restart_sent")
        terminating = wait_runners(
            stack,
            lambda rs: all(
                r.name != holder.name or r.status == "terminating" for r in rs
            ),
            timeout=600,
        )
        mark("holder_terminating")
        ev["holder_seen_terminating"] = terminating is not None and any(
            r.name == holder.name for r in terminating
        )
        ev["holder_drain_began_after_s"] = wait_drain_began(stack, holder, t0)
        mark("holder_draining")
        if ev["holder_drain_began_after_s"] is None:
            ev["holder_run_while_terminating"] = {
                "status": None,
                "body": f"{holder.name} never logged `{DRAIN_LINE}`; /run not probed",
            }
        else:
            ev["holder_run_while_terminating"] = stack.runner_post(
                holder, "/run", {}, timeout=10.0
            )
        new_turns = [_short_turn(stack, cfg, refs, "while-holder-terminating")]
        ev["new_turns"] = new_turns
        # Every old pod draining or gone: no old pod is in the Service endpoints any more.
        wait_runners(
            stack,
            lambda rs: all(r.name not in old or r.status == "terminating" for r in rs),
            timeout=600,
        )
        mark("old_set_out_of_service")
        # The endpoints drop a terminating pod a moment after its deletion starts, and during
        # its preStop the pod still accepts a turn routed to it. Let the Service catch up.
        time.sleep(5)
        ev["holder_still_terminating"] = holder.name in stack.runner_names()
        new_turns.append(_short_turn(stack, cfg, refs, "old-set-out-of-service"))
        status = stack.kubectl.run(
            "rollout",
            "status",
            f"deployment/{deployment}",
            "--timeout=600s",
            timeout=660,
        )
        mark("rollout_status_done")
        ev["rollout_status"] = {
            "rc": status.returncode,
            "out": (status.stdout + status.stderr).strip()[-300:],
        }
        new_turns.append(_short_turn(stack, cfg, refs, "after-rollout"))
        ended = wait_async(handle, TURN_WAIT_S)
        mark("long_turn_ended")
        out = handle.get("out") or {}
        ev["long_turn_frames"] = out.get("frames", [])[-8:]
        ev["long_turn_errors"] = out.get("errors")
        ev["long_turn_finished"] = ended and "FINISHED" in json.dumps(
            out.get("tool_payloads")
        )
        try:
            final = stack.wait_ready()
            mark("two_ready")
        except RuntimeError as exc:
            final = []
            ev["two_ready_error"] = str(exc)
        ev["final_pods"] = [r.name for r in final]
        time.sleep(3)
        lines = stack.session_lines(since, *[t["session"] for t in new_turns])
        for t in new_turns:
            t["log_holders"] = turn_holders(lines, t["session"], t["turn_id"])
            ev["sessions"].append(t["session"])
    finally:
        ev["restore"] = _restore(stack, holder)
    problems = []
    if ev["holder_run_while_terminating"]["status"] != 503:
        problems.append(
            f"the terminating holder's /run answered "
            f"{ev['holder_run_while_terminating']['status']}, not 503"
        )
    for t in new_turns:
        if t["errors"]:
            problems.append(f"the {t['label']} turn errored: {t['errors']}")
        elif t["label"] == "while-holder-terminating":
            # The other old pod may still serve at this point; only the holder is drained.
            if t["replica"] == holder.replica_id or holder.name in t["log_holders"]:
                problems.append(f"a new turn ran on the terminating holder: {t}")
        elif t["replica"] in old_replicas or any(n in old for n in t["log_holders"]):
            problems.append(f"the {t['label']} turn ran on an old pod: {t}")
        elif not t["log_holders"]:
            problems.append(f"no new pod logged the {t['label']} turn")
    if ev["rollout_status"]["rc"] != 0:
        problems.append(f"`kubectl rollout status` exited {ev['rollout_status']['rc']}")
    if (
        ev["long_turn_errors"]
        or "finish" not in ev["long_turn_frames"]
        or not ev["long_turn_finished"]
    ):
        problems.append(
            "the long turn did not run its command to the end across the rollout "
            f"(FINISHED in the tool output: {ev['long_turn_finished']})"
        )
    if len(final) != 2 or any(r.name in old for r in final):
        problems.append(f"after the rollout the runner pods are {ev['final_pods']}")
    if problems:
        return ev, _fail("; ".join(problems))
    return ev, _pass(
        f"rollout of {deployment} with a long turn on {holder.name}: its /run answered 503 "
        f"while it drained, new turns ran on new pods, the long turn finished; times {times}"
    )


def _uncordon(stack: Stack, node: str, tries: int = 5) -> dict:
    """`kubectl uncordon`, retried: a node left cordoned takes capacity from every workload on
    the cluster. A last failure is printed loudly so the operator runs it by hand."""
    res = None
    attempt = 0
    for attempt in range(1, tries + 1):
        res = stack.kubectl.run("uncordon", node)
        if res.returncode == 0:
            break
        time.sleep(3)
    if res.returncode != 0:
        print(
            f"[r1] NODE {node} MAY STILL BE CORDONED: `kubectl uncordon {node}` failed "
            f"{attempt} times (exit {res.returncode}); run it by hand",
            file=sys.stderr,
        )
    return {
        "rc": res.returncode,
        "attempts": attempt,
        "out": (res.stdout + res.stderr).strip()[:300],
    }


def cell_drain_node_parked_approval(ctx: Ctx) -> tuple[dict, dict]:
    """Cordon and drain the node of the pod that holds a parked approval, then answer it."""
    stack = ctx.stack
    cfg, refs = ctx.config("ask")
    s = str(uuid.uuid4())
    since = time.time()
    token = _new_token("NODEDRAIN")
    t1 = lib.invoke(s, [lib.user_msg(_mutating_prompt(token))], {"agent": cfg}, refs)
    ev: dict = {"sessions": [s], "token": token, "turn1": turn_summary(t1)}
    if t1.errors or not t1.approvals:
        return ev, _fail("turn 1 did not park an approval")
    holder = holder_runner(stack, stack.wait_binding(s, timeout=30))
    if holder is None:
        return ev, _fail("no stored binding for the parked turn")
    row = pending_approval(s)
    if row is None:
        return ev, _fail("no pending interaction row after the park")
    pod = stack.pod(holder.name) or {}
    node = (pod.get("spec") or {}).get("nodeName")
    template = ((pod.get("metadata") or {}).get("labels") or {}).get(
        "pod-template-hash"
    )
    if not node or not template:
        return ev, _fail(f"could not read the node or template hash of {holder.name}")
    selector = drain_pod_selector(stack.release, template)
    nodes = stack.runner_nodes()
    ev.update(
        a=holder.name,
        node=node,
        pod_selector=selector,
        runner_pods_on_node=sorted(n for n, where in nodes.items() if where == node),
        budgets_before=stack.runner_budgets(),
    )
    # The `finally` below uncordons the node, so a node someone else cordoned is never touched.
    try:
        node_spec = stack.kubectl.json("get", "node", node).get("spec") or {}
    except (RuntimeError, ValueError) as exc:
        return ev, _skip(f"cannot read node {node} to check it is schedulable: {exc}")
    if node_spec.get("unschedulable"):
        return ev, _skip(f"node {node} is already cordoned; the cell leaves it alone")
    # `kubectl drain` evicts matching pods in EVERY namespace on the node, whatever
    # --namespace says. Another release of the same name elsewhere could match the selector.
    try:
        targets = stack.kubectl.json(
            "get",
            "pods",
            "--all-namespaces",
            "-l",
            selector,
            "--field-selector",
            f"spec.nodeName={node}",
        )["items"]
    except (RuntimeError, ValueError) as exc:
        return ev, _skip(f"cannot list the drain's pods on node {node}: {exc}")
    ev["drain_targets"] = sorted(
        (p.get("metadata") or {}).get("name", "") for p in targets
    )
    foreign = drain_foreign_pods(targets, stack.kubectl.namespace)
    if foreign:
        return ev, _skip(
            f"the drain selector also matches pods of other namespaces: {foreign}"
        )
    cordon_refused = False
    try:
        cordon = stack.kubectl.run("cordon", node)
        ev["cordon"] = {
            "rc": cordon.returncode,
            "out": (cordon.stdout + cordon.stderr).strip()[:300],
        }
        if cordon.returncode != 0:
            if "forbidden" in cordon.stderr.lower():
                cordon_refused = True
                return ev, _skip(
                    f"the cluster refuses `kubectl cordon` for these credentials: "
                    f"{cordon.stderr.strip()[:200]}"
                )
            return ev, _fail(f"`kubectl cordon` exited {cordon.returncode}")
        drain_sent = time.time()
        drain = stack.kubectl.run(
            "drain",
            node,
            "--ignore-daemonsets",
            "--delete-emptydir-data",
            f"--pod-selector={selector}",
            "--timeout=900s",
            timeout=960,
        )
        output = drain.stdout + drain.stderr
        ev["drain"] = {
            "rc": drain.returncode,
            "elapsed_s": round(time.time() - drain_sent, 1),
            "output": output.strip()[-1500:],
        }
        ev["eviction_refused_by_budget_first"] = "disruption budget" in output
        ev["budgets_after"] = stack.runner_budgets()
        gone = wait_runners(
            stack, lambda rs: all(r.name != holder.name for r in rs), timeout=60
        )
        ev["a_gone"] = gone is not None
        if drain.returncode != 0 or not ev["a_gone"]:
            return ev, _fail(
                f"the drain did not evict {holder.name} (rc={drain.returncode})"
            )
        answer = respond_like_the_app(row, t1.approvals[-1].get("approvalId"))
        ev["answer"] = {k: answer[k] for k in ("status", "body")}
        continuation = ((answer["body"] or {}).get("execution") or {}).get("id")
        settled = wait_turn_settled(s, continuation, TURN_WAIT_S)
        ev["settled"] = settled["settled"]
        time.sleep(3)
        lines = stack.session_lines(since, s)
        ev["continuation_holders"] = turn_holders(lines, s, continuation)
        ev["survivor"] = survivor(stack, ev["continuation_holders"], holder.name, "")
        ev["creates_after_answer"] = cold_markers(
            ctx, lines, s, after=answer["sent_at"]
        )
        ev["tool_result_records_with_token"] = records_with(s, "tool_result", token)
        rows = lib.interactions(s)
        ev["interactions_after"] = [
            {k: r.get(k) for k in ("id", "kind", "status")} for r in rows
        ]
    finally:
        ev["uncordon"] = (
            {"rc": 0, "out": "not needed: the cordon was refused"}
            if cordon_refused
            else _uncordon(stack, node)
        )
        ev["restore"] = _restore(stack, holder)
    approvals = [r for r in ev["interactions_after"] if "approval" in str(r["kind"])]
    status = next(
        (r["status"] for r in ev["interactions_after"] if r["id"] == row["id"]), None
    )
    problems = []
    if not ev["settled"]:
        problems.append("the continuation did not settle")
    if ev["survivor"] is None:
        problems.append(f"the continuation ran on {ev['continuation_holders']}")
    elif not ev["creates_after_answer"].get(ev["survivor"]):
        problems.append(f"no cold start marker on {ev['survivor']}")
    if not ev["tool_result_records_with_token"]:
        problems.append("the tool did not run")
    if len(approvals) != 1:
        problems.append(f"a second approval card: {approvals}")
    if status not in ("resolved", "responded"):
        problems.append(f"the interaction row is {status!r}")
    if ev["uncordon"]["rc"] != 0:
        problems.append(f"`kubectl uncordon {node}` exited {ev['uncordon']['rc']}")
    if problems:
        return ev, _fail("; ".join(problems))
    return ev, _pass(
        f"node of A ({holder.name}) drained through the budget (refused first: "
        f"{ev['eviction_refused_by_budget_first']}); the answer ran cold on "
        f"{ev['survivor']} through the stored decision, no second card, row {status}"
    )


# --------------------------------------------------------------------------- #
# The hosted login on two pods (`--subscription hosted` only).
# --------------------------------------------------------------------------- #

PIN_TRIES = 8
_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")


def pod_lines_between(
    stack: Stack, container: str, start: float, end: float, *needles: str
) -> list[str]:
    """A container's log lines inside [start, end] that carry all of `needles`. The subscription
    lines name the connection, not the session, so a turn's lines are read by its time window;
    the cells run their turns one after another, so the windows never overlap."""
    out = []
    for ln in stack.logs_since(container, start):
        when = _line_epoch(ln)
        if when is None or when < start - 1 or when > end + 2:
            continue
        if all(n in ln for n in needles):
            out.append(ln)
    return out


def subscription_evidence(
    stack: Stack, runner: Runner, start: float, end: float, connection_id: str
) -> dict:
    """The subscription lines one pod logged for this connection inside a turn's window."""
    conn = f"connection={connection_id}"
    return {
        "credential_mode": pod_lines_between(
            stack, runner.name, start, end, "credentialMode="
        ),
        "materialize": pod_lines_between(
            stack, runner.name, start, end, "event=subscription.materialize", conn
        ),
        "publish": pod_lines_between(
            stack, runner.name, start, end, "event=subscription.publish", conn
        ),
        "recovery": pod_lines_between(
            stack, runner.name, start, end, "event=subscription.recovery", conn
        ),
        "attempt": pod_lines_between(
            stack, runner.name, start, end, "event=subscription.attempt"
        ),
    }


def api_subscription_lines(
    stack: Stack, since: float, connection_id: str, event: str
) -> list[str]:
    """The api's `subscription.<event>` lines for this connection, colour codes removed."""
    return [
        _ANSI_RE.sub("", ln)
        for ln in stack.service_lines("api", since, f"subscription.{event}")
        if f"connection={connection_id}" in ln
    ]


def _field(line: str, key: str) -> str | None:
    m = re.search(rf"(?:^|\s){re.escape(key)}=(\S+)", line)
    return m.group(1) if m else None


def short_turn(ctx: Ctx, cfg: dict, refs: dict, label: str) -> dict:
    """One short turn on a new session, with its holder and its wall-clock window."""
    s = str(uuid.uuid4())
    start = time.time()
    t = lib.invoke(
        s, [lib.user_msg(f"Reply with exactly: {label}")], {"agent": cfg}, refs
    )
    end = time.time()
    holder = holder_runner(ctx.stack, ctx.stack.wait_binding(s, timeout=30))
    return {"session": s, "turn": t, "holder": holder, "start": start, "end": end}


def pin_turn(ctx: Ctx, cfg: dict, refs: dict, want: Runner, label: str):
    """Short turns on new sessions until one lands on `want` (at most PIN_TRIES). Returns the
    pinned turn (None when none landed there) and every try."""
    tries = []
    for i in range(PIN_TRIES):
        done = short_turn(ctx, cfg, refs, f"{label}{i}")
        tries.append(done)
        if done["turn"].errors:
            break
        if done["holder"] and done["holder"].name == want.name:
            return done, tries
    return None, tries


def try_summary(done: dict) -> dict:
    return {
        "session": done["session"],
        "holder": done["holder"].name if done["holder"] else None,
        "errors": done["turn"].errors[:1],
        "reply": done["turn"].reply[:60],
        "start": _iso(done["start"]),
        "end": _iso(done["end"]),
    }


def _hosted_ready(ctx: Ctx) -> tuple[dict | None, dict | None]:
    row = ctx.hosted_row()
    if row is None:
        return None, _skip(
            f"no hosted connection with slug {ctx.args.subscription_slug!r} in the project"
        )
    if row["login_state"] != "ready":
        return row, _skip(
            f"the hosted connection is {row['login_state']!r}, not `ready`; a human must "
            "sign in first"
        )
    return row, None


def cell_hosted_both_pods(ctx: Ctx) -> tuple[dict, dict]:
    stack = ctx.stack
    row, skip = _hosted_ready(ctx)
    if skip:
        return {"row": row}, skip
    cfg, refs = ctx.config("allow")
    by_pod: dict[str, dict] = {}
    tries: list[dict] = []
    for i in range(PIN_TRIES):
        done = short_turn(ctx, cfg, refs, f"POD{i}")
        tries.append(done)
        if done["turn"].errors:
            break
        if done["holder"] and done["holder"].name not in by_pod:
            by_pod[done["holder"].name] = done
        if len(by_pod) == 2:
            break
    ev: dict = {
        "row": row,
        "sessions": [d["session"] for d in tries],
        "tries": [try_summary(d) for d in tries],
    }
    failed = next((d for d in tries if d["turn"].errors), None)
    if failed:
        return ev, _fail(
            f"a turn on the hosted login errored on "
            f"{failed['holder'].name if failed['holder'] else '?'}: "
            f"{failed['turn'].errors[:1]}",
            errors=failed["turn"].errors,
        )
    if len(by_pod) < 2:
        return ev, _fail(
            f"{PIN_TRIES} new sessions never reached both pods: {ev['tries']}"
        )
    time.sleep(2)
    ev["per_pod"] = {}
    problems = []
    expected_connection = f"connection=self_managed:{row['slug']}"
    for name, done in by_pod.items():
        sub = subscription_evidence(
            stack, done["holder"], done["start"], done["end"], row["id"]
        )
        reasons = [_field(ln, "reason") for ln in sub["materialize"]]
        ev["per_pod"][name] = {
            "session": done["session"],
            **sub,
            "materialize_reasons": reasons,
        }
        if not any(
            "credentialMode=runtime_provided" in ln and expected_connection in ln
            for ln in sub["credential_mode"]
        ):
            problems.append(
                f"{name}: no `credentialMode=runtime_provided {expected_connection}` line "
                "in the turn's window"
            )
        if not sub["materialize"]:
            problems.append(
                f"{name}: no subscription.materialize line for the connection"
            )
        # `older-generation` means a login left on the pod outranked the one the request
        # delivered; `invalid-delivered` means the request carried no usable login.
        if any(r in ("older-generation", "invalid-delivered") for r in reasons):
            problems.append(
                f"{name}: the delivered login was not the one used (reasons {reasons})"
            )
        if sub["recovery"]:
            problems.append(f"{name}: took the recovery path: {sub['recovery'][:2]}")
    after = ctx.hosted_row()
    ev["row_after"] = after
    if (
        not after
        or after["login_state"] != "ready"
        or after["generation"] != row["generation"]
    ):
        problems.append(f"the connection row moved or left `ready`: {after}")
    if problems:
        return ev, _fail("; ".join(problems))
    reasons = {n: p["materialize_reasons"] for n, p in ev["per_pod"].items()}
    return ev, _pass(
        f"both pods ran a turn on the hosted login (runtime_provided, self_managed:"
        f"{row['slug']}); neither pod kept an older-generation copy over the delivered "
        f"login (materialize reasons {reasons}); the row stayed ready at generation "
        f"{row['generation']}"
    )


def _expire_stored_login(ctx: Ctx, row: dict) -> tuple[bool, str, dict]:
    """Put the stored login past its expiry, with qa_product's own helpers (pgcrypto in place
    under the stack's AGENTA_CRYPT_KEY, then the api's cached vault read cleared). On
    `inprocess` each pod's local copy is expired too: a pod whose copy is newer than the
    delivered one keeps its copy (`materialize ... reason=not-newer`) and never refreshes."""
    import qa_product as qp  # noqa: PLC0415

    stack = ctx.stack
    qp.PROJECT = lib.PROJECT
    qp.SUBSCRIPTION_DB_CONTAINER = f"{stack.project}-postgres-1"
    qp.SUBSCRIPTION_STACK_ENV = ctx.args.stack_env
    qp.SUBSCRIPTION_REDIS_CONTAINER = (
        ctx.args.redis_container or f"{stack.project}-redis-volatile-1"
    )
    ok, why, steps = qp._expire_stored_login(row["id"])
    if not ok or not ctx.inprocess:
        return ok, why, steps
    steps["local_copies"] = {}
    for runner in stack.runners():
        qp.RUNNER_CONTAINER = runner.name
        path, reason = qp._local_login_path(row["id"])
        if not path:
            steps["local_copies"][runner.name] = reason
            continue
        broke, out = qp._break_local_login(path, "expire")
        steps["local_copies"][runner.name] = "expired" if broke else f"failed: {out}"
        if not broke:
            return False, f"could not expire {runner.name}'s local copy: {out}", steps
    return True, why, steps


def shared_state_volume(stack: Stack) -> str | None:
    """The volume name when every runner container mounts the SAME volume at its
    `AGENTA_RUNNER_STATE_DIR`, else None. The dev compose file does (`runner-state`); a Helm pod
    keeps its state on its own disk. The in-process login copy lives in that directory, so with
    a shared volume both pods read and write ONE copy, under one file lock."""
    names = set()
    for runner in stack.runners():
        try:
            info = json.loads(stack.docker("inspect", runner.name).stdout)[0]
        except (ValueError, IndexError):
            return None
        env = dict(
            e.split("=", 1)
            for e in (info.get("Config") or {}).get("Env") or []
            if "=" in e
        )
        state_dir = env.get("AGENTA_RUNNER_STATE_DIR")
        mount = next(
            (
                m
                for m in info.get("Mounts") or []
                if state_dir and m.get("Destination") == state_dir
            ),
            None,
        )
        if not mount or mount.get("Type") != "volume":
            return None
        names.add(mount.get("Name"))
    return names.pop() if len(names) == 1 else None


def cell_hosted_refresh_across_pods(ctx: Ctx) -> tuple[dict, dict]:
    stack = ctx.stack
    row0, skip = _hosted_ready(ctx)
    if skip:
        return {"row": row0}, skip
    if not ctx.args.stack_env:
        return {"row": row0}, _skip(
            "needs --stack-env: the file holding AGENTA_CRYPT_KEY for the stored-login update"
        )
    cfg, refs = ctx.config("allow")
    since = time.time()
    expired, why, steps = _expire_stored_login(ctx, row0)
    ev: dict = {
        "row_before": row0,
        "expire": {"ok": expired, "why": why, "steps": steps},
        "sessions": [],
    }
    if not expired:
        return ev, _fail(why)
    time.sleep(3)
    a = short_turn(ctx, cfg, refs, "REFRESH-A")
    ev["sessions"].append(a["session"])
    ev["a"] = try_summary(a)
    if a["turn"].errors or a["holder"] is None:
        return ev, _fail(
            f"the first turn after the expiry failed: {a['turn'].errors[:1]}",
            errors=a["turn"].errors,
        )
    pod_a = a["holder"]
    # The publisher pushes on its next tick (5 s in-process, 30 s Daytona); the api bumps the
    # version when it accepts.
    deadline = time.time() + 90
    row_a = ctx.hosted_row()
    while (
        time.time() < deadline
        and row_a
        and (row_a["version"] or 0) <= (row0["version"] or 0)
    ):
        time.sleep(2)
        row_a = ctx.hosted_row()
    accepted_at = time.time()
    ev["row_after_a"] = row_a
    pod_b = other_runner(stack, pod_a.name)
    b, tries = pin_turn(ctx, cfg, refs, pod_b, "REFRESH-B")
    ev["sessions"] += [d["session"] for d in tries]
    ev["b_tries"] = [try_summary(d) for d in tries]
    # A second refresh on B would reach the api only on B's next publisher tick, so wait one
    # full tick before reading B's publish lines and the version.
    publish_wait_s = 8 if ctx.inprocess else 35
    time.sleep(publish_wait_s)
    row_b = ctx.hosted_row()
    ev["row_after_b"] = row_b
    # In-process with a shared state volume, the refresh A's Pi writes lands in the one login
    # copy both pods read, so whichever pod's publisher ticks first pushes it (a session an
    # earlier cell parked counts), and B's copy already holds it.
    shared = shared_state_volume(stack) if ctx.inprocess else None
    ev["shared_state_volume"] = shared
    ev["publish_by_pod"] = {
        r.name: subscription_evidence(
            stack, r, a["start"], accepted_at + 5, row0["id"]
        )["publish"]
        for r in stack.runners()
    }
    ev["a_subscription"] = subscription_evidence(
        stack, pod_a, a["start"], accepted_at + 5, row0["id"]
    )
    ev["api_push"] = api_subscription_lines(stack, since, row0["id"], "push")
    ev["api_failure"] = api_subscription_lines(stack, since, row0["id"], "failure")
    accepts = [ln for ln in ev["api_push"] if "decision=accept" in ln]
    ev["api_accepts"] = accepts
    publishers = sorted(
        name
        for name, lines in ev["publish_by_pod"].items()
        if any("decision=updated" in ln for ln in lines)
    )
    ev["updated_by"] = publishers
    problems = []
    moved = bool(row_a) and (row_a["version"] or 0) == (row0["version"] or 0) + 1
    if not moved:
        problems.append(
            f"login_version did not move by one after A's turn: {row0['version']} -> "
            f"{row_a and row_a['version']}"
        )
    if len(accepts) != 1:
        problems.append(
            f"the api accepted {len(accepts)} pushes, expected 1: {accepts}"
        )
    if shared:
        if not publishers:
            problems.append("no pod published `decision=updated` for the refresh")
    elif publishers != [pod_a.name]:
        problems.append(
            f"the refresh was published by {publishers}, not by A ({pod_a.name}) alone"
        )
    if ev["api_failure"]:
        problems.append(f"the api logged a refused refresh: {ev['api_failure'][:1]}")
    if b is None:
        problems.append(f"no new session landed on {pod_b.name} in {len(tries)} tries")
    else:
        ev["b"] = try_summary(b)
        ev["b_gap_after_push_s"] = round(b["start"] - accepted_at, 1)
        sub_b = subscription_evidence(
            stack, pod_b, b["start"], b["end"] + publish_wait_s, row0["id"]
        )
        ev["b_subscription"] = sub_b
        # B runs on the refreshed login when it writes the delivered (refreshed) one into its
        # run, or, on a shared volume, when its copy is already at least as new (`not-newer`
        # against the refreshed delivery, at the same generation).
        if not any(
            "wrote=true" in ln
            or (
                shared
                and "reason=not-newer" in ln
                and _field(ln, "generation") == _field(ln, "localGeneration")
            )
            for ln in sub_b["materialize"]
        ):
            problems.append(
                f"{pod_b.name} did not run on the refreshed login "
                f"(materialize={sub_b['materialize']})"
            )
        if any("decision=updated" in ln for ln in sub_b["publish"]):
            problems.append(
                f"{pod_b.name} refreshed again and published a second login"
            )
        if sub_b["recovery"]:
            problems.append(
                f"{pod_b.name} took the recovery path: {sub_b['recovery'][:2]}"
            )
    # `pin_turn` stops at the first errored try, so an error on B leaves `b` None.
    failed_tries = [try_summary(d) for d in tries if d["turn"].errors]
    if failed_tries:
        problems.append(f"a turn after the refresh errored: {failed_tries}")
    if row_b and row_a:
        if row_b["version"] != row_a["version"]:
            problems.append(
                f"the version moved again after B: {row_a['version']} -> {row_b['version']}"
            )
        if row_b["generation"] != row0["generation"] or row_b["login_state"] != "ready":
            problems.append(f"the row left ready or changed generation: {row_b}")
    if problems:
        return ev, _fail("; ".join(problems))
    via = (
        f"the shared state volume {shared!r}, pushed by {publishers}"
        if shared
        else "A's own push"
    )
    b_reasons = [_field(ln, "reason") for ln in ev["b_subscription"]["materialize"]]
    return ev, _pass(
        f"A ({pod_a.name})'s turn refreshed; one push accepted (version {row0['version']} -> "
        f"{row_a['version']}) via {via}; B ({pod_b.name}) ran {ev['b_gap_after_push_s']}s "
        f"later on the refreshed login (materialize reasons {b_reasons}), no second accepted "
        f"push, no recovery; the row is ready at version {row_b['version']}, generation "
        f"{row_b['generation']}"
    )


def cell_hosted_restart_reconnect(ctx: Ctx) -> tuple[dict, dict]:
    stack = ctx.stack
    row0, skip = _hosted_ready(ctx)
    if skip:
        return {"row": row0}, skip
    cfg, refs = ctx.config("allow")
    a = stack.runners()[0]
    ev: dict = {"row_before": row0, "pod": a.name, "sessions": []}
    since = time.time()
    try:
        ev["kill"] = stack.kill(a)
        time.sleep(2)
        ev["restart"] = _restore(stack, a)
        if not ev["restart"]["healthy"]:
            return ev, _fail(f"{a.name} did not come back healthy: {ev['restart']}")
        a = next(r for r in stack.runners() if r.name == a.name)
        pinned, tries = pin_turn(ctx, cfg, refs, a, "RESTART")
        ev["sessions"] = [d["session"] for d in tries]
        ev["tries"] = [try_summary(d) for d in tries]
    finally:
        ev["restore"] = _restore(stack, a)
    time.sleep(2)
    row_after = ctx.hosted_row()
    ev["row_after"] = row_after
    ev["api_attempts"] = api_subscription_lines(stack, since, row0["id"], "attempt")
    problems = []
    # `pin_turn` stops at the first errored try, so an error leaves `pinned` None.
    failed_tries = [try_summary(d) for d in tries if d["turn"].errors]
    if failed_tries:
        problems.append(f"a turn after the restart errored: {failed_tries}")
    elif pinned is None:
        problems.append(f"no new session landed on {a.name} in {len(tries)} tries")
    if pinned is not None:
        sub = subscription_evidence(
            stack, a, pinned["start"], pinned["end"], row0["id"]
        )
        ev["subscription"] = sub
        if not any(
            "credentialMode=runtime_provided" in ln for ln in sub["credential_mode"]
        ):
            problems.append(f"{a.name}: no `credentialMode=runtime_provided` line")
        if not sub["materialize"]:
            problems.append(
                f"{a.name}: no subscription.materialize line after the restart"
            )
        if sub["attempt"]:
            problems.append(f"{a.name} started a device login: {sub['attempt'][:1]}")
    if ev["api_attempts"]:
        problems.append(
            f"the api logged a device-login attempt: {ev['api_attempts'][:1]}"
        )
    if (
        not row_after
        or row_after["generation"] != row0["generation"]
        or row_after["login_state"] != "ready"
    ):
        problems.append(f"the row changed generation or left ready: {row_after}")
    if problems:
        return ev, _fail("; ".join(problems))
    return ev, _pass(
        f"{a.name} killed and started; the pinned turn ran on the hosted login from the "
        f"request, no device login, generation {row0['generation']} unchanged"
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
    "hosted-both-pods": cell_hosted_both_pods,
    "hosted-refresh-across-pods": cell_hosted_refresh_across_pods,
    "hosted-restart-reconnect": cell_hosted_restart_reconnect,
    "rollout-during-turn": cell_rollout_during_turn,
    "drain-node-parked-approval": cell_drain_node_parked_approval,
}


def mode_skip(name: str, kube: bool) -> str:
    """Why a cell cannot run on this kind of stack, or ""."""
    if name in KUBE_ONLY_CELLS and not kube:
        return "a Kubernetes cell (rollout, node drain): pass --kube-namespace"
    if name in DOCKER_ONLY_CELLS and kube:
        return DOCKER_ONLY_CELLS[name]
    return ""


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
        blobs[f"{stack.service_log_name(service)}.log"] = "\n".join(
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
    skip_why = ""
    if ctx.subscription_skip:
        skip_why = ctx.subscription_skip
    elif ctx.subscription and name not in SUBSCRIPTION_CELLS:
        skip_why = f"not a subscription cell (--subscription runs {', '.join(SUBSCRIPTION_CELLS)})"
    elif name in HOSTED_CELLS and ctx.subscription != "hosted":
        skip_why = "a hosted-login cell: pass --subscription hosted"
    elif mode_skip(name, ctx.stack.kube):
        skip_why = mode_skip(name, ctx.stack.kube)
    elif name in PHASE2 and not ctx.args.allow_destructive:
        skip_why = "destructive cell: pass --allow-destructive to run it"
    if skip_why:
        verdict = _skip(skip_why)
        print(f"[{name}] SKIP — {verdict['why']}", file=sys.stderr)
        return {"evidence": {}, "verdict": verdict, "elapsed_s": 0.0, "attempts": []}
    attempts = []
    for attempt in (1, 2):
        ctx.stack.wait_ready()
        before = ctx.stack.started_at()
        started = time.time()
        print(f"\n=== cell {name} (attempt {attempt}) ===", file=sys.stderr)
        ctx.used = []
        try:
            evidence, verdict = CELLS[name](ctx)
        except Exception as exc:  # noqa: BLE001
            evidence = {
                "driver_error": f"{type(exc).__name__}: {exc}",
                "traceback": traceback.format_exc()[-2000:],
            }
            verdict = _fail(f"driver exception: {type(exc).__name__}: {exc}")
        evidence["harness"] = sorted({h for h, _ in ctx.used})
        evidence["model"] = sorted({m for _, m in ctx.used})
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


def _exit_on_sigterm(signum, frame) -> None:
    raise SystemExit(128 + signum)


def run_all(args, stack: Stack, outdir: pathlib.Path, wanted: list, results: dict):
    """Check the two runners against their own `/health`, then run every wanted cell."""
    if stack.kube:
        deployment = stack.runner_deployment()
        replicas = (
            stack.kubectl.json("get", "deployment", deployment).get("spec") or {}
        ).get("replicas")
        if replicas != 2:
            raise SystemExit(
                f"the runner Deployment {deployment} asks for {replicas} replicas, not 2"
            )
    runners = stack.wait_ready()
    results["runners"] = [r.__dict__ for r in runners]
    if len(runners) != 2:
        raise SystemExit(
            f"expected exactly two runner containers, found {len(runners)}"
        )
    for r in runners:
        try:
            health = httpx.get(stack.base_url(r) + "/health", timeout=5).json()
        except (httpx.HTTPError, ValueError) as exc:
            raise SystemExit(f"{r.name} at {r.address} did not answer /health: {exc}")
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
    if args.subscription == "hosted":
        results["hosted_connection"] = ctx.resolve_hosted()
        if ctx.subscription_skip:
            print(f"[r1] hosted: {ctx.subscription_skip}", file=sys.stderr)
    for name in wanted:
        results["cells"][name] = run_cell(ctx, name)
        (outdir / "results.json").write_text(json.dumps(results, indent=2, default=str))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument(
        "--cells",
        default="phase1",
        help="comma list of cell names, or `phase1`, `phase2`, `all` "
        f"(cells: {', '.join(CELLS)})",
    )
    target = ap.add_mutually_exclusive_group()
    target.add_argument(
        "--project", help="docker-compose project with two runner containers"
    )
    target.add_argument(
        "--kube-namespace",
        help="Kubernetes mode: the namespace of a Helm release with two runner pods",
    )
    ap.add_argument(
        "--kube-context", help="kube mode: the kubeconfig context of every kubectl call"
    )
    ap.add_argument(
        "--kubeconfig", help="kube mode: the kubeconfig file (default: $KUBECONFIG)"
    )
    ap.add_argument(
        "--kube-release",
        default="agenta",
        help="kube mode: the Helm release (`app.kubernetes.io/instance` label)",
    )
    ap.add_argument(
        "--kube-secret",
        help="kube mode: read the runner token and Daytona key from this Secret (keys "
        "AGENTA_RUNNER_TOKEN, AGENTA_RUNNER_DAYTONA_API_KEY); default: the Secret each "
        "variable comes from in the runner pod spec. Never printed",
    )
    ap.add_argument(
        "--stack-env",
        default=os.environ.get("AGENTA_QA_STACK_ENV"),
        help="the stack's env file (runner token, Daytona key); never printed; in kube "
        "mode it replaces the Secret read",
    )
    ap.add_argument("--allow-destructive", action="store_true")
    ap.add_argument("--claude-model", default="haiku")
    ap.add_argument(
        "--claude-custom-name",
        help="run the Claude cells on this custom Anthropic-protocol vault connection; "
        "--claude-model is then its model slug (e.g. anthropic/claude-haiku-4.5)",
    )
    ap.add_argument(
        "--daytona-harness",
        choices=("claude", "pi_core"),
        default="claude",
        help="the harness of the Daytona cells: `claude` on the vault Anthropic key, or "
        "`pi_core` on the custom connection named by --custom-name / --custom-model",
    )
    ap.add_argument(
        "--subscription",
        choices=("hosted", "mounted"),
        help="run the subscription cells on Pi with a ChatGPT subscription: `hosted` is the "
        "project's connection named by --subscription-slug, `mounted` the operator's login "
        "mounted into the runner containers (inprocess only); the other cells SKIP",
    )
    ap.add_argument(
        "--subscription-sandbox",
        choices=("daytona", "inprocess"),
        default="daytona",
        help="the sandbox of the --subscription shape",
    )
    ap.add_argument(
        "--subscription-slug",
        default="chatgpt",
        help="vault slug of the hosted subscription connection; the cells SKIP when the "
        "project has no such connection in state `ready`",
    )
    ap.add_argument(
        "--pi-model",
        default="gpt-5.5",
        help="the model of the --subscription shape (a ChatGPT account refuses gpt-5.4-mini)",
    )
    ap.add_argument(
        "--redis-container",
        help="the Redis holding the api's cached vault read, cleared by "
        "hosted-refresh-across-pods (default <project>-redis-volatile-1)",
    )
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
    if args.subscription == "mounted" and args.subscription_sandbox != "inprocess":
        ap.error(
            "--subscription mounted runs on inprocess only: the runner refuses an operator "
            "mount on Daytona"
        )
    if args.subscription and args.daytona_harness != "claude":
        ap.error("--subscription sets the harness itself; drop --daytona-harness")
    for flag in ("kube_context", "kubeconfig", "kube_secret"):
        if getattr(args, flag) and not args.kube_namespace:
            ap.error(f"--{flag.replace('_', '-')} needs --kube-namespace")
    if (
        "identity-mismatch" in wanted
        and args.allow_destructive
        and not args.kube_namespace
    ):
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
    results: dict = {
        "project_id": lib.PROJECT,
        "base": lib.BASE,
        "subscription": args.subscription
        and {
            "kind": args.subscription,
            "sandbox": args.subscription_sandbox,
            "model": args.pi_model,
        },
        "cells": {},
    }

    if not args.project and not args.kube_namespace:
        for name in wanted:
            results["cells"][name] = {
                "evidence": {},
                "verdict": _skip(
                    "needs --project <compose project> for docker access, or "
                    "--kube-namespace for a Helm release"
                ),
                "elapsed_s": 0.0,
            }
    else:
        if args.kube_namespace:
            # A SIGTERM must unwind like Ctrl-C: the `finally` blocks uncordon a node and end
            # the `kubectl logs -f` and port-forward children, which outlive this process.
            signal.signal(signal.SIGTERM, _exit_on_sigterm)
            kubectl = Kubectl(args.kube_namespace, args.kube_context, args.kubeconfig)
            if not kubectl.context:
                # Pin the context the run starts on, so a later change of the kubeconfig's
                # current context never sends a call of this run to another cluster.
                current = kubectl.run("config", "current-context")
                if current.returncode != 0 or not current.stdout.strip():
                    raise SystemExit(
                        "no --kube-context and the kubeconfig has no current context: "
                        f"{current.stderr.strip()[:200]}"
                    )
                kubectl.context = current.stdout.strip()
            stack = KubeStack(
                kubectl,
                args.kube_release,
                args.kube_secret,
                args.stack_env,
                outdir,
            )
        else:
            stack = Stack(args.project, args.stack_env)
        try:
            run_all(args, stack, outdir, wanted, results)
        finally:
            stack.close()

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
