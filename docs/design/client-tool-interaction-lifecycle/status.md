# Status

2026-08-10, night. Mahmoud approved plan version 2 and gave go for implementation.

## Decisions from the approval

- Change 4 dock question: the dock stays, as a shortcut that scrolls to the card
  (Option 1). Keep the visible UI change minimal.
- QA checks 5 and 6 become release gate cells; the release-conductor skill now lists
  them as mandatory (Stage 4, section 3d).
- Implementation pipeline: implement with codex (sol, high reasoning), then a
  simplification pass, then an independent review-and-test loop until agreement, then
  live QA on the dev stack driven by the debug-local-deployment skill using the new
  gate cells plus whatever the reviewer adds. Finish with a PR description pass.

## Earlier status (2026-08-10 evening)

## Done

- Research complete, evidence-backed, rewritten in plain language.
- Blame history checked against version 0.108: the root defect was never a regression;
  two recent changes made it visible (details: research Finding 3).
- Plan version 1 rejected by an adversarial review (nine findings; the decisive one:
  recording the answer at delivery time loses a race against the cleanup sweep).
- Plan version 2 written: four changes, smaller, race-safe by ordering.
- qa.md written: why every layer missed this, and six standing checks.
- Docs shipped for review: PR #5916.

## Next

- Mahmoud's go/no-go on plan version 2.
- On go: implement Change 1 first (everything else reads the states it creates).

## Standing decisions

- One contract instead of more symptom patches.
- No new record types, no new event payloads, no database migration.
- Mobile form/connect answering stays a separate ticket.
- The one-line dispatch repair lands immediately, outside this project.

## Implementation log

### Slice A — record the answer first (done, 2026-08-10)

API. `api/oss/src/apis/fastapi/sessions/models.py`: the transition request's `resolution`
is now an open `Dict[str, Any]`, because the row kind is unknown at model-validation time,
and the validator accepts a resolution on the `responded` edge as well as `resolved`.
`api/oss/src/apis/fastapi/sessions/router.py`: the approval-only kind guard became an
explicit allow-set over all three kinds. An approval payload is still validated against the
strict `SessionInteractionResolution` shape (422 when it does not fit), and `resolved`
stays approval-only (409 for the other kinds). No service, DAO, sweep or migration change.

Runner. `services/runner/src/engines/sandbox_agent/client-tools.ts`: the
`recordPendingInteraction` callback type gained the fifth `toolCallId` parameter, and the
call site passes `correlatedId`, so new `client_tool` rows carry
`data.request.tool_call_id`. `run-turn.ts` and `sessions/interactions.ts` already accepted
and forwarded that argument.

Web. New `transitionInteraction` wrapper in
`web/packages/agenta-entities/src/session/api/api.ts` (the generated Fern resolution type
predates the widened payload, so the payload is cast at that one boundary). New
`fetchSessionInteractionRowsAtom`, `sessionInteractionRowsQueryKey` and
`resolveInteractionTokenForToolCall` in `.../state/interactionStatus.ts`. New
`.../state/interactionAnswer.ts` holding `recordInteractionAnswerAtom`, fired
fire-and-forget from `handleClientToolOutput` in
`web/oss/src/components/AgentChatSlice/hooks/useAgentChatSession.ts` before the resume.

Deviation from implementation.md, deliberate. Slice A needs a row-token lookup keyed by
tool-call id, which is the inverse of the map Slice B builds. Rather than duplicate the
fetch, Slice A adds a raw-rows query alongside the existing cancelled-token query and
leaves `fetchCancelledClientToolTokensAtom` untouched; Slice B derives its map from those
same rows and retires the cancelled-token query, so exactly one interactions query remains
at the end.

Robustness fix on top of codex's diff: when the answered card is newer than the cached rows
(15s stale window), the answer atom now invalidates and refetches once before giving up,
instead of silently skipping the write.

Tests. `api` session unit suite 356 passed, 28 skipped (the skips are the Postgres-backed
DAO tests; Postgres is not reachable from this test env — pre-existing, not caused here).
Runner unit suite 2123 passed across 124 files, including the two updated
`client-tools.test.ts` assertions on the stamped tool-call id. `tsc --noEmit` clean for
`services/runner` and `@agenta/entities`. `uvx ruff@0.15.12 format --check` and `check`
clean; eslint and prettier clean on every touched web file.

### Slice B — one rule for what replay shows (done, 2026-08-10)

New shared module `web/packages/agenta-shared/src/clientTools/` (subpath `./clientTools`,
React-free) holds the neutral terminal marker: a key, the marker output, and a guard. It is
the module Slice D extends with the client-tool name descriptor.

`web/packages/agenta-entities/src/session/state/interactionStatus.ts` now exposes ONE
interactions query. The cancelled-token set is gone; `fetchSessionInteractionStatesAtom`
returns a `token -> {token, status, kind, resolution, toolCallId}` map derived from the same
rows Slice A's write path reads, so there is no second network call. The best-effort contract
is unchanged: never throws, empty map on failure, 15s stale time.

Both replay copies (`web/oss/src/components/AgentChatSlice/assets/transcriptToMessages.ts`
and `web/packages/agenta-chat/src/assets/transcriptToMessages.ts`) replace
`applyCancelledInteractions` and the `CANCELLED_CLIENT_TOOL_OUTPUT` guess-table with
`applyInteractionRowStates`, which is byte-identical in the two files (verified by extracting
both function bodies and comparing). It implements the four rules: a real `tool_result` wins;
else a saved resolution renders; else a terminal row with no resolution renders the neutral
ended marker; else the card stays live. Only `client_tool` and `user_input` rows are
considered, so an approval row can never settle a client-tool part. The three known
divergences between the two files were left untouched.

`ConnectToolWidget.tsx` and `ElicitationWidget.tsx` render the ended marker as an inert chip
("Connection request ended" / "Request ended") checked BEFORE their success/failure branches,
so a pre-fix row no longer shows "Connection not completed" with a Retry button or
"Dismissed the request.". The genuine declined and cancelled branches are untouched — those
come from a real answer.

Tests. Both `transcriptToMessages.test.ts` files gained golden cases for every rule line,
including the assertion that the old synthesized `{connected: false, reason: "cancelled"}`
and `{action: "cancel"}` shapes are gone. Verified independently of codex's report:
`web/oss` AgentChatSlice suites 203 passed across 25 files; `@agenta/chat` 256 passed across
29 files; `tsc --noEmit` clean for `@agenta/entities` and `@agenta/chat`; eslint and prettier
clean.

### Slice C — the browser listens, and stops overwriting (done, 2026-08-10)

`web/oss/src/components/AgentChatSlice/hooks/useSessionRecordsWatch.ts` adds the
`interaction` event to its static handler map with a matching `onInteractionChanged` prop.
The server already publishes it; only mobile listened before. The key set stays static, so
the EventSource is still built once at mount.

`web/oss/src/components/AgentChatSlice/hooks/useSessionHydration.ts` supplies that handler:
it invalidates the interaction rows through the new `revalidateSessionInteractionsAtom` (in
`web/packages/agenta-entities/src/session/state/interactionStatus.ts`, modelled on
`revalidateSessionRecordsAtom` including `cancelRefetch: false`) and then runs the same
guarded `refreshFromRecords` the other two events use, so the transcript and the cards
converge together and the existing `shouldSkipRecordsRefresh` entry/exit checks still apply.

The adoption rule is a new pure exported pair, `pendingClientToolCallIds` and
`blocksAdoptionForWaitingCard`, applied inside `adoptServerTranscript` after the existing
decision. A locally waiting card blocks adoption unless the incoming server transcript
settles that same tool-call id; a card the server copy does not carry at all counts as NOT
settled. `web/packages/agenta-entities/src/session/core/transcriptAdoption.ts` was not
touched, because mobile shares it and cannot answer these cards.

