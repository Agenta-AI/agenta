# Plan: Trigger "Latest" binding

Six phases, A–F. Each is sized for a narrow subagent and names exact files. Phases B–D
are frontend and depend on A being merged/available only for end-to-end QA, not for
coding (the FE change is self-contained). E and F ride existing lanes / are verification.

Dependency order: **A → (B → C → D) → E → F**. B/C/D are one logical FE change; split only
if a subagent needs smaller units. A and E can proceed in parallel with the FE work.

**Cross-phase invariant (blocker C1, review round 1):** every FE *read* of trigger
references — drawer prefill (Phase C) and settings-list rendering (Phase D) — goes
through **one shared prefix-symmetric classifier** (defined in Phase B) that handles the
`application_*`, `workflow_*`, and `evaluator_*` families, mirroring the backend's prefix
detection at `api/oss/src/core/triggers/service.py:782-789`. Agent-created triggers store
`{workflow_variant: {id}}` (research.md §10); the current FE reads never touch
`workflow_variant`, and only the `fe4a01f` pin (which wrote `workflow_revision`) made them
render. Any phase that reads references without the shared classifier reintroduces the
bug the pin papered over. Writes stay `application_*` (a re-pick silently migrates the
prefix — accepted, context.md D2).

---

## Phase A — Backend: un-pin, keep the 422 fix, reshape the test

**This reworks the existing lane `fix/trigger-revision-default-head`; PR #5103 becomes the
implementation PR for this project** (retitle it to describe the follow-latest behavior,
not the pin).

### A1. Revert the create-time pin

File: `api/oss/src/core/triggers/service.py`, `_validate_references`.

- Delete the pin block (research.md §2, currently `:820-829`):
  ```python
  if (environment_ref is None and workflow_variant_ref is not None
      and workflow_revision_ref is None):
      references[f"{prefix}_revision"] = Reference(...)
  ```
