# POC contracts

These contracts are local-only and intentionally smaller than the Agenta platform API.
They group fields by role so runtime context, configuration, credentials, and user data do
not share vague option objects.

## Agent revision

An agent owns mutable metadata. Each saved configuration creates an immutable revision.

```json
{
  "agent": {
    "id": "agt_...",
    "name": "Research assistant"
  },
  "revision": {
    "id": "rev_...",
    "version": 3,
    "instructions": "Research the question and cite sources.",
    "model": {
      "provider": "openai",
      "name": "gpt-5-mini",
      "parameters": {}
    },
    "execution": {
      "harness": "pi_core",
      "sandbox": "local"
    }
  }
}
```

Field roles:

| Field                     | Role                  | Owner            | Lifecycle              |
| ------------------------- | --------------------- | ---------------- | ---------------------- |
| `agent.id`, `revision.id` | Identity              | Local service    | Stable                 |
| `agent.name`              | Metadata              | User             | Mutable                |
| `revision.instructions`   | Agent data            | User             | Immutable per revision |
| `revision.model`          | Runtime configuration | User             | Immutable per revision |
| `revision.execution`      | Runtime routing       | Product and user | Immutable per revision |

Credentials do not appear in this record. `model.provider` selects a separately stored
provider credential.

Before invoking the SDK, the local service maps the revision to this existing parameter
shape:

```json
{
  "agent": {
    "instructions": { "agents_md": "<revision.instructions>" },
    "llm": {
      "provider": "<revision.model.provider>",
      "model": "<revision.model.name>",
      "extras": "<revision.model.parameters>"
    },
    "tools": [],
    "mcps": [],
    "skills": [],
    "harness": { "kind": "pi_core", "permissions": {}, "extras": {} },
    "runner": { "kind": "sidecar", "permissions": { "default": "deny" } },
    "sandbox": { "kind": "local" }
  }
}
```

The composition loads the selected provider credential from the secrets file and passes
it to `StaticConnectionResolver`. Empty tool and MCP resolvers must return the SDK's empty
typed results. A contract test must parse this mapping through `AgentTemplate.from_params`
and assert the resulting wire request has `harness=pi_core`, no external tools or MCPs,
and `permissions.default=deny`.

## Core interface contracts

These interfaces live below HTTP and above concrete adapters. Their methods use typed
Pydantic DTOs, keyword-only arguments, and domain exceptions. They never return DBEs,
HTTP responses, raw dictionaries, or `(value, error)` tuples.

### `AgentsDAOInterface`

Location: `services/local/src/agenta_local/core/agents/interfaces.py`.

| Method                                          | Atomic behavior                                                                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `create_agent(*, agent_create)`                 | Insert the agent, first immutable revision, and `current_revision_id` in one transaction.                                              |
| `list_agents()`                                 | Return agent summaries ordered by `updated_at DESC, id ASC`.                                                                           |
| `get_agent(*, agent_id)`                        | Return metadata plus current revision, or `None`.                                                                                      |
| `get_revision(*, revision_id)`                  | Return one immutable revision, or `None`.                                                                                              |
| `commit_revision(*, agent_id, revision_create)` | Lock the agent through the SQLite write transaction, allocate `max(version)+1`, insert the revision, and update `current_revision_id`. |
| `rename_agent(*, agent_id, name)`               | Change metadata only; do not create a revision.                                                                                        |

There is no local artifact, variant, fork, archive, folder, or revision-log abstraction.
The current revision and ordered revisions are sufficient for this POC.

### `SessionsDAOInterface`

Location: `services/local/src/agenta_local/core/sessions/interfaces.py`.

| Method                                                         | Atomic behavior                                                                                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| `create_session(*, session_create)`                            | Insert a session permanently bound to one existing revision.                                                                                                 |
| `list_sessions()`                                              | Return summaries ordered by `updated_at DESC, id ASC`.                                                                                                       |
| `get_session(*, session_id)`                                   | Return metadata, messages, and turn statuses, or `None`.                                                                                                     |
| `begin_turn(*, session_id, client_turn_id, input, input_hash)` | Resolve idempotency first, then reject another active turn, then insert the turn and user message with the next sequence in one immediate write transaction. |
| `mark_turn_running(*, turn_id)`                                | Apply only `pending -> running`.                                                                                                                             |
| `load_completed_context(*, session_id, current_turn_id)`       | Return messages from completed turns plus the current turn's user message in sequence order.                                                                 |
| `complete_turn(*, turn_id, assistant_message)`                 | Insert the final assistant message and apply `running -> completed` in one transaction.                                                                      |
| `fail_turn(*, turn_id, error)`                                 | Apply `pending                                                                                                                                               | running -> failed` once.      |
| `cancel_turn(*, turn_id)`                                      | Apply `pending                                                                                                                                               | running -> cancelled` once.   |
| `interrupt_turn(*, turn_id, error)`                            | Apply `pending                                                                                                                                               | running -> interrupted` once. |
| `interrupt_incomplete_turns()`                                 | At startup, change every leftover `pending` or `running` turn to `interrupted`.                                                                              |

