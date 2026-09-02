# Product and scope review: session control and live events

Reviewer note: pragmatic staff engineer, pre-PMF startup, one runner. Read the RFC folder at
`/home/mahmoud/code/agenta-2-worktrees/session-overnight/docs/design/session-control-and-live-events/`.
Claims marked **verified** were checked in code in that worktree. Claims marked **reported** come
from a document.

## Verdict first

The RFC is a good map of the problem and a weak plan for the next two weeks. Its version one
builds a durable command table and a long-poll transport, and with that machinery it fully closes
**one** of the 48 issues (`#5160`). It does **not** close the second-worst user problem, the
double send, because the fix for that one is in two lines of existing code, not in a new
subsystem. Version one also does not name the one-line change that keeps Stop warm, which is the
whole point of the Stop work.

Ship a smaller version one: push Stop over the HTTP hop that already exists, make a cancelled run
parkable, and route Send through the lock the API already has. No new table.

---

## 1. Issue inventory reality check

**All 48 issues listed in `requirements.md` are OPEN.** None are closed, none are duplicates of a
closed issue, and none are fixed on main. Verified by `gh issue view` on each number
(2026-09-02). So the inventory is honest, and the RFC cannot claim credit for anything already
done.

Track names below use the brief's eight tracks, because the RFC's Programs A, B, and C are
coarser. "V1" is version one as defined in `tonight-handoff.md:61-70`: durable command
repository, runner long-poll, Stop as a durable command, Redis lock held until settle, heartbeat
fallback, cancellation outcome event.

### Stop and hung executions

