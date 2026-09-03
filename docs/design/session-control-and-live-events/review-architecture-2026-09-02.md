# Architecture review: session control and live events

Reviewer role: find what breaks in implementation. The direction is agreed. All `path:line`
references are in `/home/mahmoud/code/agenta-2-worktrees/session-overnight` unless the path says
otherwise.

## Headline

The RFC is accurate about the API and the records plane. It is wrong about the runner in the one
place that decides whether version one can ship. **Today a Stop destroys the warm sandbox.** The
plan in `tonight-handoff.md` ("Let the runner apply Stop through its active abort controller")
reproduces that destruction, because the abort signal is the exact input that makes the park policy
return false. Warm resume after Stop is not a spike question. It is a code change that must land in
version one, and the handoff does not list it.

Three other items must change before implementation: Stop has no delivery path during an approval
pause, a Stop that lands after the turn ends silently kills the next turn, and command settlement
has no owner when the runner process exits.

---

## 1. Claims checked against code

### Verified

| Claim | Where in the docs | Evidence |
|---|---|---|
| Desktop Stop aborts the local response, then posts to `/sessions/streams/` with no inputs and `force=false` | research.md:14 | `web/oss/src/components/AgentChatSlice/hooks/useAgentChatSession.ts:480-505`; `force` is never passed, so it defaults to false |
| The API classifies that as Cancel, supersedes the turn owner, clears `alive` and `running` | research.md:15 | `api/oss/src/core/sessions/streams/service.py:244-245` (mode derivation), `:288-302` (cancel branch), `:169-199` (`_displace_turns` tombstones, then clears both keys, then re-tombstones) |
| The runner learns it lost ownership through `is_current_turn=false` on the next heartbeat, then aborts | research.md:16-17 | API side `service.py:406-452`, `:476-494`; runner side `services/runner/src/sessions/alive.ts:105` sets `interrupted`, `:204-208` fires the callback once, `services/runner/src/server.ts:519` wires it to `controller.abort()` |
| The heartbeat carries `session_id`, `replica_id`, `turn_id`, `is_running` | research.md:31-32 | `services/runner/src/sessions/alive.ts:81-90` |
| Hard kill is a separate `DELETE /sessions/streams/` that tears down the sandbox | research.md:20-22 | route `api/oss/src/apis/fastapi/sessions/router.py:312-318`; teardown `api/oss/src/core/sessions/streams/service.py:350-401` |
| The kill client calls one configured `runner.internal_url` and does not resolve `replica_id` to an address | research.md:24-27, rfc.md:207-209 | `api/oss/src/core/sessions/streams/runner_client.py:37-50` |
| The four-mode inputs x `force` matrix | research.md:64-71 | `api/oss/src/core/sessions/streams/service.py:7-11` and `:240-246` |
| Attach records watcher state and delivers no live frames | research.md:75 | `service.py:305-321` steals the attached token and mirrors flags only |
| Records use `ON CONFLICT DO UPDATE` over `(project_id, record_id)` and overwrite exactly the six named columns | records-invariants.md:257-266 | `api/oss/src/dbs/postgres/sessions/records/dao.py:126-135` |
| Read order is producer `timestamp`, then `created_at`, then `record_index`, and `record_index` restarts per turn | records-invariants.md:283-293 | `dao.py:151-162` including the comment that states the restart |
| The worker adds every decoded message id to `processed_ids` before the write, and keeps them after an append failure | records-invariants.md:307-314 | `api/oss/src/tasks/asyncio/sessions/records_worker.py:177` and `:184` add the ids; `:236-246` logs and `continue`s on failure; `:278` returns them; `api/oss/src/tasks/asyncio/shared/consumer.py:143-155` then acks and deletes |
| The runner retries record ingest a bounded number of times, then counts an in-memory failure and drops | records-invariants.md:316-320 | `services/runner/src/sessions/persist.ts:32-41` (3 legacy, 6 durable, cap 12), `:93-135` (loop then fall through), `:444-451` (turn-end drain marks reconstruction unsafe in-process only) |
| Interaction respond flips the row to `responded` first, then the winner enqueues a TaskIQ job | research.md:82-87 | `api/oss/src/apis/fastapi/sessions/router.py:1055-1082` |
| The watch relay sends change notifications and the reader refetches | research.md:42-44 | `records_worker.py:257-270` publishes `records_changed`; watch route `router.py:349-356` |
| Redis stores a logical `replica_id` with no network meaning | rfc.md:220-224 | `api/oss/src/dbs/redis/sessions/contract.py:69-70` plus `runner_client.py:37-45` |

