# Spike B: durable commands and long polling

> AGENT-GENERATED, low weight. Implementation-ready design for discussion. Mahmoud makes final
> decisions.

Scope: reliable API-to-runner commands, version one. The only command kind in version one is
Cancel, which the product calls Stop. The design keeps Redis execution ownership as it is, adds no
Postgres execution authority, no ownership generations, no stale-writer fencing, and no
multi-runner routing.

Every claim below is marked **verified** (read in the code of this worktree, with `path:line`) or
**reported** (taken from a document, named at the point of use).

Terms used here:

- **Execution:** one runner attempt at one user message. In the code today its identifier is the
  `turn_id` the runner mints (`services/runner/src/server.ts:190`). This design does not rename it.
- **Command:** one durable request to change an execution.
- **Owner replica:** the runner container that holds the session's Redis `owner` key.

---

## 1. What happens today when a user presses Stop

**Verified.** The browser stops its own stream at once. The runner learns nothing until its next
heartbeat, which is up to 30 seconds later. The sandbox is then deleted, so the next message is a
cold start.

The chain, in order:

1. `handleStop` marks the turn stopped locally and aborts the client fetch
   (`web/oss/src/components/AgentChatSlice/hooks/useAgentChatSession.ts:480`).
2. The browser posts `POST /sessions/streams/` with no inputs and no `force`
   (`web/packages/agenta-entities/src/session/api/api.ts:575`). Mobile posts the same call
   (`web/mobile/src/features/chat/StopButton.tsx:18`).
3. The route runs `set_session_stream` (`api/oss/src/apis/fastapi/sessions/router.py:369`), which
   calls `SessionStreamsService.command` (`api/oss/src/core/sessions/streams/service.py:229`).
4. No inputs and no `force` resolves to `CommandMode.cancel`
   (`api/oss/src/core/sessions/streams/service.py:288`).
5. Cancel calls `_displace_turns` (`api/oss/src/core/sessions/streams/service.py:169`). It writes a
   supersession tombstone for the current `alive` and `running` owners, then force-deletes both keys
   (`service.py:190` and `service.py:193`). It marks the row ended and publishes the `ended`
   lifecycle event. **The API never contacts the runner.**
6. The runner finds out on its next heartbeat. The beat runs on a 30 second interval
   (`services/runner/src/sessions/alive.ts:221`, `HEARTBEAT_INTERVAL_SECONDS = 30` in
   `services/runner/src/sessions/contract.ts:18`).
7. The beat returns `is_current_turn: false`
   (`api/oss/src/core/sessions/streams/service.py:452`), the runner reads it as `interrupted`
   (`services/runner/src/sessions/alive.ts:105`), and the watchdog fires `onInterrupted` once
   (`alive.ts:207`), which `server.ts:519` wires to `controller.abort()`.
8. The abort makes `shouldPark` return false, so the environment is destroyed rather than parked
   (`services/runner/src/engines/sandbox_agent/engine.ts:26`). The sandbox and the native harness
   session are gone.

### The delay chain

| Step | Where | Cost |
|---|---|---|
| Browser aborts its own stream | `useAgentChatSession.ts:480` | immediate |
| Cancel request returns | `router.py:369` | one API round trip |
| Redis keys cleared, row marked ended | `streams/service.py:190` | inside that call |
| Runner notices | `alive.ts:221` | **0 to 30 seconds** |
| Run aborts | `server.ts:519` | immediate after the beat |
| Harness cancel and sandbox teardown | `engine.ts:26` | seconds, and the sandbox is deleted |

The 30 second wait is the whole problem. Two further defects ride on it:

- **A Stop can be lost silently.** A heartbeat that returns a non-2xx status yields
  `interrupted: false` by design (`services/runner/src/sessions/alive.ts:92`). A run whose platform
  credential expired or was dropped can never be stopped. Verified in the code; the credential
  states are logged at `services/runner/src/server.ts:445`.
- **Stop is not free.** Because the abort path destroys the environment, Stop today costs the warm
  sandbox and the native harness session. Work package A owns the fix. This design assumes it
  delivers a warm park on Stop.

---

## 2. The command record

### Placement

| Question | Answer |
|---|---|
| Database | Core Postgres (`env.postgres.uri_core`, `TransactionsEngine`), the same database as `session_streams`, `session_turns`, `session_interactions`. Verified at `api/oss/src/dbs/postgres/shared/engine.py:29`. |
| Table | `session_commands` |
| Core module | `api/oss/src/core/sessions/commands/` with `dtos.py`, `interfaces.py`, `service.py`, `types.py`, matching the layout of `core/sessions/interactions/` |
| Storage module | `api/oss/src/dbs/postgres/sessions/commands/` with `dbas.py`, `dbes.py`, `dao.py`, `mappings.py` |
| Migration | `api/oss/databases/postgres/migrations/core_oss/versions/oss000000022_add_session_commands.py`, revising `oss000000021` (verified: `oss000000021_add_session_streams_references.py` is the current head of that chain) |

Not tracing. The tracing database holds spans, and a command is coordination state that the
sessions plane owns.

### Columns

The mixins are the house ones from `api/oss/src/dbs/postgres/shared/dbas.py`: `ProjectScopeDBA`,
`IdentifierDBA`, `LifecycleDBA`, `DataDBA`, `FlagsDBA`, `TagsDBA`, `MetaDBA`. That is the same set
`SessionInteractionDBA` uses (`api/oss/src/dbs/postgres/sessions/interactions/dbas.py:14`).