| Issue | Title (short) | Track | V1 |
|---|---|---|---|
| [#5160](https://github.com/Agenta-AI/agenta/issues/5160) | Stop does not halt execution immediately | 2 Cancel | **closes** |
| [#5982](https://github.com/Agenta-AI/agenta/issues/5982) | Stop does not halt chat generation in Playground | 2 Cancel | no |
| [#6418](https://github.com/Agenta-AI/agenta/issues/6418) | Sandbox dies under a turn, hangs 30 min | 2 Cancel | partly |
| [#6100](https://github.com/Agenta-AI/agenta/issues/6100) | Runner swallows ACP write failures, beats forever | 2 Cancel | partly |
| [#6449](https://github.com/Agenta-AI/agenta/issues/6449) | 120s adapter timeout drops the late answer | 8 Capability | no |
| [#6099](https://github.com/Agenta-AI/agenta/issues/6099) | Image over 2 MB leaves the turn stuck | 2 Cancel | partly |
| [#6420](https://github.com/Agenta-AI/agenta/issues/6420) | Codex produced no output after a resume | 8 Capability | no |
| [#6327](https://github.com/Agenta-AI/agenta/issues/6327) | Sessions stop at "Retrying…" not the final error | 7 Client | no |
| [#5788](https://github.com/Agenta-AI/agenta/issues/5788) | Endless "Retrying" for a completed turn | 7 Client | no |
| [#6102](https://github.com/Agenta-AI/agenta/issues/6102) | A slow tool call ends the whole turn | 8 Capability | no |
| [#6103](https://github.com/Agenta-AI/agenta/issues/6103) | A failed turn deletes the sandbox | 2 Cancel | partly |
| [#6084](https://github.com/Agenta-AI/agenta/issues/6084) | 45 min runner total-run deadline | 8 Capability | no |
| [#5356](https://github.com/Agenta-AI/agenta/issues/5356) | Runs time out using long tool use | 8 Capability | no |
| [#5327](https://github.com/Agenta-AI/agenta/issues/5327) | Stuck after unresolved gateway tool failure | 2 Cancel | partly |
| [#6441](https://github.com/Agenta-AI/agenta/issues/6441) | No provider key: first message hangs on "..." | 7 Client | no |
| [#6313](https://github.com/Agenta-AI/agenta/issues/6313) | Gateway park rides the relay timeout | 8 Capability | no |

Note on [#6313](https://github.com/Agenta-AI/agenta/issues/6313): its 30-minute teardown wedge was
already fixed by merged [PR #6310](https://github.com/Agenta-AI/agenta/pull/6310) (2026-08-27).
The prompt-termination half is still open and is tracked in a different design folder. It should
leave this RFC's inventory.

The five "partly" rows all depend on a **watchdog**, and the watchdog is not in the version-one
list. `decisions.md:139` defers its timeout until the sandbox spike. So today version one closes
one issue in this group, not six.

### Steer and concurrent sends

| Issue | Title (short) | Track | V1 |
|---|---|---|---|
| [#6417](https://github.com/Agenta-AI/agenta/issues/6417) | A message during a turn kills both, locks 30 min | 1 Ownership | **no** |
| [#6020](https://github.com/Agenta-AI/agenta/issues/6020) | Stop mid-turn kills the steer message | 1 + 3 | partly |
| [#5790](https://github.com/Agenta-AI/agenta/issues/5790) | Displaced turn still reports is_current_turn true | 1 Ownership | partly |
| [#5539](https://github.com/Agenta-AI/agenta/issues/5539) | Concurrent turns not gated at start | 1 Ownership | no |
| [#5538](https://github.com/Agenta-AI/agenta/issues/5538) | Takeover lands on a sandbox mid-teardown | 1 Ownership | no |

This is the group version one misses entirely. Section 2 explains why, and how cheap the fix is.

### Reattach and multiple readers

Eleven issues: [#5609](https://github.com/Agenta-AI/agenta/issues/5609),
[#5542](https://github.com/Agenta-AI/agenta/issues/5542),
[#6404](https://github.com/Agenta-AI/agenta/issues/6404),
[#5611](https://github.com/Agenta-AI/agenta/issues/5611),
[#5443](https://github.com/Agenta-AI/agenta/issues/5443),
[#5384](https://github.com/Agenta-AI/agenta/issues/5384),
[#6397](https://github.com/Agenta-AI/agenta/issues/6397),
[#5990](https://github.com/Agenta-AI/agenta/issues/5990),
[#6388](https://github.com/Agenta-AI/agenta/issues/6388),
[#6468](https://github.com/Agenta-AI/agenta/issues/6468),
[#5950](https://github.com/Agenta-AI/agenta/issues/5950).
Tracks 4, 5, 6, and 7. **Version one touches none of them.**

Three of these do not belong in this RFC at all.
[#5990](https://github.com/Agenta-AI/agenta/issues/5990) deep links already has an open PR.
[#6388](https://github.com/Agenta-AI/agenta/issues/6388) and
[#6468](https://github.com/Agenta-AI/agenta/issues/6468) are session-list and archive bugs that
need no event log.

### Record durability and ordering

[#5496](https://github.com/Agenta-AI/agenta/issues/5496) and
[#5594](https://github.com/Agenta-AI/agenta/issues/5594). Track 4. Version one: no. The RFC
parks the records-versus-event-table choice (`tonight-handoff.md:15`), which is correct, but it
means these two stay open through version one. Both are silent data loss, so they deserve their
own small fix independent of the storage decision.

### Approvals and pauses

Eight issues: [#6315](https://github.com/Agenta-AI/agenta/issues/6315),
[#6316](https://github.com/Agenta-AI/agenta/issues/6316),
[#6106](https://github.com/Agenta-AI/agenta/issues/6106),
[#5907](https://github.com/Agenta-AI/agenta/issues/5907),
[#5592](https://github.com/Agenta-AI/agenta/issues/5592),
[#5638](https://github.com/Agenta-AI/agenta/issues/5638),
[#5545](https://github.com/Agenta-AI/agenta/issues/5545),
[#5097](https://github.com/Agenta-AI/agenta/issues/5097).
Version one: no, for all eight.
[#5592](https://github.com/Agenta-AI/agenta/issues/5592) already has an open fix in
[PR #6384](https://github.com/Agenta-AI/agenta/pull/6384).
[#5638](https://github.com/Agenta-AI/agenta/issues/5638) is a warm-session eviction bug and is the
one in this group closest to the Stop work.

### Session list and identity

Six issues: [#6419](https://github.com/Agenta-AI/agenta/issues/6419) (partly, if durable
acceptance ships), [#6463](https://github.com/Agenta-AI/agenta/issues/6463),
[#5969](https://github.com/Agenta-AI/agenta/issues/5969),
[#6457](https://github.com/Agenta-AI/agenta/issues/6457),
[#6031](https://github.com/Agenta-AI/agenta/issues/6031),
[#6214](https://github.com/Agenta-AI/agenta/issues/6214). Version one: no.
[#6214](https://github.com/Agenta-AI/agenta/issues/6214) is labelled "good first issue" and has
nothing to do with this architecture. Remove it from the inventory.

### Score

| Version one outcome | Issues |
|---|---|
| Fully closes | 1 |
| Partly closes (needs the watchdog too) | 8 |
| Does not touch | 39 |

### Open PRs in the same code

| PR | State | Base | Overlap risk |
|---|---|---|---|
| [#6252](https://github.com/Agenta-AI/agenta/pull/6252) deep links | open, 2026-08-28 | `release/v0.114.3` | Low. Web only. Base is a shipped release branch, so it is stale. |
| [#6384](https://github.com/Agenta-AI/agenta/pull/6384) approval revert on failed resume | open, 2026-09-02 | `main` | **High.** Touches the interactions service and worker that the command work will also touch. Land it first. |
| [#5860](https://github.com/Agenta-AI/agenta/pull/5860) rewind forks a session | open, 2026-08-18 | `release/v0.112.2` | Medium. Touches `AgentConversation.tsx` and the playground agent request. Very stale base. |
| [#6446](https://github.com/Agenta-AI/agenta/pull/6446) runner pin messaging | open, 2026-09-01 | `main` | Low. Two files, message text only. |
| [#5497](https://github.com/Agenta-AI/agenta/pull/5497) records as a conversation store | open, 2026-07-24 | a feature branch | Docs only, but it is the prior art for the track 4 storage choice. Read it before writing that section. |

---

## 2. Does version one close the top pain?

### (a) Stop is slow, unconfirmed, and destroys the warm session

Partly, and the RFC omits the most important line.

**Slow: yes, version one fixes it.** Today the runner learns about a cancel from its next
heartbeat, and `HEARTBEAT_INTERVAL_SECONDS = 30` (verified,
`services/runner/src/sessions/contract.ts:18`). So worst-case Stop delivery is 30 seconds against
a 5-second target (`decisions.md:57-61`). Any push beats that.

**Destroys the warm session: version one does not fix it, and does not mention it.** The park rule
is three lines:

```ts
if (signal?.aborted) return false; // aborted run: destroy, do not park
if (clientGone?.()) return false; // client disconnected mid-turn: destroy, do not park
if (!result.ok) return false; // failed turn: teardown as today
```

Verified at `services/runner/src/engines/sandbox_agent/engine.ts:26-28`. A cancel aborts the
signal, so the sandbox is destroyed. The eight version-one steps in `tonight-handoff.md:61-70` say
"prove warm resume" in step 8 but never change this function. Delivering Stop faster over a new
transport only destroys the warm sandbox sooner. **Making a cancelled run parkable is the change
that closes the pain, and it is one line.** It must be step one, not an acceptance test at the end.

### (b) A second message kills both turns and locks the session for 30 minutes

**Version one does not fix this at all.** No durable command, no long poll, and no `on_busy`
policy is involved in the failure. Here is the mechanism, verified end to end.

1. A normal desktop Send does **not** go through the coordination endpoint. It goes to the
   workflow invoke path. `research.md:73` states this, and it is right: the only caller of
   `commandSessionStream` in the web tree is the Stop button
   (`web/oss/src/components/AgentChatSlice/AgentChatPanel.tsx:138`,
   `web/mobile/src/features/chat/StopButton.tsx:18`), and both call it with no inputs and no
   force, which is `CommandMode.cancel`.
2. So the runner mints its own turn id: `return request.turnId?.trim() || randomUUID();`
   (verified, `services/runner/src/server.ts:189`). The comment above it says the turn id "is the
   runner's to mint per execution".
3. The second turn reaches the session coordinator, finds the first turn's environment busy, and
   **destroys it**:

   ```ts
   klog(`evict (supersede-${existing.state}) key=${key}; cold`);
   await pool.evict(key, `supersede-${existing.state}`, "failed-turn");
   ```

   Verified at `services/runner/src/lifecycle/session-coordinator.ts:1325-1326`. Turn one now has
   no sandbox. That is the first death.
4. Turn two then heartbeats. The API sees that `running` is held by a different turn and refuses
   the acquire: `elif running_owner is not None and running_owner != request.turn_id: pass  # a
   live different turn holds the session: real takeover` (verified,
   `api/oss/src/core/sessions/streams/service.py:532-533`). Turn two gets
   `is_current_turn = False` and its watchdog aborts. That is the second death.

Both turns die. The session then reads as alive under a dead turn's lock until the lease expires,
which is the "30 minutes" users report in
[#6417](https://github.com/Agenta-AI/agenta/issues/6417).

**Does fixing this need a new table? No.** The arbiter already exists and already returns the
right status code:

- `_start_turn` does an atomic `acquire_alive` with `nx=True` and raises `SessionTurnInUse` when
  the lock is held (verified, `api/oss/src/core/sessions/streams/service.py:948-958`).
- The router already maps that to `409 CONFLICT` (verified,
  `api/oss/src/apis/fastapi/sessions/router.py:192-199`).
- The runner already accepts a supplied turn id, so it does not need a new field
  (`server.ts:189`).

The send path simply never calls the arbiter. Three changes close
[#6417](https://github.com/Agenta-AI/agenta/issues/6417),
[#5539](https://github.com/Agenta-AI/agenta/issues/5539), and
[#5538](https://github.com/Agenta-AI/agenta/issues/5538):

1. The Send path calls the API lock first and gets a turn id back, or a 409.
2. It passes that turn id to the runner instead of letting the runner mint one.
3. Delete the `supersede-busy` branch at `session-coordinator.ts:1318-1326`. A busy session is no
   longer the runner's problem to resolve, because a second turn can no longer arrive.

**So `on_busy: reject` needs zero new storage.** `on_busy: queue` and `on_busy: steer` do need a
durable pending-input store, because a saved message must survive the turn it is waiting on. But
`reject` alone closes the reported bug: users in
[#6417](https://github.com/Agenta-AI/agenta/issues/6417) asked for "queue the message, **or**
refuse it with a clear signal". Refusing with a clear signal is the cheap half, and it removes the
data loss. Queue and steer are a product improvement on top, not the bug fix.

One caution: a naive 409 makes the desktop worse if the browser drops the typed text. The client
must keep the message in the composer on a 409. That is a frontend change of a few lines and it
belongs in the same slice.

---

## 3. Simplicity audit

| Component | Verdict | Reasoning |
|---|---|---|
| Durable command table | **not needed for v1** | Its only v1 job is carrying one Stop. A Stop that is not delivered is not worth replaying: the user is still watching, and pressing Stop again is free. Recoverable delivery matters for Send and Steer, which v1 does not do. |
| Long-poll endpoint | **not needed for v1** | An authenticated API-to-runner HTTP hop already exists and is already used for hard kill: `POST /kill` with a bearer token (verified, `api/oss/src/core/sessions/streams/runner_client.py:44-51` and `services/runner/src/server.ts:704`). Add `POST /cancel` beside it. With one runner there is no routing problem to solve. Long polling exists to serve future user-operated runners, which `decisions.md:236` itself calls "a consideration, not a binding requirement". |
| Control-delivery port | **needed for v1**, as one function | Keep the idea, drop the ceremony. One module with `cancel(project_id, session_id, turn_id)` behind it, mirroring `runner_client.py`. That is enough to swap in long polling later without touching the service. A three-verb port with claim leases is designing for the second implementation before the first one runs. |
| Command state machine (`pending`, `claimed`, `applied`, `obsolete`) | **later** | It only earns its keep once commands are durable and retried. Ships with queue and steer. |
| Execution state machine (`running`, `stopping`, `stopped`, `failed`, `lost`) | **needed for v1** | This is the cheap half and it is the one users see. `stopping` is what makes Stop feel confirmed. `lost` is what the watchdog writes. It needs no new table: the session stream row already carries per-turn state. |
| Session snapshot endpoint | **later** | Track 4 and 6. Real value, no v1 dependency. |
| Replayable event endpoint | **later** | Same. It is also the largest piece of design work in the folder, which is why it should start in parallel as *design*, not as code. |
| Pending inputs API | **later** | Needed for queue and steer, not for reject. |
| Redis Stream ingress | **later**, and reconsider | The relay already works at paragraph level. Reuse it before adding a second ingress. Reopening token-level relay is a separate product decision (see section 5). |
| Durable projector | **later** | Depends on the records-versus-event-table choice, correctly parked. |
| Watchdog | **needed for v1** | This is the highest value per line in the whole folder. It closes or bounds five issues ([#6418](https://github.com/Agenta-AI/agenta/issues/6418), [#6100](https://github.com/Agenta-AI/agenta/issues/6100), [#6099](https://github.com/Agenta-AI/agenta/issues/6099), [#5327](https://github.com/Agenta-AI/agenta/issues/5327), and part of [#6441](https://github.com/Agenta-AI/agenta/issues/6441)) and needs no new subsystem: a TaskIQ periodic job that finds stream rows whose lease expired with no terminal record, writes a terminal record, and clears the locks. The RFC defers its timeout to the sandbox spike. That is over-caution. Pick 90 seconds past the lease, ship it, tune it. |

What to reuse instead of building: the existing `/kill` HTTP hop, the existing `acquire_alive` NX
arbiter and its 409, the existing heartbeat as the failure detector, the existing watch relay for
the cancellation notification, TaskIQ for the watchdog, and the existing session stream row for
execution state.

---

## 4. Sequencing

`plan.md:44-59` proposes Stop and Live frames first, in parallel, then durable ordering, then
sender detachment, then durable commands, then queue and steer. The brief proposes track 2 first,
track 4 in parallel, track 1 right after.

**Neither is right. Recommended order for the next two weeks:**

1. **Warm cancel (days 1 to 3).** The park rule change, the direct `POST /cancel` hop, the
   `stopping` and `stopped` states, one terminal record. Closes
   [#5160](https://github.com/Agenta-AI/agenta/issues/5160).
2. **Single-turn admission (days 1 to 4, parallel, different files).** Route Send through
   `_start_turn`, pass the turn id to the runner, delete the supersede branch, keep the text in
   the composer on a 409. Closes [#6417](https://github.com/Agenta-AI/agenta/issues/6417),
   [#5539](https://github.com/Agenta-AI/agenta/issues/5539),
   [#5538](https://github.com/Agenta-AI/agenta/issues/5538).
3. **Watchdog (days 4 to 6).** Bounds every hang.
4. **Event log design, not code (all two weeks, in parallel).** The single largest open question
   is records versus a separate event table. It needs the stable record-ID spike
   (`tonight-handoff.md:52-59`) and [PR #5497](https://github.com/Agenta-AI/agenta/pull/5497) read
   first. Design it now, build it after.

Why this order and not the RFC's: it puts the two changes that close the two worst reported bugs
in the first four days, using code that already exists, and it defers every new subsystem until a
design question is actually answered. It also matches the brief's instinct (cancel first, read
path designed in parallel) while correcting the brief's claim that track 1 must wait for track 2.
Track 1 does not depend on track 2. They touch different files.

**Parallel-safe split.** These three sets do not overlap:

- Agent A, warm cancel: `services/runner/src/engines/sandbox_agent/engine.ts`,
  `api/oss/src/core/sessions/streams/runner_client.py`, `services/runner/src/server.ts` (the new
  route only).
- Agent B, admission: `api/oss/src/core/sessions/streams/service.py`,
  `services/runner/src/lifecycle/session-coordinator.ts`, the web send path.
- Agent C, watchdog: a new TaskIQ job under `api/oss/src/tasks/taskiq/sessions/`.

Both A and B touch `services/runner/src/server.ts`, so give the file to A and have B send its turn
id through the existing request field, which already exists (`server.ts:189`). Land
[PR #6384](https://github.com/Agenta-AI/agenta/pull/6384) before agent B starts, because both
touch the interactions path.

---

## 5. Consistency with earlier rulings

Places where the RFC reverses a decision on file. Reversal may be correct. It should be
deliberate.

| Ruling (date) | RFC position | Declared? |
|---|---|---|
| Steer is reject-with-message (2026-07-22, `arda-reject-siblings-proposal.md`, [PR #5444](https://github.com/Agenta-AI/agenta/pull/5444)) | `rfc.md:125`: steer means "save the new message. Interrupt current work, then start the new message." That is interrupt-and-restart, not reject-with-message. It starts a **new** execution where the July shape kept the same turn and delivered the text as tool feedback. | **No. Silent.** This is the reversal that matters most, because interrupt-and-restart is the shape that loses warm state today. |
| Live-following a running turn from a new tab is out of scope (2026-07-21, `arda-handoff.md`) | `context.md:39` and `decisions.md:33-37` make multi-reader live output a core goal. | **No. Silent.** The brief flags it as "revisit" and the reversal is probably right, but the RFC never says it is reversing anything. |
| Token-by-token relay is rejected; the relay is paragraph-level (2026-07-27, `m3-live-relay.md:290-293`) | D-004 (`decisions.md:33-37`): moving readers behind the API "must not reduce the sender to paragraph-only updates". | **No. Silent.** And it is a cost decision, not just a design one: token-level fan-out multiplies relay traffic per reader. |
| The watch relay carries notifications only. No replay, no cursor (2026-07-27, `m3-live-relay.md:158-161`) | `rfc.md:96-98` replaces it with replay-after-cursor plus live tail. | **Partly.** The RFC says the new endpoint "is not" the current watch, but never cites the ruling it overturns. |
| Records carry no dense per-session sequence; order by uuid7 (2026-07, `records/specs.md:98-123`) | P-003 and O-003. | **Yes, declared.** `decisions.md:177` says "Requires an explicit decision reversal". This is the model for how the others should read. |
| Session id is a bare correlator, never a foreign key. No sessions table (2026-06) | `rfc.md:82` proposes `GET /sessions/{session_id}`, plus server-held pending inputs and a per-session cursor. A per-session sequence makes the session an entity in practice. | **No. Silent**, and easy to miss because no schema is drawn yet. |
| Per-card Deny by default; turn-level Stop must be warm (2026-07-22) | Warm Stop is honoured in `tonight-handoff.md:13`. Per-card Deny is not contradicted. | Fine. |
| Cancel is not kill (2026-07, `streams/service.py:350-360`) | D-008 (`decisions.md:63-69`). | Fine, and stated well. |
| Redis is authoritative for liveness (2026-07) | D-017 (`decisions.md:142-154`). | Fine. |
| Harness-native continuity over platform replay (2026-07-19) | Not contradicted. The RFC's "replay" is client replay of durable events, not harness replay. Worth saying so in the doc, because the word collides. | Fine, but rename. |

---

## 6. Smallest slice that should ship first

Ship warm cancel and single-turn admission together as one release, in about a week, with no new
table and no new transport. Make a cancelled run parkable by changing the abort branch of
`shouldPark`, so Stop keeps the sandbox and the harness session. Add `POST /cancel` to the runner
beside the `POST /kill` route that already exists, and call it from the API the way
`kill_runner_sandbox` already does, so Stop lands in under a second instead of waiting up to
thirty for a heartbeat. Move the session from `running` to `stopping` when the request is
accepted and to `stopped` when the runner reports the terminal record, so the button is confirmed
rather than hopeful. In the same release, route a normal Send through `_start_turn` so the atomic
`acquire_alive` decides who runs, hand the resulting turn id to the runner instead of letting it
mint one, delete the `supersede-busy` branch that destroys a live turn's sandbox, and keep the
user's text in the composer when the API answers 409. Add the TaskIQ watchdog that writes a
terminal record for any session whose lease expired without one. That is four issues closed, five
bounded, roughly two hundred lines, and it leaves every large question in the RFC open for a
proper design pass.

---

## Open questions for Mahmoud

1. **Is steer still reject-with-message, or is it interrupt-and-restart?** The RFC changed it
   without saying so. *Recommendation: keep reject-with-message.* It preserves the turn and the
   warm session, which interrupt-and-restart cannot, and it is the shape your July ruling already
   picked after studying ACP.

2. **Can version one ship `on_busy: reject` alone, with queue and steer deferred?**
   *Recommendation: yes.* Reject needs no storage and closes the reported bug, because the user's
   complaint in [#6417](https://github.com/Agenta-AI/agenta/issues/6417) was that the message was
   neither queued nor refused. Queue and steer are worth building, but they should not gate the
   fix for a session-destroying bug.

3. **Do we build the long poll now, or use the `/kill` hop we already have?**
   *Recommendation: use the existing hop.* You run one runner. The hop is authenticated, in
   production, and reaches the right process today. Keep the port idea as one function so long
   polling can replace it when a second runner or a user-operated runner is real.

4. **Does the watchdog wait for the sandbox spike?** The RFC defers its timeout.
   *Recommendation: do not wait.* Ship it at ninety seconds past lease expiry. It is the single
   highest-value change in the folder, it depends on nothing, and a wrong timeout is a config
   change, not a redesign.

5. **Is token-level live relay in scope, given the July ruling rejected it on cost?**
   *Recommendation: decide it separately from this RFC, and default to keeping paragraph level.*
   Second-reader support is the user-visible win. Whether the second reader sees words or blocks
   is a cost question that should be answered with a number, not folded into an architecture
   decision.
