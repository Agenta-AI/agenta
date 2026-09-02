# API design: the routes version one exposes

> AGENT-GENERATED, low weight. Draft for discussion. Mahmoud makes final decisions.

This file holds only the route contracts that version one of the durable-command work adds. It
covers three routes: one public Cancel, and two internal runner routes. Everything else in the RFC's
public interface section, including Send, the session snapshot, the event stream, pending inputs and
the busy-message policies, is out of scope here and stays in
[the RFC](rfc.md).

The design behind these routes is in
[the durable command design](spike-b-durable-commands-design.md). Read that first for the state
machine, the lease and the failure cases.

Conventions taken from the existing code, not invented here:

- Request and response models live in `api/oss/src/apis/fastapi/sessions/models.py`, are plain
  Pydantic models, and set `model_config = ConfigDict(extra="forbid")` on request bodies that are
  new (`SessionQueryRequest`, `models.py:59`).
- List responses carry `count` plus the list (`SessionsResponse`, `models.py:105`).
- Domain errors are typed exceptions in a `types.py` and are mapped to status codes by one decorator
  on the router (`_handle_session_exceptions`, `router.py:181`).
- Field names are `lower_snake_case`. Header names keep their standard spelling.

---

## 1. Interface review

Every field is classified before it is written down, as the `design-interfaces` skill requires.

### Public Cancel request

| Field | Concretely | Owner | Changes | Role | Placement |
|---|---|---|---|---|---|
| `session_id` | Which session to act on | Caller | Per call | routing | Path parameter, because it names the resource |
| `expected_execution_id` | The execution the caller believes is running | Caller | Per call | precondition | Body. It is a guard on this request, not data the command carries |
| `Idempotency-Key` | Retry identity for this request | Caller | Per call | protocol context | Header, because a standard name exists and it belongs to the request, not the domain object |

Three decisions fall out of that table.

- `expected_execution_id` is **not** nested under an `execution` object. It is a single atomic
  precondition, and the skill's rule against over-nesting applies. If a second precondition is ever
  added, both move under `expect: {...}` together.
- `Idempotency-Key` stays a header with its standard spelling. It is not a body field, because it
  describes the delivery of the request rather than the intent inside it. The stored column is
  `idempotency_key`, which matches `session_attachments.idempotency_key`
  (`api/oss/src/dbs/postgres/sessions/attachments/dbas.py:25`).
- No `force` flag. `force` on the current stream endpoint is what makes one route mean four things
  (`api/oss/src/core/sessions/streams/service.py:7`). Cancel means cancel.

### Public Cancel response

| Field | Concretely | Role |
|---|---|---|
| `command.id` | The durable command's id | identity, for the caller's own retries and logs |
| `command.state` | `pending` or `obsolete` at admission time | state |
| `execution.id` | The execution this Cancel targets, null when nothing ran | routing |
| `execution.state` | `stopping` or `idle` | state |

`command` and `execution` are separate objects because they answer different questions and settle at
different times. A client that only wants to draw a button reads `execution`. A client that wants to
retry safely reads `command.id`. This is decision D-016 expressed in the response shape.

### Internal claim request

| Field | Concretely | Owner | Role |
|---|---|---|---|
| `replica_id` | Which runner container is asking | Runner | routing |
| `wait_seconds` | How long the caller is willing to be held | Runner | protocol context of this poll |
| `limit` | How many commands to return at most | Runner | protocol context of this poll |

`replica_id` is in the body and not derived from the token, because the token is shared by every
replica. It identifies the caller, not its authority.

### Internal outcome request

| Field | Concretely | Owner | Role |
|---|---|---|---|
| `replica_id` | Which runner is reporting | Runner | routing, and the claim guard |
| `result` | The command's terminal state | Runner | state |
| `execution.id` | Which execution the runner acted on | Runner | routing |
| `execution.state` | What happened to it | Runner | output |
| `execution.error` | Why it failed, when it did | Runner | output |

`result` and `execution` stay apart for the same reason as in the Cancel response. `execution.error`
sits under `execution` and not at the top level, because it explains one field of that object.