Session, turn, and message writes share one DAO because their invariants are
transactionally coupled. Do not split generic CRUD DAOs that require a service to hold a
transaction across interfaces.

### `ProviderCredentialsStoreInterface`

Location: `services/local/src/agenta_local/core/providers/interfaces.py`.

| Method                           | Behavior                                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `list_states()`                  | Return configured state and redacted suffixes only.                                                  |
| `get_for_execution(*, provider)` | Return one credential to the execution adapter; never expose this method through an HTTP read route. |
| `put(*, provider, credential)`   | Atomically rewrite the protected file.                                                               |
| `delete(*, provider)`            | Atomically remove one provider record.                                                               |

### `AgentExecutorInterface`

Location: `services/local/src/agenta_local/core/execution/interfaces.py`.

`stream(*, revision, messages, credential)` accepts an immutable local revision,
completed conversation context, and one resolved credential. It returns an
`ExecutionStream` with two members: `events`, an async iterator of existing
Vercel-compatible frames, and `result()`, an awaitable that becomes available only after
`events` is exhausted or closed. `result()` either returns typed final assistant text or
raises the typed source-stream failure. A Vercel `finish` frame is not proof of success
because the projector emits finish frames after caught source errors.

The SDK adapter observes the neutral event iterator returned by `make_agent_handler()`
before sending it through `agent_stream_to_vercel_stream()`. The observer records neutral
events, source exceptions, and cancellation. On clean exhaustion it derives final text
with `assistant_text()`. An `error` neutral event or source exception makes `result()`
fail even though the Vercel projector still sends its protocol-closing frames. The core
contract contains no `AgentComposition`, runner URL, platform session ID, trace ID, or
SQLAlchemy type.

`ExecutionService` owns the lifecycle around that interface: begin the turn, mark it
running, register the active task, stream, commit exactly one terminal state, and remove
the task in `finally`. `SessionsService` owns session CRUD and history. This keeps runner
and cancellation concerns out of the persistence adapter.

### Domain failures

Core `types.py` modules define typed failures such as `AgentNotFound`,
`RevisionNotFound`, `SessionNotFound`, `SessionBusy`, `TurnAlreadyExists`,
`IdempotencyConflict`, `TurnNotActive`, and `ProviderNotConfigured`. FastAPI maps them to
the stable error shape `{code, message, retryable, next_step?, details?}`. Core services
and DAOs do not raise `HTTPException`.

## Session turn request

```json
{
  "input": {
    "content": [{ "type": "text", "text": "Summarize this repository." }]
  },
  "context": {
    "client_turn_id": "turn_..."
  }
}
```

The session ID belongs in the URL because a session is immutably bound to one agent
revision when it is created:

```text
POST /api/sessions/{session_id}/turns
```

`input` contains user data. `context.client_turn_id` supports idempotency and UI
reconciliation. The caller cannot override credentials, runner URLs, storage paths, or
permission policy per turn.

Turn creation behavior:

1. The service hashes the normalized `input`.
2. It looks up `(session_id, client_turn_id)` before checking session-busy state.
3. Reusing a `client_turn_id` with different input returns `409 idempotency_conflict`.
4. Reusing it with identical input returns `409 turn_already_exists` with the existing
   turn ID and status. It never starts a second run.
5. If no duplicate exists, it rejects another active turn before inserting anything.
6. It inserts the turn and user message in one immediate write transaction.
7. Retrying a failed or interrupted turn requires a new `client_turn_id`.
8. The service commits the final assistant message and `completed` state in one
   transaction.
9. A session permits only one `pending` or `running` turn. Another request returns
   `409 session_busy` before inserting a user message.
10. Runtime context contains messages from completed turns plus the current user message.
    Messages attached to failed, cancelled, or interrupted turns remain queryable for the
    UI but are excluded from later model context.

The response uses server-sent events. The POC should reuse the existing Vercel stream
projection rather than define a second event vocabulary.

## Provider credential write

```json
{
  "provider": "openai",
  "credentials": {
    "api_key": "..."
  },
  "connection": {
    "base_url": null
  }
}
```

- `provider` routes the credential to the provider it authenticates.
- `credentials` contains secrets and is write-only.
- `connection` contains non-secret endpoint configuration.
- Reads return only `provider`, `configured`, and a redacted suffix.

## Minimal HTTP surface