- Restore the pre-`fe4a01f` validate-only docstring (`:756-773`). Recover the exact old
  text with `git show fe4a01f^:api/oss/src/core/triggers/service.py` (the "…without
  pinning it… means 'resolve latest at trigger time'… dispatcher re-resolves from the raw
  references on every fire… latest-tracking is preserved" version).
- **Keep** the `retrieve_workflow_revision` call and the `revision is None → raise
  TriggerReferenceInvalid` guard (graceful-failure validation). The extracted
  `workflow_variant_ref` / `workflow_revision_ref` locals may stay or be re-inlined; either
  is fine.

### A2. Keep the 422 handlers

File: `api/oss/src/apis/fastapi/triggers/router.py`. **No change** — leave the
`TriggerReferenceInvalid → HTTPException(422)` handlers on `create_subscription`
(`:1006-1007`) and `edit_subscription` (`:1126-1127`) exactly as `fe4a01f` added them.
Verify they survive the lane rework. (Scope note: only the *subscription* endpoints had
the 500 gap; `create_schedule` / `edit_schedule` already had the handler at `:1283-1284`
/ `:1379-1380` — research.md §3.)

### A3. Reshape the test

File: `api/oss/tests/pytest/unit/triggers/test_triggers_reference_defaulting.py`.

- **Delete** the pinning tests: `TestValidateReferencesPinsHead.
  test_variant_only_is_pinned_to_head_revision`, `.test_application_prefix_variant_only_is
  _pinned`, and the whole `TestCreateScheduleDefaultsVariantToHead` /
  `TestCreateSubscriptionDefaultsVariantToHead` classes' *pins-head* cases
  (`test_create_schedule_pins_head_revision_when_only_variant_given`,
  `test_create_subscription_pins_head_revision_when_only_variant_given`).
- **Keep / adapt** the validation-still-works cases:
  - zero-revision variant → `TriggerReferenceInvalid`
    (`test_variant_with_no_revisions_raises_typed_error`,
    `test_create_schedule_raises_when_variant_has_no_revisions`,
    `test_create_subscription_raises_when_variant_has_no_revisions`) — keep as-is.
  - refs-left-verbatim: `test_artifact_only_reference_stays_unpinned`,
    `test_environment_reference_stays_unpinned`,
    `test_revision_already_present_is_left_untouched` — keep.
  - explicit-revision-untouched through the service entry points:
    `test_create_schedule_leaves_explicit_revision_untouched` (`:209`) — keep (it
    asserts a caller-pinned revision survives create, which stays true after the
    revert). No subscription twin exists today (`TestCreateSubscriptionDefaults…` has
    only the pins-head and raises cases); **add one** for parity while reshaping.
- **Add** an explicit "variant-only is NOT rewritten" assertion (the inverse of the
  deleted pin test): after `_validate_references` on `{"application_variant": {"id": ...}}`,
  assert `"application_revision" not in references` and the input dict is unchanged. This
  locks the revert.
- Rename the module + docstring away from "defaulting"/"pins HEAD" toward
  "validate-only / follow-latest" (e.g. `test_triggers_reference_validation.py`); update
  the top-of-file docstring which currently describes pinning.

**Verify A:** `cd api && py-run-tests` (or target the triggers unit tests). Then a live
check: create a variant-only trigger, confirm the stored references contain **no**
`application_revision`, commit a new revision, fire it, confirm HEAD runs (manual QA in
Phase F).

---

## Phase B — Frontend: `RunVersionField` Latest mode + the shared classifier

File: `web/packages/agenta-entity-ui/src/gatewayTrigger/drawers/shared/RunVersionField.tsx`
(the classifier may live in a sibling `shared/` module, e.g. `triggerReferences.ts`).

- **Add the shared prefix-symmetric classifier** (the cross-phase invariant). A pure
  exported function, consumed by both drawers (Phase C) and both settings sections
  (Phase D):

  ```typescript
  // classifyTriggerReferences(refs) → mirror of the backend prefix detection
  // (api/oss/src/core/triggers/service.py:782-789)
  // - refs.environment present → {mode: "environment", environmentSlug, appSlug}
  // - for prefix in ["application", "workflow", "evaluator"]:
  //     refs[`${prefix}_revision`]?.id → {mode: "revision", revisionId, workflowId?}
  //     refs[`${prefix}_variant`]?.id (no `${prefix}_revision`) →
  //         {mode: "latest", variantId, workflowId?}
  // - nothing matched → {mode: null}
  ```

  A `{workflow_variant: {id}}` input (agent-created trigger) MUST classify as Latest —
  this is the blocker-C1 case; unit-test it in Phase F.
- Extend `RunVersionBindMode` (`:10`) to `"latest" | "revision" | "environment"`.
- Add a third rail item (`:104-112`): `{value:"latest", label:"Latest"}`, ordered
  `Latest | Pinned | Deployed`.
- Add a Latest branch to the render (`:113-141`):
  - hint: *"Always runs the newest committed revision of this variant (ignores
    environments)."* (disambiguates from Deployed — context.md D1/U2).
  - a **variant** picker: reuse the popover-cascader but present workflow→variant (no
    revision leaf). Simplest path: pass the same `revisionAdapter` and let the user select
    the variant node; on select, emit a selection whose `id === metadata.variantId` so
    `buildRunVersionReferences` produces the variant-only ref. If a variant-scoped adapter
    is cleaner, add one alongside `applicationRevisionAdapter` in the drawers (out of this
    file). Keep the decision local and documented in a one-line comment.
- `buildRunVersionReferences` (`:29-64`): add an explicit `latest` arm for clarity —
  when `bindMode === "latest"`, return `{application:{id}?, application_variant:{id:
  variantId}}` from the current selection/`variantId`, never a revision ref. (Functionally
  the existing `else` already does this when `leafId === variantId`; the explicit arm makes
  intent legible and prevents a future edit from routing Latest into `application_revision`.)
  Writes stay `application_*`; the edit-without-repick fallback (`:63`) keeps echoing
  `fallbackReferences` verbatim so a stored `workflow_*` shape survives metadata-only
  edits (research.md §5, "resubmit is already prefix-safe").
- Accept a `selectedValue` prop and forward it to the `EntityPicker` (`:118-124`) so Pinned
  mode reflects the current binding (research.md §6). Latest mode's picker shows the
  selected variant analogously.

**No behavioral change to Deployed.** Keep `envHint` / env `Select` as-is.

---