| Column | Type | Role | Meaning |
|---|---|---|---|
| `project_id` | UUID, not null | scope | Tenant boundary. Foreign key to `projects.id`, `ON DELETE CASCADE`. |
| `id` | UUID, not null, uuid7 | identity | The `command_id`. The API mints it. |
| `session_id` | String, not null | routing | Which session the command acts on. A bare correlator, not a foreign key, like every other sessions table. |
| `kind` | String, not null | data | `cancel` in version one. |
| `data` | JSON, null | data | The command's own arguments. Empty for `cancel`. `steer` will put its message here. |
| `state` | String, not null | state | `pending`, `claimed`, `applied`, `obsolete`. |
| `outcome` | String, null | state | Why the command left the machine: `stopped`, `not_running`, `failed`, `lost`, `superseded`. Null while open. |
| `target_turn_id` | String, null | routing | The execution this command must reach. Resolved at admission from Redis. Null when nothing was running. |
| `owner_replica_id` | String, null | routing | The runner container that held the session at admission. Null when the `owner` key had expired. |
| `idempotency_key` | String, null | context | The caller's `Idempotency-Key` header, stored verbatim. |
| `claimed_by` | String, null | routing | The replica that holds the current claim. |
| `claim_expires_at` | TIMESTAMP tz, null | policy | When the claim may be delivered again. |
| `claim_count` | Integer, not null, default 0 | policy | Deliveries so far. Caps re-delivery. |
| `settled_at` | TIMESTAMP tz, null | metadata | When the command reached a terminal state. |
| `flags`, `tags`, `meta` | JSONB / JSON, null | metadata | House mixins. Unused in version one, present for consistency. |
| `created_at`, `updated_at`, `deleted_at`, `created_by_id`, `updated_by_id`, `deleted_by_id` | `LifecycleDBA` | metadata | House lifecycle columns. |

Two roles are kept apart on purpose. `state` is the delivery state of the command. `outcome` is
what happened to the execution. A reader that wants "did Stop work" reads `outcome`; a reader that
wants "is the command still in flight" reads `state`. This is decision D-016 expressed as two
columns instead of one overloaded one.

### One column added to `session_streams`

`stopping_turn_id`, String, nullable. It names the execution that an accepted Stop is waiting on. It
is written in the same transaction as the command insert, and cleared at settlement.

It is a column and not a bit inside `flags` because `flags` is the Redis mirror. Every heartbeat
rewrites it (`api/oss/src/core/sessions/streams/service.py:618`), so a stopping bit stored there
would be erased on the next beat. `SessionStreamEdit` carries only `flags`, `tags`, `meta` and
`turn_id` (`api/oss/src/core/sessions/streams/dtos.py:73`), so the heartbeat path cannot touch a
new column by accident.

### Indexes and constraints

```python
__table_args__ = (
    ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
    PrimaryKeyConstraint("project_id", "id"),
    UniqueConstraint(
        "project_id", "session_id", "idempotency_key",
        name="uq_session_commands_idempotency",
    ),
    CheckConstraint("kind IN ('cancel')", name="ck_session_commands_kind"),
    CheckConstraint(
        "state IN ('pending', 'claimed', 'applied', 'obsolete')",
        name="ck_session_commands_state",
    ),
    Index(
        "ix_session_commands_delivery",
        "owner_replica_id", "created_at",
        postgresql_where=text("state = 'pending' AND deleted_at IS NULL"),
    ),
    Index(
        "ix_session_commands_claims",
        "claim_expires_at",
        postgresql_where=text("state = 'claimed' AND deleted_at IS NULL"),
    ),
    Index(
        "ix_session_commands_project_session",
        "project_id", "session_id", "created_at",
    ),
)
```

`ix_session_commands_delivery` is the long-poll query's index. It leads with `owner_replica_id` and
not with `project_id` because one poll serves one runner across every project. A btree stores
nulls, so the same index also serves the `owner_replica_id IS NULL` case.

The check constraints copy the shape of `ck_session_attachments_state`
(`api/oss/src/dbs/postgres/sessions/attachments/dbes.py:35`).

### Idempotency, in two layers

1. **Client key.** `uq_session_commands_idempotency` on `(project_id, session_id,
   idempotency_key)`, the same triple `uq_session_attachments_idempotency` uses
   (`api/oss/src/dbs/postgres/sessions/attachments/dbes.py:29`). An insert that hits the constraint
   is caught, the existing row is read back, and it is returned to the caller. That is the pattern
   `SessionInteractionsDAO.create_interaction` already uses
   (`api/oss/src/dbs/postgres/sessions/interactions/dao.py:60`). A null key never collides, because
   Postgres treats nulls as distinct in a unique index.
2. **Open-command collapse.** Even with no client key, admission first looks for an open command
   (`state IN ('pending','claimed')`) of the same `kind` for the same `(project_id, session_id,
   target_turn_id)`. If one exists, the API returns it instead of creating a second. This is what
   makes "two Stops in a row" correct without asking the browser to send a key.

The server `command_id` is the idempotency identity of every later step. A settle for a command that
already reached a terminal state returns the stored state and changes nothing.

### Retention

Settled rows (`state IN ('applied','obsolete')`) are deleted 7 days after `settled_at` by the sweep
described in section 4. Commands are operational state, not session history. Durable session history
stays in `session_records`. Open rows are never deleted by the sweep; the watchdog settles them
first.

---

## 3. The state machine

```text
                    admission
                        |
                        v
      +------------> pending ------------------------+
      |                 |                            |
      | lease expired   | claim (poll or heartbeat)  | nothing to do
      | and attempts    v                            v
      | remain      claimed --------> applied     obsolete
      |                 |     runner
      +-----------------+     reports
                        |
                        | lease expired, attempts exhausted
                        v
                     obsolete (outcome = lost)
```

`applied` and `obsolete` are terminal. There is no transition out of either.

Every transition is one `UPDATE ... WHERE ... RETURNING *` whose `WHERE` names the state it expects.
`scalar_one_or_none()` decides the winner, so two API replicas cannot both win. This is exactly the
pattern `SessionInteractionsDAO.transition_interaction` already uses
(`api/oss/src/dbs/postgres/sessions/interactions/dao.py:120`). Verified.

