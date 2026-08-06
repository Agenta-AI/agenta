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

- Found by: the cold/warm lifecycle matrix work, 6 August 2026. Now pinned by a test
  (`tests/unit/execution-authorization.test.ts`, "still offers an approved set
  after its IDENTICAL sibling was denied").
- The mechanism: a deny discards the denied call's own records via `discardAll`,
  which is keyed by tool-call id, while `findSetByCall` matches on tool name plus
  args digest and deliberately ignores the id (its header argues the id is
  correlation and the digest is the binding, which is what makes an MCP relay under
  a fresh uuid work at all). Two gates for the same tool with byte-identical
  arguments are therefore indistinguishable to that lookup, so an execution arriving
  under the DENIED id matches the APPROVED sibling's set and runs.
- Bounded, not an escalation: the bytes that execute are the frozen bytes the human
  approved, and the set is single-use, so N approvals still permit exactly N
  executions. What is not preserved is WHICH call ran — the user can deny a change
  and watch it succeed, while the call they approved then fails closed.
- The ask: decide whether a deny should poison identical siblings (discard by
  name+digest rather than by id) or whether identical arguments make the distinction
  meaningless by construction. Either answer is defensible; today's behaviour was
  never chosen, only inherited from the id-versus-digest split.

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
  trace and gate cell matrix_l3.
- At the next turn's start the runner sweeps pending approval rows to `cancelled`
  (cancelStaleInteractions), and the safety half is correct and now pinned: the
  gated tool does not run, an unanswered approval is never consent. The broken
  half is the surface: the wire protocol has no cancellation frame, so the
  frontend card stays in approval-requested forever, and a user who answers it
  after eviction feeds a decision into a gate that no longer exists (the session
  then logs approval-mismatch and rebuilds cold).
- The proposal awaiting a ruling, three independent layers, any prefix shippable:
  (1) frontend renders the swept row as cancelled (poll or on next turn render),
  (2) the runner tells the model the approval lapsed so it can re-ask,
  (3) optional automatic re-issue of the gate on the next turn.
- The ask: pick the layer set for v1. Layer 1 alone removes the stuck-card lie
  at UI cost only.

## The workspace live route is withdrawn; refresh-then-reopen is the follow-up

- Found by: gate cell `matrix_l5_live_route_observed.py`, 6 August 2026 (claude
  on local, reproduced three times). Fixed the same day as a release blocker.
- The `workspaceFiles` facet was live: an instructions edit rewrote `AGENTS.md`
  on the running sandbox, `applyReconcilePlan` committed the incoming
  configuration as applied, and every later turn then matched and continued warm
  while the model went on answering from the instructions the session started
  with. Installing is not observing: every harness reads its instruction file
  once, at session start. The user's edit was dead until something else evicted
  the session, and before the optimisation the same edit took effect on the very
  next turn.
- The fix: `workspaceFiles` routes to `rebuild-sandbox`, and `refresh-workspace`
  left `LIVE_ACTION_KINDS` so restoring the capability table on its own fails
  closed. An instructions edit costs a sandbox again. The applier in
  `apply-plan.ts` keeps the refresh arm, unreachable, because the follow-up needs
  exactly that write.
- The ask: refresh the workspace and THEN reopen the session, so the new files
  are on disk before the harness reads them. Two things must land first, and
  neither may be assumed: the reopen must build its session init from the
  INCOMING request (adapter-matrix.md §8 steps 1 and 2 — today `env.reopenSession`
  closes over the init the environment was built with, so a reopen would
  reinstall the old MCP list, prompts and harness files), and a workspaceFiles-only
  reopen must be proven on L5, which asserts the observation and only reports the
  sandbox count for exactly this reason.
- Two entries above are affected. "Pi refresh refuses any request that carries
  skills" is now moot in practice, since nothing routes to the refresh arm; it
  becomes live again the moment the follow-up ships. "Shadow router logs a
  permanent DISAGREE for rebuilt reopen facets" is why the fix moved the
  CAPABILITY TABLE rather than only dropping the kind from `LIVE_ACTION_KINDS`:
  dropping it alone would have left the router planning `refresh-workspace`
  (outcome `reuse`) against a coordinator that rebuilds, adding a fifth permanent
  false positive to that count.