### Verified, and stronger than the doc says

**The vendored client refuses `session/cancel`.** research.md:57-60 calls this "reported" and "not
yet verified in this workspace". It is verified. In
`/home/mahmoud/code/agenta-2/services/runner/node_modules/sandbox-agent/dist/chunk-TVCDKGSM.js`:

- `:1550-1551` — `if (method === SESSION_CANCEL_METHOD && !allowManagedCancel) throw new Error(MANUAL_CANCEL_ERROR)`.
- `:561` — the message: `Manual session/cancel calls are not allowed. Use destroySession(sessionId) instead.`
- `:1407-1410` — the only caller that passes `allowManagedCancel = true` is `destroySession`, which
  then stamps `destroyedAt` on the session record.

So the vendored package offers cancel only as part of destroying the harness session. The runner
uses it exactly that way: `services/runner/src/environment/harness-session-lifecycle.ts:171` and
`services/runner/src/engines/sandbox_agent/run-turn.ts:496`, both on teardown paths. O-002 can be
closed now on the client-capability half. What remains open is whether Pi and Claude Code accept
`session/cancel` and stay resumable, which is a live test, not a code read.

**`shouldPark` destroys on abort.** `services/runner/src/engines/sandbox_agent/engine.ts:21-31`:

```ts
if (signal?.aborted) return false; // aborted run: destroy, do not park
if (clientGone?.()) return false;  // client disconnected mid-turn: destroy, do not park
```

Every park decision routes through it: `server.ts:302`, `engine.ts:76`,
`lifecycle/session-coordinator.ts:561`, `:770`, `:828`. The Stop path aborts that same signal
(`server.ts:519`). Therefore Stop today ends in `env.destroy({reason: "aborted"})`.

This contradicts a comment in the runner itself. `run-turn.ts:146-148` says the cancel marker exists
so the turn "ends CLEANLY (honest interrupted transcript, keep-warm)". The turn does end cleanly and
sets `stopReason: "cancelled"` (`run-turn.ts:1188-1191`), but nothing downstream reads that value.
No park path branches on `"cancelled"`. The abort flag wins.

### Stale or incomplete

- **research.md:52-54** says the implementation "uses stable record IDs and upserts" against a spec
  that says UUIDv7. Correct, but records-invariants.md:275-278 is the sharper statement and the two
  files should say the same thing once.
- **rfc.md:108** ("Stop | ... | Clearer endpoint and faster delivery") understates the change. The
  behavior change that closes the Stop issues is warm preservation, not endpoint shape. Faster
  delivery without a park fix makes the product worse: the user gets a quicker Stop that also
  discards the sandbox.
- **rfc.md:113** says Attach "records watcher state but does not provide live output". True, but the
  table omits that Attach also **does not steal `alive`**, so removing Attach removes nothing the
  control path depends on. Fine to delete; say so.
- **research.md:9-10** says the desktop Send path "does not yet use the session command endpoint".
  Verified, and worth adding the consequence: `_start_turn`
  (`api/oss/src/core/sessions/streams/service.py:939-1038`) writes the stream row and a derived
  session name but never persists the user message. The message row is written by the runner
  (`services/runner/src/server.ts:562-570`). That is the mechanism behind #6419, "session titled
  with my message, conversation empty", and it is a two-line observation the RFC does not make.

### Numbers the RFC never states and the design depends on

| Value | Setting | Evidence |
|---|---|---|
| 30 s | Heartbeat interval | `services/runner/src/sessions/contract.ts:18` |
| 3600 s | `alive` and `running` TTL | `api/oss/src/utils/env.py:1416-1422` |
| 3600 s | `superseded` tombstone TTL, refreshed on every read | `env.py:1465-1467`, `api/oss/src/dbs/redis/sessions/locks.py:147-153` |
| 120 s | `owner` affinity TTL | `env.py:1428-1430` |
| 60 s | Warm idle park window, local provider | `services/runner/src/engines/sandbox_agent/session-identity.ts:39` |
| 120 s | Warm idle park window, Daytona | `session-identity.ts:54` |
| 600 s | Approval park window | `session-identity.ts:48` |

The 30 s heartbeat is why D-007 asks for five seconds. The 60 s and 120 s idle windows are the more
important pair: even a perfect warm Stop gives the user about one to two minutes to resume before
the sandbox is reclaimed. The RFC promises "warm resume" without stating that budget.

