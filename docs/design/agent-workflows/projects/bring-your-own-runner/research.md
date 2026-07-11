# Research: the current state, verified against code

Everything below was verified in the working tree on 2026-07-09. Doc pages sometimes
still cite the pre-rename path `services/agent/`; the code lives at `services/runner/`.

## 1. Topology: three tiers, and where the runner sits

There are three process tiers, not two:

1. **`api/`** - the Agenta backend (FastAPI). Owns the DB, the vault, the tool gateway,
   OTLP ingest, and the session store.
2. **`services/oss/src/agent/`** - the agent service (Python). Serves `/invoke` and
   `/messages`, parses config, resolves secrets and tools, threads trace context, then
   dispatches one turn to the runner.
3. **`services/runner/`** - the runner (Node). Serves `GET /health`, `POST /kill`, and
   `POST /run` on `:8765` (`services/runner/src/server.ts`). Drives a harness (Pi or
   Claude) over ACP through `sandbox-agent`, either as a local daemon or inside a
   Daytona sandbox.

The critical topology fact: **the runner is never remote today.** Even the Daytona
flavor keeps the runner next to the backend; only the sandbox (the harness execution
environment) is remote, and the co-located runner creates it via the Daytona SDK
(`src/engines/sandbox_agent/daytona.ts`). "Bring your own runner" is a new topology,
not an existing one with a longer wire.

A deprecated `LocalBackend` adapter (`sdks/python/agenta/sdk/agents/adapters/local.py`)
exists as the intended "run on your own machine" backend, but it raises
`NotImplementedError` and is not wired.

## 2. The interface map

### Inbound: backend reaches the runner

| Interface | Endpoint | Carries | Auth today |
| --- | --- | --- | --- |
| Turn dispatch | `POST /run` (alias `/stream`), NDJSON streaming with `Accept: application/x-ndjson` | The whole turn: harness, sandbox, messages, AGENTS.md, resolved model + provider, **plaintext provider secrets**, resolved tools, permissions, trace context, telemetry target, runContext | Optional shared static `AGENTA_RUNNER_TOKEN` (Bearer or `X-Agenta-Runner-Token`, constant-time compare), **default off**; loopback bind `127.0.0.1` by default (`server.ts:66-129`) |
| Control | `GET /health`, `POST /kill` | Identity (`runner`, `protocol`, engines, harnesses) and teardown | Same token gate |

The service picks HTTP when `AGENTA_RUNNER_INTERNAL_URL` is set
(`services/oss/src/agent/config.py`, `app.py select_backend`) and a CLI subprocess
otherwise (`sdks/python/agenta/sdk/agents/utils/ts_runner.py`). Config and versioning
are **pushed in the dispatch payload**; the runner never fetches app config from the
backend.

### Outbound: the runner reaches back to `api/`

The runner resolves its API base in `src/apiBase.ts`: `AGENTA_API_INTERNAL_URL` →
`AGENTA_API_URL` → inferred → `http://api:8000`. Four reach-back surfaces:

| Surface | Endpoints | Purpose | Auth |
| --- | --- | --- | --- |
| Tool gateway | `POST /tools/call` (`src/tools/callback.ts`); direct platform ops like `POST /tools/discover` (`src/tools/direct.ts`, SSRF-confined to the callback origin) | Execute gateway/reference/platform tools server-side so Composio keys and connection auth never enter the sandbox | `toolCallback.authorization`, a `Secret` token riding in the `/run` payload |
| Session coordination | `/sessions/states/`, `/sessions/streams/*` (+ query, detach, heartbeat), `/sessions/mounts/sign`, `/sessions/interactions/*` (+ transition, cancel-stale), `/sessions/contract`, `/sessions/persist` (`src/sessions/*.ts`, `src/engines/sandbox_agent/mount.ts`; router `api/oss/src/apis/fastapi/sessions/router.py`) | Sandbox ids, stream liveness, durable-mount signing, approval interaction rows | The run credential (same `Secret` token) |
| Credential refresh | `GET /access/permissions/check?action=run_service` (`src/sessions/auth.ts`) | Re-mints the ~15-minute `Secret` token mid-session | Any still-valid credential |
| Trace ingest | `POST {base}/otlp/v1/traces` (`src/tracing/otel.ts`, Pi extension `src/extensions/agenta.ts`) | The span tree (`invoke_agent` → `turn N` → `chat` / `execute_tool`) with usage and cost, nested under the caller's trace via `traceparent` | `telemetry.exporters.otlp.headers.authorization` (ApiKey or Secret), env fallback `AGENTA_API_KEY` |

