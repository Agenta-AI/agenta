# Context: Trigger "Latest" binding

README.md explains how trigger binding and fire-time resolution work. This file
explains why the project exists, what it will and will not do, and each design
decision with its trade-offs.

## The problem

A trigger can bind to a workflow in three ways. The product exposes two:

- **Pinned**: run one exact revision, frozen. The UI supports this.
- **Deployed**: run whatever is deployed to an environment. The UI supports this.
- **Latest**: run the newest revision of a variant, resolved at each fire. The backend
  supports this. The UI cannot express it, and it renders triggers that use it as
  broken.

Three frontend defects cause this:

1. **Edit mis-renders a variant-only trigger.** The drawer prefill takes the variant id
   from the stored references and puts it in a revision field. Revision lookups fail on
   a variant id, so the drawer shows an empty, required "Select workflow revision"
   field. The trigger has a valid binding; the UI says it has none. Saving is blocked,
   even for a name-only edit.

2. **The frontend never reads the `workflow_*` reference keys.** The drawers read
   `application_revision`, then `application_variant`, then `workflow_revision`. The
   settings list reads a similar chain. Neither reads `workflow_variant`. Agent-created
   triggers store exactly `{workflow_variant: {id}}`, so the UI treats them as unbound
   and the settings list shows "-".

3. **A backend workaround hid the frontend gaps.** PR #5103 made the create and edit
   endpoints pin a bare variant reference to its head revision at save time. The
   frontend then always found a revision key it could read. But the trigger stopped
   following new commits, which defeats the point of a variant-only binding. Mahmoud
   closed that PR on 2026-07-09. The pin commit still sits on its local lane; Phase A
   removes it.

The fix belongs on the frontend read paths, not on the backend write path.

## Goals

- Add a first-class **Latest** mode to both trigger drawers. The user picks a variant;
  the trigger follows its newest revision.
- Round-trip all three modes through create, edit, and save without corrupting the
  binding. This must work for every reference prefix the backend accepts
  (`application_*`, `workflow_*`, `evaluator_*`), so agent-created triggers render too.
- Keep the pin out of the codebase, and salvage the one good fix from the closed PR:
  the subscription create and edit endpoints should return 422, not 500, when a
  reference does not resolve. The schedule endpoints already return 422.
- Show Latest triggers honestly in the settings list, using the same classification
  logic as the drawers.
- Fix the SDK op-catalog descriptions. Without the pin, the claim that "existing
  schedules and subscriptions keep pointing at the old revision" is wrong for
  variant-bound triggers: they pick up new commits on the next fire. An agent that
  trusts the current text will reason wrongly about its own schedules.

## Non-goals

- **Recording which revision actually ran on each delivery.** Latest triggers resolve
  the head at fire time, and the delivery record does not capture the result. That is
  issue #5110, assigned to jp.
- **Scoping the version picker to the trigger's own app.** In settings, the picker
  lists every application workflow in the project. Real problem, unrelated to Latest.
  Deferred to a follow-up issue (decision D5).
- **Two pre-existing render gaps for dangling references.** A Pinned trigger whose
  revision was archived shows an empty picker. A Deployed trigger whose environment was
  deleted shows a blank select. Both predate this project and stay unchanged. Listed so
  nobody mistakes them for regressions.
- **A data migration.** None is needed (decision D6).
- **A new wire field or binding marker.** Considered and declined for now (decision
  D2).

## Design decisions

### D1: The control is a third rail item, "Latest | Pinned | Deployed"

The "Which version runs?" control (`RunVersionField.tsx`) is a left rail of modes with
a mode-specific control on the right. Today the rail has two items: Pinned (a workflow
to variant to revision cascader) and Deployed (an environment select).

We add Latest as a third peer item, first in the list. When selected, the right side
shows a variant picker: workflow, then variant, no revision level.

Why a peer item and not something smaller:

- The three modes are three binding policies: follow the head, freeze, follow a
  deployment. A rail already means "pick a policy". A peer item keeps the policy
  visible.
- A "Latest" leaf inside the Pinned cascader would bury the policy in a tree of frozen
  revisions, and it would give the picker two value types that mean different things.
  Rejected.
- A "follow latest" checkbox is a hidden modifier on Pinned. Users would miss it.
  Rejected.
- Deployed already re-resolves at fire time. Latest is the same idea aimed at a variant
  head instead of an environment, so a third peer reads as consistent.

Hint copy:

- Latest: "Always runs the newest committed revision of this variant (ignores
  environments)." The parenthetical separates it from Deployed, which also floats.
- Pinned (unchanged): "Runs one exact variant + revision."
- Deployed (unchanged): "Follows the revision deployed to an environment."

