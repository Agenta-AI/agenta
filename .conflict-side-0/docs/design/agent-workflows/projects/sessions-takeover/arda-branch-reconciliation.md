# Reconciling Arda's approval-UI branch with the #5382 approvals fix train

Written 2026-07-21. All claims below are verified against the git history in this
repository: `origin/fe-enhance/approval-ui-onbig` (Arda's branch, 11 commits on top of the
current `origin/main` at `dd19a601e9`, which is v0.105.7), its safety copy
`origin/backup/approval-ui-pre-stack`, and the open PR train `sessions-rebase/backend`
(PR #5375), `sessions-rebase/runner` (PR #5376), and `plan/concurrent-approvals`
(PR #5382). Conflict claims come from real `git merge-tree` trial merges, not from
eyeballing file lists.

## Vocabulary used throughout

- The **runner** is the Node/TypeScript sidecar under `services/runner/` that drives a
  coding-agent harness inside a sandbox. A **harness** is the actual coding agent, either
  Pi or Claude Code, speaking the ACP protocol.
- A **gate** is a human-approval request the harness raises before a policy-gated tool
  runs. The playground shows a gate as an approval card.
- To **park** is to end the streamed turn while keeping the live harness session alive in
  a keep-alive pool, waiting for the human's answer. A **warm resume** checks that session
  back out and answers the gate in place. The **cold path** rebuilds the environment and
  replays or continues the conversation instead.
- A **sentinel** is a bookkeeping string the runner writes as a tool result when the real
  result is unavailable. Two matter here: `DEFERRED_NOT_EXECUTED` (the call never ran this
  turn because the turn paused on another gate) and `APPROVED_EXECUTION_RESULT_UNKNOWN`
  (the call was approved and started, but the pause ended the turn before its result was
  observed; the second sentinel exists only on the #5382 side).
- **Hydration** is the frontend rebuilding the conversation from the persisted session
  records on reload, in `transcriptToMessages.ts`.
- On `main` today the runner can park exactly **one** gate. A turn with more than one gate
  bails out of parking entirely (`multi-gate-no-park` in `server.ts`) and falls to the
  cold path. Both bodies of work below independently generalize this to many gates, and
  that shared ambition is where they collide.

## Part 1: what Arda built, told as a story

Arda's branch is really three projects that happen to live on one branch.

The first project is **approval throughput on the runner**. He observed that when the
model fires several tool calls in parallel, each needing approval, the runner parks on the
first gate and force-settles the siblings with the `DEFERRED_NOT_EXECUTED` sentinel, so a
two-file write costs the user one full park-and-resume round trip per file, and on cold
replay the sentinel rendered as `[tool error: ...]`, which the model read as a denial and
gave up. His answer has two halves. On the cold path, render the deferred sibling as a
"call it again with the same arguments" nudge so the model re-issues the call and its own
gate surfaces (commit `fcc7348156`). On the warm path, stop parking on the first gate:
collect the whole staggered batch behind a debounce window (a new
`AGENTA_RUNNER_APPROVAL_COLLECT_MS` environment variable, default 800 ms), park once with
every gate recorded in a new `env.parkedApprovals` array, and resume only when the
frontend has answered every gate in the batch (commit `23b9557fef`, plus the formatting
commit `a7524a835c`).

While testing that flow he hit the same reload corruption our incident investigation hit,
and fixed it from his side: a paused turn persists a terminal `done` record and the resume
run re-persists the same user prompt, so a reloaded conversation splits the parked gate
from the resume that settles it and duplicates the user turn. His runner fix tags the
paused `done` with its stop reason and skips re-persisting the prompt on a resume
(commit `e658c1ec43`); his frontend fix keys tool parts transcript-wide during hydration
and keeps the draft message open across a paused `done` (commit `3e5c2d1c44`).

The second project is **approval friction and config UX**, and it is the part with his
name on it in spirit: an "Always allow this tool for this agent" toggle on the approval
card that writes a real permission into the draft agent config (per-tool `permission` for
gateway and custom-function tools, a `harness.permissions.allow` rule for harness builtins
like bash), with a contained Undo notice in the config pane (commit `14e82e03c7`); an
"Approve all" action that resolves a whole batch of cards in one step instead of walking
1-of-N; and a set of config-pane primitives that surface "what changed" inline: a shared
`HeightCollapse` animation primitive (commit `491c593986`), `ChangedPathsContext` and
`FocusPathsContext` plus a section-change classifier (commit `0f1448f68a`), and the
drawer-backed "Model & harness" and "Advanced" sections showing a missing provider key or
uncommitted changes inline with revert affordances (commit `9ab4099cb8`).

The third project is housekeeping: a one-line drawer width fix (commit `8bdd5c4ed4`) and
the Claude Code harness environment variables and volume mount for the EE dev compose
stack (commit `07c9153a62`).

The branch name suffix "onbig" and the backup branch tell the provenance: he originally
built this on the big-agents workspace trunk interleaved with his Drive work (which has
since merged to main through PRs #5399 and #5400), then ported the eleven surviving
commits onto clean v0.105.7 main. Nothing in the branch touches the sessions backend, the
`interaction_response` event, or any API code: it is a pure runner-plus-frontend branch,
and it merges onto main today without help from any open PR.

## Part 2: the commit map

Classification key: (a) approval-machinery overlap with #5382, (b) approval UX net-new,
(c) config-section UI work unrelated to approvals, (d) infrastructure, (e) parked/resume
defect fixes overlapping #5382's defect fixes.

| # | Commit | What it does | Main files | Class | Merges over #5382 stack? |
|---|--------|--------------|-----------|-------|--------------------------|
| 1 | `fcc7348156` fix(runner): render a deferred parallel-tool sibling as a retry nudge | Cold-replay transcript renders the `DEFERRED_NOT_EXECUTED` sentinel as a "call it again" nudge instead of an error the model reads as a denial. Exports `isDeferredNotExecuted`. | `transcript.ts`, `responder.ts`, tests | (e), mostly complementary | Near-clean; `transcript.ts` is untouched by #5382, one small conflict in `responder.ts` |
| 2 | `23b9557fef` feat(runner): hold parallel approval gates and resume them together | Generalizes the single parked gate to a `parkedApprovals` array; debounced collect-then-pause window (800 ms); resume answers the whole batch or goes cold. | `server.ts`, `run-turn.ts`, `pause.ts`, `acp-interactions.ts`, `runtime-contracts.ts`, `otel.ts`, tests | (a), direct machinery overlap | Conflicts across all six runner files |
| 3 | `491c593986` feat(ui): shared HeightCollapse + config-section animation primitives | One CSS collapse primitive; section shimmer and draft tones; adds the `motion` dependency to `@agenta/ui`. | `agenta-ui`, `AgentCommitNotice`, `RevealCollapse` | (c) | Clean |
| 4 | `0f1448f68a` feat(config): changed-path + focus primitives for config sections | `ChangedPathsContext`, `FocusPathsContext`, `RailField` opt-in, `sectionChanges` classifier, two new shared signal atoms. Includes unit tests. | `agenta-entity-ui`, `agenta-shared` | (c) | Clean |
| 5 | `9ab4099cb8` feat(config): context-driven config sections | Inline provider-key field, focus-filtered changed controls with revert, wired dot-paths for sandbox and harness permission controls. | `agenta-entity-ui` SchemaControls | (c) | Clean |
| 6 | `14e82e03c7` feat(agent-chat): always-allow + batch resolve | The always-allow toggle writing draft-config permissions via new `toolPermission` helpers (224 lines of tests); Approve-all; dock latch so a batch resolves in one visual step. | `ApprovalDock`, `useAlwaysAllowTool`, `toolPermission.ts`, notices | (b) | Clean |
| 7 | `8bdd5c4ed4` fix(ui): TriggerDeliveriesDrawer width | One line. | `TriggerDeliveriesDrawer.tsx` | (c) | Clean |
| 8 | `e658c1ec43` fix(runner): don't corrupt a parked+resumed turn's persisted transcript | Tags the paused turn's persisted `done` with `stopReason`; skips re-persisting the prompt on a resume (`tailIsFreshUserMessage`). | `server.ts`, `otel.ts`, `run-turn.ts`, tests | (e), overlaps #5382's deferred record-hygiene item | Conflicts in `server.ts` and `otel.ts` |
| 9 | `3e5c2d1c44` fix(agent-chat): restore a parked+resumed approval on reload | Hydration keys tool parts transcript-wide; dedupes the resume's re-emitted `tool_call`; a paused `done` no longer closes the draft message. | `transcriptToMessages.ts`, tests | (a)/(e), overlaps #5382's hydration work | Conflicts (content plus add/add on the test file) |
| 10 | `07c9153a62` chore(hosting): Claude Code harness config in EE dev compose | `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_OAUTH_TOKEN`, and a writable `~/.agenta-claude-config` mount on the dev runner. | `docker-compose.dev.yml` | (d) | Clean (auto-merges) |
| 11 | `a7524a835c` style(runner): prettier-format the rebased parallel-approval port | Formatting fallout of the port. | 3 runner files | (a) rider | Folds into the machinery decision |

Trial-merge ground truth (`git merge-tree --write-tree`): merging Arda's branch over the
full #5382 stack conflicts in exactly ten files, all of them the runner machinery and the
hydration adapter (the six `services/runner/src` files, the keep-alive approval test, and
`transcriptToMessages.ts` plus its test). Every other file in the branch, meaning the
whole config-UX, always-allow, drawer, and compose set, auto-merges. Against the sessions
rebase alone (#5375 and #5376 without #5382) the conflict set shrinks to two files,
`run-turn.ts` and `runtime-contracts.ts`.

## Part 3: the overlap analysis

There are four overlapping pairs. For each: what defect it addresses, whether the two
sides conflict textually and semantically, and which is more complete, judged against the
incident root-cause reports
(`docs/design/agent-workflows/scratch/debug-concurrent-approvals-db58551b.md` and
`debug-frontend-approval-dispatch.md`) and each side's tests.

### Pair 1: multi-gate parking machinery

**His:** `23b9557fef` "hold parallel approval gates and resume them together".
**Ours:** the #5382 stack's park-and-resume train (`b831e753f3` multiple simultaneous
requests, `1171dd5beb` record every parked gate, `a05238576a` partial answer sets,
`24bc93b344` the Pi-batching park rule, `3204ad5517` review closure).

Both sides generalize main's single `env.parkedApproval` to a collection, in the same six
files. The textual conflict is total. The semantic conflict is the important one, and it
is a genuine contract difference:

- **Arda's resume is all-or-nothing.** His `server.ts` comment states the contract
  plainly: "The FE only resumes once it has answered ALL pending gates ... a gate still
  missing a decision means the request is not that resume ... treat as a mismatch, go
  cold." A resume request that answers only some parked gates evicts the live session.
  This is exactly the shape the incident report identifies as defect 1's enabling
  condition: the frontend's "every card settled" precondition could never hold after a
  state rebuild, so the last answer sat unsent in browser memory and the conversation
  died. Arda's branch does not change the frontend dispatch predicate
  (`agentApprovalResume.ts` is untouched), so the all-settled batching survives on his
  branch, and his design leans on it.
- **#5382's resume is per-card with partial answer sets.** One click dispatches one
  answer; the runner answers the subset it received, streams those results, and re-parks
  on the remaining gates. This was adversarially reviewed, carries an end-to-end
  regression replay of the incident (`b955011782`), and was verified in four live QA
  cycles.
- **Arda's collect window is the genuinely new idea.** #5382 parks each gate as it
  arrives and explicitly deferred "two cards genuinely on screen at once" to issue #5391
  because the harness adapters raise gates serially. Arda measured gates arriving roughly
  half a second apart and debounces the pause so a staggered batch parks together and the
  user sees N cards at once. One caution that decides the window's fate: the live incident
  investigation established that BOTH harness adapters raise approval requests strictly
  serially today, each blocking until answered (Pi's confirms, and Claude's adapter per the
  evidence recorded on issue #5391). The second request does not exist until the first is
  answered, so no window of any length has a burst to gather on either harness. The window
  therefore only becomes useful when the upstream adapter work in #5391 makes requests
  arrive together, and it belongs with that issue rather than in the port.

What Arda's machinery does not cover, and #5382 does, mapping to the incident defects:
defect 2 (the post-pause sweep stamps the retry-inviting sentinel onto an approved,
mid-execution call; #5382 excludes approved-executing calls and introduced the
`APPROVED_EXECUTION_RESULT_UNKNOWN` sentinel; Arda's sweep exclusion is still only the
paused gates, and his branch has no second sentinel), defect 3 (a never-started sibling
recorded as a successful "(no output)" result; #5382 buffers completion frames during the
pause; Arda does not touch `runtime-policy.ts`), defect 4 (the answer half of a gate is
never persisted; #5382 emits a durable `interaction_response` and writes the verdict onto
the interaction row through the API; Arda's branch contains no `interaction_response`
producer at all), and the Pi-batching deadlock (#5382 parks immediately when Pi's
batching blocks an approved call; Arda's resume waits on the blocked prompt).

There is also an interaction between defect 2 and Arda's own retry nudge that matters:
because his branch leaves the sweep unfixed, an approved call that actually executed can
still be stamped `DEFERRED_NOT_EXECUTED`, and his nudge then tells the model to run it
again with the same arguments. For a side-effecting command that is a double-execution
invitation, sharpened rather than softened.

**Verdict: resolve in favor of #5382's machinery.** It fixes four root-caused defects his
does not, its contract survives state rebuilds, and it is regression-tested against the
literal incident. The one thing worth carrying forward from his commit is the
collect-then-pause window, which is small (a `schedulePause` debounce on the pause
controller plus wiring in `acp-interactions.ts`) and can be re-expressed on top of
#5382's parked-gates map as a follow-up. It is, in effect, the first half of issue #5391
delivered without upstream adapter changes, for the Claude harness only.

### Pair 2: reload hydration of a parked-and-resumed approval

**His:** `3e5c2d1c44`. **Ours:** the hydration halves of `20dcb553ce` and `297d82ae1f`.

Here the two sides converged on the same core insight independently: tool parts must be
keyed transcript-wide, not per-draft-message, because a gate parked in one run is settled
by a `tool_result` in the resume run, and per-draft keying drops that result and leaves
the card stuck at "Awaiting approval". Both implementations hoist the tool index out of
the draft. On top of that shared core:

- #5382 additionally overlays the persisted `interaction_response` answers onto requests
  (so an answered card rehydrates as answered even before any resume ran), reopens a
  sentinel-only sealed card when a later approval request re-parks it (the defect-B fix
  from the frontend report, with the sentinel prefixes mirrored as exported constants),
  and keeps `done` as a message boundary, with a comment stating that choice: the index
  settles across the boundary, and message-per-turn stays true.
- Arda additionally dedupes the resume's re-emitted `tool_call` record (update in place
  rather than pushing a duplicate part) and treats a `stopReason: "paused"` `done` as a
  non-boundary, keeping the paused turn and its resume in one assistant bubble. His
  non-boundary reading requires his runner-side commit (pair 3) to have stamped the stop
  reason; #5382's version needs no new persisted field.

Textually they conflict (content conflict on the adapter, add/add on the test file).
Semantically they are two dialects of the same fix, but only #5382's covers the answered
half: without persisted answers, Arda's hydration still resurrects an answered-but-not-
yet-resumed gate as pending, which is the state that killed the incident conversation.

**Verdict: #5382's version is the superset that matters; take Arda's `tool_call` dedupe
as a small follow-up.** The dedupe becomes genuinely necessary the moment record ids are
scoped per turn (the queued audit-hardening work makes re-emits append instead of
upserting in place), so it is worth keeping on the roadmap with his name on it. The
one-bubble-versus-two rendering choice is cosmetic and can be decided later.

### Pair 3: persisted-transcript corruption on park and resume

**His:** `e658c1ec43`. **Ours:** the truthful-terminalization work in `4c8c809984` plus
the deliberate deferral in #5382.

These do not solve the same defect, despite the similar titles. #5382's runner commit is
about result truthfulness (an approved executing call keeps its real result; a
never-started call becomes deferred, never a fake success). Arda's commit is about record
hygiene: the duplicated user-message row on every resume, and the paused `done` masquerading
as a turn boundary. That is, almost exactly, item 5 of the incident report's fix plan
("stop re-persisting the recovered prompt on approval resumes", part of making the record
a trustworthy audit log), which #5382's PR description explicitly deferred. So Arda
implemented, in parallel, a piece of our own declared follow-up.

The catch is purely textual: his edit sits in the same `server.ts` persist block and the
same `otel.ts` `finish()` that #5382 reworked, so the commit does not apply as-is. The
content, a `tailIsFreshUserMessage` guard before persisting the prompt and an optional
`stopReason` on the terminal `done` record, is small and re-expressible on the stack in
an afternoon. One design note before re-applying the guard: the frontend report shows the
#5382 hydration currently relies on the duplicated user row's existence in one place (the
server-transcript-adoption heuristic prefers the server copy "whenever it has MORE
messages"), so removing the duplicate row should land together with a re-check of that
heuristic, which is a reason to do it as a deliberate follow-up rather than a mechanical
cherry-pick.

**Verdict: no contest to resolve; adopt the intent as the already-planned record-hygiene
follow-up on top of #5382, re-implemented against the stack's code.**

### Pair 4: rendering the deferred sibling on cold replay

**His:** `fcc7348156`. **Ours:** the sentinel taxonomy in `4c8c809984` and `3204ad5517`.

This is the cleanest pair: they compose. #5382 never touched `transcript.ts`, the
cold-replay prompt builder, so his change (render a `DEFERRED_NOT_EXECUTED` block as a
neutral "this was skipped, not denied; call it again" nudge instead of an error string)
fills a real gap that exists on the #5382 stack too: any deferred sibling that does end
up on the cold path today still replays as `[tool error: ...]` and reads as a denial. The
only overlap is a trivial conflict in `responder.ts` where he exports the existing
`isDeferredNotExecuted` helper and #5382 edited neighboring lines.

Two conditions for taking it: it must land on top of #5382's sweep fix, because only
there is the deferred sentinel guaranteed to mean "genuinely never started" (see the
double-execution note under pair 1); and it should extend the same courtesy to the
`APPROVED_EXECUTION_RESULT_UNKNOWN` sentinel, which his branch does not know about, with
the opposite instruction (do not retry a side-effecting call).

**Verdict: take it, rebased onto the stack, with the UNKNOWN-sentinel case added.**

## Part 4: the extraction plan

The branch splits cleanly along the trial-merge conflict line. Everything below is
ordered so that no step waits on anything it does not truly need.

**Now, independent of every open PR (target: main).**

1. `8bdd5c4ed4` (drawer width) and `07c9153a62` (compose harness config). Trivial,
   zero-risk, one small PR or folded into the next one.
2. The config-UX train as one stacked pair of PRs in this order: `491c593986`
   (HeightCollapse and section primitives), then `0f1448f68a` (changed-path and focus
   primitives), then `9ab4099cb8` (the context-driven sections). These three auto-merge
   over both main and the #5382 stack and have their own unit tests
   (`sectionChanges`, `formatCommitted`). Nothing approval-related blocks them.
3. `14e82e03c7` (always-allow plus batch resolve) can also go to main now on top of the
   config train (it needs `HeightCollapse` and the shared signal atoms). It is frontend
   plus config only and auto-merges over the stack. If it lands before #5382, give it one
   QA pass again after #5382 merges: the dock's batch latch was written against the
   all-settled dispatch, and under #5382's per-card dispatch an "Approve all" click fires
   several responses that may resume-then-re-park in waves. The runner side accepts
   partial answer sets by design, so this should compose, but it is the one seam nobody
   has watched live.

**After #5375, #5376, and #5382 merge (target: the merged main).**

4. Drop, from Arda's branch, the four machinery commits as they stand: `23b9557fef`,
   `e658c1ec43`, `3e5c2d1c44`, and `a7524a835c`. Their tests encode the all-or-nothing
   resume contract and go with them.
5. Re-express the salvage as three small follow-ups, each cheap on top of the stack's
   code, ideally by Arda so the authorship follows the ideas:
   - the collect-then-pause window (`schedulePause` on the pause controller, the
     `onScheduleApprovalPause` seam, the env var), now feeding #5382's parked-gates map,
     positioned honestly as a Claude-harness batching feature and the first half of #5391;
   - the record-hygiene pair (skip the duplicate user row via `tailIsFreshUserMessage`,
     stamp `stopReason` on the paused `done`), landed together with a re-check of the
     frontend's server-transcript-adoption heuristic, as the already-planned deferred
     item 5;
   - the cold-replay retry nudge in `transcript.ts`, extended to also treat the UNKNOWN
     sentinel (as "do not retry"), plus the trivial `isDeferredNotExecuted` export.
6. The `tool_call` re-emit dedupe in hydration rides along whenever the per-turn
   record-id scoping lands, since that change is what makes it necessary.

## Part 5: the decision list for Mahmoud

**Decision 1: which multi-gate machinery survives.**
Context: both bodies of work replace main's single-gate park with multi-gate machinery in
the same six runner files; the contracts are incompatible (all-or-nothing batch resume
versus per-card dispatch with partial answer sets and re-park).
Option 1: keep #5382's machinery and drop Arda's four machinery commits.
Option 2: keep Arda's and rework #5382 on top of it.
Consequence: option 2 would discard the fixes for incident defects 2, 3, and 4 (sweep
clobbering, phantom success, unpersisted answers), the Pi-batching deadlock fix, the
adversarial-review closures, and the end-to-end incident regression test, and would
reinstate the all-answers-required resume that caused the dead conversation.
Recommendation: option 1, without reservation. Arda's implementation is competent but it
was built without the incident evidence; nothing in it handles a case #5382 misses, while
#5382 handles four cases his misses.

**Decision 2: whether the collect-then-pause window becomes a follow-up.**
Context: the window is Arda's genuinely novel contribution; it batches staggered gates so
the user sees N cards and answers once, which #5382 deferred to issue #5391. It helps the
Claude harness only, because Pi raises confirms strictly serially.
Option 1: have Arda re-implement it on top of the merged stack as a small, env-gated
follow-up, QA'd against the Claude harness, framed as the no-upstream-change half of #5391.
Option 2: drop it until #5391 resolves the adapter-serialization question for both
harnesses.
Consequence: option 2 leaves multi-file Claude approvals at one round trip per file for
however long #5391 takes.
Recommendation: option 1. It is small, additive on the surviving machinery, and it keeps
Arda's headline idea alive with his authorship.

**Decision 3: whether Arda's UX and config commits land now or wait for the stack.**
Context: the always-allow toggle, batch resolve, config sections, drawer fix, and compose
config all auto-merge over both main and the #5382 stack; only the always-allow and
batch-resolve dock has any behavioral coupling to the approval flow.
Option 1: land them on main now (config train and housekeeping immediately; the approval
dock commit too, with a repeat QA pass after #5382 merges).
Option 2: hold everything until #5375/#5376/#5382 merge and rebase once.
Consequence: option 2 costs Arda one to two weeks of idle divergence for no correctness
gain; option 1 costs one extra QA pass on the dock.
Recommendation: option 1. This is what actually unblocks him this week.

**Decision 4: who owns the record-hygiene and retry-nudge follow-ups.**
Context: Arda independently built two things #5382 explicitly deferred or missed (the
duplicate-user-row and paused-done tagging; the cold-replay nudge). Both need
re-implementation against the stack's code rather than cherry-picks.
Option 1: assign both to Arda as his first post-merge tasks on the approvals surface.
Option 2: fold them into the existing audit-hardening queue on our side.
Consequence: either works technically; option 1 turns the collision into shared ownership
of the surface and gives his parallel work a landing.
Recommendation: option 1, with the two guardrails named in part 3 (record-hygiene lands
with the frontend adoption-heuristic re-check; the nudge lands only on top of the sweep
fix and covers the UNKNOWN sentinel too).

**The dependency answer, for completeness.** Arda's branch is standalone on v0.105.7
main: it does not depend on #5375, #5376, or #5382, uses no sessions API, and merges to
main today. The dependency runs the other way: if the train merges first, ten files
conflict, all of them the machinery this document recommends dropping, and everything
else rebases clean.
