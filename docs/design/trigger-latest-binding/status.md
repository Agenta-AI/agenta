# Status: source of truth

**State: DESIGN DRAFT, awaiting Mahmoud's review on PR #5113.**

Do not start implementation until Mahmoud approves this design. This file is the single
source of truth for project state; if it disagrees with any other note, this file wins.

_Last updated: 2026-07-09._

## Log

- **2026-07-09**: Mahmoud closed PR #5103 (the create-time pin) as wrong behavior. The
  plan no longer repurposes that PR; Phase A now reworks the leftover local lane
  (`fix/trigger-revision-default-head`, which still carries the pin commit) and opens a
  fresh backend PR. Same day: the workspace docs were rewritten in plain language on
  Mahmoud's request. No design decision changed.
- **2026-07-07**: adversarial review round 1 (UX plus correctness) folded in. Research
  re-verified against the working tree; every plan claim cites `file:line`.

## Where things stand

- Research is complete and verified (research.md, dated 2026-07-07).
- The plan is drafted (plan.md, phases A to F).
- No implementation code has been written for this project.
- Next step: Mahmoud reviews the design and answers the open questions below.

## What review round 1 changed (summary)

The review found one real scope defect and several smaller fixes, all folded in:

- **The prefix gap (the review's blocker).** The original plan kept frontend work on
  `application_*` references only. But the frontend read paths never read the
  `workflow_*` family, and agent-created triggers store exactly
  `{workflow_variant: {id}}`. The pin PR had masked this by writing `workflow_revision`,
  a key the drawers do read. Without a fix, agent triggers would prefill null, block
  name-only edits, and show "-" in the settings list. The design now requires one
  shared prefix-symmetric classifier for every frontend read (context.md D2, plan.md
  Phases B to D), plus a `{workflow_variant} classifies as Latest` unit test (Phase F).
  Resubmit was verified safe: an edit without a re-pick echoes the stored references
  verbatim; an active re-pick rewrites them to `application_*`, accepted as a silent
  migration.
- **UX fixes.** The settings list must classify and resolve names with the same
  classifier. The Latest hint copy now says "(ignores environments)" to separate it
  from Deployed. The default-mode choice became an explicit open question instead of a
  silent decision. Two pre-existing dangling-reference render gaps are listed as
  non-goals so they are not mistaken for regressions.
- **Corrections.** The 500-to-422 gap was on the subscription endpoints only; schedules
  already had the handler. The `commit_revision` description fix is a correctness fix,
  not polish. The explicit-revision-untouched tests were added to the Phase A3 keep
  list, with a note that the subscription twin is missing and should be added.

## Lanes and PRs this project touches

- **Lane `fix/trigger-revision-default-head`**: carries the closed pin commit. Phase A
  reworks it (remove the pin, keep the 422 handlers, reshape the tests) and opens a new
  backend PR. PR #5103 itself stays closed.
- **PR #5105 lane** (op catalog): Phase E description fixes ride here.
- **PR #5106 lane** (build-an-agent skill): Phase E re-verify rides here.
- **Issue #5110** (jp): deliveries should record which revision actually ran. Out of
  scope here (non-goal).

## Open questions for Mahmoud

1. **Default mode on create.** Recommendation: new triggers default to Latest, but a
   drawer opened from a context that carries a concrete revision (for example, the
   playground positioned on a revision) opens Pinned, pre-selected to that revision.
   Today the code discards that context and hardcodes `revision: 0`
   (`TriggerScheduleDrawer.tsx:496-507`). Context.md D1 has the full framing; plan.md
   Phase C implements whichever he picks.
2. **Wire marker.** Confirm we do NOT add an explicit `binding: "latest"` field, and
   keep the absence of a revision reference as the signal (context.md D2). This is the
   decision most worth a second opinion.
3. **Rail choice.** Confirm the third peer rail item ("Latest | Pinned | Deployed")
   over a picker leaf or a checkbox (context.md D1).
4. **Picker scoping.** Confirm deferring the unscoped-picker fix to a follow-up issue
   (context.md D5).

## Citation corrections found during re-verification

Re-verification agreed with the original research brief on all behavior. Three
citations were corrected, with no behavior change:

1. The settings sections live under a `components/` subfolder:
   `web/oss/src/components/pages/settings/Triggers/components/GatewaySchedulesSection.tsx`.
2. The unscoped picker comes from `applicationRevisionAdapter` built on
   `appWorkflowsListQueryStateAtom`, not from `workflowRevisionRelationAdapter.ts`.
3. The 500 gap was subscription-endpoints only (see above).

Also confirmed while resolving the brief's open questions: the backend is
prefix-agnostic but the frontend reads were not (now the classifier requirement); the
`EntityPicker` already supports `selectedValue` / `displayRender`, so showing the
current binding is wiring, not new picker work; `agenta_builtins.py` has no freeze
language in its trigger sections today.
