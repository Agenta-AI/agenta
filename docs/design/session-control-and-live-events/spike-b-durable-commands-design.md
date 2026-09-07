# Spike B: durable commands and control delivery

> AGENT-GENERATED, low weight. Implementation-ready design for discussion. Mahmoud makes final
> decisions.

Scope: reliable API-to-runner commands, version one. The only command kind in version one is
Cancel, which the product calls Stop. The design keeps Redis execution ownership as it is, adds no
Postgres execution authority, no ownership generations, no stale-writer fencing, and no
multi-runner routing.

Every claim below is marked **verified** (read in the code of this worktree, with `path:line`) or
**reported** (taken from a document, named at the point of use).

This revision answers the architecture review at `review-architecture.md`, sections 3 and 4. The
holes it names are addressed here: H-2 in sections 5 and 7, H-3 in sections 4 and 7, H-4 in section
4, H-5 in section 4, H-6 in section 5, and the interface corrections in sections 2, 5 and 9. H-1,
the `shouldPark` change, belongs to Work package A and is named as a dependency in section 7.

Terms used here:

- **Execution:** one runner attempt at one user message. In the code today its identifier is the
  `turn_id` the runner mints (`services/runner/src/server.ts:190`). This design does not rename it.
- **Command:** one durable request to change an execution.
- **Held session:** a session this runner process holds warm, whether it is running a turn, idle in
  the keep-alive pool, or parked awaiting an approval.

---

## 1. What happens today when a user presses Stop

**Verified.** The browser stops its own stream at once. The runner learns nothing until its next
heartbeat, which is up to 30 seconds later. The sandbox is then deleted, so the next message is a
cold start.

The chain, in order:

1. `handleStop` marks the turn stopped locally and aborts the client fetch
   (`web/oss/src/components/AgentChatSlice/hooks/useAgentChatSession.ts:480`).
2. The browser posts `POST /sessions/streams/` with no inputs and no `force`, and **with no
   execution id** (`useAgentChatSession.ts:505`, which passes only `{sessionId, projectId}`).
   Mobile posts the same call (`web/mobile/src/features/chat/StopButton.tsx:18`).
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

The 30 second wait is the whole problem. Four further defects ride on it:

- **A Stop can be lost silently.** A heartbeat that returns a non-2xx status yields
  `interrupted: false` by design (`services/runner/src/sessions/alive.ts:92`). A run whose platform
  credential expired or was dropped can never be stopped. The credential states are logged at
  `services/runner/src/server.ts:445`.
- **A parked session has no channel at all.** When a turn parks awaiting an approval, the request
  handler's `finally` calls `aliveWatchdog.release()` (`services/runner/src/server.ts:618`), which
  clears the heartbeat interval and sends one last beat with `is_running: false`
  (`services/runner/src/sessions/alive.ts:241`). From that moment the runner sends no heartbeat for
  that session, so the only existing control channel is gone. This is review hole H-2, and it is why
  section 5 makes the poll session-scoped rather than turn-scoped.
- **A late Stop can kill the next turn.** `_displace_turns` reads whoever holds `alive` and
  `running` at the moment it runs, so a Stop applied 300 ms after the turn ended tombstones the turn
  that started in between. The tombstone lasts an hour and every read refreshes it
  (`api/oss/src/dbs/redis/sessions/locks.py:147`). This is review hole H-3.
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
| `kind` | String, not null | routing | `cancel` in version one. |
| `target_turn_id` | String, null | target | The execution this command must reach, resolved once at admission. Null only when nothing was running or parked. |
| `expected_turn_id` | String, null | target | The caller's `expected_execution_id`, stored as sent. Null when the caller supplied none. |
| `data` | JSON, null | input | The command's own arguments, shaped `{"input": {"text": ..., "attachments": [...]}, "policy": {"on_busy": ...}}`. Empty for `cancel`. |
| `state` | String, not null | delivery | `pending`, `claimed`, `applied`, `obsolete`. |
| `claimed_by` | String, null | delivery | The replica that holds the current claim. Bookkeeping, not an address. |
| `claim_expires_at` | TIMESTAMP tz, null | delivery | When the claim may be delivered again. |
| `claim_count` | Integer, not null, default 0 | delivery | Deliveries so far. Caps re-delivery. |
| `outcome` | String, null | result | What happened to the execution: `stopped`, `not_running`, `superseded_by_newer_turn`, `failed`, `lost`. Null while open. |
| `idempotency_key` | String, null | context | The caller's `Idempotency-Key` header, stored verbatim. |
| `settled_at` | TIMESTAMP tz, null | metadata | When the command reached a terminal state. |
| `flags`, `tags`, `meta` | JSONB / JSON, null | metadata | House mixins. Unused in version one, present for consistency. |
| `created_at`, `updated_at`, `deleted_at`, `created_by_id`, `updated_by_id`, `deleted_by_id` | `LifecycleDBA` | metadata | House lifecycle columns. `created_at` carries a guard: it is the "do not supersede a newer turn" comparison of section 4. |

Four grouping rules from the interface review are applied here.

- **Delivery bookkeeping is one group.** `state`, `claimed_by`, `claim_expires_at` and `claim_count`
  are the delivery record. On the wire they are nested under `delivery`. In the table they are flat
  columns because a claim query filters and orders on them, and a JSON blob cannot be indexed for
  that. The names carry the grouping.
- **Delivery is never merged with the result.** `state` says where the command is; `outcome` says
  what happened to the execution. That separation is the whole point of decision D-016.
- **The target has its own two columns.** `expected_turn_id` is what the caller asserted;
  `target_turn_id` is what the API resolved. Keeping both makes a 409 explainable after the fact and
  gives a future `target.execution_id` an obvious home.
- **There is no `owner_replica_id` and no `runner_url`.** The first revision routed commands by the
  owner replica. Section 5 replaces that with session-scoped claims, so the record needs no routing
  identity at all, and an address in a durable record would be an implementation detail with a
  lifetime longer than the thing it points at.

### Two columns added to `session_streams`

**`stopping_turn_id`**, String, nullable. It names the execution that an accepted Stop is waiting on.
It is written in the same transaction as the command insert, and cleared at settlement.

**`turn_started_at`**, TIMESTAMP tz, nullable. It records when the row's current `turn_id` started.
It exists for one reason: the stale-Stop guard in section 4 needs to compare a command's arrival
time with the current execution's start time, and **there is nowhere to read that today**. The
options were checked, and none of them works:

| Candidate | Why it does not serve |
|---|---|
| `session_streams.updated_at` | It is the heartbeat timestamp and moves every 30 seconds. Verified: the mirror write is unconditional (`api/oss/src/core/sessions/streams/service.py:618`). |
| The turn id itself | API-minted turns use uuid7 and are time-ordered (`streams/service.py:940`), but the runner mints its own with `randomUUID()`, which is uuid4 and carries no time (`services/runner/src/server.ts:190`, verified). Every browser turn today is runner-minted. |
| Redis `running` or `alive` | The value is the bare turn id, and the release-if-owner script compares the whole value (`api/oss/src/dbs/redis/sessions/contract.py:153`). Packing a timestamp into it would break that compare and the golden fixture the runner shares. |
| `session_turns.start_time` | It is written, from `turnStartedAt` captured at `services/runner/src/engines/sandbox_agent/run-turn.ts:192` and sent at `:469`. But the append is fire-and-forget (`.catch(() => {})`) and it needs a stream id and a continuity index, so a turn can be running with no row at all. It is a good secondary source, not a guard. |

So add the column. It is written wherever `turn_id` is written, in the same statement, and only when
the id actually changes:

```sql
UPDATE session_streams
   SET turn_id = :turn_id,
       turn_started_at = CASE
           WHEN turn_id IS DISTINCT FROM :turn_id THEN now()
           ELSE turn_started_at
       END,
       ...
```

That form is idempotent under the repeated heartbeats that stamp the same id every 30 seconds, and
it needs no new writer: both `_start_turn` (`streams/service.py:940`) and the heartbeat's
`durable_turn_id` stamp already go through `SessionStreamEdit`.

Both are columns and not bits inside `flags` because `flags` is the Redis mirror. Every heartbeat
rewrites it (`api/oss/src/core/sessions/streams/service.py:618`), so a value stored there would be
erased on the next beat. `SessionStreamEdit` carries only `flags`, `tags`, `meta` and `turn_id`
(`api/oss/src/core/sessions/streams/dtos.py:73`), so the heartbeat path cannot touch
`stopping_turn_id` by accident, and it touches `turn_started_at` only through the guarded `CASE`.

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
        "ix_session_commands_open",
        "project_id", "session_id", "created_at",
        postgresql_where=text("state IN ('pending', 'claimed') AND deleted_at IS NULL"),
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

`ix_session_commands_open` is the claim query's index. It leads with `(project_id, session_id)`
because a claim asks for the commands of a named set of sessions, and it is partial on the open
states because a settled command is never claimed again. It also serves the open-command collapse
read at admission.

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
      | claim expired,  | claim (poll, direct call,  | nothing to do
      | session still   | or heartbeat)              |
      | beating         v                            v
      |             claimed --------> applied     obsolete
      |                 |     runner
      +-----------------+     reports
                        |
                        | claim expired and the session stopped beating
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
| none to `obsolete` | The API, when nothing is running or parked | Same insert, with `state='obsolete'`, `outcome='not_running'`, `settled_at=now()` |
| `pending` to `claimed` | The API, serving a claim, a direct call, or a heartbeat | `WHERE state = 'pending'` |
| `claimed` to `pending` | The command sweep, when a lease expired and the session is still beating | `WHERE state = 'claimed' AND claim_expires_at < now() AND claim_count < :max_deliveries` |
| `claimed` to `applied` | The API, on the runner's outcome report | `WHERE state = 'claimed' AND claimed_by = :replica_id` |
| `claimed` to `obsolete` | The API, on a report of `not_running` or `superseded_by_newer_turn` | Same guard |
| `claimed` to `obsolete` (`lost`) | The command sweep, when the lease expired and the session stopped beating | `WHERE state = 'claimed' AND claim_expires_at < now()`, plus the heartbeat-age test of section 4 |
| `pending` to `obsolete` (`lost`) | The command sweep, when nobody ever claimed it | `WHERE state = 'pending' AND created_at < :admission_deadline` |

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
            AND (project_id, session_id) IN :held_sessions
          ORDER BY created_at
          LIMIT :limit
          FOR UPDATE SKIP LOCKED
       )