One design fact does a lot of work here: **all three outbound surfaces reuse one
credential** that arrives inside the `/run` payload. The runner holds no standing
Agenta credential of its own. It acts "as the caller" for the duration of a run and
refreshes that token through `/access/permissions/check`.

### Optional outbound: Daytona

`sandbox: "daytona"` makes the runner call the Daytona API (`DAYTONA_API_KEY`,
`DAYTONA_SNAPSHOT`, ...) and drive the harness through Daytona's preview proxy. For a
user-machine runner this is out of scope: the user's machine is the sandbox host.

## 3. What sandbox-agent provides vs what our runner adds

`sandbox-agent@0.4.2` (pinned in `services/runner/package.json`) provides exactly:
a daemon with an ACP session lifecycle (`createSession` → `prompt` → destroy), harness
process management (resolves `pi` → the `pi-acp` adapter, `claude` →
`claude-agent-acp`, installing Claude Code from Anthropic at runtime), two sandbox
providers (`local`, `daytona`), and platform CLI binaries. It provides nothing for
tracing, approvals, tool delivery, secret isolation, durable sessions, or credential
scoping.

Our runner layer adds, roughly in order of how expensive it would be to rebuild:

1. **The `/run` wire contract and event IR** (`src/protocol.ts`, 579 lines,
   hand-mirrored in `wire.py`, pinned by golden fixtures). Streaming framing: one
   NDJSON `{kind:"event"}` per event, exactly one terminal `{kind:"result"}`.
2. **Tracing** (`src/tracing/otel.ts`, `src/extensions/agenta.ts`). For Pi, a bundled
   extension turns Pi's in-process lifecycle events into the Agenta span tree with real
   per-call token usage. For Claude, the runner builds the same tree from the ACP event
   stream. Both nest under the caller's `traceparent`. The OTLP bearer is delivered as
   a read-once 0600 file, not an env var.
3. **Approvals and permissions** (`src/permission-plan.ts`, `src/responder.ts`,
   `src/engines/sandbox_agent/acp-interactions.ts`). One shared decision function
   (allow / ask / deny / allow_reads plus authored rules), an ACP permission responder,
   and (behind flags) parked gates: a pending approval holds the live session so the
   original tool call resumes with byte-exact arguments.
4. **Tool delivery** (`src/tools/*`). Pi gets native tools via the extension; Claude
   gets a loopback MCP delivery server; execution relays through one dispatcher that
   keeps the private half of every spec (call refs, callback auth, scoped secrets) in
   runner memory. Only public metadata ever enters the sandbox.
5. **Secret hygiene** (`src/engines/sandbox_agent/daemon.ts`). Managed runs clear all
   known provider env vars before applying the run's resolved secrets; sandbox infra
   creds are force-blanked; the compose service deliberately has no `env_file`.
6. **Session keep-alive and durable cwd** (`src/engines/sandbox_agent/session-pool.ts`,
   `mount.ts`). Flag-gated live-session pool (config fingerprint, history fingerprint,
   credential epoch, project-scoped keys) and a geesefs/S3 cwd mount signed per run via
   `/sessions/mounts/sign`.
7. **Operational hardening.** Loopback bind, optional token, crash-proof server
   process, Daytona auto-stop backstop, swallowed-Pi-error recovery
   (`src/engines/sandbox_agent/pi-error.ts`), `/health` identity and capability probes.
8. **Licensing enforcement** (`services/runner/docker/Dockerfile`, `docker/README.md`).
   Pi (MIT) is baked; Claude Code is never baked or redistributed, the daemon installs
   it from Anthropic at runtime; no credentials in images.

## 4. The auth landscape

All HTTP auth is decided in `api/oss/src/middlewares/auth.py`:

| Scheme | What it is | Scope | Fit for a user-hosted runner |
| --- | --- | --- | --- |
| `ApiKey <prefix>.<token>` | The only long-lived user-holdable credential. Hashed, project-scoped (`APIKeyDB.project_id` is required), optional expiry (column exists, not surfaced in the creation API) | Full RBAC of the creating user in that one project | Functionally yes; over-privileged |
| `Bearer` (SuperTokens session) | Browser sessions | Full 4-tuple | No (interactive only) |
| `Secret <jwt>` | Internal service-to-service token, HS256, ~15-minute TTL, minted by `sign_secret_token`, renewable via `/access/permissions/check` | Full project scope; signed with the same global `auth_key` as the admin key | Fine as the per-run token it already is; must not be handed out as a standing credential |
| `Access <key>` | Global admin, string-equality against `env.agenta.auth_key`, admin paths only | Superuser | Never |