---

## 2. Internal contradictions

1. **Ownership generations.** requirements.md:63 requires "Only the current execution ownership
   generation can append events or cause external effects", and rfc.md:271-273 restates it as target
   design. decisions.md:143-149 (D-017) defers generations entirely, and tonight-handoff.md:614 lists
   "Ownership generations and full fencing" as deferred. A requirement no version satisfies should be
   marked deferred in requirements.md, not left as a live requirement the RFC appears to meet.

2. **Stop and pending interactions.** requirements.md:149 states "Stop cancels pending interactions
   for the stopped execution." In code only kill does that
   (`api/oss/src/apis/fastapi/sessions/router.py:441-444`); the cancel branch
   (`service.py:288-302`) does not touch interactions. Neither rfc.md nor tonight-handoff.md assigns
   this to anyone. It is a requirement with no owner.

3. **Disconnection.** requirements.md:98 says "Refresh, navigation, and sender disconnection do not
   stop the execution." Closing a chat tab in the desktop sends the same cooperative cancel the Stop
   button sends (`web/oss/src/components/AgentChatSlice/AgentChatPanel.tsx:133-139`), and
   `shouldPark` treats a mid-turn client disconnect as destroy
   (`engine.ts:27`). The RFC never mentions either. Two of them are deliberate product choices; at
   least say which.

4. **Ordering of the durable decision.** decisions.md:177 marks P-003 as needing "an explicit
   decision reversal or separation from records", and O-005 makes the stable-ID spike a gate.
   tonight-handoff.md:554 parks the records-versus-event-table decision. rfc.md:340-404 then writes
   two full options with trade-offs as if the choice were imminent. That is fine as analysis; label
   it as blocked on work package D so no one implements from it.

5. **Attach.** rfc.md:101 says "Attach is replaced by reading the snapshot and event stream", and
   rfc.md:113 says "Remove the command." decisions.md O-007 (line 245) still lists the command
   boundary as open with Attach as "a read operation". Same answer, two statuses.

6. **Numbering.** decisions.md has two entries numbered O-009 (`:255` public Cancel target and
   `:267` busy-message policy names). Renumber before anyone cites one.

---

## 3. Holes in the version-one design

Version one as fixed: durable commands, long polling behind a port, heartbeat fallback, Stop keeps
the sandbox warm, Redis ownership unchanged.

### H-1. Stop destroys the sandbox (blocking)

**Scenario.** User presses Stop. API supersedes the turn and clears `alive`. Within 30 s the
heartbeat returns `is_current_turn:false`. `alive.ts:206` calls `controller.abort()`. `run-turn.ts`
races to `CANCELLED` and returns cleanly. `server.ts:302` calls `shouldPark(result, signal,
clientGone)`; `engine.ts:26` sees `signal.aborted` and returns false; the coordinator evicts and
destroys (`session-coordinator.ts:770`, `:828`). The next message rebuilds cold.

**Why the text does not cover it.** tonight-handoff.md:605 says "Let the runner apply Stop through
its active abort controller" and tonight-handoff.md:552 says "Require Stop followed by warm resume".
Under current code those two sentences are mutually exclusive. Work package A is scoped to
sandbox-agent, so nobody owns `shouldPark`.

**Smallest fix.** Distinguish a user Stop from an abort. Thread a `cancelReason` (or a second signal)
so the runner knows the abort was a cooperative Stop, and change `shouldPark` to park when
`result.ok && result.stopReason === "cancelled" && reason === "user-stop"`. Keep destroy for a
disconnect abort and for any other abort. That is a runner-local change of a few lines plus the
tests in `services/runner/tests/unit/`. Put it in work package A's deliverable and in the version-one
implementation list.

### H-2. Stop has no delivery path during an approval pause (blocking)

**Scenario.** The agent asks for approval. The turn parks: the coordinator seats the environment as
`awaiting_approval` (`session-coordinator.ts:766-775`), and the request handler's `finally` runs
`aliveWatchdog.release()` (`server.ts:618`), which clears the heartbeat interval and sends one final
beat with `is_running:false` (`alive.ts:241-252`). From that moment the runner sends no heartbeat for
that session. The user presses Stop. The API records the command. Long polling can deliver it only if
the runner holds a poll loop that is not scoped to an in-flight turn. Heartbeat fallback cannot
deliver it at all, because there is no heartbeat.