## Phase C — Frontend: drawer prefill + picker value display

Files: `TriggerScheduleDrawer.tsx`, `TriggerSubscriptionDrawer.tsx` (same package).

- Add `variantId` (or reuse a clearly-named state) distinct from `workflowRevId`, and let
  `bindMode` hold `"latest" | "revision" | "environment"`.
- **Prefill classification** (schedule `:456-479`, subscription `:526-550`): replace the
  hand-rolled fallback chains with the **shared classifier from Phase B**. The current
  chains read `application_revision ?? application_variant ?? workflow_revision` and never
  read `workflow_variant`, so agent-created triggers prefill null (blocker C1 —
  research.md §5). Via the classifier:
  - `{mode: "environment"}` → `bindMode = "environment"` (unchanged behavior).
  - `{mode: "revision", revisionId}` (any prefix, incl. `workflow_revision` from
    `fe4a01f`-pinned triggers) → `bindMode = "revision"`, `workflowRevId = revisionId`.
  - `{mode: "latest", variantId}` (any prefix, incl. `workflow_variant` from agent
    triggers) → `bindMode = "latest"`, `variantId` set. **Do not** assign it to
    `workflowRevId` (removes the research.md §5 bug).
  - Delete/replace `extractBoundRevId` (subscription `:116-125`) — it collapses the
    variant-vs-revision distinction the classifier makes explicit.
- **Picker value:** pass `selectedValue={workflowRevId}` (Pinned) / the variant id
  (Latest) into `RunVersionField` so the `EntityPicker` shows the current binding, not a
  placeholder. Resolve the human label via the existing molecule selectors
  (`artifactName` / `variantLabel` / `data`), but note those are **revision-only** — for
  Latest, resolve the *variant* label instead (variant molecule selector), since a variant
  id won't resolve through revision selectors.
- **Submit validation:** add a `latest` arm alongside `bindMode === "revision" &&
  !workflowRevId` (schedule `:595-596`): `bindMode === "latest" && !variantId` →
  `message.error("Pick a variant")`. Mirror in the subscription drawer. (Post-classifier,
  an agent trigger in edit mode carries a valid `variantId`, so a name-only edit is no
  longer blocked — the C1 regression scenario.)
- **`versionChosen` / summary** (schedule `:700-702`): include the Latest case
  (`bindMode === "latest" ? !!variantId : …`).
- **Create-mode default-bind** (schedule `:486-510`, subscription `:552-576`): agent /
  `defaultReferences` binding provides a variant id — open in Latest with the variant
  pre-selected. **Pending Mahmoud's answer to the default-mode open question**
  (context.md D1): if he opts for revision-context honoring, a `defaultReferences` that
  carries a concrete revision (the current code discards it and hardcodes `revision: 0` —
  schedule `:496-507`) should instead open **Pinned** pre-selected to that revision.
  Implement his choice; don't decide silently.

---

## Phase D — Frontend: settings-list rendering

Files (note the `components/` subfolder — research.md §8):
`web/oss/src/components/pages/settings/Triggers/components/GatewaySchedulesSection.tsx`
and `.../GatewaySubscriptionsSection.tsx`.

- Rework the "Bound workflow" column render (schedules `:116-127`) **on top of the
  shared classifier from Phase B** — the current read chain (`application ??
  application_variant ?? application_revision`) never reads `workflow_*`, so an
  agent-created trigger renders "-" (blocker C1 — research.md §8). Via the classifier:
  - Resolve the workflow/variant display name via the workflow molecule (`artifactName`
    and the variant selectors, as the drawers do) instead of printing the raw id.
  - Append a mode tag: `{mode:"revision"}` → `· v<n>` (or just the name);
    `{mode:"environment"}` → `@ <env slug>`; `{mode:"latest"}` → a `Latest` tag. An
    agent trigger must show a workflow NAME + `Latest` tag, not a bare id or "-".
  - Floor if name resolution is heavy in the table context: resolved-or-id **plus the
    mode tag** — never a bare undifferentiated id (context.md D4).
- Apply the same to the subscriptions section for parity.
- Import note: the classifier is a pure function in `@agenta/entity-ui`'s gatewayTrigger
  shared module; the settings sections live in `web/oss` and already consume that package,
  so a subpath export is the only wiring needed.

