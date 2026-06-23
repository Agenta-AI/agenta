# Sandbox sharing: one sandbox for all agents, or one per agent?

Status: research. Source of the question: the product owner wants v1 to mirror today's
prompt-style workflows, which run against one shared runtime/service rather than one per
workflow. The proposed shortcut is "reuse the same sandbox but connect it to a different
volume at each execution."

This file answers: can we reuse one Daytona sandbox across many agent executions, can the
mounted volume change per execution, how do we isolate executions in a shared sandbox,
what is the concurrency model, how pi.dev views sessions, and what v1 should actually do.

## Summary

- **Reusing one long-lived sandbox: yes, supported.** A Daytona sandbox is designed for
  long-lived reuse across many tasks, and the Process API provides both stateless one-off
  `exec()` / `code_run()` and stateful named **Sessions** (`create_session` /
  `execute_session_command` / `delete_session`) for running many independent command
  streams in one sandbox. [daytona-sandboxes][daytona-sandboxes][daytona-process]
- **Swapping a different volume per execution: NO.** Daytona volumes are mounted **only at
  sandbox creation** via `CreateSandboxFromSnapshotParams(volumes=[...])`. They cannot be
  attached, detached, or changed on a running sandbox. Changing the mount requires
  recreating the sandbox. The canonical docs say so explicitly. So the literal
  "reuse the sandbox, attach a different volume each run" idea is **not feasible in
  Daytona today.** [daytona-volumes][daytona-volumes-src]
- **Closest workable equivalent to "a volume per execution" without recreating the
  sandbox:** give each execution its own **working directory** (e.g.
  `/runs/<session_id>/`) and lay its config/files/secrets there per run, optionally with a
  per-run OS user. That is the per-exec isolation lever in a shared sandbox, not volumes.
  If you genuinely need a persistent named volume per agent, that belongs to the
  sandbox-per-agent model, where `subpath` on one shared volume gives per-agent isolation
  at create time. [daytona-process][daytona-volumes]
- **Isolation in a shared sandbox is weak by default.** All sessions and execs in one
  sandbox share one kernel, one filesystem, one process table, one network stack, and one
  set of OS env vars. Filesystem bleed, leftover processes, and secret bleed are real and
  must be managed by convention (per-run dirs, per-command `env`, cleanup), not by the
  platform. Daytona's own positioning is "isolated sandbox **per execution**" for safety.
  [daytona-sandboxes][daytona-blog-best]
- **Concurrency is bounded and shares resources.** One sandbox defaults to 1 vCPU / 1 GiB
  RAM (max 4 vCPU / 8 GiB), and an org's *total* active-sandbox budget is 4 vCPU / 8 GiB /
  10 GiB. Many agent runs can be launched as concurrent sessions in one sandbox, but they
  contend for that single sandbox's CPU/RAM/disk and can step on each other's files.
  Daytona has an open issue to add a Parallel Sandbox Execution API precisely because one
  sandbox is not a clean unit for parallel independent workflows today.
  [daytona-sandboxes][daytona-parallel-issue]
- **pi.dev does not need a dedicated machine per session, only a distinct session file and
  working dir.** pi stores each session as a JSONL tree file; the SDK lets you point each
  session at its own `cwd`, its own session file (`SessionManager.open(path)`), or its own
  `agentDir`, and run in `--mode rpc --no-session`. So multiple pi sessions can coexist in
  one environment as long as each gets its own directory/session file. This maps cleanly
  onto "per-run working directory inside one shared sandbox." [pi-sdk][pi-docs]
- **Recommendation for v1:** one shared, long-lived sandbox for all agents, isolation by
  **per-run working directory + per-command env + cleanup**, NOT by per-run volumes.
  Treat the volume-per-execution idea as not feasible and substitute per-run dirs.
  Serialize or cap concurrency on the shared sandbox. Keep the sandbox-provider port
  abstraction so the migration to **sandbox-per-agent / sandbox-per-run** (with a
  per-agent volume via `subpath` at create time) is a config swap, not a rewrite.

## Reusing one sandbox (sessions / exec model)

