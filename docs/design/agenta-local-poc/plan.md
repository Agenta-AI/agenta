# Implementation plan

## POC acceptance point

The POC is complete when a clean Linux machine can launch one distributable bundle,
configure one provider, create an agent, stream a Pi-backed conversation, restart the
application, and reopen its local agents and conversations without Docker or any Agenta
Cloud request.

The work is split into four stacked slices. Each slice must pass its exit gate before the
next slice begins. Do not hide an incomplete lower slice with mocks in a higher slice.

## Fixed implementation shape

The local product is a standalone project, not another API edition:

```text
services/local/
  AGENTS.md
  README.md
  pyproject.toml
  uv.lock
  scripts/
  packaging/
  databases/sqlite/migrations/
  src/agenta_local/
    entrypoints/
    apis/fastapi/
    core/
    dbs/sqlite/
    execution/sdk/
    stores/files/
  tests/pytest/{unit,integration,acceptance}/

web/agenta-local/
  package.json
  next.config.ts
  src/{pages,features,lib,styles}/
  tests/unit/
```

The service follows the same required dependency direction as `api/AGENTS.md`:

```text
Router -> Service -> DAO Interface -> DAO Implementation -> DB
```

Concrete dependencies are wired only by
`services/local/src/agenta_local/entrypoints/server.py`. The local project must not import
`api.oss`, `api.ee`, `oss.src` from the broad services project, or any platform DAO.

The SQLite implementations live at
`services/local/src/agenta_local/dbs/sqlite/`. Do not create
`api/oss/src/dbs/sqlite/`; that would claim to implement the full multi-tenant platform
contracts.

## Local Python project contract

Create `services/local/pyproject.toml` in Slice 1 and keep it independent from
`services/pyproject.toml`.

Runtime dependencies:

```text
agenta
fastapi>=0.139,<0.140
pydantic>=2,<3
uvicorn[standard]>=0.51,<0.52
httpx>=0.28,<0.29
sqlalchemy>=2,<3
aiosqlite>=0.20,<1
alembic>=1,<2
orjson>=3,<4
structlog>=26,<27
```

Development dependencies:

```text
pytest>=9,<10
pytest-asyncio>=1,<2
pytest-mock>=3,<4
pytest-xdist>=3,<4
```

Use Python `>=3.11,<3.14`, `uv_build`, a `src/agenta_local` package root, and these scripts:

```text
agenta-local-server  -> agenta_local.entrypoints.server:main
agenta-local         -> agenta_local.entrypoints.launcher:main
```

Generate and commit `services/local/uv.lock`. `services/local/AGENTS.md` must record the
layer direction, commands, local-only scope, and the prohibition on importing platform
API/service modules.

In checkout development, `[tool.uv.sources]` must override both local packages:

```text
agenta = { path = "../../sdks/python", editable = true }
agenta-client = { path = "../../clients/python", editable = true }
```

After locking, verify `uv.lock` resolves both names to those checkout paths. This prevents
tests from using a registry `agenta-client` while the bundle later installs the checkout
wheel.

Add local `[tool.pytest.ini_options]` with `addopts = "-ra"`, `asyncio_mode = "auto"`,
and `testpaths = ["tests/pytest"]`. This prevents tests run from `services/local` from
inheriting `services/pytest.ini`, whose HTML and xdist options belong to the broad services
project.

## Slice 1: prove and relocate one offline agent turn

### Goal

Remove uncertainty from the SDK-to-runner path before adding HTTP, storage, or UI. End
with the same cold Pi turn passing from a source checkout and from a directory that has no
repository or pnpm-store dependency.

Execute this slice as three bounded work packets:

1. **S1.1 Mapping and composition:** create the project, local DTO/interface, mapping,
   composition, and unit tests.
2. **S1.2 Live and replayed turn:** add the adapter, smoke script, live test, capture, and
   replay-runner test.
3. **S1.3 Runner relocation:** build the self-contained runner directory and pass the
   clean-VM gate.

### Files to add

```text
services/local/AGENTS.md
services/local/README.md
services/local/pyproject.toml
services/local/uv.lock
services/local/src/agenta_local/__init__.py
services/local/src/agenta_local/core/__init__.py
services/local/src/agenta_local/core/agents/__init__.py
services/local/src/agenta_local/core/agents/dtos.py
services/local/src/agenta_local/core/execution/__init__.py
services/local/src/agenta_local/core/execution/dtos.py
services/local/src/agenta_local/core/execution/interfaces.py
services/local/src/agenta_local/execution/__init__.py
services/local/src/agenta_local/execution/sdk/__init__.py
services/local/src/agenta_local/execution/sdk/composition.py
services/local/src/agenta_local/execution/sdk/mappings.py
services/local/src/agenta_local/execution/sdk/adapter.py
services/local/scripts/smoke_turn.py
services/local/packaging/runner/build_runner.py
services/local/packaging/runner/verify_runner.py
services/local/tests/pytest/unit/execution/test_revision_mapping.py
services/local/tests/pytest/unit/execution/test_composition.py
services/local/tests/pytest/integration/execution/test_cold_pi_turn.py
services/local/tests/pytest/integration/execution/test_tool_denial.py
services/local/tests/pytest/integration/execution/test_replay_cold_pi_turn.py
services/local/tests/pytest/utils/replay_runner.py
services/local/tests/fixtures/runner/cold_pi_turn.request.json
services/local/tests/fixtures/runner/cold_pi_turn.ndjson
services/local/tests/fixtures/runner/cold_pi_turn.result.json
```

### Symbols and responsibilities

`core/agents/dtos.py`:

- `AgentModel`: provider, model name, and extensible parameters.
- `AgentExecution`: fixed `harness="pi_core"` and `sandbox="local"` for the POC.
- `AgentRevision`: immutable revision data needed by execution. Persistence-only fields do
  not enter the SDK mapping.

