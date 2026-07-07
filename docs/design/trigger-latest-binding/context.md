# Context: Trigger "Latest" binding

## The problem

A trigger (a cron **schedule** or a provider-event **subscription**) binds to a workflow
so it knows what to run when it fires. Today a trigger can bind three ways in intent, but
the product only exposes two:

- **Pinned** — run one exact revision, frozen. The UI supports this.
- **Deployed** — run whatever revision is deployed to an environment. The UI supports
  this.
- **Latest** — run the newest revision of a variant, re-resolved on every fire. **The UI
  cannot express or render this**, even though the backend already implements it.

The backend follows-latest whenever the stored references name a variant (or artifact)
but no revision: the dispatcher rebuilds the invoke request from the *raw stored
references* on every fire, and the workflow service resolves the variant HEAD fresh when
no revision ref is present (see research.md §1). Agent-created triggers already rely on
this — the `create_schedule` / `create_subscription` ops context-bind only the variant id.

Three things broke because the frontend never modeled Latest:

1. **The FE mis-renders a variant-only trigger.** Edit-prefill takes the variant id out of
   `application_variant.id` and feeds it to revision-only selectors, which return null, so
   the "Which version runs?" section shows an empty "Select workflow revision" placeholder
   under a required asterisk — as if the trigger had no binding, when it has a perfectly
   valid follow-latest binding.

2. **The FE read paths never read the `workflow_*` reference family** — and agent-created
   triggers store exactly `{workflow_variant: {id}}` (research.md §10). The drawer
   prefills read `application_revision ?? application_variant ?? workflow_revision`; the
   settings list reads `application ?? application_variant ?? application_revision`.
   Neither reads `workflow_variant`. The `fe4a01f` pin "fixed" agent triggers only
   because, being prefix-agnostic, it wrote `workflow_revision` — which the drawers DO
   read. So a plain revert with `application_*`-only FE work would leave an agent trigger
   prefilling null, rendering the empty required picker, blocking even a name-only edit
   on submit validation, and showing "-" in the settings list. The FE classifier must be
   **prefix-symmetric** (decision D2).

