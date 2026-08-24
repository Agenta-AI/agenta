# Research

## The current local deployment is a server deployment

`hosting/docker-compose/oss/docker-compose.gh.yml` runs the current OSS product with
published images. The agent path still depends on the API, workflow service, runner,
PostgreSQL, Redis, SuperTokens, SeaweedFS, workers, migrations, and a proxy. The API
composition in `api/entrypoints/routers.py` imports auth, tracing, evaluations, sessions,
workers, and tenant-scoped services in one application.

Removing containers does not remove those dependencies. Installing all of them as native
host processes would create a larger and less reliable installer than Docker Compose.

## The reusable execution path is smaller than the platform

The Python SDK already provides the main local execution boundary:

- `sdks/python/agenta/sdk/agents/handler.py` builds an agent handler from an injectable
  `AgentComposition`.
- `sdks/python/agenta/sdk/agents/connections/resolver.py` resolves credentials from the
  environment or explicit values without platform calls.
- `sdks/python/agenta/sdk/agents/adapters/sandbox_agent.py` sends a run to the Node runner
  over HTTP or a subprocess transport.
- `sdks/python/agenta/sdk/agents/utils/wire.py` and
  `services/runner/src/protocol.ts` define the shared Python and TypeScript wire contract.
- `sdks/python/agenta/sdk/agents/adapters/vercel/stream.py` and `sse.py` project runner
  events into UI-ready streaming frames.
- `services/runner/src/engines/sandbox_agent/` owns the current sandbox-agent execution
  engine.

`services/oss/src/agent/app.py` demonstrates how the production service composes these
pieces. Its platform connection resolver, authentication wrapper, tools, mounts, and
tracing are not required for the POC.

## The runner must receive cold turns first

The current runner treats a platform `sessionId` as a signal to use platform-owned
session features. Those features include ownership heartbeats, record reconstruction,
interactions, attachments, turn ledgers, and mount signing.

The POC should own its session ID in SQLite but pass `session_id=None` to the SDK. The
current wire encoder emits `sessionId: null`, which the runner treats as an unowned cold
turn. The local service should send the full conversation on every turn. The runner then
returns events without depending on the Agenta API.

The POC runner environment must set:

```text
AGENTA_SESSIONS_RECONSTRUCT=false
AGENTA_RUNNER_SESSION_KEEPALIVE=off
```

This choice defers warm conversations and cross-turn approval state. It removes the
largest hidden dependency on the platform API.

## Pi is not tool-free by default

`sdks/python/agenta/sdk/agents/pi_builtins.py` activates `read`, `bash`, `edit`, `write`,
`grep`, `find`, and `ls` for every Pi run. An empty Agenta `tools` list does not remove
those built-ins. The local sandbox also runs on the host and does not enforce a filesystem
root.

The POC must therefore send `runner.permissions.default=deny` on every run and allow no
permission rules. It is a text-only agent POC. Filesystem and shell tools remain out of
scope until a later design can prove that the agent cannot read the secrets file or escape
its selected workspace.

## Local persistence should be new, small, and house-shaped

The existing persistence layer is designed for multi-tenant, revisioned platform data in
PostgreSQL. Porting its DAOs to SQLite would also port tenant scope, RBAC assumptions,
tracing storage, and migration history that the local POC does not need.

A POC-specific SQLite repository should store only agents, immutable agent revisions,
sessions, and messages. SQLite WAL mode and foreign-key enforcement are sufficient for a
single local process. Provider credentials should live in a mode-0600 secrets file for
the POC and move to an OS keychain during productization.

The right location is `services/local/src/agenta_local/dbs/sqlite/`, behind local core
interfaces in `services/local/src/agenta_local/core/`. This preserves Agenta's required
Router -> Service -> DAO Interface -> DAO Implementation -> DB direction while keeping
the product boundary honest.

`api/oss/src/dbs/sqlite/` is the wrong location for this POC. The existing
`GitDAOInterface` and workflow DTOs model artifacts, variants, revisions, tenant scope,
forks, archives, environments, and watch events. Existing session interfaces model
Redis-coordinated streams, platform records, interactions, mounts, heartbeats, and trace
identifiers rather than authoritative local chat messages and turn idempotency. Existing
vault interfaces model organization/project scope, multiple secret kinds, caches, and
managed-secret policy. Implementing those contracts in SQLite would recreate a smaller
platform deployment instead of the local product described here.