`core/execution/dtos.py`:

- `ExecutionCredential`: provider, API key, optional base URL.
- `ExecutionMessage`: role and typed text content.
- `ExecutionEvent`: the existing Vercel event payload without local database fields.
- `ExecutionResult`: final assistant text after a clean source-stream exhaustion.
- `ExecutionStream`: `events` async iterator plus an awaitable `result()`.

`core/execution/interfaces.py`:

- `AgentExecutorInterface.stream(*, revision, messages, credential)` returns
  `ExecutionStream` without exposing SDK classes.

`execution/sdk/mappings.py`:

- `revision_to_agent_params(revision)`: produce the exact `AgentTemplate.from_params`
  shape in `contracts.md`.
- `messages_to_sdk(messages)`: convert local text messages to SDK messages.
- The mapping hardcodes empty tools, MCPs, and skills; `pi_core`; local sandbox; sidecar
  runner; and `runner.permissions.default=deny`.

`execution/sdk/composition.py`:

- `empty_tools_resolver(...)` returns `ResolvedToolSet()`.
- `empty_mcp_resolver(...)` returns `[]`.
- `build_composition(*, runner_url, credential)` creates a fresh
  `StaticConnectionResolver`, passes its `resolve` method into `AgentComposition`, and
  selects `SandboxAgentBackend(sandbox="local", url=runner_url)`.
- Do not use platform tool, MCP, vault, tracing, or session resolvers.

`execution/sdk/adapter.py`:

- `SDKAgentExecutor` implements `AgentExecutorInterface` around `make_agent_handler()`.
- Build `WorkflowServiceRequest` with streaming enabled and `session_id=None`.
- Pass full messages and revision parameters to the handler.
- Wrap the handler's neutral async iterator in an observer before passing it to
  `agent_stream_to_vercel_stream()`. The observer records neutral events, source
  exceptions, error events, and cancellation.
- `ExecutionStream.result()` succeeds only after clean neutral-stream exhaustion and
  derives text with `assistant_text(recorded_events)`. It raises on a neutral `error`
  event or source exception even though the Vercel projector emits protocol-closing
  `finish-step` and `finish` frames.
- Reuse the SDK Vercel stream projection. Do not add local IDs to the runner wire shape.
- Preserve cancellation and ensure closing projected events also closes the neutral
  iterator and runner HTTP stream.

`scripts/smoke_turn.py`:

- Accept runner URL, provider, model, and prompt as CLI arguments.
- Read the provider key from a provider-specific environment variable only for this
  Slice 1 developer tool.
- Print stream events and a redacted terminal summary; never print request headers,
  credentials, or the runner token.

### Runner source-checkout proof

Start the existing runner with one generated token shared by runner and Python processes:

```text
AGENTA_RUNNER_HOST=127.0.0.1
AGENTA_RUNNER_PORT=<selected loopback port>
AGENTA_RUNNER_TOKEN=<random 32-byte value>
AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS=local
AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER=local
AGENTA_SESSIONS_RECONSTRUCT=false
AGENTA_RUNNER_SESSION_KEEPALIVE=off
```

Construct the runner and smoke-process environments from an explicit allowlist rather than
copying the developer shell wholesale. Remove `AGENTA_API_*`, OTLP exporter variables,
Daytona settings, cloud credentials, unrelated `AGENTA_RUNNER_*`, and unrelated provider
keys. The smoke process receives only the selected provider credential; the runner receives
it through the existing resolved-connection request.

Run the runner through `corepack pnpm run serve` from `services/runner`. Run the smoke
script through `uv run --no-sync python scripts/smoke_turn.py` from `services/local` with
the same `AGENTA_RUNNER_TOKEN` in its environment. Wait for unauthenticated `GET /health`
for liveness, then call authenticated `GET /subscription-status` with the bearer token to
prove the service and runner share the same token before dispatching the turn.

Capture outbound network syscalls for the runner process tree with `strace -f -e
trace=network`. The evidence may contain loopback runner traffic, DNS to the machine's
configured resolver, and the selected model provider. Resolve provider hostnames when
classifying destination IPs. It must not contain Agenta API, PostgreSQL, Redis, S3,
SeaweedFS, or OTLP destinations.

### Relocatable runner proof

`packaging/runner/build_runner.py` creates a staging directory with:

```text
runner/
  package.json
  pnpm-lock.yaml
  patches/
  scripts/
  config/
  skills/
  src/
  dist/
  node_modules/
runtime/node/bin/node
licenses/runner/
```

The build script must:

1. Build `services/runner/dist` with `pnpm run build:extension`.
2. Copy runner source, package metadata, lockfile, patches, and built extension assets.
3. Run the same full `pnpm install --frozen-lockfile` as the production runner image. Do
   not use `--prod`: runtime execution needs the current devDependency `tsx`, and extension
   preparation needs `esbuild`.
4. Run `build:extension` and `scripts/patch-pi-validation-message.ts` in staging exactly
   as `services/runner/docker/Dockerfile.gh` does. Keep the scripts in the staged tree so
   the build is auditable.
5. Resolve an exact Node 24 Linux archive version, upstream URL, and SHA-256 before the
   first distributable build; record them in the generated manifest rather than treating
   `24.x` as a reproducible pin.
6. Launch with staged Node directly against `node_modules/tsx/dist/cli.mjs`; do not require
   `pnpm` or Corepack at runtime.
7. Verify that package symlinks resolve within the staging directory and not into the
   source checkout or pnpm store.
8. Emit dependency versions, native architecture/libc assumptions, required host
   utilities, SHA-256 checksums, and license texts.

`verify_runner.py` copies the staged tree to a path containing spaces, starts it with only
the staged Node runtime on `PATH`, runs the same cold turn, stops it, and asserts that no
runner, Pi, or sandbox-agent child remains. Run the final verification in a clean Linux VM.

### Tests to write