| Transition | Who does it | Guard |
|---|---|---|
| none to `pending` | The API, on an accepted Cancel | `INSERT`, protected by `uq_session_commands_idempotency` and by the open-command collapse read in the same transaction |
| none to `obsolete` | The API, when nothing is running | Same insert, with `state='obsolete'`, `outcome='not_running'`, `settled_at=now()` |
| `pending` to `claimed` | The API, serving a long poll or a heartbeat | `WHERE state = 'pending'` |
| `claimed` to `pending` | The command sweep, when a lease expired and attempts remain | `WHERE state = 'claimed' AND claim_expires_at < now() AND claim_count < :max_deliveries` |
| `claimed` to `applied` | The API, on the runner's outcome report | `WHERE state = 'claimed' AND claimed_by = :replica_id` |
| `claimed` to `obsolete` | The API, on the runner's outcome report of `not_running` | Same guard |
| `claimed` to `obsolete` (`lost`) | The command sweep, when attempts are exhausted | `WHERE state = 'claimed' AND claim_expires_at < now() AND claim_count >= :max_deliveries` |
| `pending` to `obsolete` (`superseded`) | The API, when the target execution ended without the command being applied | `WHERE state = 'pending'` |

The claim statement, in the form the DAO writes it:

```sql
UPDATE session_commands
   SET state = 'claimed',
       claimed_by = :replica_id,
       claim_expires_at = now() + make_interval(secs => :lease_seconds),
       claim_count = claim_count + 1,
       updated_at = now()
 WHERE (project_id, id) IN (
         SELECT project_id, id
           FROM session_commands
          WHERE state = 'pending'
            AND deleted_at IS NULL
            AND (owner_replica_id = :replica_id OR owner_replica_id IS NULL)
          ORDER BY created_at
          LIMIT :limit
          FOR UPDATE SKIP LOCKED
       )
RETURNING *;
```

`FOR UPDATE SKIP LOCKED` is what lets two API replicas serve two polls at the same time without
either blocking or double-claiming. The settle statement:

```sql
UPDATE session_commands
   SET state = :result, outcome = :outcome, settled_at = now(), updated_at = now()
 WHERE project_id = :project_id
   AND id = :command_id
   AND state = 'claimed'
   AND claimed_by = :replica_id
RETURNING *;
```

Zero rows means the claim had already expired or another actor settled it. The route then reads the
row and answers 409 with its stored state, so the runner learns the truth instead of retrying.

---

## 4. The claim lease

| Setting | Value | Environment variable |
|---|---|---|
| Lease duration | 60 seconds | `AGENTA_SESSIONS_COMMAND_LEASE_SECONDS` |
| Maximum deliveries | 3 | `AGENTA_SESSIONS_COMMAND_MAX_DELIVERIES` |
| Sweep interval | 10 seconds | `AGENTA_SESSIONS_COMMAND_SWEEP_SECONDS` |
| Admission timeout for a never-claimed command | 90 seconds | `AGENTA_SESSIONS_COMMAND_ADMISSION_TIMEOUT_SECONDS` |

All four go in `SessionsRedisConfig`'s neighbour, a new `SessionsCommandsConfig` block in
`api/oss/src/utils/env.py`, read through the shared `env` object. Do not call `os.getenv` in the
service (`AGENTS.md`, "Environment config").

**Renewal: none in version one.** A claim is not renewed while the runner works. It simply expires
and is delivered again. This is safe because applying a Cancel is idempotent: the second delivery
aborts an execution that is already aborting, and the runner's own deduplication (below) makes it a
no-op anyway. A renewal endpoint is the first thing to add if a harness cancel is ever slower than
the lease, and the column that would carry it (`claim_expires_at`) already exists.

**Expiry and re-delivery.** A background asyncio task, `command_sweep_loop`, runs on the FastAPI
lifespan exactly like `orphan_sweep_loop`
(`api/oss/src/tasks/asyncio/sessions/orphan_sweep.py`, verified). Each pass:

1. Re-arms every expired claim that has attempts left (`claimed` back to `pending`).
2. Settles every expired claim that has none as `obsolete` with `outcome = 'lost'`, then runs the
   same settlement side effects a runner report would run (section 7, case 6).
3. Settles every `pending` command older than the admission timeout as `obsolete` with
   `outcome = 'lost'`. This is the "no runner ever came" case.
4. Deletes settled rows older than the retention window.

**Deduplication on the runner.** The runner keeps one module-level map from `command_id` to the time
it was applied, with a 10 minute time to live and a bounded size. Both delivery paths, the long poll
and the heartbeat, call one `applyCommand(command)` entry point that consults this map first. A
command already in the map is settled again (the report is cheap and idempotent) but not applied
twice. This mirrors the existing `inFlightSandboxes` module-level registry
(`services/runner/src/engines/sandbox_agent/environment.ts:239`, verified).

**The `expected_execution_id` check.** It happens twice, in two different places, for two different
reasons.

1. **At admission, against Redis.** The API reads the running owner with `get_running_owner`, and
   falls back to `get_alive_owner`, both already imported by the streams service
   (`api/oss/src/core/sessions/streams/service.py:39`). That value is the current execution's
   `turn_id`. If the caller supplied `expected_execution_id` and it differs, the API answers 409 and
   creates nothing. If the caller supplied nothing, the API adopts the running owner as
   `target_turn_id`.
2. **At application, on the runner.** The runner applies the command only to a local execution whose
   `turnId` equals `target_turn_id`. If it holds no such execution, it settles the command as
   `obsolete` with `execution.state = "not_running"`. This is what stops a re-delivered command from
   aborting a later execution that started in the meantime.

---

## 5. The long-poll contract

### Routes

| Route | Method | Caller | Purpose |
|---|---|---|---|
| `/sessions/control/commands/claim` | POST | Runner | Hold until a command exists for this replica, then claim and return it |
| `/sessions/control/commands/{command_id}/outcome` | POST | Runner | Report the terminal outcome |

Both live on a new `SessionControlRouter` in `api/oss/src/apis/fastapi/sessions/router.py`, included
with no prefix like the streams router (`api/entrypoints/routers.py:1354`, verified).

### Authentication

The runner authenticates its per-run calls as the invoke caller, using the ephemeral platform
credential from the run (`services/runner/src/sessions/alive.ts:60`, verified). That credential
cannot carry these routes: a poll belongs to the runner process, not to one project or one user, and
a run's credential can expire while the process keeps polling.