**Why the text does not cover it.** rfc.md:318-321 describes the runner releasing keys "after
cancellation settles" and assumes a live turn. tonight-handoff.md:551 names heartbeat discovery as
the fallback without noting that the fallback is absent for exactly the state approvals put the
session in.

**Smallest fix.** Make the long poll a **session-scoped, process-level loop**, started when the
runner first claims a session and kept running while the session has a parked environment. Not a
per-turn loop. State this explicitly in work package B: the poll loop's lifetime is the session's
warm lifetime, not the turn's. Then define what Stop does to a parked approval: cancel the pending
interaction, keep or drop the parked environment, and emit one terminal outcome.

### H-3. A Stop that arrives after the turn ended kills the next turn (blocking)

**Scenario.** The turn finishes at t=0. The user's Stop, sent at t=-0.2 s, is applied at t=+0.3 s.
`_displace_turns` reads `alive` and `running`, finds whatever holds them, and tombstones it
(`service.py:169-199`). If the user has already sent the next message, that is the **new** turn, and
`mark_turn_superseded` kills it before its first output. Worse, the tombstone TTL is 3600 s and every
read refreshes it (`locks.py:147-153`), so a turn id that gets tombstoned stays dead for as long as
anything keeps checking it.

This is the Stop-then-send-within-one-second race, and it is also a plausible mechanism for #6417's
"both turns die and the session refuses every message". Note the reported 30 minutes does not match
any constant in the code; the tombstone and `alive` TTLs are both 3600 s.

**Why the text does not cover it.** rfc.md:61-64 gives `expected_execution_id` as the guard, then
makes it optional, and the desktop today sends no execution id at all
(`useAgentChatSession.ts:505`). Optional plus unused equals unguarded.

**Smallest fix.** Two parts. First, make the **first-party desktop always send
`expected_execution_id`**; keep the field optional in the contract for external callers, as D-010
requires, but treat an omitted id in the browser as a bug. Second, when the id is absent, resolve the
target once at admission and refuse to supersede a turn that started after the command was created.
A command carries its creation time; a turn carries its start. That comparison is cheap and needs no
generations.

### H-4. Command settlement has no owner when the runner is gone (blocking)

**Scenario.** The runner claims the Stop command and then the process exits. On SIGTERM it destroys
every in-flight sandbox (`server.ts:838-859`), so the execution really has ended, but nothing writes
the terminal outcome: the durable command stays `claimed`, the execution stays `stopping`, and Redis
`alive` and `running` keep their 3600 s TTL. rfc.md:308-311 says "a watchdog records `lost`", and
tonight-handoff.md defers the deadline to the spike. Version one therefore ships a `stopping` state
that can persist for an hour with nothing that clears it.

**Smallest fix.** Version one must include a settlement rule that does not depend on the spike:
if a command has been `claimed` for longer than N heartbeat intervals with no acknowledgement, and no
heartbeat has arrived for that session in the same window, expire the claim, mark the execution
`lost`, and clear the Redis keys. Pick N = 3 (90 s) now and tune later. A watchdog with an undecided
timeout is not a watchdog.

### H-5. Duplicate delivery through two channels (non-blocking, but specify it)

Long polling delivers a command; the acknowledgement is lost; the next heartbeat also reports the
command. rfc.md:304-305 says "The runner deduplicates by `command_id`", which is correct and
sufficient **only if the dedupe set survives the poll loop's own restart**. Write the rule: the
runner keeps applied command ids per session in the same place it keeps session state, and applying
an already-applied Stop is a no-op that re-sends the acknowledgement. One sentence, and it prevents a
second abort landing on a fresh turn.

### H-6. API replica restart (non-blocking)

Long polling holds an open request on one API replica. A rolling restart drops it. rfc.md:238-242
covers the runner side ("A disconnected runner reconnects and claims commands that remain durable")
but not the ordering guarantee: after reconnect the runner must claim by session, not resume a
cursor, or a command created during the gap is skipped. State that claims are queries over durable
state, never a stream position.

### H-7. `clientGone` (non-blocking, one line)

`engine.ts:27` destroys the sandbox when the client disconnects mid-turn. That is the wrong policy
once the sender is an ordinary reader (rfc.md:415-434). Removing the branch belongs to the
detached-sender work, not to Stop. Name the owner so it is not deleted early.

### H-8. Steer (non-blocking for version one, but note it)

