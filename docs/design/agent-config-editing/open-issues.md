# Open issues and deferred work

Each entry records what was deferred, why, and where it came from, so a future
reader can act on it cold.

## Teach the agent WHEN to commit, not only HOW

- Deferred by: Mahmoud, 5 August 2026, during the PR #5733 briefing review.
- Context: the whole current effort makes the commit tool cheap and safe to use
  (the HOW). The build-an-agent skill and the tool instructions say nothing about
  judgment: when a change deserves a commit at all, when to batch several edits
  into one commit, when to ask the user first, when a test run should precede a
  commit. Today's playbook says "verify after every commit", which is a workaround
  for missing validation, not guidance on timing.
- The ask: after v1 ships, design the WHEN guidance into the build-an-agent skill:
  commit granularity, batching, ask-first cases, and how the agent should reason
  about draft state and pending user edits before committing.
- Not now because: v1's scope is the mechanics, and the usability spike's
  instruction budget work shows guidance must be measured, not written from
  intuition. The spike harness is reusable for testing WHEN-guidance wording.

## Live tool updates for Pi and Claude (shelved machinery)

- Deferred by: Mahmoud's uniform-reopen decision, 5 August 2026.
- What exists: the runner-spike verdicts (Claude handles list_changed, blocked
  only by our shim's missing capability flag; Pi has live registerTool /
  setActiveTools, blocked only by our env-var delivery), and the
  untrusted-acknowledgement design in contracts/adapter-matrix.md §4.3.
- Insertion points, named so enabling later is cheap: the capability entry per
  adapter (flip reopen-session to apply-live), the shim capability flag
  (tool-mcp-stdio.ts advertise + notify), a runner-written specs file plus an
  extension hook for Pi (replaces AGENTA_AGENT_TOOLS_PUBLIC_SPECS).

## Codex upstream: live MCP tool updates

