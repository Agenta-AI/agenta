# Post-Stop `running` and `alive` — every liveness consumer

> AGENT-GENERATED, low weight. This is a code trace and a recommendation, not a decision.
> Nothing here was verified on a live stack. Every line reference is from the worktree
> `~/code/agenta-2-worktrees/integration`, branch `agent/session-execution-integration`, head
> `9110c08000`. Reviewer gate 11 in `decisions.md` is the question this file answers.

## Answer

The candidate rule is safe for admission and safe for every input path, but the branch does not
yet produce the state the rule describes. A new Send is admitted while a stopped turn still holds
`alive`, because the heartbeat handover branch discriminates on `running`, not on `alive`
(`api/oss/src/core/sessions/streams/service.py:669-707`), and no composer, Send button, or send
handler in `web/` is gated on either flag. The real defect is the Postgres mirror. Settlement
tombstones the stopped execution before it releases `running`
(`api/oss/src/core/sessions/commands/service.py:573-585`), and a tombstoned execution's final
`is_running=false` heartbeat returns at `service.py:571-601` before the mirror write at
`service.py:754-765`. The runner reports its outcome as soon as it issues the abort and not after
the harness settles (`services/runner/src/sessions/control-channel.ts:158-168`), so the tombstone
always wins that race. The row therefore keeps `is_running: true`, which is the only field the
desktop and mobile "running elsewhere" surfaces read. The user who pressed Stop sees a
"running somewhere else" strip and a spinning rail glyph until the watchdog collapses the row
90 to 150 seconds later. That collapse also force-clears `alive`
(`api/oss/src/tasks/asyncio/sessions/orphan_sweep.py:351-353`), so the rule as written, `alive`
until normal idle expiry, is not what the code does. Fix the mirror at settlement and the
candidate rule becomes exactly the state a normally finished turn already leaves behind, which is
what the RFC wants. Three second-order costs remain: four frontend polls key their cadence on the
alive set and so never idle down, the sidebar "Idle" filter and the sessions page "Live" chip
misclassify every stopped session, and `alive` outlives the warm sandbox it protects by a wide
margin, because the park window is 60 seconds local and 120 seconds on Daytona.

## Readers and writers

`A` = the `alive` key, `R` = the `running` key, `M` = the `session_streams.flags` mirror in
Postgres. The mirror is what the web reads; Redis is what admission reads. They are separate.

### API — writers

| Writer | `path:line` | Key | What it does | Under the candidate rule |
|---|---|---|---|---|
| `_start_turn` | `api/oss/src/core/sessions/streams/service.py:1087`, `:1108`, `:1115` | A, R, M | nx-acquires both, mirrors `true/true` | Unchanged. Used by the legacy command route only. |
| Heartbeat, arm and refresh | `service.py:646-727` | A, R | Refreshes both; re-acquires on a stale `alive` | Unchanged. |
| Heartbeat, turn end | `service.py:728-753` | R | Releases `running` under an owner check, leaves `alive` | **This is already the candidate rule.** A normal turn end has always left `alive` set. The comment at `:729-730` says so. |
| Heartbeat, superseded beat | `service.py:571-601` | none | Returns early, before any lock write **and before the mirror write** | The defect. The stopped execution's final beat lands here, so `M` is never corrected. |
| Heartbeat, mirror write | `service.py:754-765` | M | Re-reads the nest and writes the row | Never reached by a stopped execution's last beat. |
| `_displace_turns` | `service.py:283-290` | A, R | `force_cancel_alive` then `clear_running`, tombstones first | The old rule. Still live on the legacy route `POST /sessions/streams/` for cancel, steer, and kill. |
| `_mark_stream_ended` | `service.py:1216-1232` | M | Writes `is_alive/is_running/is_attached` all false | Called by the legacy cancel and by delete. Not called by durable settlement. |
| `_mirror_flags` | `service.py:1192-1214` | M | Re-reads Redis, writes the row | Called only by attach (`:442`) and detach (`:471`). **The settlement path should call this and does not.** |
| Durable Stop settlement | `api/oss/src/core/sessions/commands/service.py:569-588` | A, R | Tombstones the target, releases `running` owner-checked, leaves `alive` by design | The candidate rule in code. It writes no mirror, which is the gap. |
| Watchdog, running branch | `api/oss/src/tasks/asyncio/sessions/orphan_sweep.py:283-289`, `:326-372` | A, R, M | Rows with `is_alive` and `is_running` stale past 90 s: writes `execution_lost` records if the turn has none, collapses the flags, force-clears `alive` and `running`, tombstones, clears `owner` | **A stopped session lands here, not in the idle branch**, because the mirror still says running. It reclaims `alive` at 90 to 150 s. |
| Watchdog, idle branch | `orphan_sweep.py:288`, `:78-85` | A, R, M | Rows alive and not running, stale past 1800 s: same collapse, **no terminal record** | Where a stopped session should land once the mirror is fixed. |