- `test_revision_mapping.py`: parse the output through `AgentTemplate.from_params()` and
  assert `pi_core`, local sandbox, no tools/MCPs/skills, and deny-by-default permissions.
- `test_composition.py`: patch all platform resolvers to fail if called; assert the static
  connection and HTTP `SandboxAgentBackend` paths are selected.
- `test_cold_pi_turn.py`: exercise a live runner, assert the request carries
  `sessionId: null` (the current SDK representation of an unowned cold turn), drain one
  complete stream, and confirm cleanup.
- `test_tool_denial.py`: assert the effective runner request denies every Pi built-in and
  run adversarial prompts against fixture files outside the working directory. No read,
  shell, edit, write, grep, find, or list operation may succeed.
- Capture one successful request/stream/result with the `agent-replay-test` procedure and
  redact provider values, runner tokens, paths, timestamps, and generated IDs.
- `test_replay_cold_pi_turn.py` starts the reusable `replay_runner.py` fixture, validates
  the exact outbound request against the redacted request fixture, emits the recorded
  NDJSON, and asserts the adapter's Vercel frames and final result without a live model.

### Commands and checks

From `services/runner`:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run build:extension
corepack pnpm test
corepack pnpm run typecheck
```

From `services/local`:

```bash
uv sync --locked
uv run --no-sync pytest tests/pytest/unit
uv run --no-sync pytest tests/pytest/integration/execution/test_cold_pi_turn.py
uv run --no-sync pytest tests/pytest/integration/execution/test_tool_denial.py
uv run --no-sync pytest tests/pytest/integration/execution/test_replay_cold_pi_turn.py
uv run --no-sync python packaging/runner/build_runner.py <staging-directory>
uv run --no-sync python packaging/runner/verify_runner.py <staged-runner>
```

### Exit gate

- One source-checkout turn and one relocatable-runner turn stream to completion.
- The request has `sessionId: null`, creates no platform-owned session, and calls no
  platform resolver.
- Non-loopback traffic is limited to configured DNS resolution and the selected provider.
- Missing credentials fail with the SDK's typed connection error.
- All Pi built-ins are denied and cannot read or modify host files.
- Process cleanup leaves no owned child alive.
- The replay fixture passes without a live model.

Stop before Slice 2 if a cold turn still requires platform APIs after three focused fixes,
or if the runner cannot execute outside the repository without a development toolchain.

## Slice 2: build the layered local service and SQLite adapters

### Goal

Persist the minimum product model around the proven executor and expose the local HTTP
contract. End with restart-safe agents and conversations through real API requests.

Execute this slice as five bounded work packets, each green before the next:

1. **S2.1 Schema and migration:** DBEs, initial migration, safe-copy migration runner,
   pragmas, and migration tests.
2. **S2.2 DAOs and core CRUD:** agent/session interfaces, immediate transactions,
   mappings, services, and concurrency tests.
3. **S2.3 Credential store:** provider interface/service, protected file adapter, and
   file-security tests.
4. **S2.4 Execution orchestration:** active-turn registry, stream lifecycle, replayed
   runner acceptance, and shutdown behavior.
5. **S2.5 HTTP and security:** route models, exception mapping, browser boundary, static
   mount seam, and route acceptance tests.

### Files to add

```text
services/local/src/agenta_local/config.py
services/local/src/agenta_local/lifespan.py
services/local/src/agenta_local/entrypoints/__init__.py
services/local/src/agenta_local/entrypoints/server.py

services/local/src/agenta_local/apis/__init__.py
services/local/src/agenta_local/apis/fastapi/__init__.py
services/local/src/agenta_local/apis/fastapi/app.py
services/local/src/agenta_local/apis/fastapi/errors.py
services/local/src/agenta_local/apis/fastapi/security.py
services/local/src/agenta_local/apis/fastapi/agents/{__init__.py,models.py,router.py}
services/local/src/agenta_local/apis/fastapi/sessions/{__init__.py,models.py,router.py}
services/local/src/agenta_local/apis/fastapi/providers/{__init__.py,models.py,router.py}
services/local/src/agenta_local/apis/fastapi/runtime/{__init__.py,models.py,router.py}

services/local/src/agenta_local/core/agents/{interfaces.py,service.py,types.py}
services/local/src/agenta_local/core/sessions/{__init__.py,dtos.py,interfaces.py,service.py,types.py}
services/local/src/agenta_local/core/providers/{__init__.py,dtos.py,interfaces.py,service.py,types.py}
services/local/src/agenta_local/core/execution/{service.py,types.py}

services/local/src/agenta_local/dbs/__init__.py
services/local/src/agenta_local/dbs/sqlite/__init__.py
services/local/src/agenta_local/dbs/sqlite/shared/{__init__.py,base.py,engine.py,types.py,exceptions.py}
services/local/src/agenta_local/dbs/sqlite/agents/{__init__.py,dbes.py,mappings.py,dao.py}
services/local/src/agenta_local/dbs/sqlite/sessions/{__init__.py,dbes.py,mappings.py,dao.py}

services/local/src/agenta_local/stores/__init__.py
services/local/src/agenta_local/stores/files/__init__.py
services/local/src/agenta_local/stores/files/providers.py

