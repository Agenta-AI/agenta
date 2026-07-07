# Status — source of truth

**State: DESIGN DRAFT — review round 1 folded in; next step: draft PR for Mahmoud's
review.**

Do not start implementation until Mahmoud reviews and approves this design (the
plan-feature → draft-PR → review workflow). This file is the single source of truth for
project state; if it disagrees with any other note, this file wins.

_Last updated: 2026-07-07._

## Where things stand

- Research complete and re-verified against the working tree (see research.md, dated
  2026-07-07). Every plan claim is cited to `file:line`.
- Plan drafted (plan.md), phases A–F.
- **Adversarial review round 1 complete** (UX + correctness): UX verdict
  SOUND-WITH-CHANGES, correctness verdict RETHINK-narrowly — one scope defect, mechanism
  sound. **All findings are folded into this revision** (see "Review round 1" below); the
  scope defect (blocker C1) is fixed in context.md D2 and plan.md Phases B–D/F.
- No code written for this project yet. **No git/but/gitbutler writes have been made by
  the planning agent.**
- **Next step:** open the draft PR carrying this workspace for Mahmoud's review.

## Review round 1 (folded into this revision)

**Blocker C1 (correctness scope defect — FIXED in this revision).** The original plan said
"FE work stays on `application_*`", but the FE read paths never read the `workflow_*`
reference family, and agent-created triggers store `{workflow_variant: {id}}`
(op_catalog.py:1128-1130, :1140-1142). The `fe4a01f` pin masked this by writing
`workflow_revision`, which the drawers do read. Post-revert, agent triggers would have
prefilled null, blocked name-only edits, and shown "-" in the settings list. The design
now requires **one shared prefix-symmetric classifier** (prefixes `application` /
`workflow` / `evaluator`, mirroring the backend's own detection at
`api/oss/src/core/triggers/service.py:782-789`) used by both drawers and both settings
sections — context.md D2/D3/D4, plan.md cross-phase invariant + Phases B–D, and a
`{workflow_variant} → Latest` unit-test case in Phase F. Resubmit was verified already
prefix-safe (edit-without-repick echoes stored refs verbatim); an active re-pick rewrites
to `application_*`, accepted as a silent prefix migration.

**UX changes folded:** settings list must classify + resolve names via the same
classifier (U4 → D4/Phase D); Latest hint copy tightened to *"Always runs the newest
committed revision of this variant (ignores environments)"* to disambiguate from
Deployed (U2 → D1/Phase B); the default-mode decision is now an explicit open question,
not silently decided (U3 → below); two pre-existing dangling-ref render gaps acknowledged
as non-goals so they aren't mistaken for regressions (U5 → context.md non-goals).

**Corrections folded:** the 422 "500 gap" was subscription-endpoints-only — schedules
already had the handler at router.py:1283-1284 / :1379-1380 (C5 → research.md §3);
the `commit_revision` description fix is a **correctness fix**, actively wrong for the
common agent case post-revert, not polish (C4 → research.md §9, plan.md Phase E); the
explicit-revision-untouched keeper tests added to the Phase A3 keep-list, noting the
subscription twin doesn't exist yet and should be added (C6 → plan.md A3).

## Existing lanes / PRs this project touches

- **PR #5103 / lane `fix/trigger-revision-default-head`** — added the create-time pin
  (commit `fe4a01f`). **This project reverts the pin and repurposes this PR as the
  backend implementation PR** (Phase A). Retitle it to describe follow-latest, not
  pinning.
- **PR #5105 lane** (op catalog) — Phase E correctness fixes ride here.
- **PR #5106 lane** (build-an-agent skill / `agenta_builtins.py`) — Phase E re-verify /
  align here.
- **Issue #5110** (jp) — deliveries recording which revision ran. **Out of scope**
  (non-goal). Latest triggers resolve HEAD at fire time; the delivery record does not yet
  capture the resolved revision.

## Open questions for Mahmoud

1. **Default mode when a concrete revision is in context (U3 — his call, not decided).**
   Recommendation: new triggers default to **Latest**; but when the drawer opens from a
   context carrying a concrete revision (e.g. the playground positioned on a revision —
   the current create-mode default-bind at `TriggerScheduleDrawer.tsx:496-507` discards it
   and hardcodes `revision: 0`), should it open **Pinned** pre-selected to that revision?
   Recommended: yes. Context.md D1 has the full framing; plan.md Phase C implements
   whichever he picks.
2. **Marker** — confirm we do **not** add an explicit `binding:"latest"` wire marker now,
   relying on absence-of-revision as the policy signal (context.md D2). Flagged as the
   decision most worth a second opinion.
3. **Rail choice** — confirm the third-peer-rail-item recommendation ("Latest | Pinned |
   Deployed") over a picker leaf or a checkbox (context.md D1).
4. **Cascader scoping** — confirm deferring the unscoped-picker fix to a follow-up issue
   (context.md D5).

## Contradictions found vs. the original research brief

Re-verification agreed with the brief on all substantive backend/FE behavior. Citation
corrections (behavior unchanged):

1. **Settings-list path.** The sections live under a `components/` subfolder:
   `web/oss/src/components/pages/settings/Triggers/components/GatewaySchedulesSection.tsx`
   (not `.../Triggers/GatewaySchedulesSection.tsx`). "Bound workflow" column is at
   `:112-129` (title `:113`, render `:116-127`).
2. **Cascader scoping site.** The unscoping is `applicationRevisionAdapter` built on
   `appWorkflowsListQueryStateAtom` (schedule `:66-68`, subscription `:92`), not
   `workflowRevisionRelationAdapter.ts:391-401` (that region is unrelated JSDoc).
3. **422 scope.** The pre-existing 500 gap was on the subscription endpoints only; the
   schedule endpoints already handled `TriggerReferenceInvalid` → 422 (review C5).

Also confirmed, resolving open questions in the brief:

4. **Reference prefix.** The drawers and `buildRunVersionReferences` *write* the
   `application_*` family. Agent-created (op-catalog) triggers *store* `workflow_*`. The
   backend is prefix-agnostic — but the FE **reads** were not, which became blocker C1
   (see "Review round 1" above). FE reads are now specified prefix-symmetric.
5. **EntityPicker value support.** `UnifiedEntityPicker` already exposes `selectedValue` /
   `selectedParentId` / `selectedChildId` / `displayRender` — the drawer just never passes
   them, so displaying the current binding (Phase C) is wiring, not new picker work.
6. **`agenta_builtins.py` trigger wording.** No "does not follow later commits" text
   currently exists in the trigger sections (grep clean); only the op catalog carries it.
   Phase E's skill step is a re-verify, not a guaranteed edit.

No finding contradicts the brief's core claim that the backend already follows-latest and
the pin must be reverted.
