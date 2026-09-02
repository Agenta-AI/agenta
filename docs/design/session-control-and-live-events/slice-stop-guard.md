# Slice: the Stop guard and pending cancel

Branch `feat/session-stop-guard`. Three changes on the existing cancel path, no new transport, no
new table, no runner change.

## What happens today

Stop is `POST /sessions/streams/` with no inputs and `force=false`. The service classifies that as
CANCEL and calls `_displace_turns`, which tombstones whichever turn holds `alive` or `running` at
that instant and clears both keys.

Two things follow from that, and both are bugs.

1. **A Stop applied after its turn ended kills the next turn.** Nothing recorded which turn the
   Stop meant, so the tombstone lands on whatever is there. The tombstone lives for 3600 s and its
   TTL is refreshed on every read (`api/oss/src/dbs/redis/sessions/locks.py:147-153`), so the
   session stays wedged. This is review finding H-3 and a plausible mechanism for #6417.
2. **A stopped session keeps a live approval card.** Kill cancels pending interactions
   (`api/oss/src/apis/fastapi/sessions/router.py:441-444`); cancel did not. The card's buttons then
   answer a turn that no longer exists (#6315). `requirements.md:149` asks for this and no work
   package owned it (review open question 5).

## What changed

### 1. The cancel guard

| Change | Where |
|---|---|
| `expected_execution_id` on the cancel request | `api/oss/src/core/sessions/streams/dtos.py:150-166` |
| `SessionTurnMismatch`, the refusal | `api/oss/src/core/sessions/streams/types.py:41-73` |
| The guard itself | `api/oss/src/core/sessions/streams/service.py:174-222` |
| `_displace_turns` takes the guard and reports what it killed | `service.py:224-297` |
| The cancel branch passes both guards | `service.py:384-411` |
| 409 mapping with both ids in the body | `api/oss/src/apis/fastapi/sessions/router.py:203-212` |

`expected_execution_id` keeps the RFC's public name. Internally it is a turn id, which is the
coordination plane's word for one execution of a session, and the service maps the two at the
boundary. It stays optional in the contract, per D-010. A whitespace-only value is read as absent,
which is the safe failure.

With the id present, cancel touches that turn or nothing. Another turn holding the session means the
turn the caller meant is already gone, so the request returns 409 and no key is written. A named turn
that holds nothing is still tombstoned, so a beat still in flight for it cannot re-take the session.

With no id, cancel refuses a turn whose start is later than the request's arrival. Read the next
section before relying on that.

### 2. Turn start times

Nothing recorded when a turn started, and it cannot be derived. `session_turns.start_time` is
written by the runner after the fact, and a browser turn's id is a runner-minted uuid4
(`services/runner/src/server.ts:188`), so it carries no timestamp. The slice adds one API-side Redis
key, in the same shape as the existing tombstone key and with the same lifetime as `alive`.

| Change | Where |
|---|---|
| `started:<project>:session:<session>:turn:<turn>` | `api/oss/src/dbs/redis/sessions/contract.py:81-93` |
| `record_turn_start` (write-once) and `get_turn_start` | `api/oss/src/dbs/redis/sessions/locks.py:171-221` |
| Stamped when the API mints a turn | `service.py:1079-1086` |
| Stamped on a runner-minted turn's first beat | `service.py:601-613` |

An absent record means unknown, never old, so a turn from before this shipped stays stoppable.

This branch adds **no migration and no column**. `feat/session-durable-cancel` owns
`session_streams.turn_started_at`; when that lands it replaces this key and the two helpers in
`locks.py` can go. The Redis key is here because the alternative offered, comparing the turn id read
at the start of the cancel handler with the one read at the end, only catches a turn that changes
inside the handler, which is microseconds wide and catches nothing real.

### 3. Stop cancels the stopped turn's pending interactions

The cancel response now reports every turn it tombstoned (`cancelled_turn_ids` on
`SessionStreamCommandResponse`, `dtos.py:175-178`). The route reads it and calls
`cancel_session_pending` once per turn, scoped with the existing `only_turn_id` argument
(`router.py:413-433`). That helper already publishes the `interaction: resolved` watch event, so an
open browser refetches and re-renders. A cancel that ended no turn cancels every pending gate on the
session, because nothing holds the session and nothing can ever answer them. That is kill's
reasoning.

The runner writes a gate with `request.turnId` (`services/runner/src/engines/sandbox_agent/run-turn.ts:708-714`),
which is the same id it heartbeats with, so the scoping matches what the runner produces. Verified in
code.

### 4. The browser renders a cancelled gate as closed

Replay already did: `settleApprovalPart` maps a `cancelled` interaction row to `output-denied`
(`web/packages/agenta-chat/src/assets/transcriptToMessages.ts:240-243`). The live path did not. The
in-memory pending list was not gated on `stopped`, unlike the two docks beside it, so a live card with
working buttons and hot keyboard shortcuts stayed up until a reload.

`getLivePendingApprovals` (`web/packages/agenta-chat/src/model/approvals.ts:68-82`) holds the rule for
both clients. Desktop reads it at `web/oss/src/components/AgentChatSlice/AgentConversation.tsx:378-387`
and mobile at `web/mobile/src/features/chat/LiveConversation.tsx:191-196`. `stopped` clears on the next
send, so a new turn's gates appear normally.

### 5. The concurrency limit no longer refuses a Stop

Added scope, raised after the first pass. `check_runner_concurrency_limit` gated every mode, so a
project at its per-project run limit could not stop the very runs holding the limit: the one request
that frees capacity was the one refused with 429. Cancel starts nothing, so it is now exempt
(`api/oss/src/apis/fastapi/sessions/router.py:407-413`).

The route needs the mode before the service runs, so the inputs-by-force matrix moved into
`derive_command_mode` (`api/oss/src/core/sessions/streams/service.py:144-160`) and both the route and
the service call it. One derivation, so the two cannot disagree about what a cancel is.

### 6. A refused Stop reaches the user

Added scope. The desktop Stop was fire-and-forget and `callFern` logs and returns null for every
non-abort failure, so a Stop the server refused was invisible: the transcript said "Stopped" while
the run continued and kept billing. Now the outcome is read.

`cancelSessionStream` (`web/packages/agenta-entities/src/session/api/api.ts:629-690`) returns one of
three answers, `cancelled`, `stale`, or `failed`, carrying the server's own 409 message. It is a
separate function rather than a flag on `commandSessionStream` because the other callers of that
function deliberately ignore the result and use a null check that widening would break.

The desktop reads it at `web/oss/src/components/AgentChatSlice/hooks/useAgentChatSession.ts:505-524`:
on a refusal it withdraws the local "Stopped" marker, shows a short notice, and invalidates the
liveness query so the running-elsewhere strip tells the truth.

### 7. The mobile composer Stop calls the server

Added scope. Mobile had the server-calling Stop only on the running-elsewhere strip, the button that
appears when the turn is NOT this device's. The composer's own Stop called `conversation.stop`, which
aborts this device's fetch and nothing else, so stopping your own turn on mobile left the run going
and billing.

`stopHere` (`web/mobile/src/features/chat/LiveConversation.tsx:197-213`, wired at `:482`) now aborts
locally and sends the same cancel the desktop sends, with the same refusal handling. The strip's
`StopButton` moved to the same helper (`web/mobile/src/features/chat/StopButton.tsx:15-38`) and shows
the stale message instead of "try again", which would have sent the user round the same refusal.

### 8. The browser sends the guard

The client half of the turn id. The runner emits `{type: "turn", turnId}` as its first event and the
SDK forwards it verbatim as a `data-agent-turn` part, arriving third after `start` and `start-step`,
before any content. It cannot ride on `start`, because the SDK egress emits `start` before the runner
is consulted. The runner half is runner commit `ce0f1e12da` on
`feat/session-single-turn-admission`; until it lands no part arrives, nothing is stored, and Stop
sends no guard, exactly as before.

| Change | Where |
|---|---|
| `turnIdFromDataPart`, the strict reader | `web/packages/agenta-chat/src/assets/agentTurn.ts:16-23` |
| The per-session store, cleared with the session's ephemera | `web/packages/agenta-chat/src/state/sessionEphemera.ts:33-52` |
| Desktop reads the part and sends the id | `web/oss/src/components/AgentChatSlice/hooks/useAgentChatSession.ts:152-156`, `:519-526` |
| Mobile reads the part (shared hook) and sends the id | `web/packages/agenta-chat/src/hooks/useAgentConversation.ts:273-276`, `web/mobile/src/features/chat/LiveConversation.tsx:200-207` |
| `cancelSessionStream` carries it | `web/packages/agenta-entities/src/session/api/api.ts:629-680` |
| The typed client gained the field | `web/packages/agenta-api-client/src/generated/.../SessionStreamCommandRequest.ts` |

The store is a Map beside the composer drafts rather than an atom, because nothing renders the id:
it is written once per turn and read once, when Stop is pressed. It is deliberately kept past the end
of the turn. A turn parked on an approval has finished streaming and is still the turn a Stop means,
which is exactly the state review finding H-2 is about.

Three rules the code holds to, each because the wrong id refuses a Stop that is correct:

- The reader is strict. A part of any other type, a missing id, a blank id, or a non-string yields
  null, and null means send nothing.
- The field is omitted, never sent as null, when the client never learned an id. The server then
  falls back to its own arrival-time check.
- The running-elsewhere button on mobile sends no guard at all
  (`web/mobile/src/features/chat/StopButton.tsx:15-21`). That turn runs on another device, so this
  device never saw its part, and naming a turn it watched earlier would refuse a correct Stop.

**The typed client was regenerated**, against this stack's own OpenAPI
(`clients/scripts/generate.sh --language typescript --url http://144.76.237.122:8980/api/openapi.json`).
The diff is two fields and nothing else: `expected_execution_id` on the request and
`cancelled_turn_ids` on the response. The checked-in client was otherwise already in sync.

One transition hazard, stated rather than guarded: if a session's first turn emitted the part and a
later turn did not, the stored id would be stale and that Stop would be refused. It needs a runner
version change in the middle of one session, and the refusal is visible and says why. The code does
not retry without the guard, because retrying unguarded is exactly the behavior #6417 is about.

## The honest limit of the arrival-time guard

**The arrival-time check does not close #6417 on its own. `expected_execution_id` does.** Both
first-party clients now send it, and the id reaches them only once the runner half lands on
`feat/session-single-turn-admission`. Until then the measurement below is what Stop does.

Measured, not argued. Fourteen runs of the real race against the live stack: turn one takes the
session, then a Stop with no id and the next Send are fired together, Stop first. Results below.

| Measurement | Result |
|---|---|
| Stops refused by the arrival-time guard | 0 of 14 |
| Runs where turn two was tombstoned | 1 of 14 |

The guard never fired because in every run where turn two died, the Stop genuinely reached the API
after turn two had started. The check only catches a request that arrives before the turn starts and
is processed after it. That window is the permission check plus the concurrency check, both database
round trips, which is why the stamp is taken at the route's first line
(`router.py:385-391`) rather than inside the service. It is still small next to the client's own
network latency, which is the larger half of the race and which the server cannot see.

The mechanism itself works. Forcing one turn's recorded start five seconds into the future and then
sending a Stop with no id returns 409 and leaves the turn holding `alive` and `running`, untombstoned.
That protocol is under "Live verification" below.

A client-supplied age would close the gap without a clock-skew problem: the browser sends how many
milliseconds ago the button was pressed, and the server subtracts that from arrival. It is not in the
RFC and it is not in this slice. It is open question 2 below.

## Live verification

Stack: `http://144.76.237.122:8980`, project `agenta-ee-dev-session-stopguard`, EE, dev images, local
sandbox provider. Left running. Teardown:

```bash
cd /home/mahmoud/code/agenta-2-worktrees/slice-stop-guard
bash ./hosting/docker-compose/run.sh --license ee --dev --env-file .env.ee.dev.stopguard --no-tunnel --down
```

One operational note for whoever takes the stack over. Running `pnpm install` on the host inside a
worktree that a dev-mode web container bind-mounts breaks that container: the host user owns the
resulting `node_modules` and `dist` directories, the container runs as uid 10001, and its own
`pnpm install` fails with EACCES on every restart. The web page serves 502 until the tree is made
group-writable (`chmod -R a+rwX web`). The API is unaffected.

Every scenario below was driven by curl against the public API, with Redis read through
`docker exec agenta-ee-dev-session-stopguard-redis-volatile-1 redis-cli`. The project id in the keys
is `01a063e7-865b-7883-aecc-43cd6ae9a4d9`.

### (a) A Stop naming a turn that has ended is refused, and the new turn keeps running

Turn one took the session, a steer replaced it with turn two, then a Stop named turn one.

```
--- STALE STOP: expected_execution_id = T1 ---
{"detail":{"message":"Session 'qa-stopguard-1788382545' is running turn '01a063e8-0890-7473-b31e-5e5bd7367dcb',
 not the expected turn '01a063e8-0722-73d0-b023-0f88dab03245'. Nothing was cancelled.",
 "expected_execution_id":"01a063e8-0722-73d0-b023-0f88dab03245",
 "actual_execution_id":"01a063e8-0890-7473-b31e-5e5bd7367dcb"}}
HTTP=409
--- state after the refused stop ---
alive   -> 01a063e8-0890-7473-b31e-5e5bd7367dcb
running -> 01a063e8-0890-7473-b31e-5e5bd7367dcb
tombstone(T2) exists -> 0
tombstone(T1) exists -> 1
```

A Stop naming turn two was then accepted, returned `cancelled_turn_ids`, and cleared `alive`.

### (b) A Stop with no id does not tombstone a turn that started after it

Constructed, because the timing cannot be forced from outside the process. One turn was started
normally, its recorded start was moved five seconds into the future, and a Stop with no id was sent.

```
forced start -> 1788382688429  (5s after now)
--- Stop with NO expected_execution_id ---
{"detail":{"message":"Session 'qa-future-1788382683' started turn '01a063ea-20b4-71b0-a5b7-6b5b82a29ec5'
 after this cancel arrived, so the cancel is stale. Nothing was cancelled.
 Send `expected_execution_id` to cancel a specific turn.", ...}}
HTTP=409
alive          -> 01a063ea-20b4-71b0-a5b7-6b5b82a29ec5
running        -> 01a063ea-20b4-71b0-a5b7-6b5b82a29ec5
tombstone(T2)  -> 0
```

The unconstructed version of this scenario is the 14-run race above, which the guard did not catch.

### (c) Stop cancels a pending gate and a late answer is refused

The gate was created through `POST /sessions/interactions/`, the endpoint and body the runner uses,
with the same `turn_id` as the running turn.

```
status before Stop = pending   turn_id = 01a063ea-bf70-7f82-b0df-bfb2b783ad46
=== STOP ===
{"mode":"cancel","session_id":"qa-gate-1788382723","turn_id":"01a063ea-bf70-7f82-b0df-bfb2b783ad46",
 "detached":true,"cancelled_turn_ids":["01a063ea-bf70-7f82-b0df-bfb2b783ad46"]}
HTTP=200
status after Stop = cancelled
=== late answer ===
{"detail":"Interaction is no longer pending"}
HTTP=409
```

An open browser sees the refresh signal. The watch stream for the same sequence:

```
event: ready
event: interaction   data: {"type": "interaction", "session_id": "...", "status": "pending"}
event: lifecycle     data: {"type": "lifecycle", "session_id": "...", "state": "ended"}
event: interaction   data: {"type": "interaction", "session_id": "...", "status": "resolved"}
```

Not verified live: a gate raised by a real agent turn rather than by the same endpoint the runner
posts to. The turn id the runner uses was checked in code, not on the wire.

### (d) A project at its concurrency limit can still Stop

The API was recreated with `AGENTA_SESSIONS_REDIS_CONCURRENCY_LIMIT=1`, driven, then recreated with
the setting removed. The stack is back on the default.

```
=== a SEND takes the one slot ===        HTTP=200
=== a second SEND is refused ===         HTTP=429
  {"detail":"Concurrency limit of 1 concurrent runs reached for this project."}
=== STOP on the running session ===      HTTP=200
  {"mode":"cancel", ... "cancelled_turn_ids":["01a06424-5758-7ac3-a4ea-fc03ff4e267c"]}
=== the freed slot lets the next SEND through === HTTP=200
```

Before the change the third line was a 429.

Not verified live: the desktop and mobile notices in a browser. Both need an agent run with a model
key, which this stack has no key for. The three outcomes of `cancelSessionStream` are unit-tested,
all four touched packages typecheck, and the web container compiled the chat route clean
(`✓ Compiled /w`).

## Tests

| Suite | File | Result |
|---|---|---|
| The guard, the start record, steer staying unguarded | `api/oss/tests/pytest/unit/sessions/test_cancel_stop_guard.py` | 12 passed |
| The route: pending gates and the concurrency exemption | `api/oss/tests/pytest/unit/sessions/test_cancel_cancels_pending_interactions.py` | 11 passed |
| The live approval rule | `web/packages/agenta-chat/tests/unit/model/liveApprovals.test.ts` | 3 passed |
| The Stop outcomes and the guard on the wire | `web/packages/agenta-entities/tests/unit/session-cancel-stream.test.ts` | 8 passed |
| The turn-id reader and its store | `web/packages/agenta-chat/tests/unit/assets/agentTurn.test.ts` | 6 passed |

`api/oss/tests/pytest/unit/sessions/` as a whole: 505 passed, 41 skipped. The `@agenta/entities`
suite is 1472 passed and `@agenta/chat` is 631 passed. `pnpm lint-fix` in `web/` is clean, `ruff
format` and `ruff check` in `api/` are clean, and `@agenta/entities`, `@agenta/chat`,
`@agenta/mobile` and `@agenta/oss` all typecheck.

## What is left

- **The guard is inert until the runner emits `data-agent-turn`.** Both clients read it and send it;
  no runner on this branch emits it. The runner half is commit `ce0f1e12da` on
  `feat/session-single-turn-admission`. The stream row's `turn_id` was rejected as a source: it
  reaches the browser through a 15 s liveness poll, and a stale id refuses a legitimate Stop of the
  current turn, which is worse than the bug.
- The residual in-handler race: a turn that takes `alive` between `_displace_turns` reading the owners
  and clearing them is still tombstoned. Microseconds wide, and closing it needs a Lua script or the
  fencing that D-017 defers.
- The desktop and mobile notices, and the guard actually travelling from a browser, were not seen in
  a browser. All of it is unit-tested and typechecked, and the wire body the client now sends was
  driven by hand against the live API. Seeing it end to end needs the runner half plus an agent run
  with a model key, and this stack has no key.

## Open questions for Mahmoud

1. **Should the browser's Stop carry how long ago the button was pressed?** Recommendation: yes, one
   optional integer. Reason: it is the only thing that closes #6417 before a turn id reaches the
   browser, it needs no clock agreement between client and server, and the measurement above shows the
   server-side arrival stamp catches nothing on its own.
2. **Should the same turn id also guard the interaction responses?** Recommendation: yes, once the
   runner half lands. Reason: `rfc.md:68-75` already asks for `expected_execution_id` on a response,
   the browser will now have the id in hand, and an approval answered against a turn that has ended is
   the same class of bug as a stale Stop.
3. **Should a refused Stop be a 409 or a quiet success?** Recommendation: 409 with both ids, as built.
   Reason: the browser can retry with the id in the body, and a silent success would tell the user the
   run stopped when it did not.
4. **Should Stop keep cancelling every pending gate when it ended no turn?** Recommendation: keep it.
   Reason: nothing holds the session in that state, so no gate can ever be answered, and leaving them
   pending reproduces #6315 for the case where the turn had already lapsed.
5. **Should closing a chat tab keep sending a cancel?** Recommendation: no. Reason:
   `AgentChatPanel.tsx:138` is now the only Stop that still discards its outcome, and it fires on tab
   close, which contradicts `requirements.md:98` and surprises anyone who closes a tab to reopen the
   session elsewhere. If it stays, it should say so in the requirements and use the same helper.