services/local/databases/sqlite/migrations/alembic.ini
services/local/databases/sqlite/migrations/env.py
services/local/databases/sqlite/migrations/script.py.mako
services/local/databases/sqlite/migrations/runner.py
services/local/databases/sqlite/migrations/versions/0001_initial_local_schema.py
```

Add unit, integration, and acceptance tests under the existing Slice 1 test tree rather
than beside source files.

### Configuration and paths

`config.py` defines one immutable `LocalSettings` loaded by the composition root. It owns:

- loopback host and selected service port;
- runner URL and runner token;
- application-data, state/log, database, and provider-file paths;
- renderer asset path;
- startup and shutdown deadlines;
- application version.

The launcher may supply these through arguments or environment, but feature modules may
not call `os.getenv()` directly. On Linux, default mutable paths follow XDG conventions:

```text
${XDG_DATA_HOME:-~/.local/share}/agenta-local/local.db
${XDG_DATA_HOME:-~/.local/share}/agenta-local/providers.json
${XDG_STATE_HOME:-~/.local/state}/agenta-local/logs/
```

Create data and state directories with mode `0700` before opening files.

### Core domains

Implement the exact interfaces in `contracts.md`:

- `AgentsDAOInterface` and `AgentsService` own agent metadata and immutable revisions.
- `SessionsDAOInterface` and `SessionsService` own session/history reads and transactional
  turn records.
- `ProviderCredentialsStoreInterface` and `ProvidersService` own redacted provider state.
- `AgentExecutorInterface` remains the SDK seam from Slice 1.
- `ExecutionService` orchestrates one streamed turn and owns the in-memory
  `dict[session_id, ActiveTurn]` registry guarded by an async lock.

Core services return typed DTOs and raise domain exceptions. They never import FastAPI,
SQLAlchemy, Alembic, or concrete adapters.

### SQLite implementation

`dbs/sqlite/shared/base.py` owns SQLAlchemy declarative metadata.
`dbs/sqlite/shared/engine.py` builds one async engine/session maker and installs connection
hooks for:

```text
PRAGMA foreign_keys=ON
PRAGMA journal_mode=WAL
PRAGMA busy_timeout=5000
```

The concrete classes are `AgentsDAO(AgentsDAOInterface)` and
`SessionsDAO(SessionsDAOInterface)`. Keep SQLAlchemy entities in `dbes.py`; keep all DTO
conversion in `mappings.py`; do not return DBEs above the adapter.

`dbs/sqlite/shared/engine.py` also provides one bounded `immediate_transaction()` helper
that issues `BEGIN IMMEDIATE` before invariant reads, commits on success, and rolls back on
failure. Use it for `create_agent`, `commit_revision`, `begin_turn`, every terminal turn
transition, and startup recovery. Do not use a default deferred `session.begin()` for
read-then-write allocation.

The initial migration creates the five records in `contracts.md` and:

- foreign keys for revisions, sessions, messages, and turns;
- unique `(agent_id, version)`;
- unique `(session_id, sequence)`;
- unique `(session_id, client_turn_id)`;
- partial unique index on `turns(session_id)` where status is `pending` or `running`;
- check constraints for message roles and turn statuses;
- a trigger rejecting updates to `agent_revisions`;
- a trigger rejecting changes to `sessions.agent_revision_id`;
- deferrable, initially deferred foreign keys for the non-null
  `agents.current_revision_id` / `agent_revisions.agent_id` creation cycle.

Use file-backed temporary databases in integration tests, not `:memory:`. Every DAO
operation that spans records must use `immediate_transaction()`. Map unique-index races by
re-reading the conflicting row and raising the stable domain outcome. Retry `database is
locked` only within one bounded adapter policy, then raise retryable `StorageBusy`; do not
scatter retries through services. `begin_turn` must check idempotency before session-busy
so an exact duplicate returns its existing turn rather than the unrelated busy response.

### Migration and startup order

`databases/sqlite/migrations/runner.py` exposes `upgrade_database(database_path)`.
`lifespan.py` runs this order before readiness:

1. Resolve and secure local directories.
2. With no application database connections open, handle the source once. If `local.db`
   exists, checkpoint/truncate its WAL, use Python's SQLite backup API to create and fsync
   a separate versioned pristine backup, then copy that closed backup to a distinct
   migration-candidate path. If this is first launch, create an empty candidate.
3. Run Alembic programmatically against the candidate and pass its database path
   directly through the Alembic config. Do not depend on a CLI-only environment variable.
4. Run `PRAGMA integrity_check` on the migrated candidate, fsync it, and close all handles.
5. After an existing source has been checkpointed, remove its stale `-wal`/`-shm`
   sidecars. For both existing and first-launch databases, perform one
   `os.replace(candidate, local.db)` and fsync the parent directory. Never rename the
   original out of place first. A crash before replacement leaves the original path valid;
   a crash after replacement leaves the migrated database valid and, for upgrades, the
   pristine backup available.
6. Open the async engine and verify foreign keys are active.
7. Call `interrupt_incomplete_turns()` through an immediate write transaction.
8. Verify unauthenticated runner liveness and authenticated token readiness through
   `GET /subscription-status`.
9. Mark the local service ready.

If migration fails, do not report readiness or serve the renderer. Preserve the original
database and report both its path and the migration log path. Slice 2 tests fresh and
no-op `0001` migration; migration-from-previous-version testing begins when `0002` exists.

### Provider file adapter

`stores/files/providers.py` implements `ProviderCredentialsStoreInterface`. The on-disk
JSON is versioned and contains provider, API key, and optional base URL. Writes must:

1. Open a same-directory random temporary name with exclusive create, no-follow, and mode
   `0600`.
2. Write the complete replacement and fsync the file.
3. Atomically replace `providers.json`.
4. Fsync the parent directory.

One process-wide async lock guards every provider read, put, and delete so two provider
updates cannot lose each other. Reads use `O_NOFOLLOW`, verify through `fstat` that the
target is a regular file owned by the current user with mode `0600`, and reject unsafe
files instead of repairing them silently.

Reads exposed over HTTP return only provider, configured state, and a redacted suffix.
Only `ExecutionService` calls `get_for_execution`.

### HTTP layer and security

`apis/fastapi/app.py` receives already-built services and mounts the route classes. Each
domain has explicit Pydantic request/response models and operation IDs. List responses use
`{count, items}` and single-resource responses use `{item}`. Errors use
`{code, message, retryable, next_step?, details?}`.

Implement every route listed in `contracts.md`. The turn route returns the existing
Vercel SSE vocabulary and always emits one terminal event before closing when the client
is still connected.

`POST /api/runtime/shutdown` sets the application's shutdown event. It first stops new
turn admission and completes the graceful service-shutdown sequence; process exit tells
the supervising launcher to stop the runner. Pre-readiness migration or runner failures
cannot render a web screen because the service is not ready: the launcher reports those
failures in its terminal/status output with the relevant log path. Renderer banners are
for failures after HTTP readiness.

`security.py` enforces:

- exact selected `Host`;
- exact same-origin `Origin` on mutations and stream requests;
- `application/json` on mutations;
- one random process-lifetime cookie with `HttpOnly`, `SameSite=Strict`, and `Path=/`;
- `Referrer-Policy: no-referrer`;
- no broad CORS middleware.

The cookie is set on an initial same-origin HTML request and rotated at every service
start. The runner URL/token and raw provider credentials never enter any response.
HTML navigation responses and `/api/runtime` use `Cache-Control: no-store`, and HTML
responses refresh the process cookie when it is absent or stale. Hashed static assets may
use immutable caching. Mount `/health` and `/api/*` before the renderer catch-all.

### Turn orchestration

`ExecutionService.stream_turn` performs this order:

1. Normalize and hash input.
2. Call `SessionsDAO.begin_turn`.
3. Resolve the bound immutable revision and provider credential.
4. Register `ActiveTurn(turn_id, asyncio.current_task(), reason=None)` under the registry
   lock before calling `mark_turn_running`; if transition fails, remove that exact entry.
5. Load completed context and invoke `AgentExecutorInterface.stream`.
6. Forward Vercel events without persisting partial assistant deltas, then await
   `ExecutionStream.result()`; never infer success from a Vercel `finish` frame.
7. On successful `result()`, call `complete_turn` with final assistant text.
8. On provider/runner failure, call `fail_turn` with a redacted typed error.
9. On explicit stop, set the active entry's reason to `cancelled` under the lock, then
   cancel its task. The cancellation handler closes the execution stream and calls
   `cancel_turn`.
10. A disconnect watcher or service shutdown sets reason `interrupted` before cancelling;
    an unexpected `CancelledError` defaults to interrupted. The same handler closes
    upstream work and calls `interrupt_turn`.
11. Remove the active registry entry in `finally` only if its turn ID still matches.

Exactly one terminal transition may win. A losing cancellation/failure path reads the
already-terminal row and performs no second transition.

On service shutdown, stop accepting turns, cancel and await every active stream, persist
`interrupted`, dispose the SQLite engine, and only then let the process exit. The launcher
stops the runner after the service has completed this graceful phase.

### Tests to write

Unit tests:

- every core service against fake interfaces;
- domain exception to HTTP mapping;
- input normalization/hash;
- completed-turn-only context selection;
- stream success, failure, cancellation, disconnect, and cleanup;
- provider redaction and log redaction;
- Host, Origin, content-type, and cookie policy.

SQLite integration tests:

- fresh and no-op migration tests for `0001`; add previous-version coverage with `0002`;
- migration failure preserves the original file;
- WAL, busy timeout, and foreign keys on every connection;
- atomic first revision and atomic revision version allocation;
- immutable revision and session binding triggers;
- deterministic message ordering;
- exact and conflicting client-turn ID reuse;
- partial unique index rejects a second active turn;
- completion writes assistant message and terminal state together;
- failed/cancelled/interrupted messages remain visible but leave later context;
- startup recovery marks incomplete turns interrupted;
- restart persistence with a newly constructed engine and services;
- two-connection races for revision allocation, message sequence allocation, duplicate
  client IDs, and active-turn creation return domain outcomes rather than raw lock or
  integrity errors.

Acceptance tests:

- every HTTP route through the real composition root and temporary application directory;
- one complete streamed turn against the replayed Slice 1 runner fixture;
- stop closes the upstream stream and records one terminal state;
- responses/logs/database/browser-facing payloads contain no provider or runner secret;
- no platform API, Redis, PostgreSQL, S3, or SeaweedFS client is invoked. SDK modules may
  import platform-capable symbols eagerly, but injected local composition must ensure
  those clients and resolvers perform no call.
- source and acceptance processes do not inherit platform, telemetry, or unrelated
  credential variables from the parent shell.

### Commands and checks

From `services/local`:

```bash
uv lock
uv sync --locked
uv run --no-sync pytest tests/pytest/unit
uv run --no-sync pytest tests/pytest/integration
uv run --no-sync pytest tests/pytest/acceptance
uv run --no-sync python databases/sqlite/migrations/runner.py --database <temp-db>
```

Run the repository's pinned Ruff formatter/checker over `services/local` before commit.
Start the service through `uv run --no-sync agenta-local-server`, not by importing a DAO
from an ad hoc script.

### Exit gate

- All routes and database constraints pass automated tests.
- Restart preserves agents, revisions, sessions, messages, and terminal turn states.
- Failed/interrupted turns cannot appear as completed or enter later model context.
- Duplicate submissions cannot execute twice.
- Cancellation closes runner work and stores exactly one terminal state.
- Credentials and runner tokens appear in no API response, log, or SQLite row.
- The service listens only on loopback and rejects wrong Host/Origin requests.

## Slice 3: build the narrow local renderer

### Goal

Prove the local product experience without rehosting the full Agenta frontend or its auth,
organization, project, RBAC, evaluation, and observability graph.

Execute this slice as three bounded work packets:

1. **S3.1 Host and client:** workspace wiring, static host, same-origin API client,
   schemas, stream parser, theme, and route tests.
2. **S3.2 Provider and agent flow:** provider setup, agent list/editor, revisions, and
   first-run states.
3. **S3.3 Conversation flow:** sessions, messages, composer, streaming, stop/retry, Quit,
   and real-service acceptance.

### Application choice

Create `web/agenta-local` beside `web/mobile`, `web/oss`, and `web/ee`. Use Next.js Pages
Router with `output: "export"` and `trailingSlash: true`; all data loads client-side from
the same-origin local API. Use fixed routes and query parameters rather than dynamic
build-time routes:

```text
/                       redirect/select first useful screen
/agents                 list and editor; selected agent in ?agent_id=
/sessions               list and conversation; selected session in ?session_id=
/providers              provider setup
```

FastAPI mounts `/health` and `/api/*` first, then mounts the exported `out/` directory at
`/` with HTML directory handling. `trailingSlash: true` emits `agents/index.html`,
`sessions/index.html`, and `providers/index.html`, so direct navigation and refresh work
without rewrite guesses. Route tests request all four paths from the FastAPI-mounted
export. This avoids a third managed server process and guarantees one browser origin.

Add `agenta-local` to `web/package.json` workspaces and `web/pnpm-workspace.yaml`. Add root
scripts `build-local`, `lint-local`, `type-check-local`, and `test-local`, each filtering
`@agenta/local`. Development uses a static build served by the real local service; do not
introduce a permissive cross-origin Next dev proxy.

### Files to add

```text
web/agenta-local/AGENTS.md
web/agenta-local/package.json
web/agenta-local/next.config.ts
web/agenta-local/tsconfig.json
web/agenta-local/eslint.config.mjs
web/agenta-local/vitest.config.ts
web/agenta-local/postcss.config.mjs
web/agenta-local/next-env.d.ts
web/agenta-local/public/assets/{favicon.ico,agenta-symbol.svg}
web/agenta-local/src/pages/{_app.tsx,_document.tsx,index.tsx,agents.tsx,sessions.tsx,providers.tsx}
web/agenta-local/src/features/app/{AppProviders.tsx,AppShell.tsx,Navigation.tsx,ThemeProvider.tsx}
web/agenta-local/src/features/agents/{AgentList.tsx,AgentEditor.tsx,AgentRevisionBadge.tsx}
web/agenta-local/src/features/agents/states/{AgentListSkeleton.tsx,AgentListEmpty.tsx,AgentListError.tsx}
web/agenta-local/src/features/sessions/{SessionList.tsx,Conversation.tsx,MessageList.tsx,Composer.tsx,StopButton.tsx}
web/agenta-local/src/features/sessions/states/{ConversationEmpty.tsx,ConversationError.tsx,ConversationSkeleton.tsx}
web/agenta-local/src/features/providers/{ProviderList.tsx,ProviderForm.tsx}
web/agenta-local/src/features/runtime/{RuntimeBanner.tsx,StartupFailure.tsx}
web/agenta-local/src/lib/api/{client.ts,schemas.ts,stream.ts,types.ts}
web/agenta-local/src/lib/state/{agents.ts,sessions.ts,providers.ts,runtime.ts}
web/agenta-local/src/styles/globals.css
web/agenta-local/tests/unit/{client.test.ts,stream.test.ts,turnState.test.ts,routes.test.ts}
```

### Frontend dependencies

Declare only what this host uses:

```text
@agenta/shared
@agenta/ui
@ant-design/icons
@tanstack/react-query
@tailwindcss/postcss
antd
jotai
jotai-tanstack-query
next
react
react-dom
tailwindcss
zod
```

Use `@agenta/ui` through narrow exported subpaths plus Ant Design primitives. Import
`@agenta/ui/theme-variables.css`, configure light/dark Ant Design algorithms in
`ThemeProvider`, and use semantic theme/Tailwind tokens. Build the POC message list and a
plain textarea composer in this app; do not import the package chat composer, attachment
engine, Lexical editor, platform session state, or compatibility shims.

`next.config.ts` must list the TypeScript-source package closure in `transpilePackages`
(`@agenta/shared` and `@agenta/ui`) and set the workspace tracing root. Add
`@agenta/local#build` to `web/turbo.json` with dependency edges to shared/UI builds,
inputs for source/public/config, and `out/**` as output. Add matching local lint,
types-check, and test tasks; the package scripts are `build`, `lint`, `types:check`, and
`test` and are the targets of the root scripts above.

Because Tailwind v4 does not scan dependency source automatically, `globals.css` must add
an explicit `@source "../../node_modules/@agenta/ui/src/**/*.{ts,tsx}"` for selected UI
subpaths and import the shared theme-variable stylesheet. A renderer style test must
confirm representative imported controls retain generated classes in the production
export.