Steer today calls `_displace_turns` then `_start_turn` in the same request
(`service.py:272-286`), so the old turn's abort and the new turn's start race by design, and the
saved message does not exist yet because the runner writes it. requirements.md:65 requires the
opposite order. rfc.md:453-455 leaves Queue and Steer "pending discussion". That is honest. Keep
Steer out of version one and say so in the handoff, because the double-send issues (#6417, #6020,
#5539) are closed by H-3 and by the reject policy, not by Steer.

---

## 4. Interface review

Applying `design-interfaces`: classify each field by the role it plays, not by the feature it
belongs to.

### `POST /sessions/{session_id}/commands` (rfc.md:41-49)

Current proposal:

```jsonc
{ "type": "send", "message": "Explain this failure", "delivery": "reject" }
```

Roles present: `type` is routing, `message` is input data, `delivery` is policy. Three roles, one
flat object. Two concrete problems.

- `delivery` names the mechanism, not the decision. Nothing is being delivered; the field says what
  to do when the session is busy. decisions.md:270 and rfc.md:127 already prefer `on_busy`. Use it.
- `message` is a bare string, and today a turn carries text plus attachments
  (`services/runner/src/server.ts:565-580`). A string cannot grow into that without a breaking
  change.

Corrected shape:

```jsonc
{
  "type": "send",
  "input": { "text": "Explain this failure", "attachments": [] },
  "policy": { "on_busy": "reject" }
}
```

`Idempotency-Key` stays a header. It is a standard protocol-boundary name and belongs with the other
headers, not in the body.

### `POST /sessions/{session_id}/cancel` (rfc.md:54-59)

```jsonc
{ "expected_execution_id": "execution-12" }
```

This one is right and should not be changed. `expected_execution_id` is per-call context and it is
named as the guard it is, in the same style as an HTTP `If-Match`. Keep it optional in the contract,
per D-010, and require it from first-party clients (see H-3).

### `POST /sessions/{id}/interactions/{interaction_id}/responses` (rfc.md:68-75)

```jsonc
{ "answer": {"approved": true}, "expected_execution_id": "execution-12" }
```

`answer` is input data, `expected_execution_id` is context. Both correct. One gap: the response has
no field saying what the continuation did. rfc.md:193-195 asks the API to "expose whether
continuation is pending, running, or failed" but the shape does not carry it. Add
`continuation: { "status": "pending" }` to the response body, not the request.

### The internal command envelope (rfc.md:293-305)

The doc gives states but not the record. Proposed shape, grouped by role:

```jsonc
{
  "command_id": "...",              // identity
  "session_id": "...",              // routing
  "type": "cancel",                 // routing
  "target": { "expected_execution_id": "execution-12" },   // context
  "payload": { "text": "..." },     // input data, absent for cancel
  "policy": { "on_busy": "reject" },
  "delivery": { "state": "claimed", "claimed_by": "replica-7",
                "claim_expires_at": "...", "attempts": 1 },
  "created_at": "..."               // metadata
}
```

Two rules this applies. First, delivery state is grouped under `delivery` and never merged with
execution state, which is D-016's whole point and is easier to hold if the shapes are separate
objects. Second, `expected_execution_id` sits under `target` rather than at the top level, so a
future `target.execution_id` (resolved at admission) has an obvious home next to it.

Two things to avoid: `replica_id` at the top level as if it were routing (it is delivery
bookkeeping, and it is logical, not an address), and a `runner_url` field of any kind (an
implementation detail in a durable record).

### `pending_inputs` (rfc.md:135-147)

```jsonc
{"id": "input-24", "type": "user_message", "content": "...", "position": 1, "status": "pending"}
```

`position` is derived server state that duplicates array order. Two representations of one ordering
will disagree the first time a removal races a promotion. Since D-011 makes inputs immutable and
FIFO, drop `position` and let array order carry it. Rename `content` to `input` and give it the same
`{text, attachments}` shape as Send, so one client renderer handles both.

---

## 5. What version one must not build

The Stop issues (#5160, #5982, #6418, #6100, #6449) and the double-send issues (#6417, #6020, #5539)
are closed by: a durable Stop command, a session-scoped delivery loop, a park policy that survives
Stop, a stale-command guard, and a settlement watchdog. Everything below is in the RFC and is not
needed for those.

- **Ownership generations and stale-writer fencing** (rfc.md:271-276, decisions.md P-004). Already
  deferred by D-017. Keep it deferred. One runner, and the tombstone already blocks a displaced turn
  at `service.py:431`.
- **Postgres execution authority** (rfc.md:278-280). Same reason.
- **The raw live-frame ingress and Redis Stream relay** (rfc.md:327-336, P-001). This is Program B.
  No Stop issue needs it. D-003 already says Stop must not wait for it.
- **The append-only durable event log and cursor replay** (rfc.md:338-404). Blocked on work package D
  by O-005, and none of the seven issues turns on replay ordering.
- **The session snapshot endpoint** `GET /sessions/{id}` (rfc.md:83). A read-path convenience. Ship
  it with Program B.
- **`GET /sessions/{id}/events`** (rfc.md:92-94). Same.
- **Server-side pending inputs, `input.queued`/`removed`/`promoted`, and
  `DELETE /sessions/{id}/inputs/{id}`** (rfc.md:130-167). Queue is a policy value on Send. The
  visible shared queue is a product feature, not a fix for #6417. #6417 asks for "queue the message,
  **or** refuse it with a clear signal"; `on_busy: reject` with a clean 409 satisfies the issue.
- **Steer** (rfc.md:125, plan.md:31). See H-8. Ship `reject` and `queue`; leave `steer` unwired.
- **The detached sender** (rfc.md:415-434). Large, and it changes the invoke path. rfc.md:433 already
  says the current invoke response can keep serving the sender.
- **Removing Attach** (rfc.md:113). Harmless to keep. Deleting a public mode is migration work with
  no bug attached.
- **WebSocket or persistent runner connection** (rfc.md:244-247). Already deferred; do not let the
  port abstraction grow adapters that have no second implementation yet.

One item the version-one list is **missing** and should gain: `shouldPark` (H-1), the session-scoped
poll loop (H-2), the stale-command guard (H-3), and the claim-expiry watchdog (H-4).

---

## 6. Verdict

**Not ready to implement version one.** The design is sound and the fixed direction is right. Three
things must change first.

1. **Move warm preservation from the spike into the build.** Work package A can still answer the
   harness questions, but `shouldPark` and the abort-versus-Stop distinction
   (`engine.ts:21-31`, `server.ts:519`) are known now and belong in the version-one list. Without
   this change, shipping faster Stop delivery makes the product worse.
2. **Define the command loop's lifetime as the session's warm lifetime, not the turn's.** Version one
   must state that the runner polls while it holds any environment for a session, including a parked
   approval, and must say what Stop does to a pending interaction. Otherwise Stop is undeliverable in
   the exact state approvals create.
3. **Give version one a concrete settlement rule and a stale-Stop guard.** A claim expiry of 90 s
   with an execution marked `lost` and the Redis keys cleared, plus a refusal to supersede a turn
   that started after the command was created. Both are small. Both prevent a Stop from taking down
   the next turn or leaving a session wedged for an hour.

Fix those and the remaining work is ordinary. The interface shapes need the field moves in section 4,
none of which changes a decision.

---

## Open questions for Mahmoud

1. **Does Stop have to keep the sandbox warm in version one, or is a warm harness session enough?**
   Recommendation: warm sandbox and warm harness session, both. Reason: the idle park window is 60 s
   local and 120 s Daytona (`session-identity.ts:39`, `:54`), so a user who stops and then continues
   inside two minutes is the common case, and that is exactly the case a cold rebuild ruins.

2. **After Stop, how long should the sandbox stay parked?** Recommendation: reuse the approval window
   of 600 s (`session-identity.ts:48`) rather than the 60 s idle window. Reason: a person who stops
   the agent is about to type, and typing takes longer than a minute. It costs at most ten minutes of
   one idle sandbox.

3. **Should closing a chat tab keep sending a cancel?** Recommendation: no. Reason:
   `AgentChatPanel.tsx:133-139` makes closing a tab stop the run, which contradicts
   requirements.md:98 and surprises anyone who closes a tab to open the session elsewhere. If it must
   stay, name it in the requirements as a deliberate rule.

4. **Is `queue` in version one, or only `reject`?** Recommendation: `reject` only, with a clean 409
   and a clear message. Reason: #6417 accepts either, `reject` needs no server-side input store, and
   the shared queue then lands with the snapshot work that makes it visible to other clients.

5. **Do we accept that version one leaves `Stop cancels pending interactions` unbuilt, or does it
   land now?** Recommendation: land it now, in the API. Reason: it is one call to
   `cancel_session_pending` in the cancel branch, the same call kill already makes at
   `router.py:441-444`, and without it a stopped session keeps showing an approval card whose buttons
   do nothing (#6315).