### API — readers

| Reader | `path:line` | Key | Decision | Under the candidate rule |
|---|---|---|---|---|
| Legacy send gate | `service.py:376-377` | A | `if liveness["alive"]: raise SessionTurnInUse` → HTTP 409 at `router.py:212-219` | Would refuse the first message after a Stop. **It already refuses the second message on any warm session**, because a normal turn end also leaves `alive`. The product does not use this route, so it is latent, not new. |
| `_start_turn` acquire | `service.py:1087-1097` | A | Same 409 on a failed nx acquire | Same as above. |
| Heartbeat handover | `service.py:669-707` | A, R | `running` is the discriminator. A stale `alive` from the same session with no `running` is a legitimate handover: release, tombstone, re-acquire | **Admission works.** This is the path a browser Send takes. |
| Tombstone check | `service.py:571-577` | superseded | Refuses a dead turn's beat before any write | Correct, and the cause of the mirror gap. |
| `_resolve_target` | `commands/service.py:230-236` | R then A | The execution to stop: `running` first, `alive` as a fallback for a parked approval | A second Stop after settlement resolves the **tombstoned** turn from the retained `alive` and manufactures a command against it. There is no `is_turn_superseded` check here. |
| Late-Stop guard | `commands/service.py:134-158` | R | No running execution means an obsolete command, `not_running` | Unchanged. |
| `query_streams` | `service.py:950-985` | M | **Reads Postgres only, never Redis** | This is why the mirror gap is user-visible. |
| Interactions dispatcher | `api/oss/src/tasks/asyncio/sessions/interactions_dispatcher.py` | none | Grepped for `alive`, `running`, `liveness`: no hit. The resume dispatches through invoke | **The resume path does not need `alive`.** |
| Triggers dispatcher | `api/oss/src/tasks/asyncio/triggers/dispatcher.py:459-468` | M | Soft-deletes a claimed row so it cannot become an unsweepable phantom | Not affected. |

### Runner

| Role | `path:line` | Field | What it does |
|---|---|---|---|
| Heartbeat POST | `services/runner/src/sessions/alive.ts:97-106` | `is_running` | The only wire on which the runner touches liveness. It never speaks Redis. |
| `is_running=true` | `alive.ts:245`, `:266` | true | First awaited beat, then every 30 s (`:24`). |
| `is_running=false` | `alive.ts:293` | false | The single place, inside `release()` (`:285-296`). Best effort, no retry (`:126-131`). |
| Admission verdict | `alive.ts:284` | `admitted: !first.interrupted` | Read from the first beat only. The runner holds no condition of its own: `services/runner/src/sessions/admission.ts:4-8` says the decision is not made there. |
| Admission refusal | `services/runner/src/server.ts:636-656` | — | HTTP stays 200 with an NDJSON `error` frame, code `session_turn_in_use`. |
| `/cancel` route | `server.ts:950-1010` | — | Auth, dedupe, `holdsSession` else 404, fire-and-forget apply, 202. |
| Outcome report | `services/runner/src/sessions/control-channel.ts:158-168` | — | **Reported as soon as the abort is issued, not after the harness settles.** The comment says teardown "can take seconds". This is what makes the tombstone beat the final heartbeat. |
| Nothing clears `alive` | — | — | The runner has no code path that clears or releases `alive`. |
| Park window selector | `services/runner/src/lifecycle/session-coordinator.ts:578-579`, `:796`, `:856` | — | `stopped ? stoppedTtlMs : ttlMs`, where `stopped` means `stopReason === "cancelled"`. |
| Park defaults | `services/runner/src/engines/sandbox_agent/session-identity.ts:63`, `:138-141` (local), `:78`, `:126` (Daytona) | — | **60 000 ms local, 120 000 ms Daytona.** One env var, `AGENTA_RUNNER_SESSION_STOPPED_TTL_MS`, moves both. |
| Park expiry | `services/runner/src/engines/sandbox_agent/session-pool.ts:363-395` | — | Destroys the sandbox. No HTTP call, no notice to the API, nothing touches `alive`. |
| Runner boot | `server.ts:1122-1202` | — | **No reconciliation of any kind.** The execution registry (`execution-registry.ts:50`) and the applied-command map (`applied-commands.ts:38`) are in-process and start empty. |
| Runner shutdown | `server.ts:1142-1151` | — | Destroys sandboxes. Sends no final `is_running=false` beat. |
| TTL mirror | `services/runner/src/sessions/contract.ts:14` | 3600 | `ALIVE_TTL_SECONDS` is referenced only by the contract test. No runtime path reads it. |