`web/agenta-local/AGENTS.md` documents one scoped transport exception: this app talks to
the separate local-only API, not the platform OpenAPI/Fern API. `lib/api/client.ts` may use
same-origin `fetch` with Zod validation at the boundary; no package code may import it.
`lib/api/stream.ts` is the only SSE parser and consumes the existing Vercel event
vocabulary. Do not point a Fern platform client at the local service.

### State and data flow

`AppProviders` must use the shared `@agenta/shared/api` QueryClient singleton and hydrate
the Jotai query-client atom with that same instance. Do not construct another
`QueryClient`.

Feature state files expose query atoms and mutation functions:

- `agents.ts`: list, selected agent, create, commit revision, invalidate list/detail.
- `sessions.ts`: list, selected session, create, stream turn, stop, refresh after terminal
  event.
- `providers.ts`: configured states and write/delete mutations.
- `runtime.ts`: service/runner health and application version.

Persist only theme preference. Agent/session selection remains in URL query parameters.
Provider keys, runner details, messages, and drafts must not enter localStorage or
IndexedDB.

### Product behavior

- First launch with no provider opens provider setup.
- Agent creation requires name, instructions, provider, and model and creates revision 1.
- Saving a changed executable configuration commits a new revision; renaming changes
  metadata only.
- Creating a session binds the current immutable revision and displays its version.
- Conversation streams incremental text, supports stop, and keeps the draft after errors.
- Failed, cancelled, and interrupted turns remain visible with status and retry creates a
  new `client_turn_id`.