3. **A backend workaround was added to hide those FE gaps.** Commit `fe4a01f` (lane
   `fix/trigger-revision-default-head`, PR #5103) made `_validate_references` **pin** a
   bare variant reference to its current HEAD revision at create/edit time, so the FE
   always receives a revision key it reads. That freezes follow-latest at save time — it
   trades a correct-but-unrendered binding for a wrong-but-rendered one. It must be
   reverted; the fix belongs on the frontend (render Latest, read all prefixes), not on
   the write path.

## Goals

- Add a first-class **Latest** binding mode to both trigger drawers: the user picks a
  variant and the trigger follows its newest revision, resolved at each fire.
- Correctly **round-trip** all three modes through create → edit → save without losing or
  corrupting the binding — **for every reference prefix the backend accepts**
  (`application_*`, `workflow_*`, `evaluator_*`), so agent-created triggers render too.
- **Revert** the create-time pin so variant-only means follow-latest again, while keeping
  the unrelated-but-good fix from the same lane (typed `TriggerReferenceInvalid` → HTTP
  422 on the *subscription* create/edit endpoints, which previously surfaced 500s; the
  schedule endpoints already had the handler — research.md §3).
- **Render** Latest triggers honestly in the settings list ("Bound workflow" column),
  using the same prefix-symmetric classifier as the drawers.
- **Fix the wording** in the op catalog: post-revert, the `commit_revision` description's
  claim that "existing schedules and subscriptions keep pointing at the old revision" is
  actively wrong for the common agent case (a variant-bound self-schedule DOES pick up
  the new commit). This is a correctness fix, not polish (research.md §9).

## Non-goals (explicitly out of scope)

- **Recording which revision actually ran on each delivery** — issue **#5110**, assigned
  to jp. Latest triggers resolve HEAD at fire time; the delivery record does not yet
  capture the resolved revision. Out of scope here; mentioned so a reader does not expect
  it.
- **Scoping the settings-mode picker to the trigger's own app.** The Pinned/Latest picker
  in settings lists *every* application workflow in the project (unscoped) — part of the
  "weird options" complaint. Real, but orthogonal to Latest. **Defer to a follow-up
  issue** to keep this PR tight (see decision D5).
- **Two pre-existing dangling-reference render gaps** (acknowledged so they are not
  mistaken for regressions from this work): a **Pinned** trigger whose revision was
  archived renders an empty picker, and a **Deployed** trigger whose environment was
  deleted renders a blank select. Both predate this project and are unchanged by it.
- **A data migration.** None is needed (see decision D6).
- **A new wire field / explicit binding marker.** Considered and declined for now
  (see decision D2).

## Design decisions

### D1 — UX: a third rail item ("Latest" | "Pinned" | "Deployed")

The "Which version runs?" control is a left rail of mutually exclusive modes with a
mode-specific control on the right (`RunVersionField.tsx`). Today the rail has two items:
`Pinned` (a workflow→variant→revision cascader) and `Deployed` (an environment select).

**Recommendation: add a third peer rail item, `Latest`.** Order: `Latest | Pinned |
Deployed`.

Why a peer rail item rather than a leaf inside the Pinned picker or a checkbox:

- The three modes are three **binding policies** (follow-head / frozen / follow-deployment).
  A rail already means "pick a policy." Making Latest a peer keeps the policy explicit and
  visible, and it round-trips cleanly because the mode is derivable from the stored
  reference shape.
- A "Latest revision" *leaf inside the Pinned cascader* would bury the policy inside a
  tree whose other leaves are frozen revisions, and it complicates the picker's value
  model (a variant node and a revision node mean different things). Rejected.
- A *checkbox* ("follow latest") is a hidden modifier on Pinned; users miss it and it
  muddies the "one control, one policy" model. Rejected.
- Note **Deployed is already a kind of "floating" binding** — it also re-resolves at fire
  time, just against an environment instead of a variant HEAD. Latest is the variant-HEAD
  sibling of that idea, so a third peer is conceptually consistent.

Copy:

- **Latest** — hint: *"Always runs the newest committed revision of this variant
  (ignores environments)."* The parenthetical disambiguates from Deployed, which is also
  a floating binding. Right-side control: a variant picker (workflow → variant; no
  revision leaf). The selection resolves to the variant node.
- **Pinned** — hint (unchanged): *"Runs one exact variant + revision."* Cascader unchanged.
- **Deployed** — hint (unchanged): *"Follows the revision deployed to an environment."*

**Default mode — OPEN QUESTION for Mahmoud (do not decide silently).** Recommendation:
new triggers default to **Latest** (the most common intent and the shape agent-created
triggers already use). But when the drawer opens from a context carrying a *concrete
revision* — e.g. the playground positioned on a specific revision — should it instead
open **Pinned**, pre-selected to that revision? Note the current create-mode default-bind
already discards the revision context (it seeds the selection with the variant id and a
hardcoded `revision: 0` — `TriggerScheduleDrawer.tsx:496-507`). Recommendation: **yes**,
honor a concrete revision context as Pinned-preselected; plain contexts default to
Latest. Flagged as Mahmoud's call in status.md.

Implementation note: `buildRunVersionReferences` already emits a variant-only ref when the
selected leaf id equals the variant id (`isRevision = !!meta.variantId && leafId !==
meta.variantId`, research.md §4). So "Latest" is largely a matter of letting the user
*select the variant node* and tagging the mode, not new reference-assembly logic.

### D2 — Reference shape: no new field; absence of a revision ref IS the policy; reads are prefix-symmetric

Classified by semantic role (per the design-interfaces skill), all three are
**routing / binding-policy** references, owned by the trigger author, changed only on
edit:

| Mode     | Submitted references (FE drawers)                     |
|----------|-------------------------------------------------------|
| Latest   | `{application: {id}, application_variant: {id}}`       |
| Pinned   | `{application: {id}, application_revision: {id}}`      |
| Deployed | `{environment: {slug}, application: {slug}}`           |

The **absence of a revision reference is the follow-latest signal.** This is already the
contract the backend enforces (`_ensure_request_revision` resolves HEAD when
`request.data.revision` is absent and no revision ref is present — research.md §1). No new
field is required.

**Prefix rule — writes are `application_*`, reads are prefix-symmetric.** The trigger
drawers and `buildRunVersionReferences` *write* the `application_*` family. But
agent-created triggers *store* `workflow_variant` (research.md §10), and the backend is
prefix-agnostic — it detects the prefix among `application` / `evaluator` / `workflow`
(`api/oss/src/core/triggers/service.py:782-789`) and follows-latest identically for all.
So every FE **read path** (drawer prefill, settings-list rendering) must classify with
**one shared prefix-symmetric classifier**, mirroring the backend's own prefix detection:

> for `prefix` in `{application, workflow, evaluator}`:
> `{prefix}_revision` present → **Pinned** carrying that revision id;
> `{prefix}_variant` present with no `{prefix}_revision` → **Latest** carrying that
> variant id; `environment` present → **Deployed**.

This classifier is shared by both drawers AND both settings sections (plan.md Phases
B–D). An earlier draft of this decision said "FE work stays on `application_*`" — that
sentence encoded the agent-trigger rendering bug and is retracted.

**Accepted silent prefix migration on re-pick.** The resubmit path is already safe:
editing without re-picking echoes the stored references verbatim
(`RunVersionField.tsx:63` `fallbackReferences`, fed from the stored refs at
`TriggerScheduleDrawer.tsx:622` / `TriggerSubscriptionDrawer.tsx:697`), so a
`workflow_variant` trigger keeps its shape across a name-only edit. An active re-pick in
the drawer rewrites the references to `application_*` — harmless, since the backend is
prefix-agnostic. We accept this as a deliberate, silent prefix migration on user edit; no
code needs to preserve the `workflow_*` prefix on write.

**The marker question (flagged explicitly).** Should Latest carry an explicit marker, e.g.
`binding: "latest"`, instead of relying on the absence of a revision ref?

- **Recommendation: no, not now.** The shape is already unambiguous and the backend
  already keys off it. A marker would be a *second* source of truth for one policy and
  could drift from the ref shape (the classic two-fields-one-fact bug).
- The one real risk the marker would remove: a future reader (human or code) misreading
  variant-only as "incomplete / binding not finished" rather than "intentionally latest."
  That is exactly the misread that produced the `fe4a01f` workaround. **But the correct
  remedy for that is FE rendering** — show a "Latest" tag so the binding reads as
  deliberate — not a wire marker.
- **When to revisit:** if we ever need a policy that the ref shape *cannot* express — e.g.
  "freeze at the revision deployed at create time" (which is neither today's Pinned nor
  Deployed), or per-trigger opt-out of follow-latest while still naming a variant. At that
  point an explicit `binding` enum earns its keep. Until then, absence-of-revision is
  canonical and consistent with the rest of the workflow-invoke contract.

### D3 — Edit round-trip

Prefill must **classify the stored shape into a mode** via the shared prefix-symmetric
classifier (D2), instead of flattening everything into one revision-id field:

- `environment` ref present → **Deployed** (existing behavior, correct).
- `{prefix}_revision` present (any prefix) → **Pinned**; `workflowRevId = revision id`;
  the picker highlights it via `selectedValue` (the `EntityPicker` supports
  `selectedValue` / `displayRender` — research.md §7 — the drawer just never passes them).
- `{prefix}_variant` present (any prefix) with **no** revision → **Latest**; store the
  variant id in its own state (`variantId`), set mode to `latest`. **Do not** assign the
  variant id to `workflowRevId` (that is the current bug — research.md §5).

Switching modes rebuilds the correct references via `buildRunVersionReferences`. Submit
validation gets a `latest` arm (mode `latest` && no variant selected → "Pick a variant").

### D4 — Settings list rendering ("Bound workflow" column)

The column must use the **same shared classifier** as the drawers (D2) — so agent-created
`workflow_variant` triggers get a workflow name + Latest tag, not a bare id or "-". Then
resolve the display name and append a mode tag:

- Latest → `<workflow name>` + a `Latest` tag.
- Pinned → `<workflow name> · v<n>` (or just the name if the version isn't resolvable).
- Deployed → `<workflow name> @ <env>`.

Resolve the display name (workflow molecule `artifactName` / variant selectors, as the
drawers do) rather than showing a raw id; the raw-id rendering is part of what this
project fixes. If name resolution proves heavy in the table context, the floor is:
resolved-or-id **plus the mode tag**, never a bare undifferentiated id.

### D5 — Cascader scoping: defer

The settings-mode picker uses `applicationRevisionAdapter`
(`createWorkflowRevisionAdapter({workflowListAtom: appWorkflowsListQueryStateAtom})`),
which lists **every** application workflow in the project, unscoped to the trigger's app —
part of the "weird options" complaint. This is a pre-existing issue orthogonal to Latest.
**Defer to a follow-up issue.** Keep this PR tight.

### D6 — Migration / compatibility: none

- Triggers pinned by `fe4a01f` in the last day (dev stacks) carry an explicit
  `{prefix}_revision` (including `workflow_revision` for agent triggers). After the revert
  they simply render as **Pinned** via the prefix-symmetric classifier — correct and
  harmless; they stay pinned until re-pointed.
- Agent-created and pre-pin variant-only triggers become correctly-rendered **Latest**.
- A re-pick in the drawer silently migrates `workflow_*` refs to `application_*` (accepted
  — see D2).
- No stored data changes shape. **No migration.**