---

## 2. Public: cancel the current execution

```http
POST /sessions/{session_id}/cancel
Idempotency-Key: 0199a3f2-0000-7000-8000-000000000001

{
  "expected_execution_id": "0199a3f1-0000-7000-8000-00000000000a"
}
```

Permission: `Permission.RUN_SESSIONS`, the same permission the current cancel path checks
(`api/oss/src/apis/fastapi/sessions/router.py:377`).

```python
class SessionCancelRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Optional stale-request guard (decision D-010). When present, the API cancels only this
    # execution and rejects the request if another one is running. When absent, it cancels
    # whichever execution is active when the request is applied. A person never types this;
    # the browser fills it from the session snapshot.
    expected_execution_id: Optional[str] = None


class SessionCommandRef(BaseModel):
    """The durable command an accepted request created. Identity and delivery state only.
    A client must not infer execution state from it (decision D-016)."""

    id: UUID
    state: Literal["pending", "claimed", "applied", "obsolete"]


class SessionExecutionRef(BaseModel):
    """What the caller should render. `id` is null when the session was idle."""

    id: Optional[str] = None
    state: Literal["stopping", "idle"]


class SessionCancelResponse(BaseModel):
    command: SessionCommandRef
    execution: SessionExecutionRef
```

Responses:

| Status | When | Body |
|---|---|---|
| 202 Accepted | An execution was running. The command is durable and on its way | `command.state = "pending"`, `execution.state = "stopping"` |
| 200 OK | Nothing was running and no `expected_execution_id` was sent | `command.state = "obsolete"`, `execution.state = "idle"`, `execution.id = null` |
| 409 Conflict | `expected_execution_id` does not name the running execution | `detail: {"message": ..., "current_execution_id": <id or null>}` |
| 422 | The session id fails the allowlist (`SessionIdInvalid`) | `detail: <message>` |
| 403 | The caller lacks `RUN_SESSIONS` | `FORBIDDEN_EXCEPTION` |

202 and not 200 for the accepted case, because the work is not done when the response returns. The
caller learns the outcome from the session's own state, not from this response.

Repeating the request with the same `Idempotency-Key` returns the same `command.id` and the same
status. Repeating it without a key also returns the same command while one is still open, because
admission collapses onto an open command for the same target execution.

New domain exceptions in `api/oss/src/core/sessions/commands/types.py`, mapped by a
`_handle_command_exceptions()` decorator alongside the existing one:

```python
class SessionCommandError(Exception): ...

class ExecutionExpectationFailed(SessionCommandError):
    """expected_execution_id does not name the running execution."""
    def __init__(self, session_id: str, expected: str, current: Optional[str]): ...
```

---

## 3. Internal: claim commands

```http
POST /sessions/control/commands/claim
X-Agenta-Runner-Token: <AGENTA_RUNNER_TOKEN>

{
  "replica_id": "runner-7f3c",
  "wait_seconds": 25,
  "limit": 10
}
```

Not a product API. It is excluded from the public schema with `include_in_schema=False`, the
treatment the admin routers already get (`api/entrypoints/routers.py:1502`).

Authentication is the shared runner token, not a user credential. The path prefix
`/sessions/control/` is added to `_PUBLIC_ENDPOINTS` (`api/oss/src/middlewares/auth.py:52`) so the
project-scoped middleware does not reject a request with no user credential, and the route then
compares the presented token to `env.runner.token` in constant time. If that setting is unset the
route answers 503 and serves nothing.

```python
class SessionControlClaimRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Which runner container is asking. The token is shared across replicas, so it proves
    # trust, not identity; this field is the identity.
    replica_id: str = Field(min_length=1, max_length=128)
    # How long the API may hold this request. Clamped server-side to the configured hold.
    wait_seconds: int = Field(default=25, ge=0, le=60)
    limit: int = Field(default=10, ge=1, le=50)


class SessionCommandClaim(BaseModel):
    expires_at: datetime
    attempt: int


class SessionCommandEnvelope(BaseModel):
    """One command as the runner receives it. The heartbeat fallback returns the same model,
    so the runner has one parser and one applier."""

    id: UUID
    project_id: UUID
    session_id: str
    kind: Literal["cancel"]
    # The execution this command must reach. Null when the session was idle at admission.
    target_turn_id: Optional[str] = None
    # The command's own arguments. Empty for cancel; steer will carry its message here.
    data: Dict[str, Any] = Field(default_factory=dict)
    claim: SessionCommandClaim


class SessionControlClaimResponse(BaseModel):
    count: int = 0
    commands: List[SessionCommandEnvelope] = Field(default_factory=list)
```