- `Open Agenta Cloud` uses a normal external browser link and shares no local state.
- `Quit Agenta Local` calls the authenticated same-origin runtime shutdown route and
  shows a closing state. Closing an arbitrary browser tab is not treated as application
  shutdown.
- Runtime errors name the failing layer and link to the local log path returned by the
  launcher-safe runtime endpoint.

### Tests to write

- Zod validation for every local response and stable error shape.
- SSE parsing for text deltas, completion, provider error, runner error, denied tool,
  cancellation, and disconnect.
- Query invalidation after create, revision commit, terminal turn, and provider update.
- URL selection hydration after refresh.
- Direct HTTP navigation to `/`, `/agents/`, `/sessions/`, and `/providers/` against the
  FastAPI-mounted export.
- First-run provider routing and no-agent/no-session empty states.
- Duplicate submit disables the composer until the prior request resolves.
- Stop issues one request and renders the server's terminal state.
- No credential is written to storage, URL, or logs.
- Stale/missing process cookies recover on a no-store HTML navigation after service restart.
- Light/dark readable snapshots and keyboard/responsive checks for core screens.
- Integration test against the real local service with the replayed runner stream.

### Commands and checks

From `web`:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @agenta/local lint
corepack pnpm --filter @agenta/local types:check
corepack pnpm --filter @agenta/local test
corepack pnpm --filter @agenta/local build
corepack pnpm test-local
corepack pnpm lint-fix
```

From `services/local`, run the acceptance test that serves `web/agenta-local/out` and
drives the real HTTP contract with the replay fixture.

### Exit gate

- A first-time user completes provider -> agent -> session -> streamed turn without a
  terminal after launch.
- Completion, failure, cancellation, disconnect, retry, and denied-tool states render.
- Refresh preserves the selected agent/session through the URL and hydrates data from the
  API, not browser storage.
- Light and dark themes are readable on desktop and narrow mobile widths.
- The built renderer is static, served by the local service, and makes no Cloud request.
- No secret enters browser storage, URL parameters, HTML, or renderer logs.

## Slice 4: supervise and bundle managed runtimes

### Goal

Produce a relocatable Linux directory archive that runs on a machine without system
Python, Node, pnpm, Docker, PostgreSQL, or Redis. AppImage may be evaluated afterward; the
directory archive is the required POC artifact because it keeps runtime failures visible.

Execute this slice as three bounded work packets:

1. **S4.1 Python payload:** pin runtimes, build non-editable local wheels, install the
   locked target tree, copy renderer/migrations/runner, and verify relocation.
2. **S4.2 Launcher:** paths, logs, ports, readiness, graceful shutdown ordering, and unit
   tests.
3. **S4.3 Final artifact:** checksums/licenses, read-only install, clean-VM journey,
   restart, replacement install, process cleanup, and network evidence.

### Files to add

```text
services/local/src/agenta_local/entrypoints/launcher.py
services/local/src/agenta_local/launcher/{__init__.py,paths.py,lock.py,ports.py,processes.py,health.py,logs.py}
services/local/packaging/linux/build_bundle.py
services/local/packaging/linux/verify_bundle.py
services/local/packaging/linux/manifest.json
services/local/packaging/linux/THIRD_PARTY_NOTICES.md
services/local/tests/pytest/unit/launcher/{test_paths.py,test_lock.py,test_ports.py,test_processes.py,test_logs.py}
services/local/tests/pytest/acceptance/test_linux_bundle.py
```

Update `services/local/pyproject.toml` to include migration assets and version metadata in
the installed target.

### Bundle layout

`build_bundle.py` produces:

```text
dist/agenta-local-linux-x64/
  bin/agenta-local
  app/python/site-packages/
  app/web/
  app/migrations/
  runner/{src,dist,node_modules,package.json}
  runtime/python/bin/python3
  runtime/node/bin/node
  licenses/
  manifest.json
  SHA256SUMS