RETURNING *;
```

`:held_sessions` is the set of sessions the calling runner holds warm, sent with the request. See
section 5. `FOR UPDATE SKIP LOCKED` is what lets two API replicas serve two claims at the same time
without either blocking or double-claiming.

The settle statement:

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

## 4. The claim lease and the settlement rule

| Setting | Value | Reason | Environment variable |
|---|---|---|---|
| Lease duration | 90 seconds | Three heartbeat intervals, the window the review picked for H-4 | `AGENTA_SESSIONS_COMMAND_LEASE_SECONDS` |
| Maximum deliveries | 3 | Bounds a delivery loop when a runner accepts but never reports | `AGENTA_SESSIONS_COMMAND_MAX_DELIVERIES` |
| Sweep interval | 10 seconds | Fine enough that a lost Stop settles inside two minutes | `AGENTA_SESSIONS_COMMAND_SWEEP_SECONDS` |
| Admission deadline | 90 seconds | A command nobody ever claimed is a runner that is not there | `AGENTA_SESSIONS_COMMAND_ADMISSION_TIMEOUT_SECONDS` |

All four go in a new `SessionsCommandsConfig` block in `api/oss/src/utils/env.py`, read through the
shared `env` object. Do not call `os.getenv` in the service (`AGENTS.md`, "Environment config").

**Renewal: none in version one.** A claim is not renewed while the runner works. It expires and is
either delivered again or settled. This is safe because applying a Cancel is idempotent, and because
the runner deduplicates. A renewal route is the first thing to add if a harness cancel is ever
slower than the lease, and the column that would carry it (`claim_expires_at`) already exists.

### The settlement rule when the runner is gone (H-4)

**The Redis time to live cannot be the signal.** `alive` and `running` both hold 3600 seconds
(`api/oss/src/utils/env.py:1417` and `:1421`, verified). A `stopping` state that waits for those
keys to expire is a `stopping` state that lasts an hour. Settlement must key off **heartbeat age**,
which is `session_streams.updated_at`, the column the heartbeat writes on every beat and the one the
orphan sweep already filters on (`api/oss/src/tasks/asyncio/sessions/orphan_sweep.py:57`, verified).

The rule, evaluated by the sweep for every command whose `claim_expires_at` has passed:

| Heartbeat age for that session | Attempts left | Action |
|---|---|---|
| Under 90 seconds (the runner is alive, the report was lost) | yes | Re-arm to `pending` and deliver again |
| Under 90 seconds | no | Settle `obsolete`, `outcome='lost'`, and run the settlement side effects |
| 90 seconds or more (the runner is gone) | either | Settle `obsolete`, `outcome='lost'`, and run the settlement side effects |

A session parked awaiting an approval stops beating on purpose (`server.ts:618`), so it would look
"gone" by heartbeat age alone. Exclude it: a command whose target session has an open interaction,
or whose stream row is `alive` but not `running`, uses the admission deadline rather than the
heartbeat-age test. That is the same distinction the orphan sweep already draws between its 300
second running threshold and its 1800 second idle threshold
(`api/oss/src/tasks/asyncio/sessions/orphan_sweep.py:33` and `:37`, verified).

**The watchdog owns settlement, not this design.** A separate agent is building the execution
watchdog on branch `feat/session-execution-watchdog`. This design does not build a second one. The
command sweep described here is either that watchdog with the command rules folded in, or a caller
of it. The single rule both must obey: **one execution reaches exactly one terminal outcome, written
by exactly one writer.** If the watchdog marks an execution `lost`, it must settle that execution's
open commands in the same transaction, and vice versa. Decide the ownership before either lands.

The side effects of a `lost` settlement are the same as a normal settlement (section 7, step 10 to
13), with one difference: Redis keys are cleared with the force variants rather than the
owner-checked ones, because the owning process is gone.

### Deduplication on the runner (H-5)

The applied-command set must outlive the poll loop, because a loop restart with an empty set would
apply a Stop a second time, and by then the session may be running a newer turn.

- The set lives in the same module as the session state the runner already keeps across turns, next
  to `SessionPool` (`services/runner/src/engines/sandbox_agent/session-pool.ts:90`), keyed by
  `${projectId}:${sessionId}` with a bounded list of applied command ids and their apply times, kept
  for 30 minutes. It is not owned by the poll loop and does not reset when the loop restarts.
- Both delivery paths call one `applyCommand(command)` entry point that consults the set first.
- **Applying an already-applied command is a no-op that re-sends the acknowledgement.** It does not
  abort anything, and it does report the stored outcome, so a lost acknowledgement is repaired
  without a second abort.

### The three guards on the target execution (H-3)

A Stop that arrives after its turn ended must not touch the next turn. Three guards, in order of
strength:

1. **The API compares arrival time with the current turn's start time.** This is the guard that
   closes the reported race, so it is spelled out below.
2. **The target is pinned at admission.** The API resolves `target_turn_id` once and never
   re-resolves it. A turn that starts later has a different id, so a pinned command cannot reach it.
3. **The runner repeats the comparison locally.** The envelope carries the command's arrival time.
   The runner refuses to abort an execution that started after it, and settles the command
   `obsolete` with `outcome='superseded_by_newer_turn'`. The runner holds its own execution's start
   time in memory, so this check is exact even when the API's is not.
4. **First-party clients always send `expected_execution_id`.** The field stays optional in the
   contract, as decision D-010 requires, but the desktop and mobile Stop buttons must send it. Today
   the desktop sends nothing (`useAgentChatSession.ts:505`, verified). Treat an omitted id from a
   first-party client as a bug, not as a supported mode.

#### The arrival-time comparison, when no expected execution id was sent

The race: the user presses Stop at t=0 while turn one is running. Turn one ends at t=0.1. Turn two
starts at t=0.2. The request is applied at t=0.3, reads Redis, finds turn two, and targets a turn the
user never meant to stop.

The rule, applied at admission before anything is inserted:

1. The service stamps `received_at = now()` as its **first** action, before it reads Redis. It later
   writes that same value as the row's `created_at` rather than letting the server default fill it,
   so the value it compared is the value it stored.
2. It reads the current running owner from Redis and the session's row, which gives `turn_id` and
   `turn_started_at` in one query the admission path already makes.
3. If `turn_started_at > received_at`, the current execution began after the user pressed Stop.
   Insert the command already settled: `state='obsolete'`,
   `outcome='superseded_by_newer_turn'`, `settled_at=now()`, `target_turn_id=null`. Return 200 with
   `execution.state = "idle"`. **Do not target that turn and do not touch Redis.**
4. Otherwise proceed normally.

This runs only when `expected_execution_id` is absent. When the caller sent one, the 409 comparison
already settles the question and is stricter.

**When `turn_started_at` is null, the guard does not fire.** A row written before this column
existed, or a turn whose stamp was lost, yields no comparison. The API then targets the turn as it
does today and leaves the decision to guard 3, which is exact because the runner reads its own
memory. Failing this way round is deliberate: a guard that refuses to Stop whenever it lacks data
would break the common case to protect a rare one.

`session_turns.start_time` is a useful secondary source when the row exists, but the design does not
depend on it, for the reasons in the table in section 2.

The `expected_execution_id` check itself happens twice, for two different reasons. At admission the
API compares it to the Redis running owner and answers 409 if they differ. At application the runner
applies the command only to a local execution whose `turnId` equals `target_turn_id`, and settles
`obsolete` with `outcome='not_running'` when it holds no such execution.

---

## 5. The claim contract

### The loop is session-scoped and lives as long as the session is warm (H-2)

This is the single most important correction from the review. The first revision started one poll
per runner process and routed by owner replica. That has two faults: it cannot say which sessions
the runner actually holds, and a per-turn loop would go silent exactly when a turn parks.

The rule:

- **One loop per runner process.** Not one per turn and not one per session.
- **The loop declares the sessions it holds.** Every claim carries the current set. That set is the
  union of the execution registry (turns in flight) and the keep-alive pool keys, which are already
  `${projectId}:${sessionId}` strings and already include parked entries
  (`SessionPool.keys()` and `SessionPool.snapshot()`,
  `services/runner/src/engines/sandbox_agent/session-pool.ts:108` and `:127`, verified; a parked
  entry is seated as `awaiting_approval` at
  `services/runner/src/lifecycle/session-coordinator.ts:764`, verified).
- **A session leaves the set only when the runner stops holding it warm.** A parked approval stays
  in the set, so a Stop reaches it. That is H-2 closed.
- **Claims are queries over durable state, never a stream position** (H-6). The request declares a
  set of sessions and the API answers with whatever is pending for them right now. There is no
  cursor, no offset and no resume token, so a command created while the connection was down is
  picked up by the next claim like any other.

### Routes

| Route | Method | Caller | Purpose |
|---|---|---|---|
| `/sessions/control/commands/claim` | POST | Runner | Claim the pending commands for the sessions this runner holds, waiting up to the hold if there are none |
| `/sessions/control/commands/{command_id}/outcome` | POST | Runner | Report the terminal outcome |

Both live on a new `SessionControlRouter` in `api/oss/src/apis/fastapi/sessions/router.py`, included
with no prefix like the streams router (`api/entrypoints/routers.py:1354`, verified), and excluded
from the public schema.

### Authentication

The runner authenticates its per-run calls as the invoke caller, using the ephemeral platform
credential from the run (`services/runner/src/sessions/alive.ts:60`, verified). That credential
cannot carry these routes: the loop belongs to the process and spans many projects, and a run's
credential expires while the process keeps polling.

So both routes use the shared runner token, `AGENTA_RUNNER_TOKEN`, which both sides already hold
(`api/oss/src/utils/env.py:1161` as `env.runner.token`, and `services/runner/src/server.ts:104`).
Verified. It is the same secret the existing API-to-runner hop uses in the other direction
(`api/oss/src/core/sessions/streams/runner_client.py:44`).

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
- The project scope of every command comes from the row and from the declared session set, never
  from a header. A runner can only receive commands for sessions it named, and a session id is
  meaningful only inside its project, so the pair is the scope.

### Request and response bodies

Claim request:

```json
{
  "replica_id": "runner-7f3c",
  "sessions": [
    {"project_id": "1f0a4b2c-0000-4000-8000-000000000002", "session_id": "sess-42"},
    {"project_id": "1f0a4b2c-0000-4000-8000-000000000002", "session_id": "sess-77"}
  ],
  "wait_seconds": 25,
  "limit": 10
}
```

`replica_id` is delivery bookkeeping: it becomes `claimed_by` so a settle can be matched to its
claim. It is not routing, and it is not an address. `sessions` is the routing input, capped at 200
entries and ordered most recently used first. `wait_seconds` is bounded server-side to
`[0, AGENTA_SESSIONS_CONTROL_POLL_HOLD_SECONDS]`, default 25. `limit` is bounded to `[1, 50]`,
default 10.

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
      "target": {
        "turn_id": "0199a3f1-0000-7000-8000-00000000000a",
        "expected_turn_id": "0199a3f1-0000-7000-8000-00000000000a"
      },
      "delivery": {
        "claimed_by": "runner-7f3c",
        "claim_expires_at": "2026-09-02T22:10:31Z",
        "attempt": 1
      },
      "created_at": "2026-09-02T22:09:01Z"
    }
  ]
}
```

`count` plus a list is the house response envelope (`SessionsResponse`,
`api/oss/src/apis/fastapi/sessions/models.py:105`). A `cancel` carries no `input` and no `policy`;
both appear only for the kinds that have them, so a reader never has to interpret an empty object.
`created_at` is on the envelope because the runner needs it for guard 3 of section 4.

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
`stopped`, `failed`, `not_running`, `superseded_by_newer_turn`. `execution.error` is a short string, present only
when the state is `failed`. The two objects are separate because they answer different questions and
have different owners: `result` is delivery bookkeeping the runner controls, `execution` is a
product fact the user sees.

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

The route subscribes to one Redis Pub/Sub channel per declared session on the durable plane, then
loops:

1. Claim once, without waiting. Return 200 if anything came back.
2. Wait on the subscription with a one second timeout, so the loop can re-check the shutdown flag.
3. On a message, or every second, try the claim again.
4. When the hold budget runs out, return 204.

Three details are not optional:

- **Add `control_channel(project_id, session_id)` to the Redis contract**
  (`api/oss/src/dbs/redis/sessions/contract.py`), with the payload `{"type": "command-pending"}` and
  nothing else. It is project-scoped like every other key in that file, and it carries no tenant data
  because the claim re-queries Postgres, which is the authority.
- **Reuse the watch endpoint's shutdown release.** `api/oss/src/apis/fastapi/sessions/watch.py:50`
  installs a hook on uvicorn's exit path because a held response blocks graceful shutdown for ever.
  A held claim has exactly the same failure. Import `request_shutdown` and the same threading event,
  or move both into a small shared helper.
- **A new session mid-hold ends the hold.** When the runner starts holding a session that was not in
  the declared set, the loop aborts its in-flight request locally and re-issues the claim with the
  new set. That is one in-process event, not a server concern.

### What the runner does

| Result | What the runner does |
|---|---|
| 200 with commands | Apply each through `applyCommand`, report each outcome, then claim again at once |
| 204 | Claim again at once |
| Read timeout with no response | Claim again after the backoff floor |
| Network error, 502, 503, 504 | Back off: 1 s, 2 s, 4 s, 8 s, 16 s, then 30 s, with 20 percent jitter. Reset on the first success |
| 401 or 403 | Log once at error level and retry every 60 s. This is a deployment misconfiguration and must be loud, not a tight loop |
| 429 | Back off as for a network error |
| API restart | The held connection closes. This is the network error case. Nothing is lost, and the next claim is a fresh query over durable state, not a resumed cursor |
| Empty session set | Do not call. Wait for the next session to be held |

The client timeout must exceed the hold: set the fetch timeout to `hold_seconds + 10`.

### After a reconnect, the runner asks again; it never resumes a position

This is worth stating on its own, because getting it wrong loses commands silently.

A claim is a **query over durable state**. The runner sends the sessions it currently holds and the
API answers with whatever is pending for them at that moment. There is no cursor, no offset, no
sequence number, no resume token and no server-side per-runner queue position.

So after any break, whether the connection dropped, the API replica restarted, the runner process
restarted, or the loop was switched off and on, the runner simply issues the next claim with its
current session set. A command created while nothing was listening is `pending` in Postgres, and the
next claim returns it like any other. Nothing has to be replayed, and nothing can be skipped by
starting from the wrong place, because there is no place to start from.

The one thing this requires: the session set must be rebuilt from what the process actually holds,
not cached from before the break. After a runner restart the set comes from the rebuilt pool and the
live execution registry, both of which reflect reality rather than history.

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
    # claim route uses. Empty when there is nothing to deliver, which is the normal case.
    commands: List[SessionCommandEnvelope] = Field(default_factory=list)
```

`SessionCommandEnvelope` is the same model the claim route returns, so the runner has one parser and
one applier.

Rules:

- The beat serves only commands for its own `(project_id, session_id)`, and only those whose
  `target.turn_id` matches the beat's `turn_id` or is null. It never serves another session's
  commands, because the beat is authenticated with the run's project-scoped credential.
- It claims them under the same statement as the claim route, so a command cannot be delivered by
  both paths at once. One of the two wins the compare-and-set; the other sees zero rows.
- The runner deduplicates by `command_id` in the set described in section 4, so a command delivered
  by the claim route and offered again by a beat is acknowledged again but applied once.

**Know what this fallback cannot do.** It covers only a session with a live turn, because the
heartbeat stops when a turn ends or parks (`services/runner/src/server.ts:618` and
`services/runner/src/sessions/alive.ts:241`, verified). It is not a substitute for the session-scoped
loop, and it must not be treated as the delivery path for a parked session. It exists for two cases:
the primary adapter is switched off, and the primary adapter is failing while the run's own
heartbeat still works.

The runner reads the new field in `sendHeartbeat` (`services/runner/src/sessions/alive.ts:96`) and
hands each entry to `applyCommand`. The existing fail-open rule at `alive.ts:92` is unchanged: a
non-2xx beat returns nothing. That is one more reason the primary path does not depend on a run's
credential.

---

## 7. Stop, end to end

### Case 1: the normal Stop

1. The browser posts `POST /sessions/{session_id}/cancel` with `expected_execution_id` filled in
   from its own state, and an optional `Idempotency-Key` header. It marks its own view "stopping"
   and stops rendering. It does not abort anything server-side by itself.
2. The API authorizes the caller with `Permission.RUN_SESSIONS`, the same permission the current
   cancel path uses (`api/oss/src/apis/fastapi/sessions/router.py:377`).
3. The API resolves the target once. It stamps `received_at` first, then reads
   `get_running_owner`, falling back to `get_alive_owner`, both already imported by the streams
   service (`api/oss/src/core/sessions/streams/service.py:39`), and reads the session row for
   `turn_started_at`. Call the result `turn_id`. Three outcomes: if `expected_execution_id` was sent
   and differs, stop with 409; if no expected id was sent and `turn_started_at > received_at`, stop
   with a settled `superseded_by_newer_turn` command and 200 (section 4); otherwise continue.
4. **One transaction.** Insert the command with `state='pending'`, `kind='cancel'`,
   `target_turn_id=turn_id`, `expected_turn_id=<as sent>`, and set
   `session_streams.stopping_turn_id = turn_id` on the same session's row. The DAO method takes an
   optional `AsyncSession` so both writes share one session, the pattern `RecordsDAO.append` already
   uses (`api/oss/src/dbs/postgres/sessions/records/dao.py:33`).
5. **Redis is not touched.** No tombstone, no `force_cancel_alive`, no `clear_running`. The current
   execution keeps `alive` and `running` while it stops, which is what stops a second message from
   starting underneath it. This is decision D-017.
6. The API delivers through the configured adapter: the direct call posts to the runner (section 9),
   the long-poll adapter publishes on the session's control channel. Either way the API then returns
   202 with the command id and the target execution id. **Delivery failure does not fail the
   request**, because the command is already durable.
7. The runner receives the command, on its held claim or on the direct route.
8. `applyCommand` checks the deduplication set, checks that it holds an execution with
   `target.turn_id`, checks that the execution did not start after `created_at`, and then aborts it.
   The abort must be a harness cancel that keeps the sandbox and the native harness session warm.
   **This step is Work package A's deliverable, and it is not free today.** `shouldPark` returns
   false whenever the signal is aborted (`services/runner/src/engines/sandbox_agent/engine.ts:26`,
   verified), so the environment is destroyed. The review's proposed fix, which this design assumes:
   thread a cancel reason to the runner so a user Stop is distinguishable from a disconnect abort,
   and let `shouldPark` park when the result is a clean cancellation caused by a user Stop. Nothing
   in this design can deliver a warm Stop without that change.
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
12. The API cancels the stopped execution's pending interactions, the same call the kill route
    already makes (`api/oss/src/apis/fastapi/sessions/router.py:441`), scoped with `only_turn_id` so
    it touches only this execution's gates.
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

This is the case with no channel today. A parked approval means the runner is running no turn: the
coordinator seats the environment as `awaiting_approval`
(`services/runner/src/lifecycle/session-coordinator.ts:764`, verified) and the request handler's
`finally` has already released the alive watchdog (`services/runner/src/server.ts:618`, verified),
so the heartbeat has stopped. Redis holds `alive` but not `running`, because the last beat carried
`is_running: false` (`api/oss/src/core/sessions/streams/service.py:590`, verified).

1. Step 3 finds no `running` owner and does find an `alive` owner. `target_turn_id` takes the alive
   owner's value.
2. The command is created `pending` and delivered. **The session is in the runner's declared set**,
   because the parked pool entry is one of `SessionPool.keys()`, so the held claim delivers it. With
   the direct adapter the process is reachable regardless.
3. `applyCommand` finds no live execution for that turn. It resolves the parked entry instead,
   settles the command `applied` with `execution.state = "not_running"`, and leaves the parked
   environment in the pool so the session stays warm. It does not destroy the park: Stop ends the
   work, not the session.
4. The API settles as in case 1. **Step 12 is the visible part here:** the pending interaction is
   cancelled, so the approval card stops rendering as actionable. That closes the class of bugs where
   an approval survives a Stop and its buttons do nothing.

### Case 5: two Stops in a row

The second request finds an open command for the same `(project_id, session_id, target_turn_id)`
and returns it unchanged, with the same command id. If the second request carries a different
`Idempotency-Key`, the open-command collapse still wins, because it runs before the insert. If the
first command has already settled and a new execution has started, the second Stop is a fresh
command against the new execution, which is what the user meant.

### Case 6: a Stop that arrives after its turn ended

The user presses Stop at t=0 while turn one runs. Turn one ends at t=0.1, turn two starts at t=0.2,
and the request is applied at t=0.3. Today `_displace_turns` would tombstone turn two before its
first output, and that tombstone lasts an hour because every read refreshes it
(`api/oss/src/dbs/redis/sessions/locks.py:147`, verified). The four guards of section 4 answer this
case in order.

1. **Guard 1, at admission.** The API compares `received_at` with the row's `turn_started_at`. Turn
   two started after the request arrived, so the API inserts a command that is already settled,
   `state='obsolete'` with `outcome='superseded_by_newer_turn'`, targets nothing, touches no Redis
   key, and returns 200 with `execution.state = "idle"`. **Turn two never hears about it.** This is
   the guard that closes the case; the rest are for what it cannot see.
2. **Guard 2** covers the ordinary late Stop, where turn one simply ended and nothing replaced it.
   The command names a turn that no longer exists, so the runner settles `obsolete` with
   `not_running`.
3. **Guard 3** covers the residual window where turn two took over between the API's Redis read and
   its insert, or where `turn_started_at` was null and guard 1 could not fire. The runner sees an
   execution that started after the command's arrival time and settles `obsolete` with
   `superseded_by_newer_turn` rather than aborting it. This check is exact, because the runner reads
   its own memory.
4. **Guard 4** removes the whole class for first-party clients, which send `expected_execution_id`
   and get a 409 naming the current execution.

No guard writes a Redis tombstone, so nothing can be killed for an hour the way `_displace_turns`
can today.

### Case 7: the runner is gone

No claim arrives, or the command was claimed and never settled. The sweep applies the table in
section 4, keyed off heartbeat age rather than the 3600 second Redis time to live. It settles the
command `obsolete` with `outcome='lost'`, force-clears the Redis keys, cancels the pending
interactions, and publishes `ended`. The user sees a terminal state within about two minutes instead
of an hour of "stopping".

---

## 8. The control-delivery port

There are two ports, one on each side. They are named separately because they are implemented in
different languages by different components, and only one of them is the RFC's `deliver /
acknowledge / recover`.

### API side, Python

`api/oss/src/core/sessions/commands/interfaces.py`:

```python
class ControlDeliveryPort(ABC):
    """How the API reaches the runner that holds a session. Transport only.

    Durability, authorization, idempotency, the state machine, and terminal settlement
    live in SessionCommandsService and must not move into an adapter.
    """

    @abstractmethod
    async def deliver(self, *, command: SessionCommand) -> DeliveryReceipt:
        """Make `command` reachable by whoever holds its session, promptly.

        Best effort: a failure here never fails admission, because the command is already
        durable and both the sweep and the fallback recover it. The receipt says only what
        the transport learned, never what happened to the execution.
        """
        ...

    @abstractmethod
    async def acknowledge(self, *, command_id: UUID, replica_id: str) -> None:
        """Record that a replica took the command, for adapters that keep their own
        delivery bookkeeping."""
        ...

    @abstractmethod
    async def recover(
        self, *, sessions: List[SessionScope], limit: int
    ) -> List[SessionCommand]:
        """Open commands for these sessions. The claim route, the direct-call retry and the
        heartbeat fallback all go through this."""
        ...