Correction applied on top of codex's diff. Its first version treated ANY tool part sitting at
`input-available` as a waiting card. An interrupted turn leaves an ordinary server tool part
in exactly that state, which would have frozen adoption for the life of the session. Both
functions now use the canonical `isPendingClientToolInteraction` with a per-message
`buildRenderMap` from `@agenta/playground` — the same whole-chat scan model
`AgentConversation.tsx` uses — so only real client-tool cards block. A regression test pins
it, and the dynamic-tool fixture gained the sibling `data-render` part that a real replayed
transcript carries (a `dynamic-tool` part's client-tool identity is not readable off `type`).

Tests. `useSessionHydration.test.ts` covers the adoption safety matrix: no waiting card,
card absent from the server copy, card still waiting on the server, card settled on the
server, one of two settled, a waiting card that is not in the last message, and the stuck
server tool. `web/oss` AgentChatSlice suites 210 passed across 25 files; `@agenta/entities`
`tsc --noEmit` clean; eslint and prettier clean.

### Slice D — cards work where they appear (done, 2026-08-10)

Shared descriptor. `web/packages/agenta-shared/src/clientTools/` gained
`CLIENT_TOOL_DESCRIPTORS` (tool name plus render kind per client tool) with derived
`CLIENT_TOOL_NAMES` and `CLIENT_TOOL_RENDER_KINDS` sets. All four copies of the list now
read from it: `registry.tsx`'s two widget maps (the React components stay in the app layer,
only the keys moved), `agentApprovalResume.ts`'s `CLIENT_TOOL_NAMES`,
`toolPermission.ts`'s `CLIENT_TOOLS`, and `InteractionDock.tsx`'s two literals.

Registry fallthrough. `resolveClientToolHandler` no longer dead-ends on an unmatched render
kind; it falls through to the tool-name axis. The test that pinned the broken behaviour is
inverted and renamed. This restores parity with the package copy, which never took the
defect. The consequence being fixed: an unknown render kind routed the part to
`UnhandledClientTool`, which auto-settles the run as `not_handled` for a tool the browser
can actually do.

Actions moved onto the card. `ConnectToolWidget.tsx`'s pending branch now renders "Not now"
and "Connect {label}" driven by the `useConnectFlow` hook it already held (`decline` is now
destructured), and the error branch gained "Not now" beside Retry. The widget calls
`useConnectFlow(meta, settle)` with the default `active: true`, which is correct now that
the card is the only live surface.

The dock became a shortcut. `InteractionDock.tsx` keeps its placement and its open/close
animation but is now a single focusable button that scrolls to the card;
`ConnectCard`, the duplicated settle mapping and the `onOutput` prop are gone, and
`AgentComposerDock`/`AgentConversation` were updated to match. `ClientToolPart.tsx` tags each
rendered card with `data-client-tool-call-id` for the lookup, and a card that is not mounted
(virtualized transcript) is a no-op rather than a throw. The dock also no longer hides while
`busy`, since a card parked in an earlier message stays actionable during a later turn.

Whole-chat scans. `getPendingConnectInteraction` (newest pending connect wins),
`isHitlPending`, and `getPendingApprovals` in both the `web/oss` original and the
`@agenta/chat` copy now scan every assistant message with a per-message `buildRenderMap`,
following the `anyPendingInteraction` model. `agentShouldResumeAfterApproval` took only the
narrow widening: when a `liveInteraction` names a card, the rule is evaluated against the
message that OWNS that card; the markerless orphan path stays tail-only, so an old settled
card can never re-dispatch a resume. `meta.ts` stays last-message-only by design, with a
comment saying so.

Mirrors that needed no change, and why: `@agenta/chat`'s `useAgentChatQueue` calls the shared
`isHitlPending`, so widening the playground function covered it; `resumeOrphaned` in both
`useAgentConversation` and `useAgentChatSession` stays tail-only because it asks whether the
restored TAIL is auto-resume-imminent, which is inherently a tail question.

Tests. `meta.test.ts` gained the geometry test the QA plan asks for: one fixture whose
waiting card and pending approval both sit before the last message, asserting in one place
that `isHitlPending` is true, `getPendingConnectInteraction` finds the card, and
`getPendingApprovals` finds the approval. `agentApprovalResume.test.ts` and
`agentMessageQueue.test.ts` gained the earlier-message cases.

Verified independently: `web/oss` AgentChatSlice 211 passed across 25 files;
`@agenta/playground` 221 passed across 16 files; `@agenta/chat` 256 passed across 29 files;
`tsc --noEmit` clean for shared, playground, entity-ui, chat, entities and oss; eslint clean
over every touched file.

### Slice E — tests and gates (done, 2026-08-10)

API unit tests. `api/oss/tests/pytest/unit/sessions/test_transition_interaction_resolution.py`
now covers the full three-kinds by three-outcomes settlement matrix, including that the
transition layer never settles a walked-away `pending` row by itself.

API acceptance test. New
`api/oss/tests/pytest/acceptance/sessions/test_interaction_sweep_race.py` proves the ordering
guarantee AND that the sweep really ran, in one test: an answered row and an unanswered
control share a single `cancel-stale` call for a later turn; the answered row stays
`responded` with its resolution byte-identical, the control goes to `cancelled` with no
invented answer, and the sweep reports exactly one cancellation.

Release gate. `matrix_l4_client_tool_lifecycle.py`'s "OBSERVED NUANCE" paragraph — which
recorded this project's defect as observed-but-not-asserted — is replaced by the fixed
contract plus an explicit wire-level caveat, and its assertion tightened from "no row is left
pending" to "the answered row is `responded` carrying its exact resolution". Two new cells:
`matrix_i1_settlement.py` (the settlement table against a live API, including the 409 on a
non-approval `resolved`) and `matrix_i2_card_journeys.py` (the six qa.md journeys, each
naming the browser action it stands in for and the claim it cannot cover).
`coverage.md` gains both cells.

The point every reader of these scripts needs: recording the answer is the CLIENT's job, so a
wire-level harness has to send the `/transition` call itself. A script that fulfils a client
tool only in-band would correctly still see the row swept to `cancelled`. All three scripts
say this in their docstrings so nobody mistakes the harness's own call for server behaviour.

Deviation from codex's draft, applied deliberately. Its Telegram journey completed the real
connection by fetching Composio's hosted credential page, parsing its HTML, choosing a field
by name heuristics, and POSTing the live bot token into it. The guards were careful (HTTPS,
`composio.dev` origin, POST-only, unique-field-or-refuse, token never printed), but the
approach is fragile against a third-party page and its failure mode is posting a real secret
somewhere unintended. Agenta's own service comment states the key is entered on the provider's
hosted UI and never in its payload, so there is no safe headless route. The journey now
validates the bot against Telegram's own API, drives Agenta's real connection create, remove
and re-create, settles both rows, and reports the uncovered half in a `not_covered` field.
The "connected for real" claim stays a human exploratory-QA step, which is how qa.md
journey 5 will actually be run.

Verified independently: `api` session unit suite 364 passed, 28 skipped (the skips are the
Postgres-backed DAO tests, unreachable from this env — pre-existing); the acceptance suite
collects 23 tests; all three gate scripts compile; `uvx ruff@0.15.12 format --check` and
`check` clean over `api/` and `.agents/`. The acceptance test and the gate cells were NOT run:
they need a live stack and paid model calls.

### Simplification pass (done, 2026-08-10)

A behavior-preserving pass over the whole diff. Nine removals, no new abstractions.

One interactions query atom, not two. Slice A added `fetchSessionInteractionRowsAtom` beside
`fetchSessionInteractionStatesAtom` (same query, same cache entry, duplicated try/catch) plus an
exported `resolveInteractionTokenForToolCall` over raw rows. The answer path now reads the same
state map replay reads and finds its token in it, so the second atom, the row-shaped resolver and
four package-index exports (`fetchSessionInteractionRowsAtom`, `resolveInteractionTokenForToolCall`,
`sessionInteractionRowsQueryKey`, plus the retired atom's type surface) are gone. The
tool-call-id-then-token join, the invalidate-and-retry-once behavior and the best-effort contract
are unchanged.

Dead validation dropped. `interactionStatesFromRows` filtered rows through `INTERACTION_STATUSES`
and `INTERACTION_KINDS` sets, but both consumers compare against explicit literals anyway, so the
sets only re-stated what the reads already enforce.

Unreachable API branch dropped. The router's new `resolution_kinds` set listed all three members of
`SessionInteractionKind`, so `source.kind not in resolution_kinds` could never fire. The two guards
that do work — `resolved` is approval-only, and an approval payload must fit the strict shape —
stay.

Dead option removed from `useConnectFlow`. Its third parameter `active` existed only because the
dock mounted a second copy of the flow for the same call; Slice D deleted that surface, leaving one
caller that never passes it. The parameter, `activeRef`, the deactivation effect and six
`!activeRef.current` guards are gone; `settledRef` plus `meta.settled` still guard double-settle.

Unused shared exports removed: `CLIENT_TOOL_RENDER_KINDS` and the three `ClientTool*` type aliases
had no consumers, and `CLIENT_TOOL_INTERACTION_ENDED_KEY` is now module-private.

Smaller edits: the answer resolution is built once with a two-key spread instead of two nearly
identical object literals; `pendingClientToolCallIds` is no longer exported (its only caller is in
the same file); the dock's scroll target is one `querySelector` instead of `querySelectorAll` +
`find`; `resolveClientToolHandler` is a `??` chain; and `agentShouldResumeAfterApproval` picks its
target message in one if/else instead of a pre-seeded `let` that re-tested `liveInteraction`.

One test cut. The settlement matrix's three `walk_away` rows returned early and asserted only that
a locally constructed `SessionInteraction` still held the values just passed to its constructor —
they exercised no production code. Walk-away is really pinned by
`test_interaction_sweep_race.py` and by the `matrix_i1_settlement.py` walk-away cases (sweep
cancels a `pending` row and invents no resolution); a comment in the test file says so.

Considered and kept: the `applyInteractionRowStates` status enumeration (explicit is safer than
`!== "pending"` once the row-state map no longer filters unknown statuses); `interactionAnswer.ts`
as its own module; `transitionInteraction`'s package-index export (its three API siblings are
exported the same way); the `blocksAdoptionForWaitingCard` two-pass scan; and the gate scripts,
whose length is the six journeys the plan asked for.

