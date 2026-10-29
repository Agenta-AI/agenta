# API design: the routes version one exposes

> AGENT-GENERATED, low weight. Draft for discussion. Mahmoud makes final decisions.

This file holds the route contracts considered for the durable-command work. Version one adds the
public Cancel route, the internal outcome route, and the runner's direct Cancel route; the
long-poll claim contract is explicitly deferred. Everything else in the RFC's public interface
section stays in [the RFC](rfc.md).

The design behind these routes is in
[the durable command design](spike-b-durable-commands-design.md). Read that first for the state
machine, the lease, the settlement rule and the failure cases.

Version one ships the direct-call adapter behind the replaceable control-delivery port. The two
long-poll routes remain future contracts; selecting `long_poll` currently fails startup rather
than silently choosing an unimplemented transport.

Conventions taken from the existing code, not invented here:

- Request and response models live in `api/oss/src/apis/fastapi/sessions/models.py`, are plain
  Pydantic models, and set `model_config = ConfigDict(extra="forbid")` on new request bodies
  (`SessionQueryRequest`, `models.py:59`).
- List responses carry `count` plus the list (`SessionsResponse`, `models.py:105`).
- Domain errors are typed exceptions in a `types.py`, mapped to status codes by one decorator on the
  router (`_handle_session_exceptions`, `router.py:181`).
- Field names are `lower_snake_case`. Header names keep their standard spelling. The runner's own
  HTTP surface uses `camelCase`, matching its existing `/kill` body
  (`services/runner/src/server.ts:704`).

---

## 1. Interface review

Every field is classified before it is written down, as the `design-interfaces` skill requires. The
architecture review's section 4 fixed four of these shapes; where it did, that is noted.

### Public Cancel request

| Field | Concretely | Owner | Changes | Role | Placement |
|---|---|---|---|---|---|
| `session_id` | Which session to act on | Caller | Per call | routing | Path parameter, because it names the resource |
| `expected_execution_id` | The execution the caller believes is running | Caller | Per call | precondition | Body, flat |
| `Idempotency-Key` | Retry identity for this request | Caller | Per call | protocol context | Header |

Three decisions fall out of that table.

- **The public Cancel body stays flat.** The review examined this exact shape and ruled that it is
  correct and should not change: `expected_execution_id` is per-call context named as the guard it
  is, in the style of an HTTP `If-Match`. The grouping under `target` applies to the internal
  envelope, where a resolved `target.turn_id` needs a home next to the asserted one. A public body
  with one field does not.
- **`Idempotency-Key` stays a header** with its standard spelling. It describes the delivery of the
  request, not the intent inside it. The stored column is `idempotency_key`, matching
  `session_attachments.idempotency_key` (`api/oss/src/dbs/postgres/sessions/attachments/dbas.py:25`).
- **No `force` flag.** `force` on the current stream endpoint is what makes one route mean four
  things (`api/oss/src/core/sessions/streams/service.py:7`). Cancel means cancel.

The field stays optional, as decision D-010 requires, and first-party clients must always send it.
Today the desktop sends nothing (`web/oss/src/components/AgentChatSlice/hooks/useAgentChatSession.ts:505`,
verified), which is the third guard of the design document's section 4 left switched off.

### Public Cancel response

| Field | Concretely | Role |
|---|---|---|
| `command.id` | The durable command's id | identity, for the caller's own retries and logs |
| `command.state` | `pending` or `obsolete` at admission time | delivery |
| `execution.id` | The execution this Cancel targets, null when nothing ran | routing |
| `execution.state` | `stopping` or `idle` | result |

`command` and `execution` are separate objects because they answer different questions and settle at
different times. A client drawing a button reads `execution`. A client retrying safely reads
`command.id`. This is decision D-016 expressed in the response shape.

### The internal command envelope

The review's corrected shape, adopted here:

| Group | Fields | Role |
|---|---|---|
| top level | `id`, `project_id`, `session_id`, `kind`, `created_at` | identity, routing, metadata |
| `target` | `turn_id` (resolved at admission), `expected_turn_id` (as the caller sent it) | context |
| `input` | `text`, `attachments` | input data, absent for `cancel` |
| `policy` | `on_busy` | policy, absent for `cancel` |
| `delivery` | `claimed_by`, `claim_expires_at`, `attempt` | delivery bookkeeping |

Four rules this applies.

- **Delivery bookkeeping is grouped and never merged with the result.** That is decision D-016, and
  it is easier to hold when the shapes are separate objects.
- **`replica_id` is not a top-level routing field.** It is delivery bookkeeping, it is logical rather
  than an address, and it lives under `delivery` as `claimed_by`.
- **There is no `runner_url` field of any kind.** An address in a durable record is an
  implementation detail with a longer lifetime than the thing it points at.
- **`input` is an object from the start**, not a bare `message` string. A turn already carries text
  plus attachments (`services/runner/src/server.ts:565`), so a string could not grow into that
  without a breaking change. `cancel` omits the group entirely rather than sending it empty.

`created_at` is on the envelope because the runner needs it: it refuses to abort an execution that
started after the command was created.

### Internal claim request

| Field | Concretely | Owner | Role |
|---|---|---|---|
| `replica_id` | Which runner is asking, for `claimed_by` | Runner | delivery bookkeeping |
| `sessions` | The sessions this runner holds warm right now | Runner | routing |
| `wait_seconds` | How long the caller accepts being held | Runner | protocol context of this call |
| `limit` | How many commands to return at most | Runner | protocol context of this call |

`sessions` is the routing input, not `replica_id`. The runner declares what it holds, so the API
never has to guess from an expiring Redis key, and a parked session keeps receiving commands after
its heartbeat stops. A claim is a query over durable state, never a cursor or a stream position.

### Internal outcome request

| Field | Concretely | Owner | Role |
|---|---|---|---|
| `replica_id` | Which runner is reporting | Runner | delivery bookkeeping, and the claim guard |
| `result` | The command's terminal state | Runner | delivery |
| `execution.id` | Which execution the runner acted on | Runner | routing |
| `execution.state` | What happened to it | Runner | result |
| `execution.error` | Why it failed, when it did | Runner | result |

`execution.error` sits under `execution` because it explains one field of that object.

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
    # the browser fills it from the session snapshot, and a first-party client always sends it.
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
| 202 Accepted | An execution was running or parked. The command is durable and on its way | `command.state = "pending"`, `execution.state = "stopping"` |
| 200 OK | Nothing was running and no `expected_execution_id` was sent | `command.state = "obsolete"`, `execution.state = "idle"`, `execution.id = null` |
| 200 OK | The running execution started **after** this request arrived, and no `expected_execution_id` was sent | `command.state = "obsolete"`, `execution.state = "idle"`, `execution.id = null`. The newer execution is not touched. See the stale-Stop guard in section 4 of the design document |
| 409 Conflict | `expected_execution_id` does not name the running execution | `detail: {"message": ..., "current_execution_id": <id or null>}` |
| 422 | The session id fails the allowlist (`SessionIdInvalid`) | `detail: <message>` |
| 403 | The caller lacks `RUN_SESSIONS` | `FORBIDDEN_EXCEPTION` |

The two 200 cases are deliberately indistinguishable to the client. Both mean "there is nothing of
yours left to stop", and a client that needs to know which one it hit is reading the wrong signal:
it should read the session's execution state, not this response. The command row keeps the exact
reason in `outcome` for anyone debugging afterwards.

202 and not 200 for the accepted case, because the work is not done when the response returns. The
caller learns the outcome from the session's own state, not from this response. **A delivery failure
does not change the status**: the command is inserted and committed before any adapter is called, so
an unreachable runner still yields 202 and the watchdog settles the command.

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

## 3. Deferred: claim commands (future long-poll adapter)