```

```python
class DeliveryReceipt(BaseModel):
    # What the transport learned. Not an execution outcome.
    status: Literal["accepted", "unreachable", "not_held"]
```

`accepted` means a runner took the command and will report. `unreachable` means the transport
failed, so the sweep or a later claim will handle it. `not_held` means a reachable runner said it
does not hold that session, which lets the service settle the command at once instead of waiting for
the deadline.

A later adapter must provide prompt, at-least-once delivery to whoever holds the named session. It
may reorder. It may deliver twice. It must not transform or interpret a command, must not settle
one, and must not be the only record that a command exists. Replacing it must change no route, no
DTO, and no state transition.

### Runner side, TypeScript

`services/runner/src/sessions/control-channel.ts`:

```ts
/** One command as the API delivers it. The same shape arrives on every transport. */
export interface ControlCommand {
  id: string;
  projectId: string;
  sessionId: string;
  kind: "cancel";
  target: { turnId: string | null; expectedTurnId: string | null };
  createdAt: string;
}

export interface ControlOutcome {
  /** The command's terminal state. */
  result: "applied" | "obsolete";
  execution: {
    id: string | null;
    state: "stopped" | "failed" | "not_running" | "superseded_by_newer_turn";
    error?: string;
  };
}

/** The transport. `control-poll.ts` implements it over long polling; the direct route
 *  in `server.ts` feeds the same applier without implementing this at all. */
