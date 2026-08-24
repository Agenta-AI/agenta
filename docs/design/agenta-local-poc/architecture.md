# Architecture

## POC shape

```text
Agenta Local launcher
    |
    +-- Python local service on 127.0.0.1:<random>
    |       +-- SQLite
    |       +-- local secrets file
    |       +-- static or standalone React renderer
    |       +-- SDK AgentComposition
    |
    +-- Node runner on 127.0.0.1:<random>
            +-- sandbox-agent engine
            +-- Pi harness
```

The launcher generates a runner token, passes it only to the runner and local service,
starts the runner, waits for runner health, starts the local service, waits for service
health, and opens the UI. It terminates both child processes when the application exits.

## Runtime ownership

| Concern                                       | POC owner                                                |
| --------------------------------------------- | -------------------------------------------------------- |
| Agent names and revisions                     | Python local service and SQLite                          |
| Session identity and message history          | Python local service and SQLite                          |
| Provider credentials                          | Local secrets file, readable only by the current OS user |
| Agent execution                               | Existing Node runner and Pi harness                      |
| Stream projection                             | Existing Python SDK Vercel adapter                       |
| UI state                                      | Local React renderer                                     |
| Organizations, RBAC, evaluations, shared data | Existing Agenta Cloud                                    |

## Source ownership and layering

The local product is a standalone Python application under `services/local/`. It follows
the API house pattern inside that boundary:

```text
services/local/src/agenta_local/
  entrypoints/                 process composition and CLI entrypoints
  apis/fastapi/                HTTP models, routers, and security middleware
  core/agents/                 DTOs, AgentsDAOInterface, AgentsService
  core/sessions/               DTOs, SessionsDAOInterface, SessionsService
  core/providers/              DTOs, ProviderCredentialsStoreInterface, ProvidersService
  core/execution/              AgentExecutorInterface and turn orchestration
  dbs/sqlite/agents/           Agent and revision DBEs, mappings, AgentsDAO
  dbs/sqlite/sessions/         Session, message, and turn DBEs, mappings, SessionsDAO
  stores/files/                provider credential file adapter
  execution/sdk/               AgentComposition and runner adapter
```

The dependency direction is fixed:

```text
FastAPI router
  -> core service
    -> core interface
      -> SQLite, file, or SDK adapter
        -> local database, file, or runner
```

`entrypoints/server.py` is the composition root. It resolves local paths and settings,
runs migrations, creates the SQLite engine and concrete adapters, injects them into core
services, and mounts routers. Routers never construct DAOs. Core modules never import
FastAPI, SQLAlchemy, the SDK adapter, or concrete storage implementations. DBE-to-DTO
conversion remains in each SQLite domain's `mappings.py`.

The SQLite code does not belong under `api/oss/src/dbs/sqlite/`. That path would mean the
SQLite classes implement the full platform DAO contracts, including project and user
scope, RBAC, workflow artifact/variant semantics, Redis-coordinated sessions, records,
mounts, and vault behavior. The POC deliberately has different records and invariants.
It copies the platform's layering conventions without importing its application graph.

The local service is also a separate Python project with its own `pyproject.toml` and
`uv.lock`. It depends on editable `sdks/python` and `clients/python` packages in a checkout
but does not depend on `api` or the broad `services/pyproject.toml` environment. Bundles
replace both editable paths with ordinary wheels.

## One-turn flow

1. The renderer posts one user message to the local session endpoint.
2. The local service loads the selected immutable agent revision.
3. The local service loads messages from completed turns and appends the current user
   message. Messages from failed, cancelled, and interrupted turns remain visible in the
   UI but do not enter later model context.
4. The local service maps the stored revision to the SDK agent-template shape and builds
   an `AgentComposition` with `StaticConnectionResolver`, empty tool and MCP resolvers,
   `runner.permissions.default=deny`, and `SandboxAgentBackend` pointed at the runner.
5. The local service calls the SDK handler with `session_id=None`; the wire carries
   `sessionId: null`, so no platform session is owned or resumed.
6. The runner executes the cold turn through Pi and emits NDJSON records.
7. The local adapter observes the neutral SDK stream, then the SDK converts records to
   Vercel-compatible SSE frames.