So these two routes use the shared runner token, `AGENTA_RUNNER_TOKEN`, which both sides already
hold (`api/oss/src/utils/env.py:1161` as `env.runner.token`, and
`services/runner/src/server.ts:104`). Verified.

Mechanics:

- Add the prefix `/sessions/control/` to `_PUBLIC_ENDPOINTS`
  (`api/oss/src/middlewares/auth.py:52`), so the project-scoped auth middleware does not reject a
  request that carries no user credential. This is the same treatment the OAuth callback and the
  Composio event routes already get.
- The route then does its own check, with a constant-time comparison against `env.runner.token`,
  accepting `X-Agenta-Runner-Token: <token>` first and `Authorization: Bearer <token>` second. That
  is the header pair and the comparison the runner itself already implements
  (`services/runner/src/server.ts:127`).
- **Fail closed.** If `env.runner.token` is unset or blank, both routes answer 503 and serve nothing.
  Being exempt from the middleware makes the route's own check the only gate, so it must never
  default to open.
- The project scope of each command comes from its own row, never from the request. The runner
  cannot ask for another tenant's commands, because it can only ask for its own `replica_id`.

### Request and response bodies

Claim request:

```json
{
  "replica_id": "runner-7f3c",
  "wait_seconds": 25,
  "limit": 10
}
```

`wait_seconds` is bounded server-side to `[0, AGENTA_SESSIONS_CONTROL_POLL_HOLD_SECONDS]`, default
25. `limit` is bounded to `[1, 50]`, default 10.

Claim response, 200:

```json
{
  "count": 1,
  "commands": [
    {
      "id": "0199a3f2-0000-7000-8000-000000000001",
      "project_id": "1f0a4b2c-0000-4000-8000-000000000002",
      "session_id": "sess-42",
      "kind": "cancel",
      "target_turn_id": "0199a3f1-0000-7000-8000-00000000000a",
      "data": {},
      "claim": {
        "expires_at": "2026-09-02T22:10:31Z",
        "attempt": 1
      }
    }
  ]
}
```

`count` plus a list is the house response envelope (`SessionsResponse`,
`api/oss/src/apis/fastapi/sessions/models.py:105`).

Claim response, 204: the hold expired with nothing to deliver. No body.

Outcome request:

```json
{
  "replica_id": "runner-7f3c",
  "result": "applied",
  "execution": {
    "id": "0199a3f1-0000-7000-8000-00000000000a",
    "state": "stopped"
  }
}
```

`result` is the command's terminal state, `applied` or `obsolete`. `execution.state` is one of
`stopped`, `failed`, `not_running`. `execution.error` is a short string, present only when the state
is `failed`. The two objects are separate because they answer different questions and have different
owners: `result` is delivery bookkeeping the runner controls, `execution` is a product fact the user
sees.

Outcome response, 200:

```json
{
  "command": {
    "id": "0199a3f2-0000-7000-8000-000000000001",
    "state": "applied",
    "outcome": "stopped",
    "settled_at": "2026-09-02T22:09:12Z"
  }
}
```

Outcome response, 409: the claim was not held by this replica. The body carries the same `command`
object with its stored state, so the runner can stop and move on rather than retry.

### How the hold works

The route subscribes to a per-replica Redis Pub/Sub channel on the durable plane, then loops:

1. Claim once, without waiting. Return 200 if anything came back.
2. Wait on the subscription with a one second timeout, so the loop can re-check the shutdown flag.
3. On a message, or every second, try the claim again.
4. When the hold budget runs out, return 204.

Two details are not optional:

- **Add `control_channel(replica_id)` to the Redis contract**
  (`api/oss/src/dbs/redis/sessions/contract.py`), with the payload `{"type": "command-pending"}` and
  nothing else. The channel is not project-scoped, because a replica is not a tenant, so no tenant
  data may ride it. The poll re-queries Postgres, which is the authority.
- **Reuse the watch endpoint's shutdown release.** `api/oss/src/apis/fastapi/sessions/watch.py:50`
  installs a hook on uvicorn's exit path because a held response blocks graceful shutdown for ever.
  A held long poll has exactly the same failure. Import `request_shutdown` and the same threading
  event, or move both into a small shared helper.

### What the runner does

One poll per runner process, not one per session. The loop is a module in
`services/runner/src/sessions/control-poll.ts`, started once from the server bootstrap next to the
signal handlers (`services/runner/src/server.ts:912`). It runs whether or not a turn is in flight,
so a Stop arrives even for a session this process is not currently streaming.

| Result | What the runner does |
|---|---|
| 200 with commands | Apply each through `applyCommand`, report each outcome, then poll again at once |
| 204 | Poll again at once |
| Hold timeout with no response (network read timeout) | Poll again after the backoff floor |
| Network error, 502, 503, 504 | Back off: 1 s, 2 s, 4 s, 8 s, 16 s, then 30 s, with 20 percent jitter. Reset on the first success |
| 401 or 403 | Log once at error level and retry every 60 s. This is a deployment misconfiguration and must be loud, not a fast retry loop |
| 429 | Back off as for a network error |
| API restart | The held connection closes. This is the network error case. Nothing is lost, because commands are durable |

The client timeout must exceed the hold: set the fetch timeout to `hold_seconds + 10`.

### How the API maps a pending command to a replica

At admission the API reads the session's Redis `owner` key with `get_owner`
(`api/oss/src/dbs/redis/sessions/locks.py`, already imported at
`api/oss/src/core/sessions/streams/service.py:38`) and stores the result in `owner_replica_id`. The
key is refreshed on every heartbeat through `claim_owner`
(`api/oss/src/core/sessions/streams/service.py:458`), and its time to live is 120 seconds
(`OWNER_TTL_SECONDS`, verified in `api/oss/src/dbs/redis/sessions/contract.py:40`), so a running
session always has a fresh one.

If the key is absent, `owner_replica_id` stays null, and the claim query offers the command to any
polling runner. With one runner that is correct. With several it is still safe, because the runner
that does not hold the execution settles the command as `not_running` and the sweep re-delivers it.
Making null-owner routing exact needs multi-runner routing, which is deferred.

