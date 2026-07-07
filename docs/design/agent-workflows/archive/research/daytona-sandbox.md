# Daytona sandbox integration for agent workflows

Research only. This file documents how the backend would programmatically create a
Daytona sandbox, install and run the pi.dev harness inside it, lay down files, inject
secrets, run the agent, stream output, and tear down. Every claim is cited. Items I could
not confirm from a primary source are marked UNVERIFIED.

Context: see [`../README.md`](../README.md). Agents run on a pi.dev harness inside a
Daytona sandbox ("or any provider that works with our port"). Startup hooks lay down
config files, then inject secrets.

## Summary

- Daytona is an open-source (AGPL 3.0) "secure and elastic infrastructure for running
  AI-generated code." Sandboxes are isolated machines with their own kernel, filesystem,
  and network. It advertises sandbox start "under 90ms from code to execution."
  [README](https://github.com/daytonaio/daytona), [docs](https://www.daytona.io/docs/en/).
- There is a first-class **Python SDK** (`pip install daytona`, package `daytona`, with
  both sync `Daytona` and async `AsyncDaytona` clients), plus TypeScript, Go, Ruby, and
  Java SDKs, a REST API, and a CLI.
  [Python SDK](https://www.daytona.io/docs/en/python-sdk/),
  [docs landing](https://www.daytona.io/docs/en/).
- Lifecycle: `daytona.create(...)` → `sandbox.process.exec(...)` / sessions →
  `sandbox.stop()` / `sandbox.delete()`. States are creating/started/stopping/stopped/
  archiving/archived/deleting/deleted/error. Auto-stop (default 15 min), auto-archive
  (default 7 days), and auto-delete (off by default) timers manage idle sandboxes.
  [Sandboxes](https://www.daytona.io/docs/en/sandboxes/),
  [SDK reference](https://www.daytona.io/docs/python-sdk/sync/daytona/).
- **Installing pi**: best fit is to bake pi into a custom **snapshot** (reusable image
  template) so cold start does not pay an `npm install`. Build the snapshot from a base
  image plus install commands using the **declarative Image builder** or a Dockerfile, or
  install pi at runtime via `npm i -g @earendil-works/pi-coding-agent` /
  `curl -fsSL https://pi.dev/install.sh | sh`. pi runs headless in print/JSON/RPC modes.
  [Snapshots](https://www.daytona.io/docs/en/snapshots/),
  [Declarative builder](https://www.daytona.io/docs/en/declarative-builder/),
  [pi README](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md).
- **Files**: `sandbox.fs.upload_file` / `upload_files` (in-memory bytes → remote path),
  plus `git` clone and mounted **volumes**. **Secrets/env**: `env_vars={...}` at create
  time, `env={...}` per `exec`, baked `.env` in the image, or write a `.env`-style file
  via the filesystem API. [File system](https://www.daytona.io/docs/en/file-system-operations/),
  [SDK reference](https://www.daytona.io/docs/python-sdk/sync/daytona/).
- **Streaming**: run the agent in a **session** with `run_async=True`, then stream
  stdout/stderr through `get_session_command_logs_async(session_id, cmd_id, on_stdout,
  on_stderr)`. This maps cleanly onto pi's multi-message output if pi runs in JSON/RPC
  mode (each emitted JSON line is one log chunk). [Process execution](https://github.com/daytonaio/daytona/blob/main/apps/docs/src/content/docs/en/process-code-execution.mdx).
- **Ports / "works with our port"**: `sandbox.get_preview_link(port)` returns a public URL
  `https://{port}-{sandboxId}.proxy.daytona.work` plus an auth `token` (sent as
  `x-daytona-preview-token`). Any HTTP port 1–65535 can be previewed. This is the
  provider-agnostic "port contract" the design alludes to.
  [Preview](https://www.daytona.io/docs/en/preview/).
- **Self-host**: yes, AGPL, via docker-compose (local) or a domain deployment behind
  Caddy. Auth is API keys (`DAYTONA_API_KEY`, `X-Daytona-Organization-ID` for JWT) backed
  by Dex/Auth0 OIDC. [OSS deployment](https://www.daytona.io/docs/en/oss-deployment/),
  [API keys](https://www.daytona.io/docs/en/api-keys/).

## Daytona SDK and lifecycle (Python, with code)

### Install and client

```bash
pip install daytona     # package name: "daytona"; module import: "daytona"
```

```python
from daytona import Daytona, DaytonaConfig

# From env vars: DAYTONA_API_KEY, DAYTONA_API_URL, DAYTONA_TARGET
daytona = Daytona()

# Or explicit config
daytona = Daytona(DaytonaConfig(
    api_key="YOUR_API_KEY",
    api_url="https://app.daytona.io/api",   # point at self-hosted URL for own infra
    target="us",
))
```

Async client (recommended for a FastAPI backend):

```python
from daytona import AsyncDaytona

async with AsyncDaytona() as daytona:
    sandbox = await daytona.create()
```

Source: [Python SDK](https://www.daytona.io/docs/en/python-sdk/),
[API keys](https://www.daytona.io/docs/en/api-keys/).

### Create / exec / stop / delete

```python
# Create (defaults: python language, 1 vCPU / 1GB RAM / 3GiB disk)
sandbox = daytona.create()

# Run a command
resp = sandbox.process.exec("echo 'Hello, World!'")
print(resp.result)

# Stop, then delete (method names per SDK reference and sandboxes doc)
sandbox.stop()
sandbox.delete()
```

`Daytona.create()` signatures (note the default 60s creation timeout):

```python
create(params: CreateSandboxFromSnapshotParams | None = None,
       *, timeout: float = 60) -> Sandbox

create(params: CreateSandboxFromImageParams | None = None,
       *, timeout: float = 60,
       on_snapshot_create_logs: Callable[[str], None] | None = None) -> Sandbox
```

`Sandbox` exposes submodules: `process`, `fs` / `file_system`, `git`, `object_storage`,
`volume`. Source: [SDK reference](https://www.daytona.io/docs/python-sdk/sync/daytona/),
[Sandboxes](https://www.daytona.io/docs/en/sandboxes/).

### Creation params (the important fields)

`CreateSandboxFromSnapshotParams` and `CreateSandboxFromImageParams` both inherit
`CreateSandboxBaseParams`:

- `snapshot: str` (snapshot params) or `image: str | Image` (image params)
- `resources: Resources | None` — only on the image params variant
- `name`, `language` (default `"python"`), `os_user`
- `env_vars: dict[str, str] | None` — **environment variables in the sandbox**
- `labels: dict[str, str] | None`
- `public: bool | None`
- `timeout: float | None`
- `auto_stop_interval: int | None` — minutes; default 15; `0` disables
- `auto_archive_interval: int | None` — minutes; default 7 days; `0` = max
- `auto_delete_interval: int | None` — minutes; off by default; `0` deletes immediately
- `volumes: list[VolumeMount] | None`
- `network_block_all: bool | None`, `network_allow_list: str | None` (CIDRs)
- `ephemeral: bool | None` — sets `auto_delete_interval=0` when True
- `linked_sandbox: str | None`

Source: [SDK reference](https://www.daytona.io/docs/python-sdk/sync/daytona/).

## Installing pi (image / snapshot strategy)

pi.dev (the "pi coding agent") is a minimal, swappable agent harness. Install options
([pi README](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md)):

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
# or
curl -fsSL https://pi.dev/install.sh | sh
```

Three baking strategies, in order of recommendation for the agent loop:

### 1. Prebuilt snapshot (recommended)

A **snapshot** is a reusable sandbox template built from a Docker/OCI image. Bake pi (and
Node) into it once, reuse for every run, and you avoid paying `npm install` on each cold
start. [Snapshots](https://www.daytona.io/docs/en/snapshots/).

```python
from daytona import Daytona, CreateSnapshotParams, Image, Resources

daytona = Daytona()

image = (
    Image.base("node:22-bookworm")
    .run_commands("npm install -g --ignore-scripts @earendil-works/pi-coding-agent")
    .workdir("/home/daytona")
)

daytona.snapshot.create(
    CreateSnapshotParams(
        name="agenta-pi-harness",
        image=image,
        resources=Resources(cpu=2, memory=4, disk=8),
    ),
    on_logs=print,   # build logs
)
```

Then create sandboxes from it (fast path):

```python
from daytona import CreateSandboxFromSnapshotParams

sandbox = daytona.create(
    CreateSandboxFromSnapshotParams(snapshot="agenta-pi-harness")
)
```

CLI equivalents: `daytona snapshot create <name> --image <image>`,
`daytona snapshot create <name> --dockerfile ./Dockerfile`,
`daytona snapshot push <local-image> --name <name>`, `daytona snapshot list|activate|delete`.

### 2. Declarative Image built on demand

Pass an `Image` object straight to `create()` and Daytona builds it on the fly. Good for
iteration, slower than a prebuilt snapshot on first use.
[Declarative builder](https://www.daytona.io/docs/en/declarative-builder/).

```python
from daytona import CreateSandboxFromImageParams, Image

image = (
    Image.debian_slim("3.12")
    .run_commands(
        "apt-get update && apt-get install -y curl",
        "curl -fsSL https://pi.dev/install.sh | sh",
    )
    .add_local_file("AGENTS.md", "/home/daytona/AGENTS.md")  # config files
    .env({"PI_HOME": "/home/daytona/.pi"})
    .workdir("/home/daytona")
)

sandbox = daytona.create(
    CreateSandboxFromImageParams(image=image),
    timeout=0,                      # 0 = no timeout while the image builds
    on_snapshot_create_logs=print,  # stream build logs
)
```

Builder methods available: `Image.debian_slim(py_ver)`, `Image.base(ref)`,
`Image.from_dockerfile(path)`, `.pip_install([...])`,
`.pip_install_from_requirements(path)`, `.pip_install_from_pyproject(path, ...)`,
`.run_commands(...)`, `.env({...})`, `.workdir(path)`, `.add_local_file(src, dst)`,
`.add_local_dir(src, dst)`, `.dockerfile_commands([...])`.

### 3. Install at runtime

Create a plain sandbox, then `sandbox.process.exec("npm i -g @earendil-works/pi-coding-agent")`.
Simplest but pays install latency on every run; only sensible for prototyping.

Note on local parity (design requirement): the same `@earendil-works/pi-coding-agent`
package and `AGENTS.md` / skills layout work identically on a developer machine, so a
config pulled from the server runs the same locally. pi resolves `AGENTS.md` from
`~/.pi/agent/agent.md` (global), parent dirs, and cwd; skills live in
`~/.pi/agent/skills/`, `.pi/skills/`, or project dirs.
[pi README](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md).

## Files + secrets injection

Order matches the design's startup hooks: files first, secrets second.

### Files into the sandbox

In-memory upload (no local temp file needed — good for config blobs pulled from the DB):

```python
# Single file: source bytes -> remote path
sandbox.fs.upload_file(agents_md_bytes, "/home/daytona/AGENTS.md")

# Bulk
from daytona import FileUpload
sandbox.fs.upload_files([
    FileUpload(source=agents_md_bytes, destination="/home/daytona/AGENTS.md"),
    FileUpload(source=skill_bytes,     destination="/home/daytona/.pi/agent/skills/x/SKILL.md"),
])

sandbox.fs.create_folder("/home/daytona/.pi/agent/skills", "755")
sandbox.fs.set_file_permissions("/home/daytona/AGENTS.md", "644")
```

Source: [File system operations](https://www.daytona.io/docs/en/file-system-operations/).

Other ways to get files in: `sandbox.git` clone; mounted **volumes** (`VolumeMount`,
shared persistent storage); baking files into the image with `.add_local_file` /
`.add_local_dir`. [Volumes](https://www.daytona.io/docs/en/volumes/) (UNVERIFIED on exact
volume API surface; listed in SDK submodules and snapshots doc).

### Secrets / env vars

Several layers, pick by sensitivity and lifetime:

```python
# A) Whole-sandbox env at creation
sandbox = daytona.create(CreateSandboxFromSnapshotParams(
    snapshot="agenta-pi-harness",
    env_vars={"OPENAI_API_KEY": "sk-...", "ANTHROPIC_API_KEY": "sk-ant-..."},
))

# B) Per-command env (scoped to one exec)
sandbox.process.exec("echo $CUSTOM_SECRET", env={"CUSTOM_SECRET": "DAYTONA"})

# C) Write a .env file via the filesystem API, then have pi/harness read it
sandbox.fs.upload_file(b"ANTHROPIC_API_KEY=sk-ant-...\n", "/home/daytona/.env")
```

`env_vars` is a field on `CreateSandboxBaseParams`
([SDK reference](https://www.daytona.io/docs/python-sdk/sync/daytona/)); per-exec `env`
is shown in [process execution](https://github.com/daytonaio/daytona/blob/main/apps/docs/src/content/docs/en/process-code-execution.mdx).
pi reads provider keys from standard env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
etc.), so `env_vars` at create time is the cleanest secret injection path
([pi README](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md)).
The OpenClaw guide confirms the same pattern: extra keys (e.g. `ANTHROPIC_API_KEY`) added
to `.env.sandbox` are loaded into the sandbox
([OpenClaw guide](https://www.daytona.io/docs/en/guides/openclaw/openclaw-sdk-sandbox/)).

Daytona also has a server-side **secrets** concept (scoped secret injection) referenced in
its security program, but I did not find a dedicated public SDK method for an
organization secret vault; treat that as UNVERIFIED and prefer `env_vars` for now.
[SECURITY.md](https://github.com/daytonaio/daytona/blob/main/SECURITY.md).

## Process exec + streaming + ports

### One-shot exec

```python
resp = sandbox.process.exec("pi -p 'analyze repo'", cwd="/home/daytona", timeout=600)
print(resp.result)   # buffered stdout; returned after the command finishes
```

`exec` supports `cwd`, `env`, and `timeout`.
[process execution](https://github.com/daytonaio/daytona/blob/main/apps/docs/src/content/docs/en/process-code-execution.mdx).

### Long-running agent + live stdout/stderr streaming (the agent loop)

Run the harness async inside a **session** and stream both streams via callbacks:

```python
import asyncio
from daytona import SessionExecuteRequest

session_id = "agent-run-<session_id>"
sandbox.process.create_session(session_id)

command = sandbox.process.execute_session_command(
    session_id,
    SessionExecuteRequest(
        command="pi --mode json -p 'do the task'",
        run_async=True,
    ),
)

logs_task = asyncio.create_task(
    sandbox.process.get_session_command_logs_async(
        session_id,
        command.cmd_id,
        lambda chunk: handle_stdout(chunk),   # each chunk = pi JSON line(s)
        lambda chunk: handle_stderr(chunk),
    )
)

# Optional interactive input back into the process
sandbox.process.send_session_command_input(session_id, command.cmd_id, "y")

await logs_task
```

This is the recommended shape for the multi-message agent output: run pi in
`--mode json` (or `--mode rpc`), and each emitted JSON line becomes a streamed log chunk
the backend forwards to the client. pi's JSON/RPC event stream emits typed events
(`agent_start`, `message_update` with `text_delta`, `tool_execution_start/update/end`,
`agent_end`), so the backend can map each event to an agent message / tool span for
tracing. RPC framing is strict LF-delimited JSONL — split on `\n` only.
Sources: [process execution](https://github.com/daytonaio/daytona/blob/main/apps/docs/src/content/docs/en/process-code-execution.mdx),
[pi RPC](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md),
[pi README](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md).

pi mode summary for headless use:
- `pi -p "<prompt>"` — print mode, runs once and exits (buffered text).
- `pi --mode json` — same as print but emits all events as JSON lines (best for parsing).
- `pi --mode rpc` — bidirectional JSONL over stdin/stdout; send
  `{"type":"prompt","message":"..."}`, receive `response` + streamed events; supports
  `steer` / `followUp` mid-run, `get_state`, `fork`, `switch_session`.
- Flags: `--provider`, `--model` (or `--model anthropic/claude-opus`), `--name`,
  `--no-session`.
[pi RPC](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md).

### Ports / preview ("works with our port")

If the harness or a tool serves HTTP, expose it with a preview link:

```python
preview = sandbox.get_preview_link(3000)
print(preview.url)    # https://3000-<sandboxId>.proxy.daytona.work
print(preview.token)  # send as header: x-daytona-preview-token
```

Any HTTP port 1–65535 is previewable; the port opens automatically if closed. For private
sandboxes the `token` is required (header `x-daytona-preview-token`), and the token resets
when the sandbox restarts, so re-fetch after a restart. This preview/port mechanism is the
provider-agnostic "port contract" the design refers to. A self-hosted deployment serves
the equivalent under `*.proxy.<yourdomain>`.
[Preview](https://www.daytona.io/docs/en/preview/),
[Preview & auth](https://www.daytona.io/docs/en/preview-and-authentication/).

## Cold start, lifecycle states, timeouts, limits

- **Cold start:** advertised "under 90ms from code to execution"
  ([README](https://github.com/daytonaio/daytona)). UNVERIFIED how that interacts with
  on-demand image builds; a *prebuilt snapshot* should hit the fast path, whereas building
  a declarative `Image` on first `create()` is a separate, slower one-time build.
- **States:** creating, started, stopping, stopped, archiving, archived, deleting,
  deleted, error. Archived preserves state cheaply (on object storage); restarting from
  archived is slower than from stopped. [Sandboxes](https://www.daytona.io/docs/en/sandboxes/).
- **Timeouts / timers:**
  - `create(..., timeout=60)` default 60s creation timeout (use `timeout=0` for builds).
  - `auto_stop_interval`: default **15 min** of inactivity → stop; `0` disables.
  - `auto_archive_interval`: default **7 days** stopped → archive; `0` = max (30 days).
  - `auto_delete_interval`: **disabled by default**; `0` = delete immediately on stop;
    `-1` disables. `ephemeral=True` sets it to 0.
  [SDK reference](https://www.daytona.io/docs/python-sdk/sync/daytona/),
  [Sandboxes](https://www.daytona.io/docs/en/sandboxes/).
- **Resources:** default **1 vCPU / 1GB RAM / 3GiB disk**; per-sandbox org max
  **4 vCPU / 8GB RAM / 10GB disk**. Set via `Resources(cpu=2, memory=4, disk=8)` on the
  from-image path. [Sandboxes](https://www.daytona.io/docs/en/sandboxes/).

Implication for an agent loop: a long agent run will hit the 15-min auto-stop unless you
raise `auto_stop_interval` or keep the session active; set it explicitly for runs expected
to exceed 15 minutes, and `delete()`/`ephemeral=True` to guarantee teardown.

## Self-host + auth

- **Self-hostable:** yes. AGPL 3.0; "free to deploy and run in any environment,"
  community-supported. If you modify it and expose over a network, AGPL requires releasing
  your modifications. [OSS deployment](https://www.daytona.io/docs/en/oss-deployment/).
- **Deploy modes:** local docker-compose, or a domain deployment behind Caddy (TLS, DNS
  provider token, ports 80/443/2222, 4GB+ RAM). Components: API (3000, dashboard + REST),
  Proxy (4000, preview routing), SSH Gateway (2222), PostgreSQL, Redis, Dex (OIDC),
  Registry, MinIO (S3-compatible storage).
  ```bash
  git clone https://github.com/daytonaio/daytona
  docker compose -f docker/docker-compose.yaml up -d   # http://localhost:3000
  # or: ./scripts/setup-domain-oss-deployment.sh        # guided domain + TLS setup
  ```
  Local default login: `dev@daytona.io` / `password` (Dex). Domain setup generates
  `ENCRYPTION_KEY`, `ENCRYPTION_SALT`, `PROXY_API_KEY`, `RUNNER_API_KEY`,
  `SSH_GATEWAY_API_KEY`. Auth0 OIDC is an optional alternative.
  [OSS deployment](https://www.daytona.io/docs/en/oss-deployment/).
- **Auth model (API):** API keys created in the Dashboard or via the API; SDK/CLI read
  `DAYTONA_API_KEY` (and `DAYTONA_API_URL` to point at self-hosted). JWT-authenticated
  requests additionally need `X-Daytona-Organization-ID`. For self-host, set
  `api_url` / `DAYTONA_API_URL` to your deployment.
  [API keys](https://www.daytona.io/docs/en/api-keys/).

## Open questions

- **Snapshot build pipeline ownership.** Who builds/owns the `agenta-pi-harness` snapshot
  and how is it pinned/versioned per agent revision? Building a declarative `Image` on the
  hot path is slow; we likely need a prebuild step in CI or at config-publish time.
- **Cold start with custom image.** The "<90ms" figure is for sandbox start; the
  first-time build of a custom image/snapshot is separate and unmeasured here. UNVERIFIED:
  start time from a *prebuilt* pi snapshot vs. the default image.
- **pi output → Agenta tracing mapping.** Which pi events (`message_update`,
  `tool_execution_*`) map to Agenta's multi-message output and pi-instruments tracing, and
  whether RPC mode (bidirectional, supports steering) or JSON print mode is the better fit
  for our streaming endpoint. RPC's "bash output appears in context on the *next* prompt"
  semantics needs design attention.
- **Secrets vault.** Whether Daytona exposes a real scoped-secret API beyond `env_vars`
  (referenced in SECURITY.md but no public SDK method found). For now `env_vars` at
  create time. UNVERIFIED.
- **Provider abstraction.** The design says "any provider that works with our port." The
  Daytona preview-URL/port + token model is concrete; a sandbox-provider interface would
  need to abstract create/exec/stream/preview across providers (e.g. E2B, Modal). Out of
  scope here but the port + streaming-logs contract is the seam.
- **Volume API surface.** Exact `VolumeMount` / `daytona.volume` Python API not fully
  confirmed here. UNVERIFIED.
- **Long-run auto-stop.** Confirm whether an actively streaming session resets the
  `auto_stop_interval` idle timer or whether we must raise it explicitly. UNVERIFIED.

## Sources

- Daytona docs landing — https://www.daytona.io/docs/en/
- Daytona GitHub (README, license, "<90ms") — https://github.com/daytonaio/daytona
- Python SDK overview — https://www.daytona.io/docs/en/python-sdk/
- Python SDK reference (params, fields, create signatures) — https://www.daytona.io/docs/python-sdk/sync/daytona/
- Sandboxes (lifecycle, states, resources, timers) — https://www.daytona.io/docs/en/sandboxes/
- Snapshots (custom images, CLI) — https://www.daytona.io/docs/en/snapshots/
- Declarative builder (Image API) — https://www.daytona.io/docs/en/declarative-builder/
- Process & code execution (exec, sessions, async log streaming) — https://github.com/daytonaio/daytona/blob/main/apps/docs/src/content/docs/en/process-code-execution.mdx
- File system operations (upload/download/permissions) — https://www.daytona.io/docs/en/file-system-operations/
- Preview / ports / token — https://www.daytona.io/docs/en/preview/
- Preview & authentication — https://www.daytona.io/docs/en/preview-and-authentication/
- OSS deployment (self-host, components, auth) — https://www.daytona.io/docs/en/oss-deployment/
- API keys (auth model) — https://www.daytona.io/docs/en/api-keys/
- SECURITY.md (secrets management mention) — https://github.com/daytonaio/daytona/blob/main/SECURITY.md
- OpenClaw-in-sandbox guide (agent + secrets + preview pattern) — https://www.daytona.io/docs/en/guides/openclaw/openclaw-sdk-sandbox/
- pi.dev landing — https://pi.dev , https://pi.dev/docs/latest
- pi coding-agent README (install, modes, AGENTS.md, skills) — https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md
- pi RPC protocol doc (JSONL events, streaming) — https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md
- pi npm package — https://www.npmjs.com/package/@earendil-works/pi-coding-agent