**Open question for Mahmoud: the default mode.** Recommendation: new triggers default
to Latest. It is the most common intent, and it is the shape agent-created triggers
already use. But when the drawer opens from a context that carries a concrete revision
(for example, the playground positioned on a specific revision), it should probably
open in Pinned with that revision pre-selected. Today the code discards that context
and hardcodes `revision: 0` (`TriggerScheduleDrawer.tsx:496-507`). Recommendation:
honor a concrete revision as Pinned; default to Latest everywhere else.

### D2: No new wire field; leaving out the revision IS the "latest" signal; reads accept all prefixes

The three modes map to three reference shapes the drawers submit:

| Mode     | Submitted references                              |
|----------|---------------------------------------------------|
| Latest   | `{application: {id}, application_variant: {id}}`  |
| Pinned   | `{application: {id}, application_revision: {id}}` |
| Deployed | `{environment: {slug}, application: {slug}}`      |

The absence of a revision reference means "resolve the head at fire time". The backend
already enforces exactly this contract (research.md §1). No new field is required.

**The marker question, flagged for Mahmoud.** Should Latest instead carry an explicit
marker, such as `binding: "latest"`? Recommendation: no, not now. The shape is
unambiguous, and the backend already keys off it. A marker would be a second source of
truth for one fact, and the two could drift apart. The one real risk of shape-only is
that a reader mistakes a variant-only reference for an unfinished binding rather than a
deliberate one. That exact misread produced the pin PR. The remedy is rendering: show a
Latest tag so the binding looks intentional. Revisit the marker only if we ever need a
policy the shape cannot express, for example "freeze at whatever was deployed when I
created this trigger".

**The prefix rule: write `application_*`, read every prefix.** The drawers write the
`application_*` family. Agent-created triggers store `workflow_variant`. The backend
accepts three prefixes (`application`, `workflow`, `evaluator`) and treats them alike
(`api/oss/src/core/triggers/service.py:782-789`). So every frontend read must classify
references through one shared, prefix-symmetric function:

> For each prefix in {application, workflow, evaluator}: a `{prefix}_revision` key
> means Pinned with that revision; a `{prefix}_variant` key with no `{prefix}_revision`
> means Latest with that variant; an `environment` key means Deployed.

Both drawers and both settings tables use this one function (plan.md, Phases B to D).
An earlier draft kept frontend work on `application_*` only. That draft encoded the
agent-trigger rendering bug and is retracted.

**Accepted: a re-pick silently migrates the prefix.** Editing a trigger without
touching the picker resubmits the stored references verbatim
(`RunVersionField.tsx:63`), so a `workflow_variant` trigger keeps its shape across a
name-only edit. If the user actively re-picks in the drawer, the references are
rewritten to `application_*`. The backend does not care, so we accept this instead of
adding prefix-preserving write logic.

### D3: Edit opens in the mode the stored shape implies

Prefill classifies the stored references with the shared function from D2, instead of
flattening everything into one revision-id field:

- An `environment` reference: open in Deployed. This already works.
- A `{prefix}_revision` reference, any prefix: open in Pinned, with that revision shown
  as selected in the picker. The picker component already supports showing a selected
  value (`selectedValue` / `displayRender`, research.md §7); the drawer just never
  passes it.
- A `{prefix}_variant` reference with no revision, any prefix: open in Latest with that
  variant selected. Do not put the variant id in the revision field; that is the
  current bug (research.md §5).

Switching modes rebuilds the references through `buildRunVersionReferences`. Submit
validation gains a Latest arm: Latest with no variant selected is an error ("Pick a
variant").

### D4: The settings list names the workflow and tags the mode

The "Bound workflow" column classifies with the same shared function, resolves the
workflow's display name, and appends a mode tag:

- Latest: workflow name plus a `Latest` tag.
- Pinned: workflow name plus `v<n>`, or just the name if the version cannot be
  resolved.
- Deployed: workflow name plus `@ <environment>`.

Today the column prints a raw id, or "-" for agent-created triggers. If name resolution
proves heavy inside the table, the floor is: resolved-name-or-id plus the mode tag.
Never a bare id with no tag.

### D5: Defer the picker-scoping fix

The settings-mode picker lists every application workflow in the project, not just the
trigger's own app. Real problem (part of the "weird options" complaint), unrelated to
Latest. Deferred to a follow-up issue to keep this project tight.

### D6: No migration

- Triggers that the closed PR's pin touched on dev stacks carry an explicit revision
  reference. They classify as Pinned, render correctly, and stay pinned until someone
  re-points them. Correct and harmless.
- Older variant-only triggers, including all agent-created ones, classify as Latest and
  finally render correctly.
- A re-pick in the drawer silently migrates `workflow_*` references to `application_*`
  (accepted, see D2).
- Stored data never changes shape. No migration.
