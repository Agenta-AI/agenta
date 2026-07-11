# Research: verified findings

All citations re-verified against the working tree on **2026-07-07**. Line numbers are
current as of that date. Each claim is grounded in a file read, not memory.

---

## 1. Backend already follows-latest for variant-only references

**The dispatcher rebuilds the invoke request from the RAW stored references on every
fire.** `api/oss/src/tasks/asyncio/triggers/dispatcher.py:224-268`:

- Lines 224-231 build `references` by dumping `entity.data.references` verbatim.
- Lines 262-268 construct `WorkflowServiceRequest(references=references, ...)`.

There is no revision resolution at store time in this path — it uses whatever is stored,
each fire.

**The workflow service resolves the variant HEAD fresh when no revision ref is present.**
`api/oss/src/core/workflows/service.py:701-751` `_ensure_request_revision`:

- Line 707-708: if `request.data.revision` is already set, return (nothing to resolve).
- Lines 726-736: an `environment` ref resolves the environment's deployed revision.
- Lines 738-744: otherwise a revision / variant / artifact ref is resolved via
  `retrieve_workflow_revision` — for a variant-only ref this returns the variant HEAD.
- Lines 746-751: the resolved revision is written into `request.data.revision` for this
  invocation only (not persisted back to the trigger).

**Conclusion:** a stored `{application_variant}` (no revision) is genuine follow-latest,
re-resolved every fire. An `environment` ref follows the deployed revision. This is the
behavior the feature surfaces in the UI.

---

## 2. The create-time pin to remove (commit `fe4a01f`, PR #5103)

**Update 2026-07-09: PR #5103 was closed unmerged (pinning is the wrong behavior). The
pin never landed on `big-agents`; it exists only on the local lane below. Phase A
removes it from that lane and opens a fresh backend PR.**