Key gaps, verified:

- **No capability scoping exists.** `APIKeyDB` has no scope, permission, or allow-list
  columns. A key inherits its creator's full project RBAC: testsets, evaluations,
  secrets, deletes, everything. There is no way to mint a "trace ingest + tool gateway
  only" key today.
- **OTLP ingest has no separate credential.** `POST /otlp/v1/traces` runs through the
  same middleware and checks `Permission.EDIT_SPANS`.
- **Backend-to-runner auth is one global static token** (`AGENTA_RUNNER_TOKEN`),
  deployment-wide, not per user, project, or runner. No TLS or mTLS anywhere on the
  `/run` hop; `sidecar-trust-and-sandbox-enforcement` explicitly deferred both.
- The runner already proves the callback pattern works: it authenticates OTLP ingest,
  `/tools/call`, and the whole sessions plane with one project-scoped credential shipped
  in the payload.

## 5. Session and approval constraints that bind a remote runner

From `session-keepalive/`, `harness-session-resume/plan.md`, and
`approval-boundary/cold-replay-failure-report.md`:

- **The baseline is cold.** Every turn is one `/run`: create session, prompt once, tear
  down. The client resends the whole conversation each turn. The backend keeps session
  rows (streams, states, interactions); the runner is stateless per turn.
- **What survives teardown:** the cwd (geesefs mount over the object store). What does
  not: the harness's own session file (`~/.claude/projects/...jsonl`, Pi's
  `~/.pi/agent/sessions/`), which is the thing that gives the harness real memory.
- **Keep-alive and approval parking assume a single, always-up, co-located runner.**
  The live-session pool is in-memory per replica; a parked approval is a held
  in-process RPC. The docs are explicit: a pool miss (restart, multi-replica) degrades
  to cold replay, never fails. TTLs: idle 60s, parked approval 10 minutes, pool max 8.
- **Harness-session-resume ("option 3")** reopens the harness's own session file via
  ACP `session/load`. The file must exist on the disk the next sandbox sees. On a
  user's machine the runner's own disk persists naturally, which makes the local MVP
  variant (no storage work) a good fit. The durable variant (copy transcripts into the
  object-store mount, persist the harness session id on a backend sessions row) is what
  survives the machine dying, and it requires the runner to reach `/sessions/mounts/sign`.
- **Blocker for option 3:** `sandbox-agent@0.4.2` only issues `session/new`; resume
  needs a patch, the raw ACP passthrough, or an upstream PR.

## 6. Prior art inside the repo

- `sidecar-deployment-proposal/proposal.md` §5: "'Bring your own runner' cannot mean
  'any container with two endpoints.'" Prerequisites named there: a versioned protocol
  identifier, JSON schemas, shared golden fixtures, a conformance test, capability
  negotiation. §6a already sketches the external-runner path: point
  `AGENTA_RUNNER_URL` at an external service.
- `contract-versioning/README.md`: the runner advertises `protocol: 1` on `/health`,
  but no Python caller reads it. No skew guard exists. A fleet of user-updated runners
  makes this urgent.
- `remote-tools-delivery/`: the ngrok tunnel precedent (`discoverTunnelEndpoint`) used
  today for the Daytona mount path. A working in-repo pattern for crossing a network
  boundary.
- `subscription-sidecar/`: harness auth from a personal Claude/ChatGPT login instead of
  a vault key. On a self-managed run the `/run` payload carries no provider secret at
  all (`credentialMode` keeps ambient auth; `daemon.ts` clear-then-apply protects the
  managed path).
- `scratch/agent-coordination.md` standing rule: self-managed sidecars must keep
  working when model auth comes from local OAuth state; `request.secrets` is optional.

## 7. Facts that shape the proposal

1. The runner is a standalone pnpm package that runs via `tsx` with no compile step,
   already decoupled from the web workspace. Packaging it is a build problem, not an
   architecture problem.
2. The backend initiates the dispatch. That single fact is why v0 needs a tunnel and
   why the long-term design should reverse the connection.
3. Everything the runner needs from the backend after dispatch is plain outbound HTTPS
   to four endpoint families (tools, sessions, permissions check, OTLP), all already
   authenticated by one project-scoped credential.
4. The `/run` payload carries plaintext provider secrets. Whoever holds the runner URL
   and token receives vault keys. Multi-tenant routing must therefore bind a runner to
   exactly one project and only ever send it that project's runs.
5. Self-managed model auth (the user's own login or API key on their machine) removes
   the vault-keys-on-the-wire problem entirely, and it is the natural fit for the
   user-machine story anyway.
