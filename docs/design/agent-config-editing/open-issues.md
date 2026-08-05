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