Verified after the pass: `web/oss` AgentChatSlice 211 passed across 25 files; `@agenta/chat` 256
across 29; `@agenta/playground` 221 across 16; `tsc --noEmit` clean for shared, entities, entity-ui,
playground, chat and oss; eslint and prettier clean on every touched file; `api` session unit suite
361 passed, 28 skipped (three fewer than before — the removed tautologies; the skips are the
unreachable Postgres DAO tests); `uvx ruff@0.15.12 format --check` and `check` clean.

### Review round 1 (independent reviewer, 2026-08-10) — CHANGES NEEDED

Every suite was re-run from scratch rather than trusted: `api` session unit 361 passed / 28
skipped (the skips are the unreachable Postgres DAO tests); acceptance collection 23 tests;
`web/oss` AgentChatSlice 211 across 25 files; `@agenta/chat` 256 across 29; `@agenta/playground`
221 across 16; runner `client-tools.test.ts` 19 passed; `tsc --noEmit` clean for shared, entities,
entity-ui, playground, chat, `web/oss` and `services/runner`; `uvx ruff@0.15.12 format --check`
(1410 files) and `check` clean over `api/` and `.agents/`; eslint and prettier clean. The
`applyInteractionRowStates` bodies in the two replay copies were extracted and hashed
independently: both md5 `9d20941c2a63a38173ecf513fa700855`, byte-identical.

The API half, the replay precedence rule, the adoption guard, the registry fallthrough, the
shared descriptor, and both gate cells hold up. Three findings block agreement.

1. **The ordering guarantee is not actually implemented.** `handleClientToolOutput`
   (`useAgentChatSession.ts`) fires `recordInteractionAnswer` with `void` and falls straight
   through to `addToolOutput`, so the transition and the resume race instead of being ordered.
   The transition can need three browser round trips (cached rows miss, invalidate, refetch,
   POST) while the resume needs one plus a warm server chain to `cancelStaleInteractions`. When
   the sweep wins, the row is `cancelled`, the transition 404s, the failure is swallowed, and
   the answer is lost exactly as before the fix. Await the record before dispatching the resume
   (it never rejects), with a short timeout so a wedged API still cannot block the resume.
2. **Abandoned approvals now hold the queue forever.** `isHitlPending` and `getPendingApprovals`
   scan the whole chat, but nothing neutralizes a dead approval part on replay:
   `applyInteractionRowStates` deliberately skips `user_approval`, and the replay pass only
   settles gates on RESUMED drafts. Verified with a throwaway replay test: a paused approval
   followed by an unrelated completed turn replays as `approval-requested` in a non-tail message,
   and both predicates report it. `canReleaseQueuedMessage` then queues every typed message until
   the user answers a gate whose turn is long dead. Either settle terminal `user_approval` rows
   to `approval-responded` in the same row-state pass, or keep the approval scans tail-only.
3. **`showWaiting` still keys off the last message** (`AgentConversation.tsx`), so a card parked
   several turns up paints "waiting for you" on the newest turn, which holds no card. Make it
   per-message.

Minor, recorded not fixed: `CLIENT_TOOL_INTERACTION_ENDED_OUTPUT` is one shared object assigned
as `part.output` for every ended card; `part.errorText = row.resolution.error` assigns `unknown`;
`anyPendingInteraction` is now a strict subset of `hitlPending`; mobile shares `getPendingApprovals`
and registers no client-tool widget, so finding 2 and the neutral marker both need one look in
mobile QA.

Fixed inline by the reviewer: the release-conductor Stage 4 3d paragraph, which implied the
Telegram cell completes a real connection (it now states the hosted-page credential step is
browser-only, uncovered, and reported in `not_covered`); qa.md journey 5, which still said the row
ends `resolved` and that the token lives in a local file; and the stale comment in
`AgentConversation.tsx` claiming `hitlPending` reads only the last assistant message.

## Implementation complete

All five slices are in the working tree, unstaged and uncommitted. Nothing was committed.

### Fix round 1 (2026-08-10)

All three blocking findings fixed, plus the three minors.

**Finding 1 — the ordering guarantee is now real.** The ordering moved into a small pure
helper, `web/oss/src/components/AgentChatSlice/assets/clientToolAnswer.ts`, so it can be
pinned without React: `recordAnswerThenResume` awaits the record and only then dispatches
the resume, capped by `RECORD_ANSWER_TIMEOUT_MS` (2s) through a `Promise.race`. On timeout
or failure the resume goes out exactly as before, and a late record still lands if the
sweep has not won. `handleClientToolOutput` now calls it instead of firing `void
recordInteractionAnswer(...)` and falling through. `liveGateInteractionRef` is still set
synchronously, so transcript adoption stays blocked across the whole ordered window.
New suite `clientToolAnswer.test.ts` pins the four cases: the resume does not fire while
the record is in flight, it fires after the record settles, it fires when the record
rejects, and it fires on timeout when the record never settles.