Responses:

| Status | When |
|---|---|
| 200 OK | At least one command was claimed. The body is never an empty list |
| 204 No Content | The hold expired with nothing to deliver |
| 401 Unauthorized | The token is absent or wrong |
| 503 Service Unavailable | `AGENTA_RUNNER_TOKEN` is not configured on the API |

204 rather than an empty 200 keeps the common case cheap and gives the runner an unambiguous "poll
again now" signal.

---

## 4. Internal: report a command's outcome

```http
POST /sessions/control/commands/{command_id}/outcome
X-Agenta-Runner-Token: <AGENTA_RUNNER_TOKEN>

{
  "replica_id": "runner-7f3c",
  "result": "applied",
  "execution": {
    "id": "0199a3f1-0000-7000-8000-00000000000a",
    "state": "stopped"
  }
}
```

```python
class SessionExecutionOutcome(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # The execution the runner acted on. Null when it held none.
    id: Optional[str] = None
    state: Literal["stopped", "failed", "not_running"]
    # Short, human-readable, present only when `state` is "failed".
    error: Optional[str] = Field(default=None, max_length=2000)


class SessionControlOutcomeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    replica_id: str = Field(min_length=1, max_length=128)
    # The command's terminal state. `applied` means the runner did the work; `obsolete`
    # means there was nothing to do.
    result: Literal["applied", "obsolete"]
    execution: SessionExecutionOutcome


class SessionControlOutcomeResponse(BaseModel):
    command: SessionCommandSettlement


class SessionCommandSettlement(BaseModel):
    id: UUID
    state: Literal["applied", "obsolete"]
    outcome: Literal["stopped", "not_running", "failed", "lost", "superseded"]
    settled_at: datetime
```

Responses:

| Status | When | Body |
|---|---|---|
| 200 OK | The command was `claimed` by this replica and is now settled | The settlement |
| 409 Conflict | The claim expired, or another actor settled the command | The stored settlement, so the runner stops instead of retrying |
| 404 Not Found | No command with that id in any project | `detail` |
| 401, 503 | As for the claim route | |

The API does the settlement side effects inside the same request: it clears
`session_streams.stopping_turn_id`, tombstones the stopped execution, releases the Redis `running`
key under an owner check, leaves `alive` to its own time to live, cancels that execution's pending
interactions, and publishes the existing `lifecycle: ended` watch notification. The full ordering is
in section 7 of the design document.

---

## 5. One field added to an existing contract

The heartbeat response grows one field. Nothing else about `POST /sessions/streams/heartbeat`
changes.

```python
class SessionHeartbeatResult(BaseModel):
    stream: Optional[SessionStream] = None
    replica_id: str
    is_current_turn: bool = True
    # Commands for THIS session only, claimed by this beat under the same compare-and-set
    # the long poll uses. Empty in the normal case, where the poll already delivered them.
    commands: List[SessionCommandEnvelope] = Field(default_factory=list)
```

The field is additive and defaults to an empty list, so a runner build that does not know about it
is unaffected.

---

## 6. What does not change in version one

- `POST /sessions/streams/` keeps its current four-mode behavior until the last migration step, when
  its cancel branch becomes a thin wrapper over the same command. See section 9 of the design
  document.
- `DELETE /sessions/streams/` (kill) is untouched. Stop and Delete stay different operations
  (decision D-008).
- `POST /sessions/interactions/{interaction_id}/respond` is untouched. Turning interaction responses
  into commands is later work.
- No new public read route. Clients keep using `GET /sessions/streams/` and the watch stream.