---

## Phase E — Op-catalog correctness fix + skill re-verify (rides existing lanes)

File: `sdks/python/agenta/sdk/agents/platform/op_catalog.py` (PR #5105 lane).

These are **correctness fixes, not wording polish** (research.md §9): post-revert, the
current text tells the model the opposite of what the platform does for its own
variant-bound triggers.

- `_CREATE_SCHEDULE_DESCRIPTION` (`:861-866`): replace "binds to the variant's latest
  revision **at creation time and does not follow later commits**" with follow-latest
  wording, e.g. *"When no revision is specified, the schedule follows the variant's latest
  revision, re-resolved on every run."*
- `_CREATE_SUBSCRIPTION_DESCRIPTION` (`:905-910`): same change.
- `_COMMIT_REVISION_DESCRIPTION` (`:699-701`): the sentence "existing schedules and
  subscriptions keep pointing at the old revision until you re-point them" is **actively
  wrong for the common agent case** — an agent's self-created schedule is variant-bound
  and DOES pick up the new commit on its next fire. The replacement must distinguish the
  two cases explicitly, e.g. *"revision-pinned schedules and subscriptions keep pointing
  at the old revision until you re-point them; triggers bound to the variant (latest)
  pick up the new revision on their next run."*

File: `sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py` (PR #5106 lane).

- Re-grep the trigger sections (`:407-535`) for creation-time / freeze language and align
  to follow-latest. As of 2026-07-07 there is nothing to change (research.md §9); confirm
  at implementation time since the skill lane may have drifted. **Do not** touch the
  `run_a_workflow` "does not change what runs" text at `:183-191` — that's a different
  tool with an explicit version pin.

---

## Phase F — QA matrix (manual + automated)

**Automated:**
- API: `cd api && py-run-tests` — the reshaped triggers unit tests pass (Phase A3).
- FE: add `web/packages/agenta-entity-ui/tests/unit/buildRunVersionReferences.test.ts`
  (vitest, matching the existing pure-function suites — research.md §11) covering:
  Latest → variant-only ref (no revision); Pinned → revision ref; Deployed →
  environment ref; edit-without-repick fallback echoes stored refs verbatim (including a
  `workflow_*` shape).
- FE: unit-test the **shared classifier** (Phase B) — this is the blocker-C1 lock:
  - `{application_revision}` → Pinned; `{application_variant}` (no revision) → Latest;
    `{environment, application}` → Deployed.
  - **`{workflow_variant}` → Latest** (agent-created trigger — the C1 case).
  - `{workflow_variant, workflow_revision}` → Pinned (an `fe4a01f`-pinned agent trigger).
  - `{evaluator_variant}` → Latest (prefix symmetry).
  - empty/null refs → no mode.
  Run `pnpm --filter @agenta/entity-ui test` (or the package's test script).
- FE lint: `pnpm lint-fix` in `web`.

**Manual (live stack — use the debug-local-deployment skill):**
1. Create a **Latest** schedule on a variant → stored refs have `application_variant`, no
   `application_revision`. Commit a new revision → fire → HEAD runs.
2. Create a **Pinned** schedule → stored refs have `application_revision`. Commit a new
   revision → fire → the pinned revision runs.
3. Create a **Deployed** subscription → fires against the deployed revision; redeploy →
   next fire follows.
4. **Edit round-trip** each of the three: reopen the drawer → the correct rail item is
   selected and the picker shows the current binding (no empty "Select workflow revision"
   placeholder for a Latest trigger).
5. **Settings list**: each trigger's "Bound workflow" column shows name + the right tag
   (Latest / vN / @env).
6. **Agent-created** schedule (via `create_schedule` op, stored as `workflow_variant`) →
   settings list shows workflow name + Latest tag (not "-"), drawer opens in Latest mode
   with the variant shown, a **name-only edit saves without touching the binding** (the
   C1 regression scenario), and the trigger follows HEAD after a new commit.
7. **422 path**: attempt to bind a variant with zero runnable revisions → 422, not 500
   (subscription endpoints; schedules already had the handler).

Record results in this workspace (append a QA section here or in status.md) before
marking the PR ready.