Lane `fix/trigger-revision-default-head`, commit **`fe4a01f1d2`** ("fix(api): pin trigger
references to the variant HEAD revision when none is given"). The commit touches three
files: `service.py` (+the pin), `router.py` (+422 handlers on the subscription
endpoints — KEEP, see §3), and the test file (reshape).

**The pin lives in** `api/oss/src/core/triggers/service.py` `_validate_references`:

- Docstring `:756-773` was rewritten to describe pinning ("A `{prefix}_variant` reference
  with no `{prefix}_revision` is pinned in-place to the resolved (HEAD) revision…").
- The pin block is **`:820-829`**:

  ```python
  if (
      environment_ref is None
      and workflow_variant_ref is not None
      and workflow_revision_ref is None
  ):
      references[f"{prefix}_revision"] = Reference(
          id=revision.id,
          slug=revision.slug,
          version=revision.version,
      )
  ```

**Revert target:** remove the `:820-829` pin block and restore the pre-`fe4a01f`
validate-only docstring (the old text: *"Assert the bound reference family resolves —
without pinning it. … we deliberately do NOT overwrite the stored references with the
resolved revision: an environment slug, or an artifact/variant without a revision, means
'resolve latest at trigger time.' … The dispatcher re-resolves from the raw references on
every fire … so latest-tracking is preserved."*). The full old docstring is recoverable
via `git show fe4a01f^:api/oss/src/core/triggers/service.py`.

The commit also extracted `workflow_variant_ref` / `workflow_revision_ref` into locals
(`:800-805`) that feed `retrieve_workflow_revision`. Those locals are harmless to keep;
the revert only needs to drop the pin block and fix the docstring. The `retrieve` call at
`:807-814` and the `revision is None → raise TriggerReferenceInvalid` guard at `:815-818`
stay (that is the graceful-failure validation, still wanted).

---

## 3. Keep the same lane's 422 fix (subscription endpoints only)

Also from `fe4a01f`, in `api/oss/src/apis/fastapi/triggers/router.py`:

- `create_subscription`: `TriggerReferenceInvalid` → `HTTPException(422)` at
  **`:1006-1007`**.
- `edit_subscription`: the service call was wrapped in try/except and
  `TriggerReferenceInvalid` → `HTTPException(422)` at **`:1126-1127`**.

**Scope correction (review round 1):** the 500 gap was on the *subscription* endpoints
only. The **schedule** endpoints already had `TriggerReferenceInvalid → 422` handlers
before `fe4a01f` — `create_schedule` at `router.py:1283-1284` and `edit_schedule` at
`:1379-1380` (each next to a `TriggerScheduleInvalid → 422`). Before this commit an
invalid reference on the subscription endpoints surfaced as a 500. **Keep both new
handlers.** They are independent of the pin and remain correct after the revert.

`TriggerReferenceInvalid` is imported at `router.py:49` and defined in
`api/oss/src/core/triggers/exceptions.py`.

---

## 4. Frontend reference assembly: `RunVersionField.tsx`

`web/packages/agenta-entity-ui/src/gatewayTrigger/drawers/shared/RunVersionField.tsx`.

- **Two-mode rail** at `:104-112`: `{value:"revision", label:"Pinned"}` and
  `{value:"environment", label:"Deployed"}`. Type `RunVersionBindMode = "revision" |
  "environment"` at `:10`.
- Pinned mode `:113-125`: hint text (default `"Runs one exact variant + revision."`, prop
  `revisionHint` `:79`) + an `EntityPicker variant="popover-cascader"` over the revision
  adapter. **The picker gets NO `value`/`selectedValue` prop** (`:118-124`) — it only
  shows a `placeholder`, never the current binding.
- Deployed mode `:126-140`: hint + an environment `Select`.
- **`buildRunVersionReferences` `:29-64`** assembles `data.references`:
  - `environment` mode `:44-51` → `{environment:{slug}, application:{slug}?}`.
  - `:52-62`: on a fresh pick with `workflowSelection.metadata`, `leafId =
    selection.id ?? workflowRevId`; **`isRevision = !!meta.variantId && leafId !==
    meta.variantId`** (`:55`). If `isRevision` → `{application:{id}, application_revision:
    {id:leafId}}`; else → `{application:{id}, application_variant:{id: meta.variantId ||
    leafId}}`.
  - `:63`: edit-without-repick fallback → `fallbackReferences ?? {application_variant:
    {id: workflowRevId}}`.

**Implication for Latest:** the assembly already emits a variant-only ref when the picked
leaf is the variant node. Latest mode mostly needs (a) a rail item, (b) a variant-level
selection, and (c) prefill/validation that recognize the mode — not a new branch in
`buildRunVersionReferences` (though a `latest` arm makes intent explicit and is cheap).

---

## 5. The edit-prefill bug (the core defect this feature fixes)

**Schedule drawer** `TriggerScheduleDrawer.tsx`:

- State `:381` `workflowRevId`, `:389` `bindMode` (`"revision" | "environment"`).
- Prefill `:456-479`: on edit, if `refs.environment` → Deployed mode (`:465-468`); **else**
  `:469-475` sets `workflowRevId = refs.application_revision?.id ?? refs.application_variant
  ?.id ?? refs.workflow_revision?.id ?? null`. So a variant-only trigger stuffs the
  **variant id** into `workflowRevId`.
- `workflowRevId` then feeds **revision-only** selectors `:397-413`:
  `workflowMolecule.selectors.artifactName(workflowRevId)`, `.variantLabel(workflowRevId)`,
  `.data(workflowRevId)`. A variant id is not a revision id, so these return **null**,
  `resolvedRevisionName` is null, and the picker shows its placeholder.
- The section header `:795` is `<RequiredTitle>Which version runs?</RequiredTitle>`
  (required asterisk via `RequiredTitle` `:71`), status `warning` when `versionChosen`
  is false (`:796`, `versionChosen` computed `:700`).
- Picker placeholder `:804-810`: `workflowLabel ?? resolvedRevisionName ?? "Select
  workflow revision"`. With both null → the empty "Select workflow revision" placeholder
  under a required asterisk, even though a valid follow-latest binding exists.
- Submit validation `:595-596`: `if (bindMode === "revision" && !workflowRevId)
  message.error("Bind a workflow")`.

**Subscription drawer** `TriggerSubscriptionDrawer.tsx` mirrors this:

- `extractBoundRevId` helper `:116-125` reads `application_revision?.id ??
  application_variant?.id ?? workflow_revision?.id`.
- Prefill `:526-550`: `refs.environment` → Deployed (`:533-537`); else `:538-543`
  `workflowRevId = extractBoundRevId(refs)` (same variant-id-into-revision-slot bug),
  `workflowLabel = null`.

**The prefix gap (blocker C1, review round 1).** Look at those fallback chains: the
drawers read `application_revision ?? application_variant ?? workflow_revision` — they
never read **`workflow_variant`**. But agent-created triggers store exactly
`{workflow_variant: {id}}` (§10). The `fe4a01f` pin masked this because, being
prefix-agnostic, it wrote `references["workflow_revision"]` for those triggers — a key
the drawers DO read. After the Phase A revert, without a prefix-symmetric FE classifier
an agent trigger would: prefill null → render the empty required picker → **block even a
name-only edit** at the `bindMode === "revision" && !workflowRevId` submit gate
(`TriggerScheduleDrawer.tsx:595-596`) → and show "-" in the settings list (§8). The
classifier must mirror the backend's own prefix detection
(`api/oss/src/core/triggers/service.py:782-789`, prefixes `application` / `evaluator` /
`workflow`) and be shared by both drawers and both settings sections (context.md D2,
plan.md Phases B–D).

**Resubmit is already prefix-safe.** Edit-without-repick echoes the stored references
verbatim: `buildRunVersionReferences` falls back to `fallbackReferences`
(`RunVersionField.tsx:63`), and both drawers pass the stored refs
(`TriggerScheduleDrawer.tsx:622`, `TriggerSubscriptionDrawer.tsx:697`). So a
`workflow_variant` trigger keeps its shape across a metadata-only edit. An active re-pick
rewrites the refs to `application_*` — harmless (backend prefix-agnostic); accepted as a
silent prefix migration (context.md D2).

**Fix direction (Phase C):** prefill must classify via the shared prefix-symmetric
helper — "any `{prefix}_variant` with no `{prefix}_revision`" → Latest mode with a
separate `variantId`, not funneled into `workflowRevId`.

---

## 6. The `EntityPicker` never shows the current value

`RunVersionField.tsx:118-124`: the `EntityPicker` receives `adapter`, `onSelect`,
`className`, `placeholder` — no value. So even a correctly-pinned trigger shows only a
placeholder-derived label, never a selected-state in the popover.

**The picker CAN display a value.** `UnifiedEntityPicker` types
(`web/packages/agenta-entity-ui/src/selection/components/UnifiedEntityPicker/types.ts`)
expose `selectedValue?: string | null` (`:362-364`), `selectedParentId` / `selectedChildId`
for highlighting (`:255-262`), and `displayRender` (`:401`, `:538-540`). Phase C can pass
`selectedValue` (the revision id in Pinned mode) so the picker reflects the current
binding. Latest mode won't use the revision cascader, so this only matters for Pinned.

---

## 7. The settings-mode picker is unscoped (defer — D5)

`TriggerScheduleDrawer.tsx:66-68` and `TriggerSubscriptionDrawer.tsx:92`:
`applicationRevisionAdapter = createWorkflowRevisionAdapter({workflowListAtom:
appWorkflowsListQueryStateAtom})`. This lists **every** application workflow in the
project (a 3-level workflow→variant→revision tree), not scoped to the trigger's app. In a
playground the adapter is re-scoped to the agent's workflow (`:425-432` schedule /
`:470-476` subscription), but the settings path is unscoped. This is the "weird options"
complaint. Orthogonal to Latest → **deferred** (context.md D5).

(The originally-cited `workflowRevisionRelationAdapter.ts:391-401` region is JSDoc for
`filterWorkflows` / `skipVariantLevel`, not the scoping site. The actual unscoping is the
`appWorkflowsListQueryStateAtom` list atom above. Citation corrected.)

---

## 8. Settings list "Bound workflow" column shows raw ids

**Path drift from the original research:** the sections live under a `components/`
subfolder, not directly under `Triggers/`.

`web/oss/src/components/pages/settings/Triggers/components/GatewaySchedulesSection.tsx`:

- Column def `:112-129`, title `"Bound workflow"` `:113`.
- Render `:116-127`: `wfId = refs?.application?.id ?? refs?.application_variant?.id ??
  refs?.application_revision?.id ?? null`, displayed as a raw id (`:124-125`, `{wfId ??
  "-"}`). No version, no Latest/Deployed labeling — and **no `workflow_*` key is read at
  all**, so an agent-created `{workflow_variant}` trigger renders as `-` (the §5 prefix
  gap applies here too; the column must use the same shared classifier).

The sibling `GatewaySubscriptionsSection.tsx` in the same folder follows the same shape.
`GatewayTriggersSection.tsx` and `Triggers.tsx` are also in the tree.

---

## 9. Op-catalog + skill wording that contradicts follow-latest

`sdks/python/agenta/sdk/agents/platform/op_catalog.py`:

- **`_CREATE_SCHEDULE_DESCRIPTION` `:861-866`**: *"When no revision is specified, the
  schedule binds to the variant's latest revision **at creation time and does not follow
  later commits**."* — false once the pin is reverted; must become follow-latest.
- **`_CREATE_SUBSCRIPTION_DESCRIPTION` `:905-910`**: same "at creation time and does not
  follow later commits" wording — same fix.
- **`_COMMIT_REVISION_DESCRIPTION` `:699-701`**: *"existing schedules and subscriptions
  keep pointing at the old revision until you re-point them."* — post-revert this is
  **actively wrong for the common agent case**, not merely imprecise: an agent's
  self-created schedule is variant-bound (§10), so after `commit_revision` it DOES pick
  up the new commit on its next fire. A model trusting this sentence would wrongly
  conclude its schedule still runs the old behavior. The replacement must distinguish
  the two cases explicitly: variant-bound (latest) triggers follow commits; only
  revision-pinned triggers stay frozen until re-pointed. **This is a correctness fix,
  not wording polish.**

`sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py` (the build-an-agent skill):

- The trigger sections `:407-535` (`create_schedule` / `create_subscription` guidance) do
  **not** currently contain "does not follow later commits" pinning language (grep clean).
  The nearby `:183-191` "does not change what runs" text is about the `run_a_workflow`
  tool with an explicit `version` / environment pin — **not** a trigger, do not touch.
- **Action:** after rewording the op catalog, re-grep `agenta_builtins.py` for any
  creation-time / freeze language in the trigger sections and align it. As of 2026-07-07
  there is nothing to change there, but re-verify at implementation time (the skill lane,
  PR #5106, may drift).

---

## 10. Agent-created triggers store `workflow_variant` and need zero op changes

`create_schedule` / `create_subscription` context-bind only the variant id, under the
**`workflow_*` prefix**: `context_bindings` set
`schedule.data.references.workflow_variant.id` / `subscription.data.references.
workflow_variant.id` to `$ctx.workflow.variant.id` (`op_catalog.py:1128-1130` and
`:1140-1142`). The input schema is closed against a caller-supplied `references`
(`op_catalog.py:869-871`), so `{workflow_variant: {id}}` is the exact stored shape for
every agent-created trigger. Under follow-latest that variant-only binding becomes the
**correct** default with no op changes — only the *descriptions* (§9) change. But it is
also the shape the FE read paths currently never read (§5, §8), which is why the FE
classifier must be prefix-symmetric.

---

## 11. FE test surface

`web/packages/agenta-entity-ui/tests/unit/` holds pure-function vitest suites
(`connectionUtils.test.ts`, `schemaPaths.test.ts`, etc.). There are **no** existing unit
tests for the trigger drawers. `buildRunVersionReferences` is a pure function and is the
natural unit-test target; an extracted prefill-classifier helper would be too. Full-drawer
rendering tests are not the established pattern here.