8. The local service streams those frames to the renderer. Protocol-closing Vercel finish
   frames do not by themselves establish run success.
9. The local service commits the final assistant message only after the observed neutral
   source stream exhausts without an error event or exception. Failed, cancelled, and
   interrupted turns retain their user message and status for display but not future model
   context.

## Local and cloud product boundary

The POC does not merge the local and cloud control planes.

```text
Agenta Local
  - one user
  - local agents
  - local conversations
  - local execution

Agenta Cloud
  - teams and organizations
  - shared projects
  - evaluations and observability
  - hosted or registered execution
```

The local UI exposes `Open Agenta Cloud`, which launches the existing cloud application in
the system browser. It does not sync data or share credentials. This proves the product
split without inventing synchronization semantics.

A later desktop product may present local and cloud connections in one shell. Each
connection must have an isolated browser storage partition, and changing connections must
reload the renderer until SDK clients and query caches become connection-aware.

## Renderer choice

Use a static Next.js browser renderer under `web/agenta-local`. FastAPI serves the export
after mounting health and API routes, so the browser sees one loopback origin and the
bundle needs no renderer server process. This keeps the runtime observable and avoids
conflating execution failures with Electron packaging.

After the POC succeeds, a productization project may add a thin Electron shell that:

- launches the same local service and runner bundle;
- loads the renderer over loopback HTTP, never `file://`;
- disables Node integration in the renderer;
- enables context isolation and sandboxing;
- blocks arbitrary navigation and new windows;
- exposes only lifecycle and external-link actions through a typed preload bridge.

Electron must not own agent domain logic. The complete POC remains a working
`agenta-local` browser application.

## Local security boundary

- Bind all listeners to `127.0.0.1` on random available ports.
- Generate a random browser session value on every local-service launch.
- Set it as an `HttpOnly`, `SameSite=Strict`, process-lifetime cookie when the browser
  loads the UI from the approved loopback origin.
- Require the cookie plus an exact `Origin` and JSON content type on every mutation.
- Serve the renderer and API from one origin to avoid broad CORS rules.
- Reject unexpected `Origin` and `Host` headers.
- Never return raw provider credentials from an API.
- Store mutable data in a 0700 application-data directory.
- Hold one exclusive OS lock for the application-data workspace across migration,
  service execution, and shutdown; reject a concurrent launcher before it starts children.
- Write secrets through a same-directory 0600 temporary file opened with exclusive-create
  and no-follow flags, fsync it, atomically replace the prior file, then fsync the parent
  directory.
- Redact credentials from logs and error responses.
- Give the runner a separate random token known only to the local service.

The browser cookie is a cross-site request defense, not protection from another process
running as the same OS user. Such a process can already read the user's local files. The
service rotates the cookie when it restarts, never logs it, and sets `Referrer-Policy:
no-referrer`. HTML and runtime responses are not cached, HTML navigation refreshes a stale
process cookie, and API responses do not expose it to JavaScript.

## Failure behavior

| Failure                        | User-visible result                                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Runner fails to start          | Launcher output names the runner and local log path; no UI is served.                                          |
| Local service fails to start   | Launcher stops the runner and reports the service failure.                                                     |
| Provider credential is missing | Agent editor points to provider setup before the run starts.                                                   |
| Provider rejects the request   | Conversation shows a provider error without losing prior messages.                                             |
| Stream disconnects             | Local service cancels the active task, closes the runner connection, and records the turn as interrupted.      |
| SQLite migration fails         | Application stops before serving the UI; migration ran on a temporary copy and the original remains untouched. |
| Port is occupied               | Launcher chooses another loopback port.                                                                        |

## Productization path after the POC

1. Replace the secrets file with OS keychain integration.
2. Add explicit local workspace roots and filesystem permission policy.
3. Add Cloud account login and connection-isolated renderer profiles.
4. Add explicit `Publish to Cloud` and `Pull from Cloud` operations.
5. Add warm sessions and resumable approvals without platform heartbeat dependencies.
6. Build signed macOS and Windows installers and an update channel.