### Web and mobile

| Consumer | `path:line` | Key | Decision |
|---|---|---|---|
| Mapping site | `web/packages/agenta-entities/src/session/core/liveness.ts:39-50` | A, R | The one snake-to-camel choke point. Derives `resumable = isAlive && !isRunning`. |
| `isRunningElsewhere` | `web/oss/src/components/AgentChatSlice/state/liveness.ts:112-128` | **R only** | `if (!isRunning) return false`. Correct once the mirror is correct. |
| Desktop strip | `web/oss/src/components/AgentChatSlice/components/AgentComposerDock.tsx:299-301` | R | Renders "This session is running somewhere else". |
| Desktop composer | `web/oss/src/components/AgentChatSlice/AgentConversation.tsx:278`, `AgentComposerDock.tsx:423` | none | **Not gated on either flag.** Send-versus-Stop follows the local stream. |
| Mobile composer | `web/mobile/src/features/chat/LiveConversation.tsx:489` | none | Not gated either. |
| Mobile running flag | `web/mobile/src/features/chat/ChatScreen.tsx:80-82` | **R only** | Reads the raw wire field, bypassing `deriveStreamNest`. |
| Mobile working line and Stop | `ChatScreen.tsx:195`, `:217-226`; `LiveConversation.tsx:414-422`; `StopButton.tsx:12-56` | R | The server-calling Stop button unmounts when the session stops reading as running. |
| Desktop poll | `web/oss/src/components/AgentChatSlice/state/liveness.ts:29-45` | **A as the server filter** | `refetchInterval` 15 s **only while the result array is non-empty**. |
| Mobile poll | `web/mobile/src/features/sessions/useLivenessPoll.ts:13-22` | A | Same policy. |
| Mobile gates poll | `web/mobile/src/features/sessions/useActionableInteractions.ts:27-33` | A | Polls 15 s while the alive set is non-empty. |
| Sidebar poll | `web/packages/agenta-navigation/src/dynamic/sessionsSource.ts:126-129` | A, R | 15 s if any row is alive or running, else 60 s. |
| Sidebar glyph | `web/packages/agenta-navigation/src/dynamic/registry.ts:120-138` | A, R | `running` gives a spinning icon; `alive` gives a filled dot. |
| Sidebar Idle filter | `sessionsSource.ts:89`, `:387`, `:577-581` | A | The server predicate is literally `is_alive: false`. |
| Sessions page Live chip | `web/packages/agenta-sessions/src/state/useSessionList.ts:140` | A | `flags: {is_alive: true}`. |
| Row status | `web/packages/agenta-sessions/src/row/sessionRowStatus.ts:33-37` | A, R | `running` pulses; `alive` reads "Ready to resume" and does not pulse. |
| History menu kill | `web/oss/src/components/AgentChatSlice/components/SessionHistoryMenu.tsx:119` | **A only** | The "End session" button is offered while alive. |
| Cancel call | `web/packages/agenta-entities/src/session/api/api.ts:1059-1110` | — | Both hosts now call `POST /sessions/{id}/cancel`, the durable route. The legacy command route is not used for Stop. |

No frontend code reads a session `owner` field. The frontend contract is two booleans.

## The three options

### Option A — the candidate rule: clear `running` at settlement, leave `alive` to idle expiry

This is what `commands/service.py:569-588` already implements, and
`api/oss/tests/pytest/unit/sessions/test_session_cancel_admission.py:526-562` pins it in Redis.

What works:

- **A new Send is admitted.** The heartbeat handover branch treats a stale `alive` with no
  `running` as a handover (`service.py:672-707`). Verified by reading; also covered by
  `test_heartbeat_turn_handover.py` and `test_heartbeat_parked_zombie.py`.
- **Nothing that gates input breaks.** No composer or Send button reads either flag.
- **The running-elsewhere surfaces are correct in principle.** Desktop and mobile both read
  `is_running` only.
- **The interaction resume path does not need `alive`.** The dispatcher reads no liveness.

What breaks:

1. **The Postgres mirror is never corrected.** Settlement tombstones at
   `commands/service.py:573`, the runner's final beat is refused at `service.py:571-601`, and the
   mirror write at `service.py:754-765` is never reached. `query_streams` (`service.py:950`) reads
   Postgres only. The test at `test_session_cancel_admission.py:526` asserts Redis with a fake
   streams service and never looks at the row, so this is untested.
   Visible effect: the "running somewhere else" strip, a spinning sidebar glyph, a mobile Stop
   button that does not unmount, and the mobile working line, all in the tab that pressed Stop.
   The `lifecycle: ended` publish at `commands/service.py:603-606` makes it worse, because the
   client invalidates and refetches on it and gets the stale row back.
2. **`alive` does not survive to idle expiry.** With `is_running` stuck true, the row matches the
   watchdog's 90-second running branch, not the 1800-second idle branch
   (`orphan_sweep.py:283-289`). At 90 to 150 seconds the sweep force-clears `alive`
   (`:351`), clears `owner` (`:369`), and publishes a second `ended`. The rule in the RFC and the
   behavior of the code disagree.
3. **A stopped turn with no terminal record gets one.** If the runner dies during teardown, the
   watchdog's running branch writes `execution_lost` records (`orphan_sweep.py:127-183`) for a
   turn the user stopped on purpose. The `_unsettled_turns` check (`:186-231`) usually prevents
   this, because the runner writes a `done` during unwind, but the window exists.
4. **Four polls never idle down.** Every `refetchInterval` predicate keys on the alive set being
   non-empty, never on running: desktop `liveness.ts:29-45`, mobile `useLivenessPoll.ts:13-22`,
   mobile gates `useActionableInteractions.ts:27-33`, sidebar `sessionsSource.ts:126-129`. One
   stopped session holds all four at 15 seconds, in every open tab, for as long as `alive` lasts.
5. **The list filters misclassify.** The sidebar "Idle" predicate is `is_alive: false`
   (`sessionsSource.ts:89`) and the narrowing at `:387` excludes alive rows, so a stopped session
   leaves "Idle" and joins the "Live" group (`:577-581`). The sessions page "Live" chip
   (`useSessionList.ts:140`) returns every session touched in the last half hour.
6. **A second Stop targets a dead turn.** `_resolve_target` falls back to `alive`
   (`commands/service.py:230-236`) with no tombstone check, so a Stop pressed after settlement
   creates a command against the superseded turn. The runner answers `not_running`, which
   re-cancels interactions and re-publishes `ended`. Noisy, not corrupting.
7. **`alive` outlives what it protects.** The park window is 60 000 ms local and 120 000 ms on
   Daytona (`session-identity.ts:63`, `:78`). Expiry destroys the sandbox
   (`session-pool.ts:384-395`) and tells the API nothing. So "alive because the sandbox is warm"
   is false after one to two minutes, and "Ready to resume" then promises a cold start.
8. **The planned warm-versus-cold seam becomes unreachable.** `deriveSessionLifecycle` returns
   `"hot"` whenever `alive` is set (`web/packages/agenta-entities/src/session/core/liveness.ts:61`),
   and `refineLifecycleWithSandbox` refines only `"cold"` (`:86`). A stopped session is therefore
   permanently `"hot"` and can never be refined to `"warm"` or `"dead"` once the sandbox signal
   lands. Nothing renders `lifecycle` today, so this is latent, but it is a design collision.

### Option B — clear both at settlement, as the legacy cancel does

`_displace_turns` (`service.py:283-290`) plus `_mark_stream_ended` (`service.py:1216-1232`).

What works: the mirror is honest, the row leaves the alive-filtered result set at once, every
poll idles down, no strip, no stale spinner, and the second Stop returns `not_running` promptly.
Costs 1 through 6 of Option A all disappear.

What breaks:

1. **The product signal for a warm session is lost.** The tab dot goes idle, the row reads "idle"
   instead of "Ready to resume" (`sessionRowStatus.ts:33-37`), and the "End session" kill button
   disappears (`SessionHistoryMenu.tsx:119`) while a sandbox is still parked and, on Daytona,
   still billed. The user cannot see or release it.
2. **Stop and Delete become indistinguishable in every read model.** The RFC's stated intent is
   that Stop ends the work and not the session (`commands/service.py:5-9`).
3. **It does not, by itself, break warm resume.** This is worth stating plainly, because the RFC
   text implies it does. The warm sandbox lives in the runner's pool, keyed locally; the Redis
   `alive` key is coordination state and the pool never reads it. Clearing `alive` in Redis does
   not evict a parked entry. What the old cancel actually destroyed was the sandbox, through
   `shouldPark` refusing an aborted turn (`services/runner/src/engines/sandbox_agent/engine.ts:26`),
   and Spike A fixed that on the runner side. So Option B costs product semantics, not warmth.