Daytona explicitly designs sandboxes for long-lived reuse: they keep filesystem state
across stop/start, can be archived and restored, and resized without recreation.
[daytona-sandboxes] Agenta already has the integration scaffolding: `DaytonaConfig` in
`api/oss/src/utils/env.py` carries `DAYTONA_API_KEY`, `DAYTONA_API_URL`,
`DAYTONA_SNAPSHOT`, `DAYTONA_TARGET`, which tells us the plan is snapshot-based sandbox
creation.

The Process API gives two execution modes inside one sandbox:

- **One-off, stateless:** `exec(command, cwd=None, env=None, timeout=None)` and
  `code_run(code, params=None, timeout=None)`. Each invocation starts fresh; good for
  isolated commands. Both accept per-call `cwd` and `env`. [daytona-process]
- **Stateful Sessions:** named background sessions that persist state across commands.
  [daytona-process]

Python session example (verbatim shape from the docs): [daytona-process-src]

```python
session_id = "interactive-session"
sandbox.process.create_session(session_id)

command = sandbox.process.execute_session_command(
    session_id,
    SessionExecuteRequest(
        command="pip uninstall requests",
        run_async=True,
    ),
)
# later
sandbox.process.get_session(session_id)     # status + command history
sandbox.process.delete_session(session_id)  # cleanup
```

`SessionExecuteRequest` fields: `command` and `run_async` (Python) / `runAsync` (TS).
[daytona-process-src] Sessions are the natural home for one agent run: create a session
per run keyed by `session_id`, fire the harness command, monitor it, delete the session
when done. Many sessions can live in one sandbox at once.

**Keeping the shared sandbox alive.** A running sandbox auto-stops after
`autoStopInterval` (default 15 min). Critically, **internal/background processes do NOT
reset the timer** — only lifecycle changes, preview network requests, active SSH, and
Toolbox SDK calls do. For an always-on shared sandbox, set `autoStopInterval: 0` or call
`sandbox.refreshActivity()` periodically. [daytona-sandboxes]

## Volumes — can they change per execution?

**No.** This is the central finding and it kills the literal proposal.

> "Once a volume is created, it can be mounted to a sandbox by specifying it in the
> `CreateSandboxFromSnapshotParams` object." [daytona-volumes-src]

Volumes mount **only at sandbox creation**. There is no API to attach/detach or swap a
volume on a running sandbox; the docs describe mounting exclusively through the create
params, and contain no running-sandbox mount operation. Changing what is mounted requires
**recreating** the sandbox. [daytona-volumes][daytona-volumes-src]

Mounting example (Python): [daytona-volumes]

```python
from daytona import CreateSandboxFromSnapshotParams, Daytona, VolumeMount

daytona = Daytona()
volume = daytona.volume.get("my-volume", create=True)

params = CreateSandboxFromSnapshotParams(
    language="python",
    volumes=[
        VolumeMount(
            volume_id=volume.id,
            mount_path="/home/daytona/volume",
            subpath="users/alice",   # optional per-tenant prefix
        )
    ],
)
sandbox = daytona.create(params)
```

`VolumeMount` fields: `volume_id`, `mount_path` (absolute, not `/`, not a system dir like
`/proc`, `/etc`, `/bin`...), and optional `subpath`. [daytona-volumes][daytona-volumes-src]

Other volume facts that matter:

- **Persistence:** "The volume will persist even after the sandbox is removed." Good for
  producer/consumer state across sandbox lifecycles. [daytona-volumes-src]
- **`subpath` isolation:** a sandbox mounted at `users/alice` cannot reach `users/bob` via
  `../bob`; isolation is at the FUSE mount boundary. This is the supported way to give each
  *sandbox* (created per agent/run) its own slice of one shared volume — but again, only at
  create time. [daytona-volumes][daytona-volumes-src]
- **FUSE limits:** volumes are FUSE mounts — slower than local disk, not usable for block
  storage (e.g. DB files), and "not transactional": concurrent writes to the same path are
  last-write-wins. [daytona-volumes-src]
- **FUSE permission bugs:** an open issue reports `mv`, repeated `touch`, `stat`, and
  `shutil.copystat()` failing with permission errors inside FUSE volumes. This makes
  volumes a poor surface for frequent per-run file manipulation even where they do apply.
  [daytona-fuse-issue]

**Conclusion for the question as posed:** "reuse one sandbox, connect a different volume
each execution" is not achievable in Daytona. Volumes are a create-time-only mount.

### Alternatives to per-execution volumes (in one shared sandbox)