```http
POST /sessions/control/commands/claim
X-Agenta-Runner-Token: <AGENTA_RUNNER_TOKEN>

{
  "replica_id": "runner-7f3c",
  "sessions": [
    {"project_id": "1f0a4b2c-0000-4000-8000-000000000002", "session_id": "sess-42"}
  ],
  "wait_seconds": 25,
  "limit": 10
}
```

Not a product API. It is excluded from the public schema with `include_in_schema=False`, the
treatment the admin routers already get (`api/entrypoints/routers.py:1502`).

Authentication is the shared runner token, not a user credential: the loop belongs to the process
and spans many projects, and a run's credential expires while the process keeps polling. The path
prefix `/sessions/control/` is added to `_PUBLIC_ENDPOINTS` (`api/oss/src/middlewares/auth.py:52`)
so the project-scoped middleware does not reject a request with no user credential, and the route
then compares the presented token to `env.runner.token` in constant time. If that setting is unset
the route answers 503 and serves nothing. Scope comes from the declared `(project_id, session_id)`
pairs and the rows themselves, never from a header.

```python
class SessionScope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: UUID
    session_id: SessionId


class SessionControlClaimRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Delivery bookkeeping: this becomes `claimed_by` so a settle can be matched to its claim.
    # Not routing, and not an address.
    replica_id: str = Field(min_length=1, max_length=128)
    # The routing input: every session this runner holds warm right now, including sessions
    # parked awaiting an approval. Most recently used first.
    sessions: List[SessionScope] = Field(min_length=1, max_length=200)
    # How long the API may hold this request. Clamped server-side to the configured hold.
    wait_seconds: int = Field(default=25, ge=0, le=60)
    limit: int = Field(default=10, ge=1, le=50)


class SessionCommandTarget(BaseModel):
    # Resolved once at admission; the runner aborts only this execution.
    turn_id: Optional[str] = None
    # What the caller asserted, kept so a 409 stays explainable after the fact.
    expected_turn_id: Optional[str] = None


class SessionCommandDelivery(BaseModel):
    claimed_by: str
    claim_expires_at: datetime
    attempt: int


class SessionCommandEnvelope(BaseModel):
    """One command as the runner receives it. Every transport delivers this same shape,
    so the runner has one parser, one set of guards and one applier."""

    id: UUID
    project_id: UUID
    session_id: str
    kind: Literal["cancel"]
    target: SessionCommandTarget
    delivery: SessionCommandDelivery
    # The runner refuses to abort an execution that started after this time.
    created_at: datetime
    # Absent for `cancel`. Present for the kinds that carry them, so a reader never has to
    # interpret an empty object.
    input: Optional[SessionCommandInput] = None
    policy: Optional[SessionCommandPolicy] = None


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
| 422 | `sessions` is empty or over the cap |
| 503 Service Unavailable | `AGENTA_RUNNER_TOKEN` is not configured on the API |

204 rather than an empty 200 keeps the common case cheap and gives the runner an unambiguous "claim
again now" signal.

---

## 4. Internal: report a command's outcome

Used by **both** adapters. Settlement has one path on every transport.

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
    # stopped: cancelled as asked. not_running: no such execution here.
    # superseded_by_newer_turn: the held execution started after the command arrived.
    # failed: the cancel itself failed.
    state: Literal["stopped", "failed", "not_running", "superseded_by_newer_turn"]
    # Short, human-readable, present only when `state` is "failed".
    error: Optional[str] = Field(default=None, max_length=2000)


class SessionControlOutcomeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    replica_id: str = Field(min_length=1, max_length=128)
    # The command's terminal state. `applied` means the runner did the work; `obsolete`
    # means there was nothing to do.
    result: Literal["applied", "obsolete"]
    execution: SessionExecutionOutcome


class SessionCommandSettlement(BaseModel):
    id: UUID
    state: Literal["applied", "obsolete"]
    outcome: Literal["stopped", "not_running", "superseded_by_newer_turn", "failed", "lost"]
    settled_at: datetime


class SessionControlOutcomeResponse(BaseModel):
    command: SessionCommandSettlement
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

## 5. Internal: the runner's cancel route (direct-call adapter)

This is the runner's own HTTP surface, not the API's. It sits beside the existing `POST /kill`
(`services/runner/src/server.ts:704`, verified) and shares its token gate, its capped body reader and
its scoping rule. The API calls it the way `kill_runner_sandbox` already calls `/kill`
(`api/oss/src/core/sessions/streams/runner_client.py:30`, verified).

```http
POST /cancel
Authorization: Bearer <AGENTA_RUNNER_TOKEN>

