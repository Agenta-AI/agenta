# Plan: Trigger "Latest" binding

Six phases, A to F. Each names exact files and is sized for a narrow subagent. Phases
B, C, and D are one logical frontend change, split into smaller units. Phase A
(backend) can run in parallel with the frontend work; the frontend change is
self-contained and only needs A for end-to-end QA. Phase E rides existing lanes. Phase
F is verification.

Dependency order: A, then B then C then D, then E, then F.

**The invariant every phase must respect:** every frontend read of trigger references
goes through one shared, prefix-symmetric classifier, defined in Phase B. It handles
the `application_*`, `workflow_*`, and `evaluator_*` families, mirroring the backend's
prefix detection at `api/oss/src/core/triggers/service.py:782-789`. Agent-created
triggers store `{workflow_variant: {id}}` (research.md §10), and no current frontend
read recognizes that key. Any phase that reads references without the shared classifier
reintroduces that bug. Writes stay `application_*`; an active re-pick silently migrates
the prefix (accepted, context.md D2).

---

## Phase A: Backend. Remove the pin, keep the 422 fix, reshape the tests.

PR #5103 (the create-time pin) was closed unmerged on 2026-07-09: pinning at save time
is the wrong behavior. Its commit still sits on the local lane
`fix/trigger-revision-default-head`. Phase A reworks that lane into the follow-latest
backend change and opens a fresh PR. Do not reuse #5103.

### A1. Remove the create-time pin

File: `api/oss/src/core/triggers/service.py`, `_validate_references`.

- Delete the pin block (research.md §2, currently `:820-829`): the branch that writes
  `references[f"{prefix}_revision"]` when a variant reference has no revision.
- Restore the pre-pin, validate-only docstring (`:756-773`). Recover the exact old text
  with `git show fe4a01f^:api/oss/src/core/triggers/service.py`. Its key sentences:
  validation deliberately does not overwrite the stored references; a variant without a
  revision means "resolve latest at trigger time"; the dispatcher re-resolves from the
  raw references on every fire.
- Keep the `retrieve_workflow_revision` call (`:807-814`) and the
  `revision is None → raise TriggerReferenceInvalid` guard (`:815-818`). That is the
  graceful-failure validation, and it stays. The extracted `workflow_variant_ref` /
  `workflow_revision_ref` locals can stay or be re-inlined; either is fine.

### A2. Keep the 422 handlers

File: `api/oss/src/apis/fastapi/triggers/router.py`. No change; just verify these
survive the lane rework. `create_subscription` (`:1006-1007`) and `edit_subscription`
(`:1126-1127`) translate `TriggerReferenceInvalid` into HTTP 422. Before the pin lane,
those two endpoints surfaced a 500. The schedule endpoints already had the same
handlers (`:1283-1284`, `:1379-1380`; research.md §3).

### A3. Reshape the tests

File: `api/oss/tests/pytest/unit/triggers/test_triggers_reference_defaulting.py`.

Delete the pins-head cases:

- `TestValidateReferencesPinsHead.test_variant_only_is_pinned_to_head_revision`
- `TestValidateReferencesPinsHead.test_application_prefix_variant_only_is_pinned`
- `test_create_schedule_pins_head_revision_when_only_variant_given`
- `test_create_subscription_pins_head_revision_when_only_variant_given`

Keep the validation cases:

- Zero-revision variant raises: `test_variant_with_no_revisions_raises_typed_error`,
  `test_create_schedule_raises_when_variant_has_no_revisions`,
  `test_create_subscription_raises_when_variant_has_no_revisions`.
- References left verbatim: `test_artifact_only_reference_stays_unpinned`,
  `test_environment_reference_stays_unpinned`,
  `test_revision_already_present_is_left_untouched`.
- Explicit revision survives create: `test_create_schedule_leaves_explicit_revision_untouched`.
  No subscription twin exists today; add one for parity.

Add the inverse of the deleted pin test: after `_validate_references` on
`{"application_variant": {"id": ...}}`, assert `"application_revision" not in
references` and the input dict is unchanged. This locks the follow-latest behavior.

Rename the module away from "defaulting", for example
`test_triggers_reference_validation.py`, and rewrite the module docstring, which
currently describes pinning.

Verify: `cd api && py-run-tests`. The live follow-latest check happens in Phase F.

---

## Phase B: Frontend. Latest mode in `RunVersionField`, plus the shared classifier.

File: `web/packages/agenta-entity-ui/src/gatewayTrigger/drawers/shared/RunVersionField.tsx`.
The classifier may live in a sibling `shared/` module, for example
`triggerReferences.ts`.

Add the shared prefix-symmetric classifier, a pure exported function consumed by both
drawers (Phase C) and both settings sections (Phase D):