1. **Per-run working directory (recommended).** Lay each run's config/files/secrets under
   `/runs/<session_id>/` (or a temp dir) and run the harness with that as `cwd`. Clean it
   up on completion. This is the direct in-sandbox analog of "a different volume per run"
   and avoids the FUSE limits entirely. `exec`/`execute_session_command` already take
   `cwd`. [daytona-process]
2. **Copy files in/out per run** via the filesystem/Toolbox API, scoped to the per-run dir.
3. **Per-run OS user** for stronger separation (file ownership, home dir) if root isn't
   required by the harness. (Standard Linux; UNVERIFIED whether Daytona's default image
   permits adding users without extra config.)
4. **Recreate-per-run with a volume** (this is sandbox-per-run, not sandbox-sharing): if a
   *persistent* per-agent volume is a hard requirement, create a fresh sandbox per run with
   `volumes=[VolumeMount(volume_id, mount_path, subpath="agents/<agent_id>")]`. This is the
   migration target, not v1.

## Isolation in a shared sandbox

A single Daytona sandbox is "isolated" from *other sandboxes and the host* — it gets a
dedicated kernel, filesystem, network stack, and resource allocation. [daytona-sandboxes]
But **within** one sandbox there is no isolation between executions. All sessions and execs
share:

- **One filesystem** — files written by run A are visible to run B unless you scope each
  run to its own directory and clean up. Filesystem bleed is the default.
- **One process table** — a leftover/background process from a prior run keeps running
  (and does not even reset the auto-stop timer). You must track and kill per-run PIDs.
  [daytona-sandboxes]
- **One set of OS environment variables** — sandbox-level env is global. Secret bleed is a
  real risk if you `export` a secret. Mitigate by passing secrets per command via the `env`
  parameter of `exec` / `execute_session_command` rather than setting them globally, and by
  scoping secret files to the per-run dir. [daytona-process]
- **One network stack** — ports and outbound identity are shared.

Practical isolation recipe for a shared sandbox:

- Unique `session_id` per run; one Daytona Session per run.
- Per-run working dir `/runs/<session_id>/`; never write run state outside it.
- Pass secrets via per-command `env`, not global exports; keep secret files inside the
  per-run dir with tight permissions; delete on completion.
- Explicit cleanup: kill the run's process group, remove the run dir, `delete_session`.
- Optional per-run OS user for ownership separation.

Even with all of this, one sandbox is a **soft** isolation boundary (shared kernel, Docker
by default). For untrusted agent code or cross-tenant separation, this is weaker than
sandbox-per-run. Daytona's own marketing leans on "isolated sandbox **per execution**" for
exactly this reason, and notes the default Docker isolation is weaker than microVMs.
[daytona-blog-best]

## Concurrency

- **Resource budget.** One sandbox defaults to 1 vCPU / 1 GiB / 3 GiB disk, max
  4 vCPU / 8 GiB / 10 GiB. The whole org's active-sandbox budget is also 4 vCPU / 8 GiB /
  10 GiB. So a single shared sandbox is a small box, and packing many concurrent agent runs
  into it means they contend for that fixed slice. [daytona-sandboxes]
- **Mechanically parallel, practically contended.** You *can* open multiple sessions and
  run them concurrently in one sandbox, but they share CPU/RAM/disk and the filesystem, so
  heavy or untrusted runs can starve or corrupt each other. There is no per-session cgroup
  isolation documented. (UNVERIFIED: no documented per-session CPU/memory quota.)
- **Daytona itself flags this gap.** Open issue "Design and Implement Parallel Sandbox
  Execution API" states that "developers working on AI agents or multi-threaded workflows
  face limitations when trying to run multiple tasks concurrently," and that the current
  workaround is "running multiple independent sandboxes manually (inefficient and
  resource-heavy)." The proposed fix is forking sandbox state (filesystem + memory) — i.e.
  Daytona's answer to parallel independent runs is *more sandboxes*, not more sessions in
  one. [daytona-parallel-issue]

Realistic v1 concurrency model for a shared sandbox: **serialize, or cap to a small N** of
concurrent sessions, each in its own working dir, sized to fit the sandbox's CPU/RAM. If
throughput needs to scale, that is the trigger to move to sandbox-per-run.

## pi.dev session / workspace model