---

## 6. The heartbeat fallback

One field is added to the heartbeat response DTO `SessionHeartbeatResult`
(`api/oss/src/core/sessions/streams/dtos.py:180`):

```python
class SessionHeartbeatResult(BaseModel):
    stream: Optional[SessionStream] = None
    replica_id: str
    is_current_turn: bool = True
    # Commands for THIS session, claimed by this beat under the same compare-and-set the
    # long poll uses. Empty when there is nothing to deliver, which is the normal case
    # once long polling is running.
    commands: List[SessionCommandEnvelope] = Field(default_factory=list)
```

`SessionCommandEnvelope` is the same model the long poll returns, so the runner has one parser and
one applier.

Rules:

- The heartbeat serves only commands for the beat's own `(project_id, session_id)`, and only those
  whose `target_turn_id` matches the beat's `turn_id` or is null. It never serves another session's
  commands, because the beat is authenticated with the run's project-scoped credential.
- It claims them under the same statement as the poll, so a command cannot be delivered by both
  paths at the same time. One of the two wins the compare-and-set; the other sees zero rows.
- The runner deduplicates by `command_id` in the map described in section 4, so a command delivered
  by the poll and then offered again by a beat is settled again but applied once.
- The fallback exists for two cases: long polling is switched off, and the poll is failing while the
  per-run heartbeat still works. It is not the normal path.

The runner reads the new field in `sendHeartbeat` (`services/runner/src/sessions/alive.ts:96`) and
hands each entry to `applyCommand`. Note the existing fail-open rule at `alive.ts:92`: a non-2xx
beat returns nothing. That is unchanged, and is one reason the long poll, which does not depend on
the run credential, is the primary path.

---

## 7. Stop, end to end

### Case 1: the normal Stop

1. The browser posts `POST /sessions/{session_id}/cancel` with an optional
   `expected_execution_id` and an optional `Idempotency-Key` header. It marks its own view
   "stopping" and stops rendering. It does not abort anything server-side by itself.
2. The API authorizes the caller with `Permission.RUN_SESSIONS`, the same permission the current
   cancel uses (`api/oss/src/apis/fastapi/sessions/router.py:377`).
3. The API reads the current execution from Redis: `get_running_owner`, falling back to
   `get_alive_owner`. Call it `turn_id`.
4. **One transaction.** Insert the command with `state='pending'`, `kind='cancel'`,
   `target_turn_id=turn_id`, `owner_replica_id=<owner key>`, and set
   `session_streams.stopping_turn_id = turn_id` on the same session's row. The DAO method takes an
   optional `AsyncSession` so both writes share one session, the pattern
   `RecordsDAO.append` already uses (`api/oss/src/dbs/postgres/sessions/records/dao.py:33`).
5. **Redis is not touched.** No tombstone, no `force_cancel_alive`, no `clear_running`. The current
   execution keeps `alive` and `running` while it stops, which is what keeps a second message from
   starting underneath it. This is decision D-017.
6. The API publishes `{"type": "command-pending"}` on the owner replica's control channel, then
   returns 202 with the command id and the target execution id.
7. The held long poll wakes, claims the command, and returns it to the runner within the API round
   trip.
8. The runner's `applyCommand` looks up the live execution by `target_turn_id` in its execution
   registry and aborts it. The abort must be a harness cancel that keeps the sandbox and the native
   harness session warm. **This step is Work package A's deliverable.** Today the same abort deletes
   the sandbox (`services/runner/src/engines/sandbox_agent/engine.ts:26`, verified).
9. The runner posts `POST /sessions/control/commands/{command_id}/outcome` with
   `result: "applied"` and `execution: {"id": turn_id, "state": "stopped"}`.
10. The API settles both, in one transaction:
    - Command: `state='applied'`, `outcome='stopped'`, `settled_at=now()`, guarded on
      `state='claimed' AND claimed_by=<replica>`.
    - Stream row: clear `stopping_turn_id`.
11. The API releases ownership, in this order:
    - `mark_turn_superseded(turn_id)`, so a late beat from the stopped execution cannot re-arm the
      locks.
    - `release_running(turn_id)`, owner-checked, so it can only release its own execution's key.
    - **`alive` is left alone.** It expires on its own time to live, exactly as it does at the end
      of a normal turn (`api/oss/src/core/sessions/streams/service.py:590`, verified). This is the
      deliberate difference from today's cancel, which force-deletes `alive` and is a large part of
      why Stop currently reads as a session teardown. Warm resume is the required outcome, so Stop
      must leave the session in the state a finished turn leaves it in.
12. The API cancels the stopped execution's pending interactions with
    `cancel_session_pending(only_turn_id=turn_id)`, which already exists
    (`api/oss/src/dbs/postgres/sessions/interactions/dao.py:137`).
13. The API publishes the existing watch notification `lifecycle: ended` on the session channel
    (`api/oss/src/core/sessions/streams/service.py:202`), which every open browser already listens
    to.
14. Browsers refetch through their current query paths and show the turn as stopped.

Steps 1 to 8 are the five second budget. Steps 9 to 14 follow the runner's own cancel time.

### Case 2: Stop when nothing runs

At step 3 there is no running owner and no alive owner.

- If the caller sent no `expected_execution_id`: the API inserts the command already settled,
  `state='obsolete'`, `outcome='not_running'`, `settled_at=now()`, and returns 200. No Redis write,
  no delivery. The caller gets a stable command id, so a retry with the same idempotency key returns
  the same record.
- The stream row is not touched, because nothing is stopping.

### Case 3: Stop with a stale `expected_execution_id`

The caller sent an execution id that is not the current running owner. The API returns 409 with a
body naming the current execution id, or null when nothing runs. Nothing is inserted and nothing is
delivered. The browser learns that the run it was looking at already ended and refreshes.

### Case 4: Stop while an interaction is pending and the sandbox is parked

A parked approval means the runner is not running a turn: it stopped heartbeating and it holds no
in-flight execution. Verified indirectly, in that the orphan sweep gives alive-but-idle rows a 30
minute grace exactly because "the runner stops beating while a turn is parked"
(`api/oss/src/tasks/asyncio/sessions/orphan_sweep.py:37`).