### Option C — set `alive`'s time to live to the park window at settlement

Expire `alive` to the runner's `stoppedTtlMs` instead of leaving it at 3600 seconds.

What works: the coordination claim then means what it says, and the "Ready to resume" badge stops
lying one to two minutes after the Stop rather than half an hour after it.

What breaks:

1. **The API does not know the park window.** It is chosen in the runner, per provider, at
   `session-coordinator.ts:578-579`. The outcome report would have to carry it, which is a wire
   change to `POST /sessions/control/commands/{id}/outcome`.
2. **The runner may not have parked at all.** A turn that failed to park has no window to report,
   and the pool can also evict early on `poolMax` pressure (`session-identity.ts:73`,
   `DEFAULT_POOL_MAX = 8`). The reported window is a hope, not a fact.
3. **Redis and Postgres then disagree for 29 minutes.** `alive` would expire at 60 to 120 seconds
   while the mirror still says `is_alive: true` until the watchdog's idle branch at 1800 seconds.
   Option C therefore also needs the idle grace lowered or a Redis-truth reconciliation, and the
   watchdog is the only thing that writes the mirror down today.
4. It does not fix the mirror gap. Options A, B, and C all need that fix; only B gets it for free.

## Recommended rule

Paste-able:

> After a Stop settles, the API releases only the stopping execution's `running` key and leaves
> `alive` untouched, so the session ends in exactly the state a normally finished turn leaves it
> in, and the same settlement writes the `session_streams` mirror itself, re-reading the nest from
> Redis, because settlement tombstones the execution and a tombstoned execution's final
> `is_running=false` heartbeat is refused before it can update the mirror.

Two changes make it true, both small and both on existing branches:

1. `api/oss/src/core/sessions/commands/service.py:585` calls the existing
   `SessionStreamsService._mirror_flags` after `release_running`. Belongs on
   `feat/session-durable-cancel` (PR #6503), with a test that asserts the row and not only Redis.
2. The four `refetchInterval` predicates key on `is_running` rather than on the alive set being
   non-empty: `web/oss/src/components/AgentChatSlice/state/liveness.ts:29-45`,
   `web/mobile/src/features/sessions/useLivenessPoll.ts:13-22`,
   `web/mobile/src/features/sessions/useActionableInteractions.ts:27-33`,
   `web/packages/agenta-navigation/src/dynamic/sessionsSource.ts:126-129`.

## Open questions for Mahmoud

1. **Should settlement write the mirror, or should the watchdog stay the only writer that
   collapses a row?** Recommendation: settlement writes it. Reason: the watchdog reaches the row
   only after 90 seconds, and for 90 seconds the user who pressed Stop sees their own session
   marked as running somewhere else. One execution must reach one outcome from one writer, and the
   writer that knows the outcome first is the settlement.
2. **Should the sidebar "Idle" filter and the sessions page "Live" chip be re-cut now that Stop
   leaves a session alive?** Recommendation: rename "Live" to "Warm" and define "Idle" as neither
   running nor alive, which it already is client-side. Reason: after this change almost every
   session touched in the last half hour is alive, so a filter that means "alive" selects nearly
   everything and stops being a filter.
3. **Should `alive` be shortened toward the park window?** Recommendation: no, not in version one.
   Reason: the API cannot learn the true window without a wire change, the pool can evict early
   anyway, and the honest fix for the stale "Ready to resume" badge is the sandbox-state seam at
   `web/packages/agenta-entities/src/session/core/liveness.ts:82-90`, not a shorter lock.
4. **Should `_resolve_target` skip a tombstoned turn when it falls back to `alive`?**
   Recommendation: yes, add an `is_turn_superseded` check at `commands/service.py:234`. Reason:
   without it a second Stop manufactures a command against a dead execution, re-cancels its
   interactions, and re-publishes `ended`, which is exactly the duplicate-terminal-outcome shape
   the RFC forbids.
5. **Does the legacy send gate at `service.py:376-377` stay as it is?** Recommendation: change it
   to gate on `running`, or delete the route. Reason: it refuses on `alive` alone, so it already
   409s on the second message of any warm session, and the product no longer uses it. Leaving a
   route with the opposite admission rule beside the live one invites a future caller to hit it.

## What this trace did not cover

No live verification. No stack was deployed and no request was made. The mirror-gap claim is a
static reading of three files and one runner comment; it should be confirmed on the integration
stack by pressing Stop and reading `session_streams.flags` and the Redis keys at ten-second
intervals for three minutes. The record-worker path and the SSE watch endpoint were read only
where they publish, not where they consume.