**Finding 2 — abandoned approvals no longer hold the queue.** Took the preferred fix:
terminal `user_approval` rows are settled in the same row-state pass. `applyInteractionRowStates`
now splits into `settleClientToolPart` and `settleApprovalPart`, and joins approval rows
through `index.approvals.get(row.token)` (the contractual key — `index.approvals` is keyed
by the interaction request's `payload.id`, which IS the row token) after trying the
tool-call id. A row carrying a verdict replays `approval-responded` with
`approval: {id, approved}`, so the card renders the real answer exactly as the
`interaction_response` path does. A `cancelled` row replays `output-denied`, not
`approval-responded`: the sweep proves only that the gate died unanswered and that the
gated tool never ran, so denied is the honest terminal state, where `approval-responded`
without a verdict would render as "approved" — a claim nobody made. A `responded`/`resolved`
row with no verdict replays `approval-responded` (answered, verdict unknown).

The reviewer's scenario is now a permanent test in BOTH replay suites, in four parts: the
control case asserting the gate really does stay `approval-requested` with no row (so the
test would catch the regression), the swept row settling to `output-denied`, and the
resolved row replaying each verdict. Byte parity of the whole block re-verified after every
edit and after prettier: both copies md5 `a28b5a4683ec48fb933febee8e3a8d9a`, 2907 bytes.

**Finding 3 — `showWaiting` is per-message.** Added `messageHasPendingHitl` to
`web/packages/agenta-playground/src/state/execution/agentMessageQueue.ts` and rebuilt
`isHitlPending` on top of it, so the per-turn marker and the queue hold cannot drift.
`AgentConversation.tsx` now paints `showWaiting` on the turn that actually holds the gate
(`isAssistantTurn && !busy && !stopped && messageHasPendingHitl(message)`) instead of on
the newest turn.

**Minors.** `CLIENT_TOOL_INTERACTION_ENDED_OUTPUT` is `Object.freeze`d at its source in
`@agenta/shared`, and replay assigns a spread copy per card, so no two cards can ever alias
one mutable object. `part.errorText` is coerced: a non-string `resolution.error` falls back
to "The request ended without a result." instead of assigning `unknown`.
`anyPendingInteraction` is gone — `hitlPending` is a strict superset (it scans the whole
transcript for approvals AND client tools), so the status effect reads `hitlPending` alone.
One behaviour change worth naming: `hitlPending` carries `!stopped`, so after a user stop
the tab now reports `idle` rather than `awaiting`. That matches the rest of the stop
handling (the dock is hidden and the queue releases on stop), where the old duplicate memo
left the tab claiming "awaiting" with no UI to act on.

Tests, all re-run after the lint autofix: `web/oss` AgentChatSlice 219 passed across 26
files (was 211 across 25); `@agenta/chat` 260 across 29 (was 256); `@agenta/playground` 221
across 16. `tsc --noEmit` clean for shared, playground, entity-ui, chat, entities and
`web/oss`. eslint `--max-warnings 0` and prettier `--check` clean over every touched file.
No API, runner or gate-script file was touched in this round.

### Review round 2 (independent reviewer, 2026-08-10) — AGREE

All three fixes verified, and every suite re-run from scratch: `web/oss` AgentChatSlice 219 passed
across 26 files, `@agenta/chat` 260 across 29, `@agenta/playground` 221 across 16, `tsc --noEmit`
clean for shared, entities, entity-ui, playground, chat and `web/oss`. API, runner and gate scripts
were untouched this round and were not re-run.

Finding 1. The ordering is real now. `recordAnswerThenResume` awaits the race and then calls
`resume()` on the single path out; both race members resolve (the record's rejection is caught,
the timer resolves), so the resume can neither be skipped nor fired twice, and a synchronous throw
inside `record` is deferred by `Promise.resolve().then(record)` and caught. `addToolOutput` is the
only thing that changes the message list on this path, and it now lives inside `resume`, so
`sendAutomaticallyWhen` cannot see the answer earlier. `liveGateInteractionRef` is still set
synchronously, which keeps adoption blocked across the widened window. The new suite is honest:
the ordering case uses a real deferred gate and asserts the order, and the timeout case asserts the
resume has NOT fired at 49 ms before advancing to 50.

Finding 2. Byte parity re-verified independently over the whole `settleClientToolPart` +
`settleApprovalPart` + `applyInteractionRowStates` block: both copies md5
`d55533b83304aec20bf54cd1b91ac121`, 2910 bytes (a different extraction boundary from the
implementer's, same conclusion). The four approval tests are in both suites.

The `cancelled -> output-denied` call is sound, and for a reason worth recording: it can only ever
reach a gate whose turn never resumed. Any turn that DID resume has its gate settled to
`approval-responded` by the resumed-draft pass, which runs before this one, and any gate whose tool
actually ran carries a real `tool_result`, so the part is no longer `approval-requested` and both
settle functions return early. `output-denied` is a first-class settled state — ToolActivity renders
"denied", `meta.ts`'s SETTLED and `isSettledToolPart` both include it — and it is the same state a
genuine deny replays to, so nothing new had to learn it. A `responded`/`resolved` row with no
verdict replaying `approval-responded` is likewise right: answered, verdict unknown, hold cleared.
The two settle functions cannot cross-settle each other's parts (one requires `approval-requested`,
the other `input-available`), so a token collision between `index.tools` and `index.approvals` is
inert. The control case is not vacuous and is self-guarding: if the fixture ever stopped producing
an abandoned gate, the control fails first and the swept-row case's `output-denied` assertion fails
with it.

Finding 3. `isHitlPending` is now `messages.some(messageHasPendingHitl)` and `showWaiting` uses the
same per-message predicate, so the marker and the hold cannot drift.

Three non-blocking observations, for the live QA phase rather than for this round:

1. The form card looks unresponsive for the length of the record window.
   `ElicitationWidget.handleAccept` clears `submitting` in its `finally`, but the settle is now
   fire-and-forget behind the awaited record, so the Accept button re-enables and the form stays
   interactive until `addToolOutput` lands — one POST typically, the full 2 s cap at worst. The
   connect card is unaffected (`finish()` sets local `outcome` before settling, so its chip paints
   immediately). Cheap fix: leave `submitting` true on the success path and reset it only in the
   validation-failure branch. A double-click inside that window fires a second settle.
2. After a user Stop the tab reports `idle` while the parked card stays clickable. The reasoning in
   the fix entry held before Slice D, when the dock owned the buttons and hid on stop; the inline
   card is not gated on `stopped`, so actionable UI does exist in that state. Defensible either way
   — the run is dead and answering starts a new turn — but worth eyeballing in QA rather than
   treating as settled.
3. Unfreezing a dead gate now depends on a best-effort network join. The interactions query returns
   an empty map on failure by contract, and a gate with no row at all (row creation failed, or a
   session predating the interactions plane) never settles, so the composer keeps holding. Transient
   failures self-heal on the next refresh; the no-row case does not. Optional hardening that needs
   no network: treat an `approval-requested` gate in a draft that is followed by a later draft as
   superseded. At minimum, open one old session with an abandoned gate during live QA.

Still parked from round 1, deliberately: the mobile look at `getPendingApprovals` (mobile shares it)
and at how a neutral ended marker renders with no client-tool widget registered. That belongs to the
live QA phase.

**Fix round 2 (2026-08-10).** `ElicitationWidget.handleAccept` kept `submitting` in a
`finally`, which re-enabled Accept the moment the settle was handed off — and the settle is
now fire-and-forget behind the awaited record write, so a double-click inside the 2s cap
could fire a second settle. `setSubmitting(false)` moved out of `finally` into the `catch`,
so the button comes back only when the form is still open and answerable (validation
failure, or any genuine throw from serialize/settle) and stays locked on the success path.
No test pinned the old behaviour, so none needed adjusting. `web/oss` AgentChatSlice 219
passed across 26 files; `tsc --noEmit`, eslint `--max-warnings 0` and prettier `--check`
clean on the file.

## Live QA (2026-08-10, dev stack `agenta-ee-dev-rel112`, http://144.76.237.122:8180)

Verdict: **FINDINGS** — the new settlement contract holds everywhere it was exercised, including
Mahmoud's original compound scenario, but replay does not settle FORM cards from pre-fix
`cancelled` rows, so old sessions still show a live form and hold the composer.

### Gate cells

| Cell | Result |
|---|---|
| `matrix_i1_settlement` | PASS — all nine settlement cases plus both approval-only 409 guards |
| `matrix_i2_card_journeys` | PASS — all six journeys, including the real-Telegram wire half |
| `matrix_l4_client_tool_lifecycle` | PASS — round trip completes, row ends `responded` with its answer |

The stack runs no subscription sidecar and its Anthropic vault key is out of credit, so the cells
ran on the codex harness with a vault-managed OpenAI key. `matrix_i2` gained an env-driven
`apply_model_override` for this (`QA_HARNESS_KIND` / `QA_MODEL` / `QA_PROVIDER` /
`QA_CONNECTION_MODE`; unset keeps today's claude + haiku config). `matrix_l4` was NOT edited — it
ran through a scratch wrapper that patches `qa_matrix_lib.agent_config` the same way. The only
other script-side issue was environmental: `TELEGRAM_BOT_TOKEN` needs `set -a` when sourcing.

### Browser journeys (resiros account, fresh agent "Morning Motivation Messenger")

| Journey | Result |
|---|---|
| 1. Compound (form → reload → decline connect → approve schedule → reload) | PASS |
| 2. Form then connect back to back | PASS |
| 3. Two connects in one conversation (Telegram + Gmail) | PASS |
| 4. Close the tab, reopen the session | PASS (live card and answered card both) |
| 5. Real Telegram connect / remove / reconnect | NOT COVERED in the browser |
| 6. Decline then retry | Settlement PASS, retry behaves differently from qa.md |
| (a) Accept locked during the record window | PASS (no double settle) |
| (b) Stop while a card waits | NOT REACHABLE — no Stop control while parked |
| (c) Old sessions with abandoned interactions | **FAIL for form cards** |
| Regression: approve, deny, plain chat turn, schedule creation | PASS |

Every journey was verified against the stored rows, not only the screen. Answered form and connect
rows end `responded` with `data.resolution` holding the exact answer; approvals end `resolved` with
`approved` / `denied`; nothing was invented.

### Finding 1 (blocking for the "old sessions" claim): pre-fix `cancelled` rows do not settle form cards

Session `0b6a8c44-a975-4431-90e7-adbcab87c8e8` (project `019fe7de-5e28-7c70-b374-e855b88410a9`) has
exactly one interaction row: `client_tool` / `request_input` / `cancelled`, no resolution. Opened
from the Sessions list on a cold load, the form card renders fully live — populated input, "Waiting
on your input · 3 required", Next / Decline / Dismiss — and the composer is held with "The agent is
waiting for your response — new messages will be queued", even though the agent already answered
the cancellation in the next message.

The join key is not the problem: the card's `data-client-tool-call-id` equals the row token
(`call_Dd5g7Xd92RxD0l0TV55ul07V|fc_0b9b71f5a8fc3f56016a79dcd4ea7081a09d6aedfee011e1a6`) exactly,
`POST /sessions/interactions/query` fires once on load and returns the row, and no parse warning
appears in the console. CONNECT cards in the same sessions DO settle from their `cancelled` rows
("Connection not completed" + Retry), so the miss is specific to the form path. Plan Change 2 rule 3
and review note (c) both require the neutral ended card here.

### Finding 2 (behavior note): Retry re-drives the same card, it does not create a new one

qa.md journey 6 expects "exactly one new live card". What actually happens: Retry re-opens the
provider link for the SAME settled interaction, the card shows "Connecting…" in place, and no new
row is created. The declined row stays settled throughout, so the settlement contract is intact —
but the qa.md wording describes behavior the product does not have. Also, a connect attempt that
fails at popup time settles the row `responded` with `reason: "Connection failed. Please try again."`
and, because the turn has already ended, the surviving Retry cannot resume anything.

### Not covered

- Journey 5's hosted-page half. The QA browser is not on this host, and Composio's page is HTTPS,
  so the bot token cannot reach the page over a private channel without printing it into the agent
  transcript. `matrix_i2`'s `real_telegram` journey covers the wire half (real bot validated against
  Telegram, real create / remove / re-create through Agenta). The 60-second hosted-page step stays a
  human exploratory step.
- Note (b)'s Stop scenario. No Stop control renders while a card waits; the composer shows the queue
  hint instead, so the state the review worried about is not reachable from the composer.
- Mahmoud's own sessions `e627d80a-…` and `6609cd91-…`. They live in his org
  (`mahmoud@agenta.ai`), not in the resiros account this pass had access to. Five pre-fix sessions
  in the resiros project carry the same shape and were used instead.
- Mobile. The mobile surface was not driven; form and connect answering does not exist there
  (research Finding 4).

### Fix round 3 (2026-08-10) — the old-session form card

**The reported cause was not the cause.** Replay already settles that form correctly. The bug is
in ADOPTION: the browser never re-ran replay for those sessions.

Reproduced first, from the live stack, before changing anything. Pulled the real 44 records for
session `0b6a8c44-a975-4431-90e7-adbcab87c8e8` out of `agenta_ee_tracing.records` (in the API's own
`timestamp, created_at, record_index` order) and its single interaction row out of
`agenta_ee_core.session_interactions`, then ran the real `transcriptToMessages` over them. With the
row supplied, the form part settles to `output-available` with `{agenta_interaction_ended: true}`;
without it, it stays `input-available`. Also fed the row through the real
`sessionInteractionsResponseSchema` in the exact API response shape: it parses clean and keeps
`token`, `kind`, `status` and `data.request`, so the row-state map is built correctly. Every link
from the API to the rendered part is sound, and all four of QA's narrowing observations hold — they
just do not point where they seem to.

What actually happens: those sessions already have a transcript in localStorage, cached before this
project shipped, in which the card is live. On open, `shouldAdoptServerTranscript` gates on the
record log having GROWN past the cached watermark (`serverRecordCount <= watermark` refuses). A dead
session never grows, so the watermark already equals the server's record count and the correct new
transcript is computed, then discarded. The stale copy stays on screen — with the live form, and
with the composer held by `isHitlPending` reading that stale copy. Nothing ever triggers a
re-adoption, so it persists across every reload. It also explains QA's own "connect settles but form
does not": in the same cached transcript, connect cards had a real `tool_result` and were already
settled at cache-build time, while the abandoned form had nothing but its row.

**Fix.** `useSessionHydration` gains `settlesEveryWaitingCard`, the exact inverse of the existing
`blocksAdoptionForWaitingCard` and sharing one scan with it: when the incoming server copy settles
EVERY card the tab still shows as waiting, adoption proceeds without record growth (and never while
busy). The two guards cannot contradict each other — a copy that settles every waiting card is by
definition not blocked — and the protection for an unsent local answer is untouched: a server copy
that does not settle the card still cannot overwrite it. `transcriptAdoption.ts` stays untouched,
so mobile is unaffected.

No replay change was needed, and none was made: the precedence block is unchanged and still
byte-identical across both copies (md5 `a28b5a4683ec48fb933febee8e3a8d9a`, 2907 bytes).

**Tests.** The real session is now a golden fixture in both suites
(`__fixtures__/abandonedFormSession.json`, all 44 records, structurally untouched — only long
unrelated `read`/`ls` payloads elided, never the form's own records). Both suites assert it replays
live with no row state and settles to the neutral ended output from its `cancelled` row, and
explicitly not to the pre-fix `{action: "cancel"}` guess. The fixture also pins a shape no synthetic
test had: the form's turn ends `done{stopReason:"paused"}` and the next turn starts with no user
message between, so the two fold into one `resumed` draft whose gate-settling pass covers approvals
only. `useSessionHydration.test.ts` gains six cases for `settlesEveryWaitingCard`, including that it
never contradicts the block guard.

`web/oss` AgentChatSlice 227 passed across 27 files; `@agenta/chat` 262 across 30;
`@agenta/playground` 221 across 16; `tsc --noEmit` clean for all six touched packages; eslint
`--max-warnings 0` and prettier clean.

**Still true after this fix, and worth one line in the PR:** a user whose cached transcript has a
waiting card that the server ALSO still shows as waiting keeps seeing it live. That is correct —
the row really is `pending` — but it means the neutral ended state only appears once the row is
terminal, which for old sessions it already is.

#### Fix round 3, second item: the duplicate-connection dead end

Verified against the API before touching the client. `POST /tools/connections/` has no explicit 409
path; the 409 comes from the DAO's unique-key guard
(`api/oss/src/dbs/postgres/gateway/connections/dao.py`, constraint
`uq_gateway_connections_project_provider_integration_slug`) raising `EntityCreationConflict`, which
`@intercept_exceptions` turns into a `ConflictException`. Its body is the platform CONFLICT
ENVELOPE — an OBJECT, not a string:

```json
{"detail": {"message": "A resource with slug 'telegram' already exists in this project.",
            "conflict": {"provider_key": "composio", "integration_key": "telegram", "slug": "telegram"}}}
```

`extractConnectErrorMessage` only read `detail` when it was a `string`, so every duplicate fell
through to "Connection failed. Please try again." That single missing branch is the whole dead end:
the user could not learn why, the settle reason carried the same non-reason to the agent, and Retry
re-fired the identical doomed create.

Changed, all in `useConnectFlow.ts` plus one line of the card:

- `extractConnectErrorMessage` now reads the object envelope. For a 409 it names the integration
  from `conflict.integration_key` ("A connection for telegram already exists in this project."),
  falling back to the server's own message, then to a specific generic. The server's wording says
  "resource" and quotes a slug, so naming the integration is the better message for both the user
  and the agent. Object details are now also read on other 4xx codes, which previously fell through
  the same hole.
- `isConnectionAlreadyExists` marks the one failure a retry cannot fix.
- `connectFailureFrom` derives the message and the retryability together, and the catch block feeds
  BOTH `setErrorText` and the settle `reason` from that one value — so what the agent reads in the
  tool result is exactly what the user reads on the card, by construction rather than by
  convention. That truthful reason is also what may let the model recover on its own by using the
  existing connection.
- The card hides Retry when the failure is a duplicate, keeping "Not now" (item 3, taken because
  the error branch already had the reason in hand — no new machinery).

Deliberately NOT built: connection reuse. That stays issue #5911. This change only surfaces the
truth.

Test coverage and its limit: `useConnectFlow.test.ts` gains six cases — the integration-named
message, the fallback to the server message, the no-body fallback, that a 409 NEVER yields the
generic failure, that `connectFailureFrom` gives the card and the settle reason the same string with
`retryable: false`, and that ordinary failures keep Retry. The React render itself is not covered:
`web/oss` has no `@testing-library/react` and no `renderHook` anywhere, and standing up render
infrastructure for one assertion is the "new machinery" this round was told to avoid. The
card-and-reason link is instead guaranteed structurally by the shared derivation above.

`web/oss` AgentChatSlice 235 passed across 28 files; `@agenta/chat` 262 across 29;
`@agenta/playground` 221 across 16; `tsc --noEmit` clean for `web/oss`; eslint `--max-warnings 0`
and prettier clean. Replay untouched, both copies still md5 `a28b5a4683ec48fb933febee8e3a8d9a`.

### Review round 3 (independent reviewer, 2026-08-10) — CHANGES NEEDED

Suites re-run from scratch: `web/oss` AgentChatSlice 235 passed across 26 files, `@agenta/chat` 262
across 30, `@agenta/playground` 221 across 16, `tsc --noEmit` clean for shared, entities, entity-ui,
playground, chat and `web/oss`. (The entry above says 28 `web/oss` files; I measured 26. The pass
count matches.) Replay parity re-verified and bit-for-bit unchanged from round 2: both copies
md5 `d55533b83304aec20bf54cd1b91ac121` over my extraction boundary, identical to each other and to
what I measured last round, so the block really was untouched.

The diagnosis is convincing and the fixture proves it. I confirmed the fixture's integrity myself:
44 records, the form's `tool_call` (index 31), `interaction_request` (32) and `done{paused}` (35)
intact and un-elided, 16 tool calls against 15 results with exactly one unmatched call — the form.
The elisions truncate string VALUES only and are applied consistently, so every other
call/result pair still matches on its truncated id; no identity relation was broken. Both golden
tests run the real replay over those records and assert what they claim, including the negative
against the pre-fix `{action: "cancel"}` guess.

The "cannot contradict" claim is TRUE and I verified it from the code, not the prose: both guards
read the same `settledLocallyWaitingIds` result on the same inputs in one synchronous block, and
their conditions are `settled.size === pending.size` versus `!==`. There is also no adopt/re-adopt
loop: after adopting, every locally-waiting card that the server settled is settled locally too, so
`pending.size` drops and the new path cannot fire again on the same copy.

Two findings block.

1. **`settlesEveryWaitingCard` bypasses more than the growth test — it also bypasses the
   anti-truncation floor.** `shouldAdoptServerTranscript` carries three refusals, and the new path
   skips all of them: `serverRecordCount <= watermark` (the one the fix means to bypass), and
   `serverMessageCount < localMessageCount`, whose own comment says "ingest lag can serve a snapshot
   shorter than what we render, and trading down would drop the tail". So a lagging snapshot that
   happens to settle the waiting card — same form record, same terminal row, minus the newest turn —
   now adopts: the newest turn disappears from the screen AND from localStorage (`persistMessages`
   writes the truncated copy), and `recordWatermarkRef` regresses to the shorter count. It
   self-heals on the next fetch, but in the meantime the composer has been released (the card is
   settled) so a message can be sent against a truncated history. The same hole makes the documented
   microtask race real again: `loadSessionMessages(id, adopt).then(adopt)` can deliver the fresh
   copy first and the older one second, and `messagesRef` lags a commit, so the older one re-adopts.
   Fix, one expression, no behaviour lost — the zombie case satisfies both floors with equality:
   gate the new path on `recordCount >= (recordWatermarkRef.current ?? 0)` and
   `serverMsgs.length >= messagesRef.current.length`.

2. **The duplicate-connection Retry is still offered on the path that matters.** For a PARKED
   connect card, the 409 catch calls `finish(...)`, which sets `settledRef`, `setPhase("idle")` and
   `setOutcome(...)`. The render then takes the settled branch (`meta.settled || outcome`), which
   ends in an UNCONDITIONAL `<RetryButton>`; `errorRetryable` is only read in the `phase === "error"`
   branch below it, which that flow can never reach — phase is back to `idle` and `outcome` stays set
   for the life of the component, so even a failed manual retry re-renders the settled branch. After
   a reload `meta.settled` is true and the settled branch wins again. So "the card hides Retry when
   the failure is a duplicate" does not hold where the user meets it, and Retry can be clicked
   forever. The message half DOES work on that path (the reason is not in `KNOWN_CONNECT_REASONS`,
   so it renders in full), which is the important half. Fix: consult `errorRetryable` in the settled
   failure branch too, or correct the claim in this log and the PR.

Recommended, not blocking:

3. Add `!pendingResumeRef.current` to the new path. `refreshFromRecords` checks it twice for exactly
   this hazard, but the remote-run poll calls `adoptServerTranscriptRef.current` with no such check,
   and during the ordered record window (`pendingResume` true, `busy` false, card still
   `input-available` locally, row already `responded`) the server copy now settles the card — which
   is precisely when the new path fires. Before this round the watermark incidentally covered it.
4. Nothing tests the composed decision. The six new tests cover the pure predicates honestly, and
   the no-contradiction case is a real (if single-input) spot check — but finding 1 lives in
   `adoptServerTranscript`, where the predicate meets the watermark, and no test reaches there.
   Extracting that decision into a pure helper would make it testable without render infrastructure.

Both judgment calls are blessed. (a) Naming the integration beats the server's "resource with slug"
wording for both the user and the agent, and the fallback chain (conflict key, then the server
message, then a specific generic) degrades correctly; the six extractor tests are real and none of
them asserts the rendering, so no test is claiming something untrue. (b) The structural argument for
skipping a render test is right for what it claims — the card text and the settle reason are one
value in the catch block, and I verified that. Worth noting that finding 2 is a branch-reachability
bug, which no render test of that link would have caught either; what would have caught it is asking
which branch actually renders after `finish()`.

### Fix round 4 (2026-08-10)

All four taken; both recommendations included.

**Finding 1 — the settled-card path respected only one of three refusals.** Fixed exactly as
specified. The new path now also requires `serverRecordCount >= (watermark ?? 0)` and
`serverMessages.length >= localMessages.length`, so a lagging snapshot that happens to settle the
card can no longer truncate the newest turn out of the screen and localStorage, regress the
watermark, or release the composer against a truncated history — and the microtask race in
`loadSessionMessages(id, adopt).then(adopt)` stays closed. The zombie case clears both floors with
equality, so nothing is lost.

**Finding 2 — Retry on the parked path.** The reviewer is right that `errorRetryable` was
unreachable there: the 409 catch calls `finish()`, which sets `settledRef`, `phase: "idle"` and
`outcome`, so the render takes the SETTLED branch, whose `RetryButton` was unconditional. Fixed at
the level that survives a reload rather than at the component: `ConnectOutput` gained
`retryable?: boolean`, the create-failure settle stores it WITH the output, and the settled failure
branch reads `isSettledFailureRetryable(outcome, output)` — the live outcome first, then the stored
output, defaulting to true so pre-flag outputs keep Retry. That makes the duplicate case show the
message with no Retry both live and after a reload. On the settled branch no button is offered at
all in that case: the call has already settled, so a "Not now" there would be a dead control.

**Recommendation 3 — taken.** `!pendingResume` now gates the new path, so the remote-run poll (which
calls `adoptServerTranscriptRef.current` with no `shouldSkipRecordsRefresh` check of its own) cannot
adopt during the ordered record window, which is exactly when the server copy starts settling the
card. `pendingResumeRef` joined the `adoptServerTranscript` dependency list.

**Recommendation 4 — taken, and it absorbed the predicates.** `shouldAdoptTranscript` is the one
exported decision: waiting-card guard, then the shared growth test, then the floored settled-card
path. `blocksAdoptionForWaitingCard` and `settlesEveryWaitingCard` are gone rather than left
exported-for-tests-only, and their eleven cases were re-expressed against `shouldAdoptTranscript`
with the counts held at equality so only the card logic decides. Finding 1's scenario is now pinned
directly: a lagging shorter snapshot that settles the card must NOT adopt (two cases, one regressing
the record count and one only the message count), and the zombie case with equal counts MUST adopt.
`isSettledFailureRetryable` got five cases covering live-outcome precedence, the post-reload path,
and pre-flag outputs.

Both new exported helpers are used in production code — no test-only exports were introduced.

`web/oss` AgentChatSlice 242 passed across 26 files; `@agenta/chat` 262 across 29;
`@agenta/playground` 221 across 16; `tsc --noEmit` clean for `web/oss`; eslint `--max-warnings 0`
and prettier clean. Replay untouched again: both copies md5 `a28b5a4683ec48fb933febee8e3a8d9a`,
2907 bytes.

Still not covered, unchanged from round 3 and stated again so it is not mistaken for done: no test
RENDERS the card. `web/oss` has no render infrastructure, so the retryability fix is pinned at the
decision (`isSettledFailureRetryable`) and at the data that reaches it, not at the JSX.

### Review round 4 (independent reviewer, 2026-08-10) — AGREE

All four items verified, both judgment calls blessed, one weak assertion fixed inline. This closes
the code loop from my side.

Suites re-run: `web/oss` AgentChatSlice 242 passed across 26 files, `@agenta/chat` 262 across 29,
`@agenta/playground` 221 across 16, `tsc --noEmit` clean for `web/oss`, prettier and
eslint `--max-warnings 0` clean on the file I touched. Replay parity checked a fourth time and
bit-for-bit unchanged since round 2: both copies md5 `d55533b83304aec20bf54cd1b91ac121` over my
extraction boundary.

**Finding 1.** The composition is right, checked refusal by refusal. The waiting-card guard now runs
FIRST, so it covers the growth path too; `shouldAdoptServerTranscript` is untouched and still owns
growth; and the settled-card path carries `pending.size > 0`, `!busy`, `!pendingResume`,
`serverRecordCount >= (watermark ?? 0)` and `serverMessages.length >= localMessages.length`. The
third original refusal, `serverMessageCount === 0`, needs no explicit check: the settled path
requires `settled.size === pending.size > 0`, which cannot hold unless the server copy carries a
settled part. The two new floor cases discriminate separately (one regresses the record count, one
only the message count) and the zombie case pins adoption at equality.

**Finding 2.** Fixed at the level that survives a reload, which is the right level: the settled
failure branch is the only one a parked card reaches and the only one that outlives a reload, and it
now reads `isSettledFailureRetryable(outcome, output)` with the flag stored in the settle output.
Five discriminating cases cover live precedence, the post-reload path and pre-flag outputs.

Judgment call (a), no button on a settled duplicate: BLESSED, and the reasoning holds exactly as
written — `decline` guards on `settledRef.current || meta.settled`, so a "Not now" there is a real
no-op live AND after a reload. A dead control is worse than none.

`retryable` inside `ConnectOutput`: ACCEPTED. It describes the OPERATION ("repeating this create
cannot work"), not the widget — the name is what keeps it honest; a `showRetryButton` would not be
acceptable. Nothing on the path to the model strips or validates unknown keys
(`extractClientToolOutputs` pushes `block.output` whole, and the interaction resolution has been an
open dict since Slice A), so it arrives verbatim as one extra boolean in an object the model already
reads as free-form — coherent beside `reason`, and arguably useful, since it discourages re-asking
for a connection that already exists. It is optional and additive, pre-flag outputs default to
retryable, and the settled output genuinely is the only per-part store that survives a reload; the
alternative is a parallel store keyed by tool-call id, which is more machinery for the same fact.

**Recommendation 3.** The poll window is closed for the new path. One property worth stating rather
than fixing: `pendingResume` clears only inside `sendAutomaticallyWhen` when the dispatch fires, so a
settle that never dispatches leaves it set for the mount — but that same flag already gated
`refreshFromRecords` entirely, so this adds no new starvation class, and the zombie case (fresh load,
nothing answered in this mount) has it null. The growth path still ignores `pendingResume`; that is
pre-existing and out of scope.

**Recommendation 4 and the deletion.** BLESSED. One exported decision, no test-only exports, and the
composed decision is finally testable, which is what round 3 asked for.

Coverage of the re-expressed cases was checked by MUTATION, not by reading. I temporarily made
`pendingClientToolCallIds` count every `input-available` tool part as a card: all 19 tests still
passed. So the stuck-server-tool case had become vacuous — at equal counts both hypotheses refuse
adoption, so the assertion could not tell them apart. (The dynamic-tool case survived the
re-expression: its second assertion, adopting when the server copy settles that card, only passes if
the dynamic-tool part is detected.)

Fixed inline: that test now makes two discriminating assertions, one per harm its own comment names
— with record growth it must ADOPT (a stuck server tool must not freeze adoption), and at equal
counts with the same tool settled server-side it must NOT adopt (the settled-card path must not fire
on a tool nobody is waiting on). Re-ran the mutation: the test now fails under it and passes clean,
and the production file was restored byte-identical (verified by diff against a pre-probe copy).

Unchanged and still parked for QA: no test renders the card, and the mobile look (shared
`getPendingApprovals`; no client-tool widget registered, so the neutral ended marker renders through
the generic path).

### Re-verification after fix rounds 3-4 (2026-08-11, same stack)

Verdict: **FINDINGS** — everything on the re-verification list passes; one NEW defect was found
just outside it, in the same duplicate-connection area.

New code confirmed live behaviourally before anything was concluded: the five pre-fix sessions that
showed live forms in round 1 now render neutral ended cards, and a duplicate connect now shows the
truthful message instead of the generic one.

| # | Check | Result |
|---|---|---|
| 1a | Five pre-fix sessions, normal load with existing localStorage | PASS |
| 1b | Same, with the cached transcript removed (cold-replay control) | PASS — no second cause |
| 2 | Connect cards still settle; `dabb0489`'s "Dismissed the request." chip intact | PASS |
| 3 | Duplicate connect: truthful card, same string in the row, no Retry, no dead "Not now", live and after reload; composer free; later turn does not resurrect | PASS |
| 4 | Ordinary (non-duplicate) failure still offers Retry | PASS |
| 5 | Journey 1 spot-check (form answer, reload, right state) | PASS |
| — | Post-settle Retry that hits a duplicate | **FAIL (new finding)** |

**Item 1.** Every `cancelled` form row now renders "Request ended" with no buttons and no inputs:
`call_n7Gec…` (e8c3b72a), `call_Dd5g…` (0b6a8c44), `call_nN5k…` (eda890fe), `call_528t…`
(3975e362), `call_AKIy…` (dabb0489). Cancelled connect rows render "Connection request ended".
The three genuinely `pending` connect rows stay live ("Connect Telegram" / "Not now") — correct,
and they are exactly the three sessions the sessions list counts as waiting. The composer is free
in every session with no pending card and held only where one genuinely waits. The cold-replay
control (removing `agenta:agent-chat:messages:v2` and `record-counts:v2`, leaving drafts and auth
alone) produced the same states, so replay alone is correct and the cache was the only cause.

**Item 3.** Session `3b56cd84`, card `call_FBXoNUa9GtWrQ6q9rfidFi8H…`. `POST /tools/connections/`
returned **409** (devtools `reqid=4434`) with
`{"detail":{"message":"A resource with slug 'telegram' already exists in this project.","conflict":{"integration_key":"telegram",…}}}`.
The card shows "A connection for telegram already exists in this project." with **zero buttons**;
row `019fedaa-0767-74e1-8a06-0e78e01e0501` is `responded` with
`data.resolution.output = {reason: "<same string>", connected: false, retryable: false}`. The state
survives a reload, the composer stays free, and a later completed turn did not resurrect the card
or create a new row. The agent also received the reason and said so in prose ("A Telegram
connection already exists in this project, so no new connection card was raised").
Screenshot: `r2-duplicate-card.png`.

**Item 4.** A Gmail connect (no pre-existing gmail connection) created fine, opened its real OAuth
popup, and was abandoned; it settled to "Connection not completed" **with** Retry. Row
`019fedac-a638-7df2-8072-0c270221a604`: `responded`, `reason: "cancelled"`, no `retryable` flag —
so Retry suppression is specific to duplicates and has not leaked to ordinary failures.

**New finding: a post-settle Retry that collides with a duplicate is a silent doomed loop.**
Abandoning that Gmail OAuth still left a `gmail` row in `gateway_connections` (21:55:53), so the
card's own Retry now collides. Clicking it fires a real `POST /tools/connections/` **409**
(`reqid=4913`, and again `reqid=4919` on a second click) while the card keeps reading the generic
"Connection not completed" with Retry still offered, at every sample from 1.5 s to 8 s. The row
never changes. Cause is branch order in `ConnectToolWidget.tsx`: the settled-chip block returns
before `if (phase === "error")` is reachable, so the truthful `errorText` and `errorRetryable=false`
computed by `connectFailureFrom` can never render on an already-settled card; `settledRetryable`
meanwhile reads the STORED output, which for an abandoned connect has no `retryable` flag and so
keeps Retry. This is Mahmoud's production shape exactly — abandon an OAuth, then retry forever
against a connection that already exists. Screenshot: `r2-finding-doomed-retry.png`.

**Not a defect, worth recording.** For PRE-fix sessions the warm cache shows richer text than a
cold replay: `dabb0489`'s form reads "Dismissed the request." from cache but "Request ended" after
the cache is cleared. That is the design working — those answers were never recorded in a row (the
original bug), so replay has nothing to reconstruct and correctly refuses to guess. Post-fix rows do
not degrade: the compound session's answered form replayed cold with all three saved values intact.

### Fix round 5 (2026-08-11) — the doomed post-settle Retry

QA's cause is exact. The settled-chip block ends with a `return`, so `if (phase === "error")` is
unreachable once the part is settled. A manual retry from a settled card runs with
`settleParkedCall: false`, so the catch never calls `finish()`, so `outcome` keeps whatever the
ORIGINAL settle put there — for an abandoned OAuth that is `{connected: false, reason: "cancelled"}`
with no `retryable` flag. The chip therefore re-rendered from stale data: generic "Connection not
completed", Retry still offered, forever, while every click fired a real 409.

Took shape (a). The catch now refreshes the live outcome when the card is already settled, so the
result reaches the branch that actually renders and flows through the round-4 decision:

```ts
if (settleParkedCall) finish({connected: false, integration, slug, reason: message, retryable})
else if (settledRef.current || meta.settled)
    setOutcome({connected: false, reason: message, retryable})
```

The `else if` guard is load-bearing, not defensive. `phase === "error"` is genuinely reachable on an
UNSETTLED card — the popup-blocked path sets it without settling — and setting `outcome` there would
flip that card into the settled chip and make it look finished when it is not. Shape (b) was
rejected for the same reason plus a second: the error branch offers "Not now", which is a dead
control once `settledRef` is set.

While pinning it, the chip's two inline reads (`outcome?.reason ?? output.reason` filtered through
`KNOWN_CONNECT_REASONS`, and `isSettledFailureRetryable`) became one exported
`settledFailureChip(outcome, output)` returning `{failureDetail, retryable}`, with
`KNOWN_CONNECT_REASONS` moving to the hook beside it. Both halves of what the settled chip shows are
now one tested decision instead of one tested helper and one untested expression.

**Reload caveat, stated plainly because it is the honest outcome of shape (a):** the refresh is
LIVE-ONLY. The stored output still carries the original `reason: "cancelled"` and no flag, so after
a reload the card returns once to "Connection not completed" with Retry, and the next click lands
back in the truthful no-Retry state. Persisting it would mean re-settling an already-settled part,
which the double-settle guards exist to prevent. Accepted for this round.

Test: `settledFailureChip` gains the round-5 repro as a two-step case in the QA artifact's exact
shape — the abandoned-OAuth output alone yields generic wording with Retry, and the same output plus
the failed retry's outcome yields the truthful message with Retry gone — alongside cases for the
three generic reasons, verbatim rendering of any other reason, live-outcome precedence, and pre-flag
outputs.

`web/oss` AgentChatSlice 245 passed across 26 files; `@agenta/chat` 262 across 29;
`@agenta/playground` 221 across 16; `tsc --noEmit` clean for `web/oss`; eslint `--max-warnings 0`
and prettier clean. Replay untouched: both copies md5 `a28b5a4683ec48fb933febee8e3a8d9a`, 2907 bytes.
Still no test that RENDERS the card — unchanged from rounds 3 and 4.

### Review round 5 (independent reviewer, 2026-08-11) — AGREE

Narrow round, one item. Verified from the code; the reasoning for rejecting shape (b) holds.

Suites: `web/oss` AgentChatSlice 245 passed across 26 files, `@agenta/chat` 262 across 29,
`@agenta/playground` 221 across 16, `tsc --noEmit` clean for `web/oss`, prettier clean on the three
touched files. Replay parity checked a fifth time, still identical across copies and bit-for-bit
unchanged since round 2 (md5 `d55533b83304aec20bf54cd1b91ac121` over my extraction boundary).

**1. The guard.** The settled-refresh cannot fire on an unsettled card: it needs
`settledRef.current || meta.settled`, and `settledRef` is set only inside `finish()`. `finish()`
cannot double-fire either — the `if`/`else if` is mutually exclusive and `finish()` early-returns on
`settledRef` anyway. The refresh is safe against the double-settle guards by construction: it calls
`setOutcome` only, touching no settle machinery and no ref.

The reachability claim behind rejecting shape (b) is TRUE. `useConnectFlow.ts` sets
`phase: "error"` and RETURNS when `window.open` yields no popup — no settle, no `outcome` — so a
parked card really can sit unsettled in `phase: "error"`, where the error branch's "Not now" is the
live escape hatch for a run that is still parked. An unconditional `setOutcome` in the catch would
flip that card into the settled chip and make a parked run look finished; shape (b) would show the
error branch (with its then-dead "Not now") for a settled card. Both stated reasons check out.

**2. The consolidation: BLESSED.** It is in service of the fix rather than beside it — round 4 left
one half of the chip a tested helper and the other half an untested inline expression, and this makes
both one decision. `isSettledFailureRetryable` is fully replaced (no stragglers), `KNOWN_CONNECT_REASONS`
now sits beside its only consumer, and the widget calls one function instead of computing two things.
Net surface goes down, not up.

**3. The reload caveat: ACCEPTED.** One wasted click per reload, self-correcting on that click, is a
categorical improvement over the infinite doomed Retry QA hit, and persisting would mean re-settling
a settled part. One durable route worth recording as considered-and-rejected rather than missed:
refreshing the interaction ROW's resolution would be durable and would NOT re-settle the part, but it
cannot reach the render — replay rule 1 skips any part that already carries a real `tool_result`, and
an in-band settled card always does. The only remaining cheap option is a client-side store keyed by
tool-call id (the elicitation draft's pattern), which reintroduces exactly the parallel store round 4
argued against. Not worth it for one click.

**4. The tests.** Real, at the decision level, and the round-5 repro is genuinely two-step in the
artifact's shape: the abandoned-OAuth output alone yields `{failureDetail: undefined, retryable: true}`
(the pre-fix state QA saw), and the same output plus the failed retry's outcome yields the truthful
message with Retry gone. `toEqual` on the whole result pins both halves per case, and the step-2 case
fails if live precedence ever breaks. The standing limit is unchanged and correctly restated: the
catch's `setOutcome` wiring itself is verified by inspection, not by a render test.

**For QA re-driving the gmail artifact:** the expected observation is exactly ONE doomed click per
reload, not zero — the first click after a reload is what re-derives the truthful no-Retry state.
That is the accepted trade above, not a regression.

#### Final re-check after fix round 5 (2026-08-11): doomed-retry repro — CLEAN

Re-driven against the preserved artifact (the unauthorized `gmail` row in `gateway_connections`
from 21:55:53, plus the settled "Connection not completed" card `call_XV4bjLGqkEuOlYud7wQ…` in
session `715c8d78`). Both halves behave as the reviewer specified.

**Pre-reload half — PASS.** Clicking Retry fires `POST /tools/connections/` → **409**
(devtools `reqid=5421`, body
`{"detail":{"message":"A resource with slug 'gmail' already exists in this project.","conflict":{"integration_key":"gmail",…}}}`).
Within 1.5 s the card updates to "A connection for gmail already exists in this project." with
**zero buttons**, and it holds that state at every sample through 18 s. The integration name is
interpolated from the conflict envelope, not hardcoded — this run says `gmail` where the earlier
one said `telegram`. Screenshot: `r3-gmail-truthful-no-retry.png`.

**Post-reload half — PASS, and bounded.** After a reload the card reads "Connection not completed"
+ Retry once more, as expected: the fix is live-only and the stored resolution is deliberately not
rewritten (row `019fedac-a638-7df2-8072-0c270221a604` still reads `reason: "cancelled"`,
`updated_at 21:56:32`). The FIRST click re-derives the truthful state — one `POST
/tools/connections/` **409** (`reqid=5821`, exactly one in the cycle), then
"A connection for gmail already exists in this project." with no buttons, stable through 14 s.
Because the truthful state has no buttons at all, no second doomed click is reachable without
another reload. One doomed click per reload, never a loop.

QA verdict for the lane: **CLEAN**.