| Method and path                         | Purpose                                                     |
| --------------------------------------- | ----------------------------------------------------------- |
| `GET /health`                           | Process liveness and schema version                         |
| `GET /api/runtime`                      | Runner health, supported harnesses, and application version |
| `POST /api/runtime/shutdown`            | Gracefully stop local work and ask the launcher to exit     |
| `GET /api/agents`                       | List local agents                                           |
| `POST /api/agents`                      | Create an agent and its first revision                      |
| `GET /api/agents/{agent_id}`            | Retrieve metadata and current revision                      |
| `POST /api/agents/{agent_id}/revisions` | Commit a new immutable revision                             |
| `GET /api/sessions`                     | List local sessions                                         |
| `POST /api/sessions`                    | Create a session from `{agent_revision_id, title?}`         |
| `GET /api/sessions/{session_id}`        | Retrieve session metadata and messages                      |
| `POST /api/sessions/{session_id}/turns` | Run and stream one cold turn                                |
| `POST /api/sessions/{session_id}/stop`  | Cancel the local active task and close its runner stream    |
| `GET /api/providers`                    | List configured provider states, never raw secrets          |
| `PUT /api/providers/{provider}`         | Write provider credentials and connection configuration     |
| `DELETE /api/providers/{provider}`      | Remove local provider credentials                           |

The first execution smoke test may call the SDK directly before these routes exist. Once
the local service exists, the renderer must use this local contract rather than the full
platform API.

## SQLite records

```text
agents
  id, name, current_revision_id, created_at, updated_at

agent_revisions
  id, agent_id, version, instructions, model_json, execution_json, created_at

sessions
  id, agent_revision_id, title, status, created_at, updated_at

messages
  id, session_id, turn_id, sequence, role, content_json, created_at

turns
  id, session_id, client_turn_id, input_hash, status, error_json, started_at, finished_at
```

Constraints:

- Enable `PRAGMA foreign_keys = ON` and WAL mode.
- Enforce one unique revision version per agent.
- Enforce one unique message sequence per session.
- Enforce one unique `client_turn_id` per session.
- Enforce one active turn per session with a partial unique index over `pending` and
  `running` states.
- Keep sessions bound to their original `agent_revision_id`.
- Store no provider keys, runner tokens, cookies, or Cloud credentials in SQLite.
- Store JSON only for structures that the runtime already treats as extensible.
- Store IDs as application-generated UUID strings and timestamps as UTC values.
- Reject updates to `agent_revisions` and changes to `sessions.agent_revision_id`; the
  service has no mutation path for either immutable value and the initial migration adds
  defensive SQLite triggers.
- Declare both sides of the initial agent/current-revision foreign-key cycle deferrable
  and initially deferred. Generate both IDs first, insert both non-null references in one
  immediate transaction, and let commit validate the closed cycle.

Turn states are `pending`, `running`, `completed`, `failed`, `cancelled`, and
`interrupted`. Allowed transitions are `pending -> running|failed|cancelled|interrupted`
and `running -> completed|failed|cancelled|interrupted`. Only `running` may become
`completed`. A row reaches at most one terminal state. Message visibility and future
context are derived from the owning turn state; messages have no duplicate status field.
On startup, the service changes leftover `pending` or `running` turns to `interrupted`
before accepting new work.

The in-memory active-task registry is keyed by session ID and stores turn ID, task handle,
and cancellation reason. Explicit stop records `cancelled`; client disconnect and service
shutdown record `interrupted`. The terminal cancellation handler reads that reason after
closing the execution stream. `POST /api/sessions/{session_id}/stop` therefore selects at
most one task and cannot be confused with disconnect cleanup.

## Runner boundary

The local service uses the existing runner request and event contracts. It must not add
local database IDs to the shared wire format unless the runner needs them to execute the
turn. In particular, the POC session ID remains local-service context and never creates
platform session ownership. The current shared wire encoder represents this as
`sessionId: null`; do not add the local SQLite session ID there.

Runtime routing and credentials enter the runner through the existing model, connection,
and environment fields. HTTP authentication uses a dedicated runner token. The browser
never receives that token or the runner URL.

## Browser session boundary

The initial same-origin UI response sets an opaque, process-lifetime cookie with
`HttpOnly`, `SameSite=Strict`, and `Path=/`. Every mutation and stream request requires
that cookie. The service accepts browser requests only when `Host` matches its selected
loopback host and port and `Origin` matches that exact origin. Mutations require
`Content-Type: application/json`. Service restart rotates the cookie and a page refresh
obtains the new value. The value never appears in HTML, JavaScript, URLs, browser storage,
or logs. HTML and runtime responses use `Cache-Control: no-store`; an HTML navigation
replaces a missing or stale process cookie after service restart.