```

Use a pinned Linux `python-build-standalone` CPython distribution and the exact Node 24
distribution pinned in Slice 1. Build ordinary, non-editable wheels for `clients/python`
(`agenta-client`), `sdks/python` (`agenta`), and `services/local` (`agenta-local`). Export
the exact third-party resolution from `services/local/uv.lock`, then install those wheels
and locked dependencies into `app/python/site-packages` with `uv pip install --target`.
Exclude the three local package names from exported third-party requirements and install
their wheels with `--no-deps`.
Do not install editable sources or ship a venv with absolute shebangs. Fail the build if
the target contains `.pth` files, editable metadata, or paths back to the checkout.

Copy `web/agenta-local/out` into `app/web`, the migration tree into `app/migrations`, and
the verified Slice 1 runner tree into `runner`. `bin/agenta-local` is a relocatable POSIX
wrapper that resolves its own directory and execs the staged Python runtime with
`-m agenta_local.entrypoints.launcher`; it must set
`PYTHONPATH=$ROOT/app/python/site-packages`, `PYTHONNOUSERSITE=1`, and
`PYTHONDONTWRITEBYTECODE=1`, and must not use an absolute generated shebang.

The build is allowed to use the repository toolchain and network. The produced directory
is not. Record source URLs, versions, hashes, licenses, target architecture, minimum libc,
and required host utilities in the manifest/notices.

### Launcher behavior

`entrypoints/launcher.py` is the only user-facing command. It must:

1. Resolve installation, XDG data, XDG state, and log directories without depending on
   current working directory.
2. Open a mode-0600 workspace lock file in the XDG data directory and acquire a
   non-blocking exclusive OS lock before starting children or touching SQLite. Hold it for
   the launcher lifetime, pass the inherited descriptor to the service with `pass_fds`,
   and have the service keep it open through migrations and shutdown. A directly launched
   server acquires the same lock itself. A second launch exits without starting children
   and reports that the workspace is already running; a stale unlocked file is rewritten.
3. Generate a new runner token and browser session value in memory on every launch.
4. Build separate runner and service environments from an explicit allowlist of required
   host process variables plus the local variables in this plan. Do not inherit provider
   API keys, `AGENTA_API_*`, OTLP exporter settings, Daytona settings, cloud credentials,
   or unrelated `AGENTA_RUNNER_*` values from the launching shell.
5. Choose loopback ports, retrying on `EADDRINUSE` rather than assuming a probe reserves
   the port.
6. Start the runner with the exact Slice 1 environment and redirect stdout/stderr to a
   timestamped runner log.
7. Poll unauthenticated `/health`, then authenticated `/subscription-status`, until the
   readiness deadline; on failure, stop its process group and report the log path.
8. Start staged Python with `-m agenta_local.entrypoints.server` and explicit data paths,
   renderer/migration paths, runner URL/token, and selected host/port; redirect output to
   the service log.
9. Poll local-service readiness until migrations, recovery, and runner health complete.
10. Open the exact loopback UI URL in the system browser.
11. On SIGINT, SIGTERM, or the UI Quit route, ask the service to stop accepting turns,
    cancel/await streams, persist interrupted states, and close SQLite. Wait for that
    deadline before terminating the runner process group. Force-kill each layer only after
    its own deadline and only within launcher-owned process groups.

Use `subprocess.Popen` argument arrays with `shell=False` and new process sessions. Never
put credentials or tokens in command-line arguments, URLs, logs, crash reports, or the
manifest; pass ephemeral secrets in child environments.

### Upgrade and uninstall behavior

- Installation files are read-only after extraction.
- All mutable state stays under XDG data/state paths.
- Startup runs forward-only Alembic migrations and preserves a pre-upgrade database copy.
- Replacing the installation directory keeps user data.
- Uninstall removes installation files only unless the user explicitly requests local
  data deletion; the POC does not implement a destructive delete command.

### Tests to write

- Paths with spaces and a read-only installation directory.
- Missing/corrupt Python runtime, Node runtime, runner, renderer, and migration assets
  each name the failing component and log path.
- Runner and service port collision retry.
- A second launcher cannot start children, migrate, or replace the active workspace
  database; a stale unlocked lock file does not block recovery.
- Runner health timeout prevents service startup.
- Service health timeout stops the runner.
- SIGINT, SIGTERM, the explicit UI Quit action, and forced child failure leave no owned
  processes; closing an arbitrary browser tab has no lifecycle meaning.
- First launch, provider setup, agent creation, streamed turn, full shutdown, restart, and
  history reopen on a clean VM.
- Replacing the installation at the same `0001` schema preserves user data and performs a
  no-op migration; add a real prior-schema upgrade case when `0002` exists.
- Local-only network, loopback listeners, secret redaction, and Pi tool denial repeat
  against the final artifact.

### Commands and checks

From `services/local`:

```bash
uv run --no-sync python packaging/linux/build_bundle.py
uv run --no-sync python packaging/linux/verify_bundle.py dist/agenta-local-linux-x64
uv run --no-sync pytest tests/pytest/unit/launcher
uv run --no-sync pytest tests/pytest/acceptance/test_linux_bundle.py
```

Run the clean-VM acceptance with no repository mount and no system development runtimes.
Archive the result and `SHA256SUMS` only after the VM test passes.

### Exit gate

- A clean Linux VM launches the bundle with no system Python, Node, pnpm, or Docker.
- Startup reaches a healthy UI or names the failed child and exact log path.
- The complete target journey works, survives full shutdown, and reopens persisted state.
- Closing the launcher terminates every owned Python, Node, Pi, and sandbox-agent process.
- Replacing the installation does not delete or relocate the local workspace.
- Final network evidence contains only loopback, configured DNS, and the selected model
  provider.

## Optional follow-up: Electron presentation shell

Electron is not part of POC acceptance. If the four slices pass, a separate design may add
a thin shell that launches the same bundle, loads the loopback URL, disables Node
integration, enables context isolation and sandboxing, blocks arbitrary navigation/new
windows, and exposes only lifecycle/external-link actions through a typed preload bridge.
Removing Electron must leave the complete browser POC usable.

## Cross-slice validation order

Run checks in this order so a failure identifies its owner:

1. Runner unit tests, type check, extension build, liveness, and authenticated readiness.
2. Local SDK mapping/composition unit tests.
3. Live cold-turn integration and replay fixture.
4. SQLite migrations and DAO integration tests.
5. Core service and FastAPI tests.
6. Renderer unit, type, lint, and static build checks.
7. Renderer plus real local service plus replayed runner acceptance.
8. Live provider smoke through the full source stack.
9. Relocatable runner clean-VM test.
10. Final bundle clean-VM test.

Detailed product scenarios and evidence requirements remain in `qa.md`.

## Suggested stacked PR boundaries

1. `test(agent): prove standalone cold runner turns`
2. `feat(local): add core services and SQLite adapters`
3. `feat(frontend): add the Agenta Local renderer`
4. `build(local): bundle managed runtimes and launcher`
5. Optional: `feat(desktop): wrap Agenta Local in Electron`

Each branch builds on the previous one. Every branch must pass its own tests at its own tip;
do not place a test below the first branch containing every symbol it exercises.

## Decisions deliberately deferred

- OS keychain integration.
- Electron and native desktop-window integration.
- macOS and Windows packaging.
- Cloud login inside the desktop shell.
- Local and cloud workspace switching in one renderer.
- Publish, pull, merge, and synchronization semantics.
- Cloud agents that execute on a registered local runner.
- Filesystem tools, attachments, mounts, and workspace selection.
- Warm sessions, resumable approvals, and background agents.
- Claude Code, Codex, and subscription-based harness authentication.