The local project therefore mirrors these references but does not import them:

- `api/AGENTS.md` for layer direction, typed DTOs, mappings, and domain exceptions.
- `api/oss/src/core/git/interfaces.py` for interface style, not its method set.
- `api/oss/src/dbs/postgres/workflows/` for `dbes.py`, `mappings.py`, and `dao.py`
  separation.
- `api/entrypoints/routers.py` for composition-root ownership, not its platform graph.

The dedicated `services/local/pyproject.toml` avoids inheriting Redis, Taskiq,
SuperTokens, asyncpg, object storage, tracing, and deployment dependencies from the
platform projects. It directly declares FastAPI, Uvicorn, Pydantic, HTTPX, SQLAlchemy,
aiosqlite, Alembic, orjson, structlog, and the editable Agenta SDK.

## Frontend reuse is possible, but the full frontend is the wrong host

Both `web/oss/next.config.ts` and `web/mobile/next.config.ts` produce standalone Next.js
servers. Electron can launch either server over loopback HTTP. The full OSS application,
however, assumes browser authentication, organizations, workspaces, projects, RBAC, and a
large API surface.

`web/mobile` is a better reference host because it uses a smaller provider tree and
composes package-level UI. Useful package surfaces include:

- `web/packages/agenta-ui` for controls and presentation.
- `web/packages/agenta-entity-ui/src/agent` for agent cards and overview components.
- `web/packages/agenta-chat` for chat models, transport behavior, and rendering pieces.
- `web/packages/agenta-settings-ui` for provider settings patterns.
- `web/packages/agenta-navigation-ui` for a small navigation shell.

The POC should not reuse the full agent chat controller or full playground without an
adapter. Those paths assume project scope, workflow APIs, platform sessions, auth headers,
and durable platform records. A new local app under `web/agenta-local` should compose
selected package components around its own small local client.

The current `web/pnpm-workspace.yaml` and `web/package.json` enumerate application folders;
implementation must add `agenta-local` explicitly to both.

## Local and cloud switching cannot share process-wide clients safely yet

The Fern resource clients in `web/packages/agenta-sdk/src/resources.ts` and the shared
Axios client are host-pinned singletons. Query caches also assume one active project and
do not include the backend host in every key. In-place switching between localhost and
Agenta Cloud can therefore show stale data or send requests to the wrong host.

The POC should not implement an in-place dual-backend renderer. It should keep the local
renderer on localhost and hand cloud work to the existing cloud application. A future
desktop client can isolate each connection in a separate Electron storage partition and
reload the renderer when the connection changes.

## Hermes uses a simpler local core

Hermes Desktop packages an Electron shell and React renderer. The shell installs or
finds a managed Python runtime, starts `hermes serve`, and communicates through JSON-RPC
and WebSockets. Its browser dashboard starts a local FastAPI/Uvicorn server. Hermes can do
this without Docker because its core already uses local files and SQLite rather than a
multi-service platform stack.

The relevant references are:

- https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/README.md
- https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard

Agenta should copy the process boundary, not try to squeeze its current platform topology
into a desktop installer.

## Packaging options

| Option                                        | POC assessment                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Local browser UI with managed Python and Node | Best first proof. It tests the runtime without desktop-shell complexity.                   |
| Electron supervising the same local processes | Good productization follow-up after the browser POC proves demand.                         |
| Tauri                                         | Smaller shell, but it still needs Python and Node sidecars and adds Rust integration work. |
| Native installation of the current stack      | Reject. It preserves every service dependency and makes lifecycle management harder.       |
| Desktop client backed only by Agenta Cloud    | Useful product option, but it does not test fully local state and execution.               |

## Main technical risks

1. The runner may still make an unexpected API or storage call during an unowned turn.
2. Packaging the runner must preserve patched npm dependencies, sandbox-agent binaries,
   skills, OS utilities, licenses, and the Node version it requires.
3. Existing chat UI components may require more platform state than expected.
4. The Python and TypeScript wire formats may drift if the POC adds local-only fields.
5. Loopback HTTP is still a security boundary. Another web page must not be able to invoke
   the local agent or read credentials.
6. Local filesystem tools need a clear workspace root and path policy before the POC can
   expose them safely.