pi (by Earendil Inc.) is a minimal, extensible agent harness — the harness Agenta's agent
workflow defaults to. It runs as an interactive TUI, a print/JSON one-shot, an RPC process
(stdin/stdout JSONL), or embedded via a Node SDK. [pi-home][pi-docs]

Key points for sharing one sandbox:

- **Sessions are files, not machines.** pi stores each session as a JSONL tree file
  (branchable history). It does not require a dedicated host per session. [pi-docs]
- **Per-session isolation is by path.** The SDK's `SessionManager` controls where state
  lives: `SessionManager.create(cwd)` (new session in a directory),
  `SessionManager.continueRecent(cwd)`, `SessionManager.open("/path/to/session.jsonl")`
  (explicit file), and `SessionManager.inMemory()` (ephemeral). You can also point at a
  different global config via `agentDir`. [pi-sdk]
- **Multiple pi sessions coexist** in one environment by giving each a distinct `cwd`,
  distinct session file, and/or distinct `agentDir` — "each combination isolates session
  state, credentials, and settings files." [pi-sdk]
- **Context comes from the working dir.** pi loads `AGENTS.md` / `SYSTEM.md` from
  `~/.pi/agent/`, parent dirs, and the cwd, so the per-run working dir naturally carries
  per-run agent config. [pi-home]
- **Non-interactive runs:** `pi --mode rpc --no-session` (or `runRpcMode(runtime)`) for a
  programmatic, sessionless subprocess driven over JSON-RPC. [pi-sdk]

Implication: pi's design is fully compatible with "one shared sandbox, many runs." Each
agent run = one pi process pointed at its own per-run `cwd` (carrying that run's
`AGENTS.md`, skills, files) and its own session file. pi gives Agenta the per-run state
isolation that Daytona volumes do **not**. Agenta's `session_id` should map to (a) the pi
session file name and (b) the per-run working directory, and (c) the Daytona Session id —
one id threading all three layers.

## Recommendation for v1 + migration path

### v1: one shared sandbox, isolation by directory (not by volume)

1. **One long-lived shared Daytona sandbox** created from `DAYTONA_SNAPSHOT`, with
   `autoStopInterval: 0` (or periodic `refreshActivity()`), reused across all agents.
   Matches the PO's "one runtime for all" goal and the existing prompt-runtime shared model.
2. **Per-run isolation by working directory, not volume.** For each run, create
   `/runs/<session_id>/`, lay down that agent's config (`AGENTS.md`, skills, files) and
   secrets there via startup hooks, and run pi with that dir as `cwd` and its own session
   file. The "different volume per execution" intent is satisfied by a different *directory*
   per execution. This sidesteps Daytona's create-time-only volume limit and the FUSE
   permission/perf problems. [daytona-process][daytona-volumes][daytona-fuse-issue]
3. **One Daytona Session per run**, keyed by `session_id`; secrets passed via per-command
   `env`, never global exports. [daytona-process]
4. **Mandatory cleanup** after each run: kill the run's process group, delete the run dir,
   `delete_session`. This is what contains filesystem/process/secret bleed in a shared box.
5. **Bounded concurrency:** serialize, or cap to a small N sized to the sandbox's 1–4 vCPU.
   [daytona-sandboxes]
6. **Keep the sandbox-provider port thin** so the unit of isolation (shared vs per-run) is
   a config choice behind the same interface, as the design doc already anticipates.

Honest framing for the PO: "one sandbox for all agents" is achievable, but **not by
swapping volumes** — by swapping working directories. The volume idea is the right
*instinct* (per-run isolated storage) attached to the wrong Daytona primitive. Use
directories in v1; use volumes only when you move to per-run/per-agent sandboxes.

### Migration path to per-agent / per-run sandboxes

When isolation, security (untrusted code), or concurrency throughput outgrow the shared
box:

- Flip the provider port from "reuse shared sandbox" to "create sandbox per run."
- At creation, mount a per-agent persistent volume slice with
  `VolumeMount(volume_id, mount_path, subpath="agents/<agent_id>")` — this is where the
  "volume per agent" idea finally becomes native and correct. [daytona-volumes]
- Optionally enable stronger isolation (Kata/Sysbox) for untrusted code.
  [daytona-blog-best]
- Lean on snapshot warm-starts to keep per-run create latency low. [daytona-sandboxes]