- Step 3 finds no `running` owner but does find an `alive` owner. `target_turn_id` takes the alive
  owner's value.
- The command is created `pending` and delivered.
- The runner's `applyCommand` finds no live execution with that `turnId`. It settles the command
  `applied` with `execution.state = "not_running"`, and it also drops the parked environment from
  the keep-alive pool for that session so the park does not outlive the stopped work. Whether the
  park is destroyed or kept for the next message is Work package A's call; either is safe here.
- The API settles as in case 1, including cancelling the pending interaction. That closes the class
  of bugs where an approval card survives a Stop and its buttons do nothing.

### Case 5: two Stops in a row

The second request finds an open command for the same `(project_id, session_id, target_turn_id)`
and returns it unchanged, with the same command id. If the second request carries a different
`Idempotency-Key`, the open-command collapse still wins, because it runs before the insert. If the
first command has already settled and a new execution has started, the second Stop is a fresh
command against the new execution, which is what the user meant.

### Case 6: the runner is gone

No poll is held, so the command sits `pending`, or it was claimed and never settled.

- If it was never claimed and is older than the admission timeout, the sweep settles it `obsolete`
  with `outcome='lost'`.
- If it was claimed, the sweep re-arms it up to `max_deliveries` times, then settles it `obsolete`
  with `outcome='lost'`.
- Either way the sweep then runs the same settlement side effects as step 10 to 13 of case 1, except
  that it force-clears `running` rather than owner-releasing it, because the owning process is gone.
  It still leaves `alive` to its own time to live, and the existing orphan sweep will collapse the
  row if the runner never comes back
  (`api/oss/src/tasks/asyncio/sessions/orphan_sweep.py:33`, threshold 300 seconds, verified).

**Proposed timeout: 90 seconds** from admission to a settled command, and 3 deliveries with a 60
second lease within it. This number depends on Work package A. If a warm harness cancel needs a long
drain, for example a running tool that must finish before the harness session can be saved, the
lease has to exceed that drain and 90 seconds is too short. Do not fix this number until the
cancellation spike reports the drain budget.

---

## 8. The control-delivery port

There are two ports, one on each side. They are named separately because they are implemented in
different languages by different components, and only one of them is the RFC's `deliver /
acknowledge / recover`.

### API side, Python

`api/oss/src/core/sessions/commands/interfaces.py`:

```python
class ControlDeliveryPort(ABC):
    """How the API reaches the runner that owns a session. Transport only.

    Durability, authorization, idempotency, the state machine, and terminal settlement
    live in SessionCommandsService and must not move into an adapter.
    """

    @abstractmethod
    async def deliver(
        self,
        *,
        owner_replica_id: Optional[str],
        command: SessionCommand,
    ) -> None:
        """Make `command` visible to its owner promptly. Best effort: a failure here
        never fails admission, because the command is already durable and the sweep and
        the heartbeat fallback both recover it."""
        ...

    @abstractmethod
    async def acknowledge(
        self,
        *,
        command_id: UUID,
        owner_replica_id: str,
    ) -> None:
        """Record that the owner took the command, for adapters that keep their own
        delivery bookkeeping."""
        ...

    @abstractmethod
    async def recover(
        self,
        *,
        owner_replica_id: str,
        limit: int,
    ) -> List[SessionCommand]:
        """Commands this owner should hold but may have missed."""
        ...
```

The long-poll adapter, `api/oss/src/dbs/redis/sessions/control_delivery.py`:

- `deliver` publishes `{"type": "command-pending"}` on `control_channel(owner_replica_id)`. With a
  null owner it publishes on a shared `control:any` channel, so a single-runner deployment still
  wakes immediately.
- `acknowledge` is a no-op. The claim compare-and-set in Postgres is the acknowledgement, so the
  adapter has no bookkeeping of its own.
- `recover` runs the claim query for that replica. The heartbeat fallback and a reconnecting poll
  both go through it.

A later adapter must provide prompt, at-least-once delivery of a wake-up to one named owner. It may
reorder. It may deliver twice. It must not transform or interpret a command, must not settle one,
and must not be the only record that a command exists. Replacing it must change no route, no DTO,
and no state transition.

### Runner side, TypeScript

`services/runner/src/sessions/control-channel.ts`:

```ts
/** One command as the API delivers it. The same shape arrives by long poll and by heartbeat. */
export interface ControlCommand {
  id: string;
  projectId: string;
  sessionId: string;
  kind: "cancel";
  targetTurnId: string | null;
  data: Record<string, unknown>;
}

export interface ControlOutcome {
  /** The command's terminal state. */
  result: "applied" | "obsolete";
  execution: {
    id: string | null;
    state: "stopped" | "failed" | "not_running";
    error?: string;
  };
}

