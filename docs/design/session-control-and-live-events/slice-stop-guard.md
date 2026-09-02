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

## The honest limit of the arrival-time guard

**The arrival-time check does not close #6417 on its own. `expected_execution_id` does, and no
first-party client can send it today.**

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

## Tests

| Suite | File | Result |
|---|---|---|
| The guard, the start record, steer staying unguarded | `api/oss/tests/pytest/unit/sessions/test_cancel_stop_guard.py` | 12 passed |
| The route cancelling pending gates | `api/oss/tests/pytest/unit/sessions/test_cancel_cancels_pending_interactions.py` | 5 passed |
| The live approval rule | `web/packages/agenta-chat/tests/unit/model/liveApprovals.test.ts` | 3 passed |

`api/oss/tests/pytest/unit/sessions/` as a whole: 501 passed, 41 skipped. `pnpm lint-fix` in `web/`
is clean, `ruff format` and `ruff check` in `api/` are clean.

## What is left

- **No first-party client sends the guard.** The API half is done and the browser half is not
  possible today. The runner mints a browser turn's id and the client never composes one
  (`services/runner/src/server.ts:183-189`). No response or frame the browser receives carries it:
  the send goes through the transport's invoke, not through `commandSessionStream`, and the `start`
  frame's metadata is `{sessionId}` (`web/packages/agenta-chat/src/transport/AgentChatTransport.ts:146`).
  That frame is where a `turnId` would have to go. The stream row's `turn_id` reaches the browser
  through the 15 s liveness poll, which is too stale to send as a guard: a stale id would refuse a
  legitimate Stop of the current turn, which is worse than the bug.
- The residual in-handler race: a turn that takes `alive` between `_displace_turns` reading the owners
  and clearing them is still tombstoned. Microseconds wide, and closing it needs a Lua script or the
  fencing that D-017 defers.
- The Fern client was not regenerated, so the typed web client has no `expected_execution_id` field yet.

## Open questions for Mahmoud

1. **Should the browser's Stop carry how long ago the button was pressed?** Recommendation: yes, one
   optional integer. Reason: it is the only thing that closes #6417 before a turn id reaches the
   browser, it needs no clock agreement between client and server, and the measurement above shows the
   server-side arrival stamp catches nothing on its own.
2. **Should the `start` frame carry the turn id?** Recommendation: yes, and it is the better long-term
   fix. Reason: the guard is exact with it and heuristic without it, and the same id then serves the
   interaction responses (`rfc.md:68-75`), which also want `expected_execution_id`.
3. **Should a refused Stop be a 409 or a quiet success?** Recommendation: 409 with both ids, as built.
   Reason: the browser can retry with the id in the body, and a silent success would tell the user the
   run stopped when it did not.
4. **Should Stop keep cancelling every pending gate when it ended no turn?** Recommendation: keep it.
   Reason: nothing holds the session in that state, so no gate can ever be answered, and leaving them
   pending reproduces #6315 for the case where the turn had already lapsed.
5. **Does the turn-start key need its own TTL setting?** Recommendation: no, leave it equal to
   `alive`. Reason: a turn with no `alive` cannot be cancelled, so a longer life buys nothing and a
   shorter one silently disables the guard on long turns.