{
  "commandId": "0199a3f2-0000-7000-8000-000000000001",
  "projectId": "1f0a4b2c-0000-4000-8000-000000000002",
  "sessionId": "sess-42",
  "targetTurnId": "0199a3f1-0000-7000-8000-00000000000a",
  "createdAt": "2026-09-02T22:09:01Z"
}
```

`camelCase` because the runner's existing routes use it. `projectId` and `sessionId` are both
required, for the same reason `/kill` requires both: a pool key is always project-scoped, so a
single-tenant scope needs the pair.

Responses:

| Status | When | Meaning to the API adapter |
|---|---|---|
| 202 Accepted | The runner holds this session and accepted the command | `accepted`; the outcome will arrive on the outcome route |
| 404 Not Found | The runner does not hold this session | `not_held`; the service settles the command at once |
| 400 | `sessionId` or `projectId` missing | `unreachable`, and a bug to fix |
| 401 | Token mismatch | `unreachable`, and a deployment error to log loudly |

**The response is an acknowledgement, not an outcome.** The runner reports what happened to the
execution through the outcome route in section 4, so both adapters settle through one path.

**404 is ambiguous, and the API must disambiguate it.** `not_held` is the honest answer both when the
session really has ended and when the call reached the wrong replica. The API tells them apart with
data it already has: a `not_held` for a session whose row says `is_alive` with a heartbeat younger
than one interval is the wrong-replica failure. It is logged at error level, counted, and settled as
`lost` rather than `not_running`, so the user is told the Stop failed instead of being told the work
had already finished. Section 9 of the design document has the rule and the optional preventive
configuration check.

**The runner resolves a parked session through the pool, not the execution registry.** A Stop against
a parked approval has no in-flight execution, so `/cancel` falls back to
`SessionPool.awaitingApproval(sessionId)`
(`services/runner/src/engines/sandbox_agent/session-pool.ts:117`, verified) before answering 404.

---

## 6. One field added to an existing contract

The heartbeat response grows one field. Nothing else about `POST /sessions/streams/heartbeat`
changes.

```python
class SessionHeartbeatResult(BaseModel):
    stream: Optional[SessionStream] = None
    replica_id: str
    is_current_turn: bool = True
    # Commands for THIS session only, claimed by this beat under the same compare-and-set
    # the claim route uses. Empty in the normal case.
    commands: List[SessionCommandEnvelope] = Field(default_factory=list)
```

The field is additive and defaults to an empty list, so a runner build that does not know about it is
unaffected.

This fallback reaches only a session with a live turn. The heartbeat stops when a turn ends or parks
(`services/runner/src/server.ts:618` and `services/runner/src/sessions/alive.ts:241`, verified), so
it is not the delivery path for a parked session and must not be relied on as one.

---

## 7. What does not change in version one

- `POST /sessions/streams/` keeps its current four-mode behavior until the last migration step, when
  its cancel branch becomes a thin wrapper over the same command. See section 10 of the design
  document.
- `DELETE /sessions/streams/` (kill) is untouched. Stop and Delete stay different operations
  (decision D-008).
- `POST /sessions/interactions/{interaction_id}/respond` is untouched. Turning interaction responses
  into commands is later work, and so is the `continuation` field the architecture review asks for on
  its response.
- No new public read route. Clients keep using `GET /sessions/streams/` and the watch stream.
- Steer stays out. The `input` and `policy` groups are reserved in the envelope so it does not need a
  breaking change later, but no route accepts them in version one.