```typescript
// classifyTriggerReferences(refs): mirrors the backend prefix detection
// (api/oss/src/core/triggers/service.py:782-789)
// - refs.environment present -> {mode: "environment", environmentSlug, appSlug}
// - for prefix in ["application", "workflow", "evaluator"]:
//     refs[`${prefix}_revision`]?.id -> {mode: "revision", revisionId, workflowId?}
//     refs[`${prefix}_variant`]?.id with no `${prefix}_revision` ->
//         {mode: "latest", variantId, workflowId?}
// - nothing matched -> {mode: null}
```

A `{workflow_variant: {id}}` input (an agent-created trigger) MUST classify as Latest.
Unit-test that case in Phase F.

Then in `RunVersionField.tsx`:

- Extend `RunVersionBindMode` (`:10`) to `"latest" | "revision" | "environment"`.
- Add a third rail item (`:104-112`): `{value: "latest", label: "Latest"}`, ordered
  `Latest | Pinned | Deployed`.
- Add a Latest branch to the render (`:113-141`). Hint: "Always runs the newest
  committed revision of this variant (ignores environments)." Control: a variant
  picker. Simplest path: reuse the popover-cascader and let the user select the variant
  node, so the selection's `id` equals `metadata.variantId` and
  `buildRunVersionReferences` produces the variant-only reference. If a variant-scoped
  adapter is cleaner, add one next to `applicationRevisionAdapter` in the drawers. Keep
  the choice local and note it in a one-line comment.
- `buildRunVersionReferences` (`:29-64`): add an explicit `latest` arm. When
  `bindMode === "latest"`, return `{application: {id}?, application_variant: {id:
  variantId}}` and never a revision reference. The existing `else` already does this
  when the picked leaf is the variant node; the explicit arm makes the intent legible
  and keeps a future edit from routing Latest into `application_revision`. Keep the
  edit-without-repick fallback (`:63`) echoing `fallbackReferences` verbatim, so a
  stored `workflow_*` shape survives metadata-only edits (research.md §5).
- Accept a `selectedValue` prop and forward it to the `EntityPicker` (`:118-124`), so
  Pinned mode shows the current binding (research.md §6). Latest mode shows the
  selected variant the same way.

No behavior change to Deployed. Keep `envHint` and the environment `Select` as they
are.

---

## Phase C: Frontend. Drawer prefill and picker value display.

Files: `TriggerScheduleDrawer.tsx` and `TriggerSubscriptionDrawer.tsx` (same package).

- Add a `variantId` state, distinct from `workflowRevId`. Let `bindMode` hold
  `"latest" | "revision" | "environment"`.
- Prefill (schedule `:456-479`, subscription `:526-550`): replace the hand-rolled
  fallback chains with the shared classifier from Phase B. The current chains read
  `application_revision ?? application_variant ?? workflow_revision` and never read
  `workflow_variant`, so agent-created triggers prefill null (research.md §5). Via the
  classifier:
  - `{mode: "environment"}`: `bindMode = "environment"`. Unchanged behavior.
  - `{mode: "revision", revisionId}` (any prefix, including `workflow_revision` from
    pin-era triggers): `bindMode = "revision"`, `workflowRevId = revisionId`.
  - `{mode: "latest", variantId}` (any prefix, including `workflow_variant` from agent
    triggers): `bindMode = "latest"`, set `variantId`. Do not assign it to
    `workflowRevId`; that is the current bug.
  - Delete `extractBoundRevId` (subscription `:116-125`). It collapses the
    variant-versus-revision distinction the classifier makes explicit.
- Picker value: pass `selectedValue={workflowRevId}` in Pinned mode and the variant id
  in Latest mode, so the `EntityPicker` shows the current binding instead of a
  placeholder. Resolve the human label through the existing molecule selectors
  (`artifactName` / `variantLabel` / `data`). Those are revision-only, so Latest must
  resolve the variant label through the variant selectors instead.
- Submit validation: add a Latest arm next to the existing
  `bindMode === "revision" && !workflowRevId` check (schedule `:595-596`):
  `bindMode === "latest" && !variantId` shows "Pick a variant". Mirror it in the
  subscription drawer. With the classifier in place, an agent trigger in edit mode
  carries a valid `variantId`, so a name-only edit saves again.
- `versionChosen` and the summary (schedule `:700-702`): include the Latest case
  (`bindMode === "latest" ? !!variantId : ...`).
- Create-mode default binding (schedule `:486-510`, subscription `:552-576`): when the
  drawer opens with a `defaultReferences` variant id, open in Latest with the variant
  pre-selected. This part waits on Mahmoud's default-mode answer (context.md D1): if he
  opts to honor a concrete revision context, a `defaultReferences` that carries a
  revision should open Pinned, pre-selected to that revision. Today the code discards
  it and hardcodes `revision: 0` (schedule `:496-507`). Implement his choice; do not
  decide silently.

---

## Phase D: Frontend. Settings-list rendering.

Files (note the `components/` subfolder, research.md §8):
`web/oss/src/components/pages/settings/Triggers/components/GatewaySchedulesSection.tsx`
and `.../GatewaySubscriptionsSection.tsx`.