/** The transport. `control-poll.ts` implements it over HTTP long polling. */
export interface ControlChannel {
  /** Block until a command arrives or the hold expires. Never throws for an empty hold. */
  receive(signal: AbortSignal): Promise<ControlCommand[]>;
  /** Report one command's terminal outcome. */
  settle(command: ControlCommand, outcome: ControlOutcome): Promise<void>;
}
```

`applyCommand(command)` sits above the channel, not inside it, so the heartbeat path and the poll
path share one applier and one deduplication map.

The runner also needs an execution registry, because the abort controller is a local variable inside
`runAndStreamWithApiBaseResolved` today (`services/runner/src/server.ts:450`, verified). Add a
module-level map from `${projectId}:${sessionId}:${turnId}` to `{ abort(): void }`, registered when
the run starts and removed in the same `finally` that releases the watchdog
(`services/runner/src/server.ts:604`). This mirrors `inFlightSandboxes`
(`services/runner/src/engines/sandbox_agent/environment.ts:239`).

---

## 9. Migration sequence

Seven pull requests. Each names the files it touches so parallel agents do not collide. Ordering
constraints are stated; anything not constrained can go in any order.

| PR | Title | Files | Depends on |
|---|---|---|---|
| 1 | Add the session command record | `api/oss/databases/postgres/migrations/core_oss/versions/oss000000022_add_session_commands.py`, `api/oss/src/dbs/postgres/sessions/commands/{dbas,dbes,dao,mappings}.py`, `api/oss/src/core/sessions/commands/{dtos,interfaces,service,types}.py`, `api/oss/src/utils/env.py` (the commands config block), `api/entrypoints/routers.py` (wiring only), `api/oss/tests/pytest/unit/sessions/test_session_commands_dao.py` | none |
| 2 | Add the internal control routes | `api/oss/src/apis/fastapi/sessions/router.py` (new `SessionControlRouter`), `api/oss/src/apis/fastapi/sessions/models.py`, `api/oss/src/middlewares/auth.py` (one prefix), `api/oss/src/dbs/redis/sessions/contract.py` (control channel), `api/oss/src/dbs/redis/sessions/control_delivery.py`, `api/entrypoints/routers.py` | 1 |
| 3 | Add the runner control client | `services/runner/src/sessions/control-channel.ts`, `services/runner/src/sessions/control-poll.ts`, `services/runner/src/sessions/execution-registry.ts`, `services/runner/src/server.ts` (register, unregister, start the loop), `services/runner/tests/unit/control-poll.test.ts` | 2 |
| 4 | Public Cancel creates a command | `api/oss/src/apis/fastapi/sessions/router.py`, `api/oss/src/apis/fastapi/sessions/models.py`, `api/oss/src/core/sessions/commands/service.py`, migration for `session_streams.stopping_turn_id`, `api/oss/src/dbs/postgres/sessions/streams/{dbas,dbes,dao}.py` | 1 |
| 5 | Heartbeat command discovery | `api/oss/src/core/sessions/streams/{dtos,service}.py`, `services/runner/src/sessions/alive.ts` | 3, 4 |
| 6 | Command watchdog and retention | `api/oss/src/tasks/asyncio/sessions/command_sweep.py`, `api/entrypoints/routers.py` (lifespan) | 1 |
| 7 | Point the clients at the command | `web/packages/agenta-entities/src/session/api/api.ts`, `web/oss/src/components/AgentChatSlice/hooks/useAgentChatSession.ts`, `web/mobile/src/features/chat/StopButton.tsx`, `api/oss/src/core/sessions/streams/service.py` (the cancel branch becomes a wrapper) | 4, 5 |

Conflict notes:

- PRs 1, 2, 4 and 6 touch `api/entrypoints/routers.py`. Keep each edit to its own block and land
  them in order.
- PRs 2 and 4 both touch `router.py` and `models.py`. Land 2 first; 4 adds a separate router class.
- PR 3 touches only the runner. PR 7 touches only the frontend plus one API branch.
- PRs 1 and 4 each add a migration. They must not both claim `oss000000022`. Give PR 4
  `oss000000023`.

**Keeping the current Stop working.** `POST /sessions/streams/` with no inputs and no `force` keeps
its exact current behavior through PRs 1 to 6. Nothing about `CommandMode.cancel` changes. Released
browsers and the current mobile build keep working unchanged.

**When it becomes a wrapper.** In PR 7. At that point `SessionStreamsService.command`'s cancel
branch (`api/oss/src/core/sessions/streams/service.py:288`) stops calling `_displace_turns` and
instead calls `SessionCommandsService.request_cancel(...)` with no expected execution id, then
returns the same `SessionStreamCommandResponse` shape it returns today. That gives every old client
the new behavior with no client change, and it is also the point at which the old teardown of
`alive` disappears. Do it in the same PR that flips the browser, so one revert restores one
consistent behavior.

---

## 10. Test plan

### Unit tests

| Component | Test | Passes when |
|---|---|---|
| Commands DAO | Two concurrent claims of one pending command | Exactly one returns a row; the other returns none |
| Commands DAO | Insert with a repeated `Idempotency-Key` | The second insert returns the first row, and one row exists |
| Commands DAO | Settle with the wrong `replica_id` | Returns no row; the stored state is unchanged |
| Commands DAO | Settle a command that is already `applied` | Returns no row; the caller reads the terminal state |
| Commands service | Admission with a stale `expected_execution_id` | Raises the conflict type; no row inserted |
| Commands service | Admission with nothing running | One row, `state='obsolete'`, `outcome='not_running'` |
| Commands service | Admission twice with no idempotency key | One row; the second call returns the first |
| Commands service | Admission writes the command and `stopping_turn_id` | Both are visible after one commit, neither after a rollback |
| Command sweep | Expired claim with attempts left | Back to `pending`, `claim_count` incremented on the next claim |
| Command sweep | Expired claim with no attempts left | `obsolete`, `outcome='lost'`, `running` cleared, `ended` published |
| Control adapter | `deliver` when Redis is down | Admission still succeeds; the failure is logged, not raised |
| Runner poll | 204, then 200, then a network error | Immediate re-poll, apply, then the backoff sequence with jitter |
| Runner poll | 401 | One error log, then a 60 second retry, no tight loop |
| Runner applier | A command for a `turnId` this process does not hold | Settles `obsolete` with `not_running`; nothing is aborted |
| Runner applier | The same `command_id` delivered twice | Aborted once, settled twice |
| Runner registry | The run's `finally` runs | The entry is removed even when the run threw |

House note: the runner suite is `cd services/runner && pnpm test` (vitest). The API unit tests sit
under `api/oss/tests/pytest/unit/sessions/`, next to `test_command_matrix_inputs_data.py`.

### One API integration test

`api/oss/tests/pytest/integration/sessions/test_stop_command_delivery.py`, against a real Postgres
and a real Redis, with a fake runner:

1. Establish a session with `alive` and `running` held by `turn-A`, exactly as a heartbeat does.
2. Call the public Cancel route with no `expected_execution_id`. Assert 202, one `pending` row, and
   `session_streams.stopping_turn_id = 'turn-A'`.
3. Call the claim route as `replica-1`. Assert 200, one command, `state='claimed'`.
4. Call the claim route again. Assert 204 within the hold.
5. Post the outcome with `result='applied'` and `execution.state='stopped'`. Assert 200.
6. Assert: the command is `applied` with `outcome='stopped'`; `stopping_turn_id` is null; the Redis
   `running` key is gone; **the Redis `alive` key is still present**; `superseded:...:turn-A` exists;
   one `lifecycle: ended` message was published on the session watch channel.

Step 6's `alive` assertion is the one that pins warm resume at the API layer. If a later change
starts clearing `alive` on Stop, this test fails.

### One live-stack wire test

Add a cell to the agent release gate, next to the existing W5 steer cell
(`.agents/skills/agent-release-gate/resources/`), driving a deployed stack over the product
endpoints only:

1. Start a turn with a prompt that runs for at least 60 seconds.
2. Wait for the first agent output frame, then record the wall clock and press Stop through
   `POST /sessions/{id}/cancel`.
3. **Pass criterion one:** the runner reports the outcome, and the session's `running` flag goes
   false, within **5 seconds** of the Stop request. Measure from the request, not from the frame.
4. **Pass criterion two:** `session_turns` for the stopped turn still names the same `sandbox_id`
   and `agent_session_id` as before the Stop, and the session's `alive` flag is still true.
5. Send a second message on the same session.
6. **Pass criterion three:** the second turn reuses the same `sandbox_id` and `agent_session_id`.
   That is warm resume, measured from stored rows rather than from timing.
7. **Pass criterion four:** the stopped turn's records end with a cancelled outcome, not an error
   record.

Criteria 2, 3 and 4 depend on Work package A. Criterion 1 does not, and can be gated as soon as PR 7
lands.

---

## 11. Rejected alternatives

**Shorten the heartbeat interval.** Dropping `HEARTBEAT_INTERVAL_SECONDS` from 30 to 2 would cut the
Stop delay with no new machinery. It fails on three counts. It multiplies heartbeat load by fifteen
for every live session, and each beat is a Postgres write plus four Redis operations
(`api/oss/src/core/sessions/streams/service.py:406`). It still cannot deliver a Stop to a run whose
credential was dropped, because the beat itself is what fails (`alive.ts:92`). And it leaves the
control signal encoded as the absence of a lock, which is what makes today's cancel a session
teardown rather than an execution cancel. A shorter interval is a cheaper bad answer to the wrong
question.

**Call the runner directly from the API.** The kill path already does this, over
`env.runner.internal_url` with the shared token
(`api/oss/src/core/sessions/streams/runner_client.py:30`, verified). Reusing it for Stop needs no
new transport at all. It fails because the configured URL is one service address, not a
replica-specific route, and the API knows only the logical `replica_id`
(recorded in the RFC and confirmed by reading `runner_client.py`). With one runner it happens to
work today and silently breaks the moment a second replica exists, which is the worst failure shape:
correct in development, wrong in production, with no error. It also requires the runner to be
reachable from the API, which a user-operated runner behind a firewall would not be.

**Subscribe the runner to Redis directly.** The runner could subscribe to a per-replica Pub/Sub
channel and skip the poll. It is the least code. It fails on the boundary the codebase already
enforces: the API is the single Redis writer and the runner reaches the coordination plane only over
HTTP (`services/runner/src/sessions/alive.ts:13` and `sessions/contract.ts:25`, both explicit about
this). Handing the runner Redis credentials reverses a deliberate decision, and Pub/Sub has no
replay, so a disconnected runner loses every command sent while it was away.

**A persistent WebSocket or bidirectional stream.** It removes the repeated request and can carry
richer runner status. It is deferred, not wrong. It needs connection lifecycle handling, ping and
pong, reconnect with backoff, and a message framing contract, none of which the command state
machine needs to be correct. Long polling reaches the same five second target with ordinary
HTTP that every proxy already handles. Because delivery sits behind the port in section 8, this
becomes a later adapter rather than a rewrite.

**One poll per session instead of one per runner.** A session-scoped poll would carry the run's own
credential, which removes the need for a new authentication path. It fails on cost and on coverage.
Cost: one held request per live session instead of one per process, which is a connection per
session on both sides. Coverage: it exists only while a turn runs, so a Stop against a parked
session, case 4, would have no channel at all, and that is one of the cases with the worst current
behavior.

---

## 12. Open questions for Mahmoud

1. **The settlement timeout.** Recommendation: 90 seconds from admission, with a 60 second lease and
   3 deliveries. Reason: it is comfortably longer than a normal harness cancel and short enough that
   a dead runner does not leave a session showing "stopping" for minutes. It must be revisited once
   Work package A reports how long a warm cancel and drain actually takes, because a lease shorter
   than the drain causes needless re-delivery.

2. **Does Stop leave the Redis `alive` key in place?** Recommendation: yes, leave it, exactly as a
   normal turn end does. Reason: force-deleting `alive` is what makes today's cancel read as a
   session teardown, and warm resume is the required outcome. This is a deliberate deviation from
   the phrase "Redis `running` and `alive` released" in the work package brief, so it needs an
   explicit yes or no.

3. **Should the stopping state be a column, or derived from the command table?** Recommendation: the
   column `session_streams.stopping_turn_id`. Reason: readers already fetch that row, so they get
   the state with no join and no second query, and the command table stays internal. The cost is one
   migration and one more field the settlement path must clear.

4. **Are commands visible to clients?** Recommendation: no. Keep `session_commands` internal, expose
   only the execution state, and give the caller a command id purely as an idempotency handle.
   Reason: decision D-016 says public clients follow execution state and must not infer it from
   delivery acknowledgements. Exposing the table invites exactly that inference.

5. **Authentication for the internal control routes.** Recommendation: exempt `/sessions/control/`
   from the auth middleware and check `AGENTA_RUNNER_TOKEN` in the route, failing closed when the
   token is unset. Reason: it copies the existing treatment of the OAuth callback and Composio event
   routes, and it needs no change to the shared authentication code. The alternative, teaching the
   middleware a new `Runner` scheme, is cleaner but touches a file every request goes through.