export interface ControlChannel {
  /** Block until a command arrives for one of `sessions`, or the hold expires. */
  receive(sessions: SessionScope[], signal: AbortSignal): Promise<ControlCommand[]>;
  settle(command: ControlCommand, outcome: ControlOutcome): Promise<void>;
}
```

`applyCommand(command)` sits above the channel, not inside it, so every path shares one applier, one
set of guards and one deduplication set.

The runner also needs an execution registry, because the abort controller is a local variable inside
`runAndStreamWithApiBaseResolved` today (`services/runner/src/server.ts:450`, verified). Add a
module-level map from `${projectId}:${sessionId}` to `{ turnId, startedAt, abort(): void }`,
registered when the run starts and removed in the same `finally` that releases the watchdog
(`services/runner/src/server.ts:618`). `startedAt` is what guard 3 of section 4 compares. This
mirrors `inFlightSandboxes` (`services/runner/src/engines/sandbox_agent/environment.ts:239`).

---

## 9. The direct-call adapter as an alternative first adapter

This is the section the architecture review asked for as 8b. It sits here, directly after the port,
because that is what it is: the second adapter behind the same port, and a candidate for being the
**first** one built.

The product review argues that with one runner, the authenticated API-to-runner hop that already
carries hard kill can carry Cancel today, and that long polling is machinery for a second runner that
does not exist. The RFC's own text agrees that direct managed-runner routing is a legitimate adapter
behind the port (`rfc.md`, "Control delivery must sit behind an internal port"). That argument is
correct on its own terms, and this design makes both adapters cheap so Mahmoud can pick either in
the morning without changing anything else.

### What already exists

- **The API side.** `kill_runner_sandbox` posts `{sessionId, projectId}` with
  `Authorization: Bearer <AGENTA_RUNNER_TOKEN>` to `env.runner.internal_url` and swallows every
  failure (`api/oss/src/core/sessions/streams/runner_client.py:30`, verified). It is 33 lines.
- **The runner side.** `POST /kill` sits behind the same token gate, reads a capped body, resolves
  the pool scope and tears the session down (`services/runner/src/server.ts:704`, verified).

### What the direct adapter adds

**The runner: `POST /cancel`, beside `/kill`.** Same token gate, same capped body reader, same
scoping rule. Body:

```json
{
  "commandId": "0199a3f2-0000-7000-8000-000000000001",
  "projectId": "1f0a4b2c-0000-4000-8000-000000000002",
  "sessionId": "sess-42",
  "targetTurnId": "0199a3f1-0000-7000-8000-00000000000a",
  "createdAt": "2026-09-02T22:09:01Z"
}
```

It builds a `ControlCommand` from that body and hands it to the same `applyCommand`. It answers 202
when it holds the session and has accepted the command, and 404 when it does not. It does **not**
return the execution outcome: the runner reports that through the settle route, so settlement has
one path on every transport. Roughly 40 lines beside the existing kill branch.

**The API: `cancel_runner_execution`, beside `kill_runner_sandbox`.** The same 30 lines with a
different path and body. The adapter maps the response: 202 to `accepted`, 404 to `not_held`,
anything else and every exception to `unreachable`. One file,
`api/oss/src/dbs/http/sessions/control_delivery_direct.py`, implementing `ControlDeliveryPort`.
`acknowledge` is a no-op, because the claim compare-and-set is the acknowledgement. `recover` runs
the same query the claim route runs, and the service calls it from the sweep.

**The durable command is still inserted first.** The order is not negotiable and it is the whole
difference between this adapter and a bare remote call:

1. Admit and insert the command, with `stopping_turn_id`, in one transaction. Commit.
2. Only then call the runner.
3. Whatever the call returns, the user's request has already succeeded. A `not_held` lets the
   service settle at once; an `unreachable` leaves the command `pending` for the sweep or for a
   later retry. **Neither changes the 202.**

Inverting those two steps, calling first and recording afterwards, would give back every failure the
record exists to close, because a crash between the call and the insert leaves an aborted execution
with no terminal outcome written anywhere.

### What it cannot do

- **Reach a session it cannot resolve locally.** A Stop against a parked approval has no entry in the
  execution registry, because no turn is running. The runner must fall back to the keep-alive pool,
  which already has the lookup for exactly this: `SessionPool.awaitingApproval(sessionId)`
  (`services/runner/src/engines/sandbox_agent/session-pool.ts:117`, verified). That is a few lines,
  but it is not free, and it is needed by both adapters. Do not treat the parked case as covered
  just because the process is reachable.
- **Survive a second runner replica.** `env.runner.internal_url` is one service address
  (`api/oss/src/core/sessions/streams/runner_client.py:44`, verified). Behind a load balancer the
  call lands on whichever replica answers, which is the right one only by luck.
- **Reach a user-operated runner.** It needs inbound reachability from the API to the runner. A
  runner behind a firewall cannot be called at all. The RFC treats that deployment as a
  consideration rather than a requirement, so this is a real but not yet binding limit.

### Making the wrong-replica failure loud

The silent-failure worry is fair, and there are two ways to close it. Build the first; the second is
optional.

**Primary, and exact: treat a contradictory `not_held` as an error.** A mis-routed call is not
actually silent at the protocol level. The runner answers 404 `not_held` when it does not hold the
session, so the API always learns that delivery did not land. What makes it dangerous is that
`not_held` is also the **legitimate** answer when the session really has ended, so the two cases look
alike. They are easy to tell apart with data the API already has:

> A `not_held` for a session whose `session_streams` row says `is_alive` **and** whose heartbeat age
> is under one interval means some process is running that session and it is not the one we just
> called. That is the wrong-replica failure, and nothing else produces it.

On that condition, log at error level with the session id, the target turn id and the replica id
from the Redis `owner` key, count it on a metric, and settle the command `obsolete` with
`outcome='lost'` rather than `not_running`, so the user is told the Stop failed instead of being
told the work had already finished. This needs no new storage and no census.

**Optional, preventive: refuse the configuration.** Two parts, both cheap:

- A required flag. The direct adapter refuses to start unless
  `AGENTA_SESSIONS_CONTROL_DIRECT_SINGLE_REPLICA=true` is set, so choosing it is a deliberate
  statement about the deployment rather than a default someone inherited. Optionally let the operator
  name the replica instead, `AGENTA_SESSIONS_CONTROL_DIRECT_REPLICA_ID=<id>`, and refuse delivery
  when the session's owner key names a different one.
- A replica census. The heartbeat handler already computes the owning `replica_id` on every beat
  (`api/oss/src/core/sessions/streams/service.py:458`). Have it also run one `ZADD` into a sorted set
  keyed by replica id and scored by timestamp. The sweep then reads `ZCOUNT` over the last 10
  minutes and, if the direct adapter is configured and the count exceeds one, logs an error every
  pass naming the replicas it saw. One write per beat, one read per sweep, no key scan.

Do not add a retry across the load balancer in the hope of hitting the right process. It converts a
diagnosable failure into a lottery, and it multiplies load exactly when a deployment is already
misconfigured.

### What the durable command record adds beyond a bare direct call

The direct call alone would be an HTTP request with no memory. The record buys four things, and each
one is a bug the current system has:

1. **Recovery.** The runner can be restarting, deploying, or briefly unreachable. A bare call fails
   and the Stop is gone; the user pressed a button and nothing happened. With the record the command
   survives, the sweep settles it as `lost` with a terminal outcome the user sees, and a returning
   runner picks it up on its next claim.
2. **Idempotency.** Two Stops, a retried request, or a browser that resends on reconnect all collapse
   onto one command. A bare call would abort twice, and the second abort can land on a newer turn.
   That is review hole H-3 in its cheapest form.
3. **One terminal outcome per execution.** The record is where `stopped`, `not_running`,
   `superseded_by_newer_turn`, `failed` and `lost` are written down, and where the watchdog and the runner agree
   on who wrote it. A bare call has nowhere to record that the execution really ended.
4. **Audit and the next command kinds.** Who stopped what, when, and what happened. Steer and Queue
   need exactly this record, so building it now is not speculative: it is the part of version one
   that version two does not have to redo.

The honest counter-argument, stated plainly: for a single Stop that succeeds on the first try, the
record adds a table and two writes and changes nothing the user sees. Its value is entirely in the
failure cases.

### Choosing the adapter

One setting, `AGENTA_SESSIONS_CONTROL_ADAPTER`, with values `direct` and `long_poll`, read through
`env`. The service depends only on the port. Neither adapter changes a route, a DTO, or a state
transition.

| | Direct call | Long poll |
|---|---|---|
| New code | One runner route, one API client, both small | A runner loop, an API route with a hold, a Redis channel |
| Reaches a parked session | Yes, with the pool lookup above | Yes, the parked session is in the declared set |
| Two or more runner replicas | Wrong process gets the call. Loud with the `not_held` rule above, silent without it | Correct, because the runner declares what it holds |
| Runner behind a firewall | Impossible | Works |
| Runner restarting | The call fails, the sweep settles or a later claim delivers | The claim resumes on reconnect |
| Held connections | None | One per runner process |

**If `direct` is the default, PR 3b in section 10 is deferred** and the session-scoped loop is not
built at all. H-2 is then closed by the direct route plus the pool lookup rather than by the loop,
and the heartbeat fallback stays as the second path for a session with a live turn. Everything else
in this design is unchanged, which is the point of the port.

### Recommendation

**Build the direct adapter first.** Three reasons, in order of weight:

1. **It removes the largest piece of new machinery from the first release.** No held connection, no
   poll loop, no per-session Redis channel, no uvicorn shutdown interaction. The parts that carry the
   correctness, the record, the state machine, the guards and the settlement rule, are identical
   either way, and they are the parts worth reviewing carefully.
2. **The deployment it fails on does not exist yet.** Agenta runs one runner. The failure mode is
   real, and the `not_held` rule above makes it loud rather than silent, which is what turns a
   dangerous limitation into a known one.
3. **The port makes the switch small.** Long polling stays one file plus one runner module. When a
   second replica or a user-operated runner becomes real, the change is a configuration value and a
   module, not a redesign.

The cost of being wrong is bounded and visible: if a second replica appears before the long-poll
adapter is built, Stop starts failing loudly on the wrong-replica condition and the fix is already
designed. The cost of building long polling first is a larger first release for a deployment that
does not exist. Take the smaller one.

---

## 10. Migration sequence

Eight pull requests. Each names the files it touches so parallel agents do not collide. Ordering
constraints are stated; anything not constrained can go in any order.

| PR | Title | Files | Depends on |
|---|---|---|---|
| 1 | Add the session command record | `api/oss/databases/postgres/migrations/core_oss/versions/oss000000022_add_session_commands.py`, `api/oss/src/dbs/postgres/sessions/commands/{dbas,dbes,dao,mappings}.py`, `api/oss/src/core/sessions/commands/{dtos,interfaces,service,types}.py`, `api/oss/src/utils/env.py`, `api/entrypoints/routers.py` (wiring only), `api/oss/tests/pytest/unit/sessions/test_session_commands_dao.py` | none |
| 2 | Runner execution registry and applier | `services/runner/src/sessions/control-channel.ts`, `services/runner/src/sessions/execution-registry.ts`, `services/runner/src/sessions/applied-commands.ts`, `services/runner/src/server.ts` (register and unregister), runner unit tests | none |
| 3a | Direct-call adapter | `services/runner/src/server.ts` (the `/cancel` route and the parked-pool lookup), `api/oss/src/dbs/http/sessions/control_delivery_direct.py` (including the wrong-replica detector of section 9) | 1, 2 |
| 3b | Long-poll adapter | `api/oss/src/apis/fastapi/sessions/router.py` (`SessionControlRouter`), `api/oss/src/apis/fastapi/sessions/models.py`, `api/oss/src/middlewares/auth.py` (one prefix), `api/oss/src/dbs/redis/sessions/contract.py`, `api/oss/src/dbs/redis/sessions/control_delivery.py`, `services/runner/src/sessions/control-poll.ts` | 1, 2 |
| 4 | Public Cancel creates a command | `api/oss/src/apis/fastapi/sessions/router.py`, `api/oss/src/apis/fastapi/sessions/models.py`, `api/oss/src/core/sessions/commands/service.py`, migration `oss000000023` for `session_streams.stopping_turn_id` **and** `session_streams.turn_started_at`, `api/oss/src/dbs/postgres/sessions/streams/{dbas,dbes,dao}.py` (the `CASE` that stamps the start time), `api/oss/src/core/sessions/streams/service.py` (`_start_turn` and the heartbeat stamp) | 1 |
| 5 | Heartbeat command discovery | `api/oss/src/core/sessions/streams/{dtos,service}.py`, `services/runner/src/sessions/alive.ts` | 3a or 3b, and 4 |
| 6 | Command settlement in the watchdog | `api/oss/src/tasks/asyncio/sessions/command_sweep.py` or the equivalent file on `feat/session-execution-watchdog`, `api/entrypoints/routers.py` (lifespan) | 1, and agreement with the watchdog author |
| 7 | Point the clients at the command | `web/packages/agenta-entities/src/session/api/api.ts`, `web/oss/src/components/AgentChatSlice/hooks/useAgentChatSession.ts` (send `expected_execution_id`), `web/mobile/src/features/chat/StopButton.tsx`, `api/oss/src/core/sessions/streams/service.py` (the cancel branch becomes a wrapper) | 4, 5 |

3a and 3b are alternatives, not a sequence. Build whichever Mahmoud picks; the other becomes optional
later work.

Conflict notes:

- PRs 1, 3b, 4 and 6 touch `api/entrypoints/routers.py`. Keep each edit to its own block and land
  them in order.
- PRs 3b and 4 both touch `router.py` and `models.py`. Land 3b first; 4 adds a separate router class.
- PR 2 must land before 3a or 3b, because both need the registry and the applier.
- PRs 1 and 4 each add a migration and must not both claim `oss000000022`.
- PR 6 must be agreed with the agent on `feat/session-execution-watchdog` before either lands. Two
  independent writers of an execution's terminal outcome is a worse bug than the one being fixed.
- **Work package A's `shouldPark` change is a hard dependency of the user-visible result.** Landing
  PRs 1 to 7 without it gives a fast Stop that still destroys the sandbox.

**Keeping the current Stop working.** `POST /sessions/streams/` with no inputs and no `force` keeps
its exact current behavior through PRs 1 to 6. Nothing about `CommandMode.cancel` changes. Released
browsers and the current mobile build keep working unchanged.

**When it becomes a wrapper.** In PR 7. At that point `SessionStreamsService.command`'s cancel
branch (`api/oss/src/core/sessions/streams/service.py:288`) stops calling `_displace_turns` and
instead calls `SessionCommandsService.request_cancel(...)` with no expected execution id, then
returns the same `SessionStreamCommandResponse` shape it returns today. That gives every old client
the new behavior with no client change, and it is also the point at which the old teardown of
`alive` and the hour-long tombstone disappear. Do it in the same PR that flips the browser, so one
revert restores one consistent behavior.

---

## 11. Test plan

### Unit tests

| Component | Test | Passes when |
|---|---|---|
| Commands DAO | Two concurrent claims of one pending command | Exactly one returns a row; the other returns none |
| Commands DAO | Insert with a repeated `Idempotency-Key` | The second insert returns the first row, and one row exists |
| Commands DAO | Settle with the wrong `replica_id` | Returns no row; the stored state is unchanged |
| Commands DAO | Settle a command that is already `applied` | Returns no row; the caller reads the terminal state |
| Commands DAO | Claim with a session set that excludes the command's session | Returns nothing |
| Commands service | Admission with a stale `expected_execution_id` | Raises the conflict type; no row inserted |
| Commands service | Admission with nothing running or parked | One row, `state='obsolete'`, `outcome='not_running'` |
| Commands service | Admission when `turn_started_at` is later than `received_at` | One row, `state='obsolete'`, `outcome='superseded_by_newer_turn'`, `target_turn_id` null, no Redis write |
| Commands service | Admission when `turn_started_at` is null | The guard does not fire; the command targets the current turn |
| Commands service | Admission when `turn_started_at` is earlier than `received_at` | Normal admission, `state='pending'` |
| Commands service | The stored `created_at` equals the `received_at` that was compared | The two values match exactly, not merely closely |
| Streams DAO | The same `turn_id` stamped by ten heartbeats | `turn_started_at` is written once and never moves |
| Streams DAO | A new `turn_id` stamped over an old one | `turn_started_at` moves to the new turn's time |
| Commands service | Admission twice with no idempotency key | One row; the second call returns the first |
| Commands service | Admission writes the command and `stopping_turn_id` | Both are visible after one commit, neither after a rollback |
| Command sweep | Claim expired, session beating, attempts left | Back to `pending` |
| Command sweep | Claim expired, session silent for 90 s | `obsolete`, `outcome='lost'`, keys force-cleared, `ended` published |
| Command sweep | Claim expired, session parked with an open interaction | Not settled as lost; the admission deadline applies instead |
| Command sweep | Redis `alive` still holds its 3600 s value | Settlement still happens, because the rule reads heartbeat age, not the key |
| Direct adapter | Runner answers 404 for a session whose row is not alive | Receipt is `not_held`; the command settles `obsolete` with `not_running` |
| Direct adapter | Runner answers 404 for a session that is alive and beating | Logged at error level, counted, and settled `obsolete` with `lost`, never `not_running` |
| Direct adapter | Runner unreachable | Receipt is `unreachable`; admission still succeeded and returned 202 |
| Direct adapter | The command row exists before the runner is called | A crash injected between the two leaves a `pending` command, never an aborted execution with no record |
| Long-poll adapter | `deliver` when Redis is down | Admission still succeeds; the failure is logged, not raised |
| Runner claim loop | 204, then 200, then a network error | Immediate re-claim, apply, then the backoff sequence with jitter |
| Runner claim loop | 401 | One error log, then a 60 second retry, no tight loop |
| Runner claim loop | Session set includes a parked pool entry | The parked session appears in the request body |
| Runner applier | A command for a `turnId` this process does not hold | Settles `obsolete` with `not_running`; nothing is aborted |
| Runner applier | The held execution started after the command's `created_at` | Settles `obsolete` with `superseded_by_newer_turn`; nothing is aborted |
| Runner applier | The same `command_id` delivered twice | Aborted once, acknowledged twice |
| Runner applier | The deduplication set survives a loop restart | A command applied before the restart is not applied again |
| Runner registry | The run's `finally` runs | The entry is removed even when the run threw |

The runner suite is `cd services/runner && pnpm test` (vitest). The API unit tests sit under
`api/oss/tests/pytest/unit/sessions/`, next to `test_command_matrix_inputs_data.py`.

### One API integration test

`api/oss/tests/pytest/integration/sessions/test_stop_command_delivery.py`, against a real Postgres
and a real Redis, with a fake runner:

1. Establish a session with `alive` and `running` held by `turn-A`, exactly as a heartbeat does.
2. Call the public Cancel route with `expected_execution_id = 'turn-A'`. Assert 202, one `pending`
   row, and `session_streams.stopping_turn_id = 'turn-A'`.
3. Call the claim route as `replica-1`, declaring that session. Assert 200, one command,
   `state='claimed'`.
4. Call the claim route again. Assert 204 within the hold.
5. Post the outcome with `result='applied'` and `execution.state='stopped'`. Assert 200.
6. Assert: the command is `applied` with `outcome='stopped'`; `stopping_turn_id` is null; the Redis
   `running` key is gone; **the Redis `alive` key is still present**; `superseded:...:turn-A` exists;
   the session's pending interactions are cancelled; one `lifecycle: ended` message was published on
   the session watch channel.

Step 6's `alive` assertion is the one that pins warm resume at the API layer. If a later change
starts clearing `alive` on Stop, this test fails.

Add a second integration case for the parked path: park the session (no `running`, `alive` held, one
pending interaction), Stop it, and assert the command is delivered, the interaction is cancelled, and
`alive` still holds.

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

A second cell for the parked path: run a prompt that triggers an approval, wait for the gate, press
Stop, and assert that the outcome lands within 5 seconds, the interaction reads `cancelled`, and the
next message still resumes warm. That cell is the regression test for H-2 and it fails on today's
code for a reason no timing change can fix.

Criteria 2, 3 and 4 depend on Work package A. Criterion 1 does not, and can be gated as soon as PR 7
lands.

---

## 12. Rejected alternatives

**Shorten the heartbeat interval.** Dropping `HEARTBEAT_INTERVAL_SECONDS` from 30 to 2 would cut the
Stop delay with no new machinery. It fails on four counts. It multiplies heartbeat load by fifteen
for every live session, and each beat is a Postgres write plus four Redis operations
(`api/oss/src/core/sessions/streams/service.py:406`). It cannot deliver a Stop to a run whose
credential was dropped, because the beat itself is what fails (`alive.ts:92`). It cannot deliver a
Stop to a parked session at any interval, because the heartbeat has stopped (`server.ts:618`). And it
leaves the control signal encoded as the absence of a lock, which is what makes today's cancel a
session teardown rather than an execution cancel.

**Route commands by owner replica instead of by declared session.** This was the first revision's
design and it is worse. The Redis `owner` key expires after 120 seconds
(`api/oss/src/dbs/redis/sessions/contract.py:40`), so a parked session's owner can lapse and its
commands become unroutable. It also cannot tell whether the named replica still holds the session,
which is exactly the question delivery needs answered. Letting the runner declare what it holds
turns a guess into a fact, and it removes a column from the durable record.

**Subscribe the runner to Redis directly.** The runner could subscribe to a per-session Pub/Sub
channel and skip the claim. It is the least code. It fails on the boundary the codebase already
enforces: the API is the single Redis writer and the runner reaches the coordination plane only over
HTTP (`services/runner/src/sessions/alive.ts:13` and `sessions/contract.ts:25`, both explicit about
this). Handing the runner Redis credentials reverses a deliberate decision, and Pub/Sub has no
replay, so a disconnected runner loses every command sent while it was away.

**A persistent WebSocket or bidirectional stream.** It removes the repeated request and can carry
richer runner status. It is deferred, not wrong. It needs connection lifecycle handling, ping and
pong, reconnect with backoff, and a message framing contract, none of which the command state
machine needs to be correct. Because delivery sits behind the port in section 8, it becomes a later
adapter rather than a rewrite.

**Skip the durable record and make Stop a bare direct call.** This is the product review's position
and it is the strongest alternative. Note what is and is not rejected here. The **direct call** is
not rejected at all: it is section 9, it is a first-class adapter behind the port, and it is the
recommended first adapter. What is rejected is dropping the **record**, for the four reasons set out
in section 9: no recovery when the runner is unreachable, no idempotency against a double Stop
landing on a newer turn, no place to write the one terminal outcome the watchdog and the runner must
agree on, and no foundation for Steer and Queue. Insert first, then call.

---

## 13. Open questions for Mahmoud

1. **Which adapter is the default, `direct` or `long_poll`?** Recommendation: **`direct`** for
   version one, with the wrong-replica detector from section 9 built in the same PR. Reason: you run
   one runner, the hop is authenticated and in production today, it reaches a parked session once the
   pool lookup is added, and it removes a held connection and a poll loop from the first release. The
   port keeps long polling one file away for the day a second replica or a user-operated runner is
   real. The condition on the recommendation: the detector is not optional, because without it the
   two-replica failure is silent, and with it the choice is reversible on a metric rather than on a
   bug report.

2. **Who owns execution settlement, this design or the watchdog branch?** Recommendation: **the
   watchdog owns it, and the command rules move into it.** Reason: one execution must reach exactly
   one terminal outcome from exactly one writer, and two sweeps racing to write `lost` is a worse
   bug than the one being fixed. This needs deciding before PR 6 and before the watchdog branch
   lands.

3. **Does Stop leave the Redis `alive` key in place?** Recommendation: **yes, leave it**, exactly as
   a normal turn end does. Reason: force-deleting `alive` is what makes today's cancel read as a
   session teardown, and warm resume is the required outcome. This is a deliberate deviation from
   the phrase "Redis `running` and `alive` released" in the work package brief, so it needs an
   explicit yes or no.

4. **Do first-party clients always send `expected_execution_id`?** Recommendation: **yes, and treat
   an omission as a bug.** Reason: it is the cheapest of the three H-3 guards and the only one that
   works before the request reaches the server. The field stays optional in the contract for
   external callers, as decision D-010 requires.

5. **Do we cancel the pending interaction when Stop hits a parked session?** Recommendation:
   **yes, cancel it, and keep the parked environment.** Reason: an approval card whose execution was
   stopped is exactly the "actionable card whose buttons do nothing" bug, and the kill route already
   makes this call (`api/oss/src/apis/fastapi/sessions/router.py:441`). Keeping the environment is
   what makes the next message warm, and it is what distinguishes Stop from Delete.