- Rework the "Bound workflow" column (schedules `:116-127`) on top of the shared
  classifier. The current read chain
  (`application ?? application_variant ?? application_revision`) never reads
  `workflow_*`, so an agent-created trigger renders "-".
- Resolve the workflow or variant display name through the workflow molecule
  (`artifactName` and the variant selectors, as the drawers do) instead of printing a
  raw id.
- Append a mode tag: `{mode: "revision"}` shows `· v<n>`; `{mode: "environment"}` shows
  `@ <env slug>`; `{mode: "latest"}` shows a `Latest` tag. An agent trigger must show a
  workflow name plus the Latest tag, never a bare id or "-".
- If name resolution is heavy in the table context, the floor is: resolved-name-or-id
  plus the mode tag (context.md D4).
- Apply the same change to the subscriptions section.
- Wiring note: the classifier is a pure function in `@agenta/entity-ui`'s
  gatewayTrigger shared module. The settings sections live in `web/oss` and already
  consume that package, so a subpath export is the only wiring needed.

---

## Phase E: SDK wording fixes (rides existing lanes).

These are correctness fixes, not polish (research.md §9). Without the pin, the current
text tells an agent the opposite of what the platform does with the agent's own
triggers.

File: `sdks/python/agenta/sdk/agents/platform/op_catalog.py` (PR #5105 lane).

- `_CREATE_SCHEDULE_DESCRIPTION` (`:861-866`): replace "binds to the variant's latest
  revision at creation time and does not follow later commits" with follow-latest
  wording, for example: "When no revision is specified, the schedule follows the
  variant's latest revision, re-resolved on every run."
- `_CREATE_SUBSCRIPTION_DESCRIPTION` (`:905-910`): same change.
- `_COMMIT_REVISION_DESCRIPTION` (`:699-701`): the sentence "existing schedules and
  subscriptions keep pointing at the old revision until you re-point them" is wrong for
  variant-bound triggers, which pick up the new commit on their next fire. The
  replacement must distinguish the two cases, for example: "revision-pinned schedules
  and subscriptions keep pointing at the old revision until you re-point them; triggers
  bound to the variant (latest) pick up the new revision on their next run."

File: `sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py` (PR #5106 lane).

- Re-grep the trigger sections (`:407-535`) for creation-time or freeze language and
  align them to follow-latest. As of 2026-07-07 nothing needed changing (research.md
  §9); re-verify at implementation time, since the skill lane may drift. Do not touch
  the `run_a_workflow` "does not change what runs" text at `:183-191`; that describes a
  different tool with an explicit version pin.

---

## Phase F: QA matrix (automated plus manual).

Automated:

- API: `cd api && py-run-tests`. The reshaped trigger unit tests pass (Phase A3).
- FE: add `web/packages/agenta-entity-ui/tests/unit/buildRunVersionReferences.test.ts`
  (vitest, matching the existing pure-function suites, research.md §11). Cover: Latest
  produces a variant-only reference with no revision; Pinned produces a revision
  reference; Deployed produces an environment reference; the edit-without-repick
  fallback echoes stored references verbatim, including a `workflow_*` shape.
- FE: unit-test the shared classifier. This locks the agent-trigger case:
  - `{application_revision}` classifies as Pinned.
  - `{application_variant}` with no revision classifies as Latest.
  - `{environment, application}` classifies as Deployed.
  - `{workflow_variant}` classifies as Latest (the agent-created shape).
  - `{workflow_variant, workflow_revision}` classifies as Pinned (a pin-era agent
    trigger).
  - `{evaluator_variant}` classifies as Latest (prefix symmetry).
  - Empty or null references classify as no mode.
  Run `pnpm --filter @agenta/entity-ui test`.
- FE lint: `pnpm lint-fix` in `web`.

Manual, on a live stack (use the debug-local-deployment skill):

1. Create a Latest schedule on a variant. The stored references have
   `application_variant` and no `application_revision`. Commit a new revision, fire,
   and confirm the head runs.
2. Create a Pinned schedule. Commit a new revision, fire, and confirm the pinned
   revision runs.
3. Create a Deployed subscription. It fires against the deployed revision; redeploy,
   and the next fire follows.
4. Edit round-trip all three: reopen each drawer, confirm the correct rail item is
   selected and the picker shows the current binding. No empty "Select workflow
   revision" placeholder for a Latest trigger.
5. Settings list: each trigger's "Bound workflow" column shows a name plus the right
   tag (Latest, vN, or @env).
6. Agent-created schedule (via the `create_schedule` op, stored as `workflow_variant`):
   the settings list shows the workflow name plus a Latest tag, the drawer opens in
   Latest mode with the variant shown, a name-only edit saves without touching the
   binding, and the trigger follows the head after a new commit.
7. 422 path: bind a variant with zero runnable revisions and confirm a 422, not a 500,
   on the subscription endpoints. Schedules already had the handler.

Record the results in this workspace (a QA section here or in status.md) before marking
the implementation PR ready.