Because pi already isolates by `cwd`/session file and `session_id` threads all layers, the
run-orchestration code barely changes between the two models; only the
"get-a-sandbox" step swaps.

## Open questions

- **Per-session resource quotas.** Can Daytona cap CPU/RAM/disk per Session (cgroups)
  inside one sandbox, or is the only quota the whole-sandbox allocation? Not found in docs
  — UNVERIFIED. If none, concurrent runs cannot be resource-isolated within one sandbox.
- **Default image users/permissions.** Does the snapshot image allow adding/switching OS
  users per run without root issues? UNVERIFIED.
- **Toolbox filesystem API surface** for laying down per-run files/secrets and reading
  outputs (upload/download/permissions) — needs confirmation against the Daytona Toolbox
  SDK docs; sibling research on the sandbox port should pin this down.
- **pi `--no-session` vs Agenta `session_id`.** Agenta wants a `session_id` per run for
  future state storage; pi can run sessionless (`--no-session`) or with an explicit session
  file. Decide whether Agenta persists the pi JSONL session file (per the design doc's
  "future session storage") or treats runs as sessionless and stores its own trace. The
  design doc's session-storage goal points to keeping pi session files.
- **Concurrency ceiling.** Exact safe N of parallel pi runs in one 1–4 vCPU sandbox needs
  empirical testing; treat as serialize-first until measured.
- **Daytona Parallel Sandbox Execution API status.** Issue #4001 is a proposal; if/when it
  ships (fork filesystem+memory), it could change the cheapest path for parallel runs.
  [daytona-parallel-issue]

## Sources

- [daytona-sandboxes] Daytona — Sandboxes (lifecycle, states, auto-stop/archive/delete,
  refreshActivity, resource limits, per-sandbox isolation):
  https://www.daytona.io/docs/en/sandboxes/
- [daytona-process] Daytona — Process and Code Execution (exec/code_run vs Sessions, cwd,
  env, create/execute/get/delete session): https://www.daytona.io/docs/en/process-code-execution/
- [daytona-process-src] Daytona docs source — process-code-execution.mdx (verbatim session
  example, SessionExecuteRequest fields):
  https://github.com/daytonaio/daytona/blob/main/apps/docs/src/content/docs/en/process-code-execution.mdx
- [daytona-volumes] Daytona — Volumes (creation, VolumeMount, mount_path/subpath, FUSE,
  mounting via CreateSandboxFromSnapshotParams): https://www.daytona.io/docs/en/volumes/
- [daytona-volumes-src] Daytona docs source — volumes.mdx (verbatim "mounted at creation",
  persistence, FUSE not transactional, last-write-wins):
  https://github.com/daytonaio/daytona/blob/main/apps/docs/src/content/docs/en/volumes.mdx
- [daytona-fuse-issue] Daytona GitHub issue #3331 — FUSE volume permission limitations
  (mv/touch/stat/copystat failures): https://github.com/daytonaio/daytona/issues/3331
- [daytona-parallel-issue] Daytona GitHub issue #4001 — Design and Implement Parallel
  Sandbox Execution API (fork filesystem+memory; current workaround = many sandboxes):
  https://github.com/daytonaio/daytona/issues/4001
- [daytona-blog-best] Northflank — "Best code execution sandbox for AI agents 2026"
  (isolated sandbox per execution; Docker-default isolation weaker than microVMs):
  https://northflank.com/blog/best-code-execution-sandbox-for-ai-agents
- [pi-home] pi.dev — product overview (harness, modes, AGENTS.md/SYSTEM.md context):
  https://pi.dev
- [pi-docs] pi.dev — docs index (session tree, JSONL session format, RPC/SDK modes):
  https://pi.dev/docs/latest
- [pi-sdk] pi.dev — SDK/RPC (SessionManager.create/continueRecent/open/inMemory, cwd,
  agentDir, runRpcMode, `--mode rpc --no-session`): https://pi.dev/docs/latest/sdk
- Agenta repo — `api/oss/src/utils/env.py` `DaytonaConfig` (DAYTONA_API_KEY,
  DAYTONA_API_URL, DAYTONA_SNAPSHOT, DAYTONA_TARGET).
- Agenta repo — `docs/design/agent-workflows/README.md` (agent workflow context, sandbox +
  pi harness + session_id) and `docs/design/prompt-runtime-unification/README.md` (existing
  shared prompt runtime model).