- Status: source check ran 5 August (see spikes/runner-spike.md, "Codex upstream
  check" section, drafted issue inside). Filing upstream requires Mahmoud's
  explicit approval. Until then Codex stays reopen-session, which is also the
  uniform v1 route for every harness.

## Embedded (referenced) skills have no stable key

- Deferred at the phase 1 review. An @ag.embed skill cannot be addressed by name;
  editing it needs the legacy whole-list write. Needs a stable raw reference key
  design. Low urgency while embeds are rare in agent configs.

## Build kit injects a standing section into the instruction file

- Deferred by: Mahmoud, 5 August 2026, during the briefing review.
- The ask: playground runs get a short, always-present block injected into the
  agent's instruction file, telling the agent it can edit itself and pointing at
  the read and commit tools. Same never-persisted property as the rest of the
  build kit.
- Design point to settle when building: the injected block must be invisible to
  commits and to text-edit anchoring, so the agent never commits the kit's words
  into its stored instructions. Candidate: inject as a separate overlay file the
  harness reads, not as text inside the stored instruction document.
- Recorded together with the WHEN-to-commit skill guidance in the RFC artifact,
  section 9.

## Build mode shows no readable approval card

- Found by: engine-2 during S3b, 5 August 2026. Pre-existing dock behavior.
- CLOSED at the final review, 5 August 2026 (finding 4): the dock now renders the
  frozen-content manifest in its fallback branch, so Build mode and the
  entity-less host always show the files, digests, and diff next to the payload.
  The larger question (running the full specialized card body in Build mode)
  stays open as a UX decision; the contract's "a human approves a readable
  change" rule no longer depends on it.

## Shadow router logs a permanent DISAGREE for rebuilt reopen facets

- Found by: the final review fix round, 5 August 2026 (while narrowing live
  routes, finding 3).
- The four facets that reopen-session would cover now escalate to rebuild, but
  `PlanOutcome` derives from `maxAction` and only `rebuild-sandbox` counts as
  "rebuild", so the shadow router logs `plan=reuse(reopen-session) DISAGREE` for
  them. `restart-runtime` produced the same permanent disagreement before this
  change; the semantics were left alone to avoid reshaping `buildPlan` and its
  shadow tests during the fix round.
- The ask: if the shadow counters are meant to be actionable signals, make
  `PlanOutcome` reflect the routed action, not `maxAction`.

## Pi refresh refuses any request that carries skills

- Decided at the final review fix round, 5 August 2026, taking the sound side.
- On Pi, `skillRootFor` returns undefined, so a workspace refresh cannot install
  skill directories. The refresh arm now refuses whenever the request carries
  skills on a Pi run, and the caller rebuilds. This over-refuses: a Pi run that
  has skills but changes only its instructions rebuilds where a refresh would
  have been enough.
- The ask: narrow the refusal to a real skills diff (request skills differ from
  applied skills) once a test asserts the installed skill tree on Pi.

## Cold-resume re-gate shipped without a Verdict source marker

- Decided at the final review fix round, 5 August 2026 (finding 8).
- The re-gate predicate infers "this allow came from a stored decision" from
  `effectivePermission(gate, plan) !== "ask"` being false, instead of a
  `source: "policy" | "stored"` field on `Verdict` (adding the field broke
  eleven exact-shape assertions in unrelated tests). The inference is sound
  today because exactly one path consults the stored-decision store. If a second
  stored-decision path ever appears, add the explicit field.

## Editing the workspace instructions file does not persist

- Found by: the UI E2E campaign (cell U7), 5 August 2026.
- A model asked to change its instructions edited the materialized workspace copy
  (AGENTS.md) with file tools. That copy is rebuilt from the stored configuration,
  so the approved edit silently disappeared. Guidance shipped in v1: both commit
  tool descriptions and the build-an-agent skill now state that workspace edits
  do not change the stored configuration.
- The ask, if it recurs: enforce rather than advise. Either mount the
  materialized instruction file read-only, or warn when a turn ends with
  uncommitted edits to it.

## Deny narration on ACP harnesses is harness-authored

- Found by: the UI E2E campaign (cell U5) and the runner fix round, 5 August 2026.
- Every runner-authored refusal string now states plainly that the user declined
  the specific change and that reshaped retries are pointless
  (src/tools/denial-text.ts). On the Claude and Codex ACP path, the text the
  model reads comes from the harness closing the call, not from the runner, so a
  misleading "blocked by policy" narration can still occur there.
- The ask: give the deny path a runner-owned message on ACP harnesses, or have
  the SDK render tool-output-denied with user-decline framing.
- Related: environment-setup.ts's "denied by policy" fires on a no-turn-wired
  race, not a denial; it needs its own message.

## Harness file tools do not expand environment variables in a path

- Found by: the Luna session triage (cfa9d1ed), 6 August 2026. Third
  harness-authored limit, beside the deny narration above.
- The harness's Read File tool fails on a literal `$AGENTA_AGENT_MOUNT_DIR`
  path while its Terminal tool succeeds with the same string. Both are the
  harness's own built-ins: the ACP gate reports
  `{"anchor":"Read File","executor":"harness","argKeys":["file_path"]}`, and
  `services/runner/src` neither implements nor wraps either one. Our shim serves
  only `mcp__agenta-tools__*`.
- Not a defect we can patch, and arguably not a defect at all. Terminal expands
  `$VAR` because a shell runs the command; a file API takes its path literally
  because no shell is involved. That asymmetry is normal for every such pair.
- Mitigation, shipped with the loud mount-skip work: wherever the runner authors
  text, it advertises the RESOLVED absolute path and never a variable name. The
  `"(also $AGENTA_AGENT_MOUNT_DIR)"` clause is gone from the agent-mount system
  prompt segment, which is where the model learned the variable. On Daytona that
  clause was doubly wrong: the runner never sets that variable there at all,
  because Daytona freezes the daemon environment at sandbox creation, so it
  expanded to the empty string.
- Residual: a model can still learn a variable name from the user, from its own
  earlier turns, or from a skill file we do not author, and hit the same
  asymmetry. Nothing in the runner can prevent that.

## A denied call and its identical-args sibling share one authorization pool

- Found by: the cold/warm lifecycle matrix work, 6 August 2026. Pinned by
  `tests/unit/execution-authorization.test.ts`, "still offers an approved set after
  its IDENTICAL sibling was denied".
- **Symptom.** A user denies one change, watches it happen anyway, and then sees the
  change they DID approve fail. Only possible when one turn raises two gates for the
  same tool with byte-identical arguments.
- **Mechanism.** A deny discards the denied call's records with `discardAll`, which is
  keyed by tool-call id, while `findSetByCall` matches on tool name plus args digest
  and deliberately ignores the id (the id is correlation, the digest is the binding,
  which is what makes an MCP relay under a fresh uuid work at all). Two identical
  gates are therefore indistinguishable to that lookup, so an execution arriving under
  the denied id consumes the approved sibling's set.
- **Cost to fix.** One decision and a few lines. Either a deny discards by name plus
  digest, poisoning identical siblings, or identical arguments are declared to make
  the distinction meaningless and the behaviour is documented as intended. The
  existing test inverts to match whichever is chosen.
- **Cost of NOT fixing.** Bounded and non-escalating: the bytes that run are the bytes
  a human approved, the set is single-use, and N approvals still permit exactly N
  executions. What is lost is WHICH call ran. A user who denies something and sees it
  succeed has no way to understand why, and no way to tell it apart from a bug that
  ignores denials entirely, which is the more alarming reading they will reach for.
- **Acceptance test.** Invert the existing unit test, then a live cell that raises two
  identical gates in one turn, denies the first, approves the second, and asserts the
  stored revisions match the decisions (one commit, carrying the approved call's id).

## The legacy delta classifier needs a decision: teach or retire

- Found by: the card fix round, 5 August 2026.
- classifyRevisionDeltaChanges in @agenta/entities reads only the legacy
  {set, remove} delta. The approval card now describes ordered operations
  through its own reader, so the classifier is effectively dead for agent
  commits (its one production caller). Either teach the package the ordered
  form deliberately, or retire the function when the legacy arm goes.

## The card cannot show which stored fields a wholesale write replaces

- Found by: the U10 post-mortem, 5 August 2026.
- The engine now refuses wholesale writes that touch platform-owned paths, and
  the card's Now/After blocks show the full old and new objects, so an omitted
  key is visible to a careful reader. The residual: for large objects a subtle
  omission is easy to miss. A card that lists the affected stored paths for a
  wholesale set would close the class.

## A pending approval dies silently when the user moves on (was "W11" in session notes)

- Found by: live QA session forensics, 5-6 August 2026; confirmed by the lifecycle
  trace and gate cell `matrix_l3`.
- **Symptom.** A user ignores an approval card and types something else. The card stays
  on screen in `approval-requested` forever. If they answer it later, nothing happens
  except that their session silently rebuilds cold and loses its warm state.
- **Mechanism.** At the next turn's start the runner sweeps unanswered approval rows to
  `cancelled` (`cancelStaleInteractions`), and the safety half is correct: the gated
  tool does not run, an unanswered approval is never consent. The wire protocol has no
  cancellation frame, so the frontend is never told, and a late answer feeds a decision
  into a gate that no longer exists (the session logs `approval-mismatch` and rebuilds).
- **Cost to fix.** Three independent layers, any prefix shippable, in increasing cost.
  (1) The frontend renders a swept row as cancelled, on poll or at the next turn's
  render. UI only, no protocol change. (2) The runner tells the model the approval
  lapsed so it can re-ask. Needs a message the model reads, and a decision about
  whether re-asking is desirable or annoying. (3) The gate re-issues automatically on
  the next turn. Needs the gate to be reconstructible, which is the part that is not
  free.
- **Cost of NOT fixing.** The product shows a control that does nothing, permanently,
  and punishes using it. This is a trust cost rather than a correctness one: nothing
  unsafe happens, but a user who answers a stale card pays a cold rebuild for it and
  is told nothing. It is also self-inflicted confusion during any demo where someone
  leaves a card unanswered.
- **Acceptance test.** `matrix_l3` already asserts the safety half (the tool does not
  run, the row ends `cancelled` rather than `pending`). Layer 1 adds a frontend test
  that a row swept to `cancelled` renders as cancelled without a reload. Layer 2 adds
  a live cell asserting the model's next message acknowledges the lapse rather than
  proceeding as though approved.

## The workspace live route is withdrawn; refresh-then-reopen is the follow-up

- Found by: gate cell `matrix_l5_live_route_observed.py`, 6 August 2026 (claude on
  local, reproduced three times). Fixed the same day as a release blocker.
- **Symptom.** A user edits their agent's instructions mid-conversation and the agent
  keeps obeying the old ones, with no error and no indication anything was ignored.
  The edit appears to save correctly. It takes effect only when something else
  happens to evict the session.
- **Mechanism.** The `workspaceFiles` facet was a live route: the runner rewrote
  `AGENTS.md` on the running sandbox and `applyReconcilePlan` committed the incoming
  configuration as applied, so the pool reported the new fingerprint and every later
  turn matched and continued warm. Every harness reads its instruction file once, at
  session start, so the rewritten file was never re-read and the model went on
  answering from the instructions the session began with.
- **Status: FIXED, and the fix is a switch.** `WORKSPACE_FILES_EDITS_REBUILD` in
  `services/runner/src/lifecycle/reconciliation-router.ts` defaults to `true`, so an
  instructions or skills edit rebuilds the sandbox and takes effect on the very next
  turn. **That constant is also the activation mechanism for the follow-up below:**
  both the capability table and `LIVE_ACTION_KINDS` derive from it, so proving an
  in-place route and turning it on is one flip rather than two edits that can
  disagree. Read the comment on the constant before flipping it.
- **The follow-up, and its two prerequisites.** Refresh the workspace and THEN reopen
  the session, so the new files are on disk before the harness reads them. Neither
  prerequisite may be assumed: the reopen must build its session init from the
  INCOMING request (today `env.reopenSession` closes over the init the environment was
  built with, so a reopen reinstalls the old MCP list, prompts and harness files, per
  `adapter-matrix.md` section 8 steps 1 and 2), and a workspaceFiles-only reopen must
  be proven rather than argued.
- **Cost to fix.** Real. Step 8's session-init work is the prerequisite, then the
  refresh-then-reopen sequencing, then a live proof. This is a performance
  optimisation, not a correctness fix: the product is CORRECT today and merely pays a
  sandbox rebuild for an instructions edit.
- **Cost of NOT fixing.** Every instructions or skills edit costs a sandbox rebuild,
  so the turn after an edit is slow. On a durable-cwd deployment it also costs a
  remount. Users who iterate on instructions feel this most, which is exactly the
  audience for a config-editing feature.
- **Acceptance test.** `matrix_l5_live_route_observed.py` passing live with ONE sandbox
  id, plus `matrix_l1_lifecycle_routes.py` confirming the route. L5 asserts the
  observation and only REPORTS the sandbox count precisely so it stays the acceptance
  test across a change of mechanism. A green unit suite is not acceptance here: the
  unit tests cannot tell whether a harness re-read a file.

## The Codex gate waits on a timer for arguments it should be handed

- Found by: the closing review of PR #5760, 6 August 2026.
- **Symptom.** None today, and that is the point: this is a latent failure with a
  measured margin, not an active bug. If it ever fires, a Codex approval mints no
  authorization and the commit the user approved dies with `authorization_missing`.
- **Mechanism.** On Codex the permission request can arrive before the `tool_call`
  update that carries the arguments, so `awaitRecordedToolCallArgs` polls the recorded
  call for up to `RECORDED_TOOL_CALL_WAIT_MS` (750ms) before the gate reads them. It is
  a timing workaround: a stack slow enough to miss the window falls through with
  `undefined` arguments, the marker scan finds nothing, and the gate mints nothing.
- **Cost to fix.** Moderate and structural rather than fiddly. Either take the
  arguments from the event that already carries them (removing the race instead of
  racing), or make the wait a hard requirement that fails LOUDLY on timeout instead of
  proceeding with `undefined`. The second is much cheaper and converts a silent
  mis-mint into a visible refusal.
- **Cost of NOT fixing.** Every Codex approval pays up to 750ms of latency it does not
  need. The margin is wide today (measured at 28ms in practice) and it is invisible
  when it closes: the failure looks exactly like the `authorization_missing` bug we
  already chased once through two incorrect fixes, so it would cost that debugging
  time again.
- **Acceptance test.** Unit: force the recorded args to arrive after the deadline and
  assert the gate REFUSES loudly rather than minting nothing. Live: the Codex arm of
  `matrix_w7_per_harness.py` still green, since it exercises the real ordering.

## Gateway and workflow tool failures carry no `next_step`

- Found by: the API migration's step-8 live proof, 6 August 2026.
- **Symptom.** A model whose Composio or workflow tool call fails is told what went
  wrong but not what to do about it, so it guesses: it retries the same call, reshapes
  the arguments at random, or tells the user the tool is broken. A model whose
  PLATFORM op fails (read_config, commit_revision) gets a `next_step` and recovers in
  one turn. The two feel like different products.
- **Mechanism.** The migration's envelope (`{code, message, retryable, next_step,
  details}`) is emitted by the platform HANDLERS. The tools router's other two
  producers do not use it: the gateway arm sends `ToolExecutionResponse` (`{data,
  error, successful}`) with the upstream reason in `status.message`, and the
  workflow-tool arm sends the workflow's own `outputs`.
- **Cost to fix.** Per-arm and mostly about vocabulary rather than plumbing. The
  transport already works (both arms already answer 200 with `STATUS_CODE_ERROR`, and
  the runner already surfaces that as a tool error carrying the text). What is missing
  is a `code` and a `next_step` for each failure a gateway can produce, and the
  upstream reasons are third-party strings we do not control, so the mapping is a
  judgement call per integration rather than one rule.
- **Cost of NOT fixing.** Bounded. The model still receives the upstream's own reason,
  which is often actionable, and the failure is visibly a failure since the runner
  marks it `isError`. The cost is the recovery rate on tool failures, which is exactly
  what the one-shot success bar measures, and an inconsistency a user notices as
  "sometimes it fixes itself and sometimes it flails".
- **Acceptance test.** A benchmark cell rather than a unit test: force a Composio call
  to fail with a correctable argument error and measure whether the model recovers in
  one turn. Unit tests can only pin the shape, and the shape is not the question.

## The marker caps are removed; the approval card collapses instead

- Ruled by Mahmoud, 6 August 2026, on US-3. Recorded here so the removal is a
  decision rather than a surprise when it lands.
- What the code actually has, because the two numbers are different mechanisms
  and only one of them is a marker cap. `MAX_MARKERS_PER_CALL = 8` in
  `services/runner/src/tools/commit-authorization.ts` is the cap the ruling is
  about: it refuses a commit referencing more than eight files. The "32 per turn"
  is `DEFAULT_MAX_TURN_ENTRIES = 32` in
  `services/runner/src/tools/frozen-value-store.ts`, which bounds how many frozen
  values a turn may hold. That is a store capacity, protecting memory and value
  lifetime, not approval-card readability.
- The readability cap exists to keep an approval card legible, not to bound work:
  the byte bounds are what protect the server.
- The ruling: the 8-per-call CAP GOES. A legitimate change can touch more than eight files,
  and a refusal that says "the limit is 8" asks the agent to split a coherent
  change into arbitrary pieces, each needing its own approval. The readability
  problem belongs to the card, so the card collapses a many-file change (a
  summary line the human expands) instead of the server refusing it.
- Byte bounds STAY. They are the real resource protection and are unaffected.
- The frozen-value store's 32-entry turn capacity is NOT obviously in scope and
  should be decided separately: removing it trades memory rather than
  readability, and a turn that freezes unbounded values is a different risk from
  a card that lists too many rows.
- Sequencing: this is flag-on surface, so it is queued POST-RELEASE. Do not
  remove the caps while the approval card still renders one row per file, or the
  first large commit produces a card no human can read, which is the failure the
  caps were standing in for.

## A call naming a file that does not exist is refused as a DENIAL, not as a mistake

- Found by: the marker-detail work, 6 August 2026 (PR #5760). The structured reason is
  now carried to the operator log; this entry is the model-facing half, which was
  deliberately deferred rather than forgotten.
- **Symptom.** An agent copies a skill folder into `.agenta-imports/`, references a
  path that does not match where the file landed, and is told its change was DENIED.
  It reasonably concludes a human refused, apologises, and stops. It is never told the
  path was wrong, and it is never shown the directory listing that would name the
  correction. Observed in the G1 gate cell: one pi_core trial out of three failed
  exactly this way.
- **Mechanism.** Marker resolution runs when the gate is RAISED, so an unresolvable
  path fails before any card is shown, and the runner answers the harness with a
  permission `reject`. The ACP permission reply is `"once" | "always" | "reject"`, a
  bare enum with no room for text, so the reason cannot ride it and the harness
  authors whatever the model reads.
- **Cost to fix.** The honest fix is not small, and the cheap one is wrong. Validate
  the marker paths BEFORE raising a gate, and answer a bad path as an ordinary tool
  error rather than asking a human about a call that cannot execute. That is
  semantically right (a call naming a nonexistent file never needed a human decision)
  and it moves a security-relevant ordering, so it needs care. The cheap alternative,
  allowing the gate so the call reaches the relay where we author the result, was
  considered and REFUSED: on a non-Pi harness the relay guard passes `ask`, so it
  would rest the whole fail-closed property on the authorization check alone.
- **Cost of NOT fixing.** Bounded but expensive where it lands. Nothing unsafe happens:
  the call does not run, and the reader already computes `available`, the entries that
  DO exist under the import root, which usually names the fix. The cost is that a
  recoverable mistake reads as a human refusal, so the model stops instead of
  retrying, and the user sees an agent that gave up for no visible reason. It is a
  direct hit on the one-shot success bar.
- **Acceptance test.** Live: the failing G1 trial shape, an agent that copies a
  directory and then references a path inside it that does not exist, recovering
  within the same turn sequence. Unit tests can pin that the error reaches the model
  with `available` in it, but only the live cell answers whether the model acts on it.

## A client tool that the browser fulfilled is recorded as `cancelled`

- Found by: the open-issues audit, 6 August 2026. Runner side confirmed by reading the
  code; the API side is not visible from the runner and should be checked before
  fixing.
- **Symptom.** A client tool runs correctly. The browser fulfils it, the model gets the
  result, the turn succeeds. The stored interaction row for that tool then says
  `cancelled`, so the audit trail claims a tool was abandoned when it actually ran.
  Anyone reading session history to reconstruct what happened is misled.
- **Mechanism.** `pauseClientTool` creates the interaction row with
  `onCreateInteraction(..., "client_tool", ...)` and never resolves it: the runner's
  single `resolveInteraction` caller sits on the APPROVAL path
  (`resolveAfterReply`, reached only from `replyPermission` and `rejectRequest`), and
  its emitted event is hard-coded `kind: "user_approval"`. The row therefore stays
  `pending` through fulfilment, and the next turn's `cancelStaleInteractions` sweeps
  every prior-turn pending row to `cancelled`.
- **Cost to fix.** Small if the fulfilment path already has the token, which is the
  thing to check first: the client-tool relay knows the tool call it is answering, so
  resolving the row when the browser's result arrives is the natural place. The event
  kind is currently hard-coded to `user_approval` and would need to carry the real
  kind. Confirm the API's resolve endpoint accepts a client-tool resolution before
  assuming the shape.
- **Cost of NOT fixing.** No functional impact: the tool ran, the model got its result,
  nothing is unsafe and no user-facing surface reads this row today. The cost is
  entirely in forensics, and it is the kind that bites at the worst time. We have
  twice debugged live failures by reading stored interaction rows, and a row that says
  `cancelled` for a tool that ran would have sent that reading in the wrong direction.
- **Acceptance test.** Drive a client tool to completion, then start a second turn, and
  assert the stored interaction row for the first tool is `resolved` (or whatever the
  fulfilled state is named) rather than `cancelled`. `matrix_l4_client_tool_lifecycle.py`
  already drives the round trip and asserts the row is stored, so it is the natural
  home for the extra assertion.
