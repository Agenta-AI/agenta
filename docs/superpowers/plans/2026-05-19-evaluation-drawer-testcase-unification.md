# Evaluation Focus Drawer → Testcase Drawer Unification — Analysis

**Date:** 2026-05-19
**Author:** ashraf + assistant
**Status:** Analysis — **all decisions locked 2026-05-19** (see §7). Ready for implementation kickoff.
**Scope:** Replace the bespoke evaluation-results focus drawer with an evaluation-specific adapter over the unified `TestcaseDrawer` from `@agenta/entity-ui/testcase`, view-mode only.

---

## 1. Goal

Today there are three distinct testcase-like drawers in the product:

| Surface | Drawer | Drives Testcase Data via |
|---|---|---|
| Testset table → row click | `TestcaseDrawer` (entity-ui) | `TestcaseEditDrawerContent` → `TestcaseDataEditor` (edit) |
| Playground → testcase focus | `PlaygroundFocusDrawer` (playground-ui) | `PlaygroundTestcaseEditor` → `TestcaseDataEditor` (edit) |
| Evaluations details → row click | `EvalRunDetails/.../FocusDrawer` (oss, 1551 LOC) | Custom column-driven renderers (view-only) |

The first two already use the unified `TestcaseDataEditor`. **The goal is to bring the third one onto the same shell through an eval adapter**, view-only, so the entire app has one canonical testcase-rendering pipeline without mixing evaluation semantics into the testset edit adapter.

---

## 2. Current state — `EvalRunDetails/components/FocusDrawer.tsx`

### Mount / open path

- **Mounted globally** from `web/oss/src/components/AppGlobalWrappers/index.tsx` as an overlay singleton (`EvalRunFocusDrawerPreview`). `EvalRunPreviewPage` only syncs URL state; it does not mount the drawer.
- **Open state** is in [state/focusDrawerAtom.ts](web/oss/src/components/EvalRunDetails/state/focusDrawerAtom.ts) — `focusDrawerAtom` carries `{focusRunId, focusScenarioId, compareMode, testcaseId, scenarioIndex, open, isClosing}`.
- **Open trigger**: Table row click → `patchFocusDrawerQueryParams(...)` → URL query params → `syncFocusDrawerStateFromUrl()` → `openFocusDrawerAtom` → `focusDrawerAtom`. URL is the source of truth; closing clears the query params.
- Match-across-runs is computed by `compareScenarioMatchesAtom` (testcaseId match first, scenarioIndex fallback).

### Layout / chrome

[FocusDrawer.tsx:1-300](web/oss/src/components/EvalRunDetails/components/FocusDrawer.tsx#L1-L300):

- Shell: `GenericDrawer` with three slots — `headerExtra`, `sideContent` (collapsible side panel, ~240px), `mainContent`.
- `FocusDrawerHeader`: scenario navigation (prev/next), scenario index badge, copy-ID.
- `FocusDrawerSidePanel`: tree navigator that anchor-links to each section (Input, Outputs, evaluators).
- `FocusDrawerContent` or `FocusDrawerCompareContent`: the body. Compare mode is a horizontally-scrolling grid of synchronized run columns (up to `MAX_COMPARISON_RUNS = 5`).
- **Read-only**: `JsonEditor` is mounted with `disabled`; metric values render as `MetricValuePill`s with no edit affordance.

### Section model — driven by column groups

The drawer does **not** invent its own section layout. It reuses the eval table's column groups. From [atoms/table/types.ts:57-70](web/oss/src/components/EvalRunDetails/atoms/table/types.ts#L57-L70):

```ts
type EvaluationColumnGroupKind = "meta" | "input" | "invocation" | "annotation" | "metric"

interface EvaluationTableColumnGroup {
  id: string
  label: string
  kind: EvaluationColumnGroupKind
  columnIds: string[]
  staticMetricColumns?: MetricColumnDefinition[]
  meta?: Record<string, any>  // refs: testset.id, application.id, variant.id, application_revision.id
}
```

`useFocusDrawerSections` ([FocusDrawer.tsx:184-249](web/oss/src/components/EvalRunDetails/components/FocusDrawer.tsx#L184-L249)) reads `columnResult.groups` from `usePreviewTableData({runId})` and emits one `FocusDrawerSection` per group (skipping `kind === "metric"`, which are run-level aggregates, not per-scenario):

- `kind: "input"` → one section, columns are the test inputs (paths inside the testcase data).
- `kind: "invocation"` → one section per app/variant invocation; header shows `InvocationMetaChips` (app, variant, revision badge).
- `kind: "annotation"` → one section per evaluator; columns are the evaluator's output fields.
- `kind: "meta"` → typically skipped (status/timestamp don't belong inside the drawer body).

Per-section render:
- `FocusDrawerSectionCard` → sticky header (`FocusSectionHeader`) + `SectionCard` (`@/oss/components/EvalRunDetails/components/views/ConfigurationView/components/SectionPrimitives`).
- Inside, `FocusSectionContent` iterates `section.columns` and renders one `ScenarioColumnValue` per column.

### Per-cell render — `ScenarioColumnValue`

[FocusDrawer.tsx:462-630](web/oss/src/components/EvalRunDetails/components/FocusDrawer.tsx#L462-L630):

- Calls `useScenarioCellValue({scenarioId, runId, column})` → returns `{selection: {value, displayValue, isLoading, error, stepError}, showSkeleton}`.
- Branches:
  - Metric / annotation (`column.kind === "metric" || "evaluator"` or `stepType === "metric" | "annotation"`): renders `MetricValuePill` via `formatMetricDisplay` (`@agenta/ui/cell-renderers`). Run-aggregate metrics go through `RunMetricValue` with `MetricDetailsPreviewPopover`.
  - Chat-shaped value: `renderScenarioChatMessages(value, fieldKey)` (custom chat detector in `utils/chatMessages.ts`).
  - Anything else: `FocusValueCard` containing either `JsonEditor` (`@agenta/ui/editor`, disabled) for objects/arrays or a plain `<pre>` for strings.

Note: This rendering pipeline has **no overlap** with `TestcaseDrillInFieldRenderer` from entity-ui today, even though both ultimately render the same kinds of values. Convergence is the prize.

---

## 3. Target state — `TestcaseDrawer` + `TestcaseDataEditor`

From this session's recent work:

- [TestcaseDrawer.tsx](web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx) shell:
  - Title: "Testcase N" / "New Testcase" with prev/next, copy-ID, "edited" badge, `renderAddToQueue` slot, `renderEvaluatorMetrics` slot.
  - Body: loading skeleton, error alert, `renderEvaluatorMetrics?.(testcaseId)`, then `renderContent({initialPath, onPathChange})`.
  - Footer: Cancel / Apply / commit-and-save dropdown.
- [TestcaseDataEditor.tsx](web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.tsx) body:
  - `DrillInRootToolbar` (Testcase Data label + view-mode dropdown + collapse-all + copy-JSON).
  - `DrillInContent` with `fieldHeaderVariant="flat"`, per-field "View as ▾" dropdown, type chips, collapsible field rows.
  - View-only when `mode="view"` (no `onChange`).
  - `columns?: TestcaseDataEditorColumn[]` projects only the specified keys (works perfectly for "input fields the eval cares about").

What's **already done** that helps us:
- `value: Record<string, unknown>` — exactly the shape of `FlattenedTestcase.data`.
- `columns` projection — exactly the shape we need to drive input-column selection from the eval column group.
- `renderEvaluatorMetrics` slot — already in the API; we added it earlier in this session for this very migration.

What's **not** there:
- No Outputs section.
- No invocation-meta chips (app / variant / revision badges).
- No multi-section grouping (only one "Testcase Data" section today).
- No side-panel tree navigator.
- No URL state synchronization; open/close is React state.
- No compare mode.

---

## 4. Data alignment / shape compatibility

| Concept | Eval source | TestcaseDrawer expects | Compatibility |
|---|---|---|---|
| Testcase input | `scenarioTestcaseEntityAtomFamily(scenarioId, runId)` → `FlattenedTestcase` (uses the same global `testcase` molecule we already use) | `value: Record<string, unknown>` | ✅ Direct — already the same entity |
| Input columns | `group.kind === "input"` → `EvaluationTableColumn[]` with `path`, `valueKey`, `label` | `columns: TestcaseDataEditorColumn[]` with `key`, `name`, `label`, `pathMode` | ✅ Trivial mapper (`{key: column.valueKey, label: column.displayLabel, pathMode: "direct"}`) |
| Output blob | `scenarioStepsQueryFamily(scenarioId, runId)` → `{steps: IStepResponse[]}` where each invocation step has `output: any` | No prop today | 🟡 Needs new section / renderer |
| Output columns (per-invocation paths) | `group.kind === "invocation"` columns with `path` inside the step output | None | 🟡 Same as above |
| Invocation meta (app/variant/revision) | `useInvocationRefs(group, runId)` → app/variant/revision IDs + reference queries | None | 🟡 Needs a header slot or banner component |
| Evaluator metrics | `evaluationAnnotationQueryAtomFamily(traceId, runId)` → `AnnotationDto[]`; annotation columns under `group.kind === "annotation"` | `renderEvaluatorMetrics?(testcaseId)` slot exists | 🟡 Slot exists; the OSS adapter still needs to read annotations and produce nodes |
| Trace meta (traceId, latency) | `invocationTraceSummaryAtomFamily(scenarioId, runId)` | None | 🟡 Render inline with the Outputs section header |
| Online evaluation inputs | Trace/step payloads — inputs live in steps/traces, no separate testcase | Adapter supplies `inputValue: Record<string, unknown>` + projected columns | ✅ Use the same adapter model as regular evals; no legacy fallback |
| Online evaluation outputs/evaluator metrics/run metrics | Trace/step payloads + annotation/metric atoms | Adapter supplies normalized output/metric sections | ✅ Computed by adapter before rendering the shared drawer |
| Compare mode (N runs side-by-side) | `compareScenarioMatchesAtom` + synchronized horizontal scroll | Single-run | 🔴 Major feature gap |

**Key observation:** the eval drawer's input data already flows through the same `testcase` molecule we're already consuming. There is no parallel "eval testcase" entity. That's the strongest argument for unification: we're already 90% there for the inputs section; we just don't use the shared renderer.

For **online evaluations**, the same unification still applies, but the source is not a testcase entity. The evaluation adapter owns that difference: it reads trace/step data, computes inputs, outputs, evaluator metrics, and run metrics, then passes the same drawer-facing model used for regular evaluations. `TestcaseDrawer` and `TestcaseDataEditor` should not know whether a row came from a persisted testcase or an online trace.

---

## 5. Gap analysis — what TestcaseDrawer needs

### 5.1 Required new capability — Outputs section

The current TestcaseDrawer renders exactly one logical "Testcase Data" section. Evaluation needs at least two more conceptual sections (Outputs, Evaluator Metrics). Two design options:

**Option A — Render slots on the drawer shell**

Add to `TestcaseDrawerProps`:
- `renderOutputs?: (testcaseId: string) => ReactNode` — between testcase body and evaluator metrics.
- Keep `renderEvaluatorMetrics?` as it already is.

OSS adapter implements both, using `TestcaseDataEditor` for the outputs blob (because outputs are also `Record<string, unknown>` and benefit from the same drill-in + per-field View-as).

**Option B — Sectioned TestcaseDataEditor**

Extend `TestcaseDataEditor` with a `sections?: {label: string; value: Record<string, unknown>; columns?: TestcaseDataEditorColumn[]; headerSlot?: ReactNode}[]` prop and have it render N `DrillInRootToolbar + DrillInContent` blocks.

**Recommendation: Option A.** It localizes the eval-specific knowledge in the OSS adapter and keeps `TestcaseDataEditor` focused on a single field set. The drawer chrome already has slot conventions; this matches them.

### 5.2 Required new capability — section header chips

The current eval drawer renders app/variant/revision badges inside the Outputs section header (`InvocationMetaChips`). Today's `DrillInRootToolbar` only takes a string `label` plus collapse/copy/view-mode controls.

Add an optional `headerSlot?: ReactNode` to `DrillInRootToolbar` rendered between the label and the right-side controls. The OSS adapter passes the meta chips into it.

### 5.3 Required new capability — evaluator metrics rendering

`renderEvaluatorMetrics` already exists as a slot. What's missing is the OSS implementation. The shape we'd want:

```tsx
function EvaluatorMetricsAdapter({scenarioId, runId}: {...}) {
  const sections = useAtomValue(...annotation column groups...)
  return (
    <div className="flex flex-col gap-2">
      {sections.map(group => (
        <EvaluatorSection
          key={group.id}
          label={group.label}      // evaluator name
          columns={group.columns}  // metric paths
          scenarioId={scenarioId}
          runId={runId}
        />
      ))}
    </div>
  )
}
```

Inside `EvaluatorSection`, render one `MetricValuePill` per column using `useScenarioCellValue` + `formatMetricDisplay`. Same pipeline as today — just lifted into an adapter that consumers the existing focus-drawer slot.

Question for review: should evaluator metrics also be rendered through `TestcaseDataEditor` (treating each evaluator as a `columns`-driven view)? **No** — metrics are visually pills, not field rows; forcing them through DrillIn would be a regression. Keep them as a dedicated adapter.

### 5.4 Compare mode — see §6.4 for the full plan

Compare is a major piece of UX (`FocusDrawerCompareContent`, synchronized horizontal scroll across N runs, section rows aligned across columns). It is fundamentally different from single-scenario rendering and needs its own design pass. The full architectural plan with three options + recommendation lives in [§6.4](#64-compare-mode-architecture-plan).

In phase 1–3, compare URLs continue to render the legacy `FocusDrawer` so we never block the cutover on compare design.

### 5.5 Side panel tree navigator — dropped

**Decision (2026-05-19):** drop the side panel entirely for this migration.

Rationale:
- `EnhancedDrawer` (used by `TestcaseDrawer` today) does **not** support a side panel; introducing one would require either swapping to `GenericDrawer` or adding `sideContent` to `EnhancedDrawer`. Both ripple across every existing `TestcaseDrawer` consumer (testset table, playground focus drawer).
- The tree navigator's value is incremental — section-anchor jumping is a nice-to-have, not load-bearing for the read-only flow.
- Skipping it keeps `TestcaseDrawer`'s shell stable and avoids a drawer-primitive refactor that's out of scope for this migration.

No new slots, no shell changes. Users will scroll the drawer body to reach lower sections (Outputs, Evaluator Metrics) — same as the playground focus drawer today.

### 5.6 Pure-view mode requirement (no edit, ever)

**Decision (2026-05-19):** the evaluation surface is view-only forever — there is no future edit toggle.

Today `TestcaseDrawer` always renders an Apply / Cancel / commit-and-save footer and tracks `sessionStartDraft` / `everDirtyIds` for the edit lifecycle. None of that applies to eval.

Add a `viewOnly?: boolean` prop to `TestcaseDrawerProps`. When `true`:
- Footer is not rendered (the entire `<div className="w-full flex items-center justify-end gap-3">` block is skipped).
- "edited" badge in the title is never shown.
- `sessionStartDraftsRef` / `everDirtyIds` / `handleApply` / `onRestoreSessionStart` are no-ops or unused.
- `isDirty` prop becomes irrelevant (still accepted to keep the API stable, but unused).

OSS adapter passes `viewOnly` and omits the dirty-tracking props. Same flag also flips `TestcaseDataEditor` to `mode="view"`.

### 5.7 Section ordering — Inputs → Outputs → Evaluator Metrics

**Decision (2026-05-19):** evaluator metrics render **after** outputs, not above the testcase data.

Current state in [TestcaseDrawer.tsx](web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx):

```tsx
{testcaseData && testcaseId && renderEvaluatorMetrics?.(testcaseId)}
{testcaseData && renderContent({...})}
```

That places metrics *above* the body. We need to reorder so the slots render in this order:
1. `renderContent({initialPath, onPathChange})` — Inputs
2. `renderOutputs?.(testcaseId)` — Outputs (new slot, phase 2)
3. `renderEvaluatorMetrics?.(testcaseId)` — Metrics (existing slot, moved down)

The slot move is a one-line shuffle. It is a **breaking change** for the slot's render position, but currently no consumer uses `renderEvaluatorMetrics` in production (we added it earlier in this branch for this very migration), so the risk is contained to this branch.

### 5.8 Required — URL state synchronization

Eval drawer state lives in the URL (`?focusRunId=...&focusScenarioId=...&compareMode=...`). The TestcaseDrawer is opened by parent state. The OSS adapter must:
- Read URL params → derive `open` + `testcaseId` + prev/next callbacks.
- Write URL params on prev/next/close (mirroring `patchFocusDrawerQueryParams`).

This is adapter-level, doesn't change `TestcaseDrawer` itself.

### 5.9 Required — evaluation adapter boundary

The new work should be named and implemented as an **adapter**, not as a new drawer primitive and not inside the existing `TestcaseEditDrawer`.

Why not `web/oss/src/components/SharedDrawers/TestcaseDrawer/index.tsx`?
- That file is the **testset edit adapter**. It owns testcase entity lookup, draft mutation, dirty state, restore-on-cancel, commit/save behavior, and the Add-to-queue button.
- Evaluation needs different ownership: URL-driven run/scenario state, compare fallback, trace/step extraction, view-only mode, outputs, evaluator metrics, and run metrics.
- Combining those concerns would make the testset drawer harder to reason about and would risk regressions in existing edit flows.

Recommended boundary:
- Shared shell: `web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx`
- Shared field renderer/editor: `web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.tsx`
- Existing testset adapter: `web/oss/src/components/SharedDrawers/TestcaseDrawer/index.tsx`
- New evaluation adapter: `web/oss/src/components/EvalRunDetails/components/EvalTestcaseDrawerAdapter/`

The adapter should normalize every eval source into a drawer-facing model:

```ts
interface EvalTestcaseDrawerModel {
  drawerItemId: string              // stable ID passed to TestcaseDrawer; testcaseId ?? scenarioId
  sourceTestcaseId: string | null   // real testcase ID when one exists
  displayId: string                 // ID shown/copied in the header
  inputValue: Record<string, unknown>
  inputColumns: TestcaseDataEditorColumn[]
  outputSections: EvalDrawerOutputSection[]
  evaluatorMetricSections: EvalDrawerMetricSection[]
  runMetricSections: EvalDrawerMetricSection[]
  scenarioNumber: number | null
}
```

Regular evaluations populate this model from testcase + scenario step atoms. Online evaluations populate it from trace/step payloads. The rendering layer consumes only the normalized model.

Important identity rule: `TestcaseDrawer` currently gates rendering on a truthy `testcaseId`. The eval adapter must always pass a stable `drawerItemId` as that prop. For regular evals this is the real testcase ID; for online evals this is the scenario ID. Keep `sourceTestcaseId` separate so the adapter never pretends an online scenario has a persisted testcase.

---

## 6. Phased migration plan

### Phase 1 — Single-run, inputs only (smallest viable cutover)

**Deliverables**
- Env flag: add `NEXT_PUBLIC_AGENTA_EVAL_UNIFIED_DRAWER` to `api/oss/src/utils/env.py` is **not** needed since this is a frontend-only switch — consume via `getEnv("NEXT_PUBLIC_AGENTA_EVAL_UNIFIED_DRAWER")` from `@/oss/lib/helpers/dynamicEnv` in a small helper:
  ```ts
  // web/oss/src/components/EvalRunDetails/state/unifiedDrawerFlag.ts
  export const evalUnifiedDrawerEnabledAtom = atom(
    () => getEnv("NEXT_PUBLIC_AGENTA_EVAL_UNIFIED_DRAWER") === "true",
  )
  ```
  Also add the key to `web/oss/src/lib/helpers/dynamicEnv.ts`; otherwise `getEnv(...)` cannot read the build-time value. If this repo does not maintain `web/oss` / `web/ee` `.env.example` files, document the variable in this plan and any environment docs touched by the implementation.
- New file: `web/oss/src/components/EvalRunDetails/components/EvalRunFocusDrawerMount.tsx`
  - Reads `evalUnifiedDrawerEnabledAtom` and `focusScenarioAtom`.
  - Renders `<EvalTestcaseDrawerAdapter />` when the flag is true and `focus.compareMode !== true`.
  - Renders legacy `<FocusDrawer />` when the flag is false or compare mode is true.
  - Replace the `EvalRunFocusDrawerPreview` dynamic import in `AppGlobalWrappers` with this mount wrapper. Do not switch at the page level; the drawer is globally mounted.
- New folder: `web/oss/src/components/EvalRunDetails/components/EvalTestcaseDrawerAdapter/`
  - Reads `focusScenarioAtom` for `{focusRunId, focusScenarioId, testcaseId, scenarioIndex}`.
  - Builds an `EvalTestcaseDrawerModel` from the current run/scenario.
  - For regular evals, resolves testcase input through `scenarioTestcaseIdAtomFamily` / `scenarioTestcaseEntityAtomFamily`.
  - For online evals, computes input data from trace/step payloads instead of falling back to legacy.
  - Builds `inputColumns` from `columnResult.groups.find(g => g.kind === "input").columnIds.map(id => columnMap.get(id))`.
  - Renders `TestcaseDrawer` with `viewOnly`, `mode="view"`, `surface="drawer"`, prev/next from scenario index navigation.
  - URL sync via the existing `urlFocusDrawer` helpers.
- `TestcaseDrawer` shell changes (entity-ui package):
  - Add `viewOnly?: boolean` → hides the footer when true (see §5.6).
  - Add a small display/copy override if needed for eval identity, e.g. `displayId?: string` / `copyId?: string`, so online rows can pass `testcaseId={scenarioId}` for render identity without misleading downstream UI.
  - Keep default behavior unchanged for testset and playground consumers.
- Mount switch at the global eval drawer mount:
  ```tsx
  const useUnified = useAtomValue(evalUnifiedDrawerEnabledAtom)
  return useUnified && !target?.compareMode
    ? <EvalTestcaseDrawerAdapter />
    : <FocusDrawer />  // legacy
  ```
  Note the explicit `!target?.compareMode` guard — compare URLs always go to legacy in phase 1–3.

**Acceptance**
- With `NEXT_PUBLIC_AGENTA_EVAL_UNIFIED_DRAWER=true`: clicking a row on the eval results page opens the unified drawer; inputs render via `TestcaseDataEditor`; no outputs/metrics yet.
- Online evaluation rows with no testcase ID still open the unified drawer; the adapter supplies trace/step-derived inputs to `TestcaseDataEditor`.
- Prev/next navigation works (URL params update; new scenario loads).
- Compare URLs (`?compareMode=true`) continue to open the legacy drawer.
- With the flag unset/false: legacy drawer everywhere (zero behavior change).

**Estimated effort:** 1–2 days, mostly wiring + URL adapter + `viewOnly` plumbing.

### Phase 2 — Outputs section

**Deliverables**
- Reorder `TestcaseDrawer` body slots: `renderContent` → `renderOutputs` → `renderEvaluatorMetrics` (see §5.7).
- Add `renderOutputs?: (testcaseId: string) => ReactNode` slot to `TestcaseDrawer` (renders between content and evaluator metrics).
- Add `headerSlot?: ReactNode` to `DrillInRootToolbar` for app/variant/revision chips.
- In `EvalTestcaseDrawerAdapter`:
  - For each `group.kind === "invocation"`, render a `TestcaseDataEditor` instance (`mode="view"`, `value=stepOutput`, `columns=invocationColumns`).
  - For online evals, the same output section shape is computed from the trace/step payload before rendering.
  - `headerSlot` hosts `InvocationMetaChips` (lifted from legacy drawer).
  - Trace meta (traceId, latency) rendered as a small footnote inside each invocation section.

**Acceptance**
- Outputs visible for single-step (most common) and chain (multi-step) runs.
- Variant/app/revision badges match legacy.
- Slot order produces Inputs → Outputs → (Metrics in phase 3) visually.

**Estimated effort:** 2–3 days.

### Phase 3 — Evaluator metrics (rendered AFTER outputs)

**Deliverables**
- New OSS component: `EvaluatorMetricsAdapter` that consumes `evaluationAnnotationQueryAtomFamily` + annotation column groups and renders metric pills/sections.
- Wire it into `TestcaseDrawer` via the existing `renderEvaluatorMetrics` slot — which by now (post-phase-2) renders **after** `renderOutputs`.
- Extend the eval model so online evals and regular evals both provide evaluator metric sections and run metric sections through the same adapter contract.
- Reuse `formatMetricDisplay`, `MetricValuePill`, `MetricDetailsPreviewPopover` — these stay in OSS; we are not promoting them.
- Static metric definitions: include `group.staticMetricColumns` alongside dynamic columns (see Risk #3 in §7).

**Acceptance**
- Each evaluator block visually matches legacy (pills, popover on click).
- Skipped / errored evaluators show the same fallback states.
- Final section order in the body: Inputs → Outputs → Evaluator Metrics.

**Estimated effort:** 2–3 days.

### Phase 4 — Compare mode

Detailed architectural plan in [§6.4](#64-compare-mode-architecture-plan). Phase content depends on which option is chosen; recommended option (A — separate shell) is sized at ~1–2 weeks.

Until phase 4 lands, compare URLs continue to open the legacy `FocusDrawer` (the env-flag wiring in phase 1 already does `!target?.compareMode` to keep this invariant).

### Phase 5 — Retire legacy

**Deliverables**
- Delete `EvalRunDetails/components/FocusDrawer.tsx` (1551 LOC) + supporting helpers no longer used:
  - `FocusDrawerHeader.tsx`, `FocusDrawerSidePanel.tsx`, `FocusDrawerCompareContent.tsx` if separate
  - `useFocusDrawerSections`, `InvocationMetaChips` (or move to shared lib if reused)
  - `renderScenarioChatMessages` (replaced by `TestcaseDrillInFieldRenderer`)
- Audit and remove atoms / hooks now unreferenced (the eval data atoms stay; only the legacy renderer goes).
- Flip env flag default to `true`, then remove the flag entirely after a release.

### 6.4 Compare mode architecture plan

Three options, with concrete trade-offs:

#### Option A — Separate `EvalCompareDrawer` shell (recommended)

A new top-level drawer just for compare. `TestcaseDrawer` stays single-scenario.

**Shape**
- New file: `web/oss/src/components/SharedDrawers/EvalCompareDrawer/index.tsx`.
- Renders `GenericDrawer` directly (or a thin `CompareDrawerShell` if we want to share chrome with `TestcaseDrawer` later).
- Body layout: section-major grid. Each row is a section (Inputs / Outputs / each Evaluator); each cell in a row is a `TestcaseDataEditor` (or thin equivalent) for one run. Cells in a row share a horizontal-scroll container with synchronized scroll (port `CompareSectionRow` / `CompareMetaRow` logic from legacy).
- Title: "Comparing N scenarios" + the testcase identifier (since all N columns share a testcase).
- No prev/next at the per-scenario level — instead, scenario-set navigation walks through all matching scenarios across the compared runs. (Same model as legacy `compareScenarioMatchesAtom`.)
- No footer (view-only).

**Pros**
- `TestcaseDrawer` stays focused on single-scenario. No conditional spaghetti in the shared package.
- Compare-only complexity contained in OSS.
- Shared building blocks (`TestcaseDataEditor`, `DrillInRootToolbar`, type chips, view-mode dropdown) are reused per cell — convergence is preserved at the cell level even though the shell is bespoke.
- Easy to evolve compare UX independently (e.g. diff highlights between columns) without touching `entity-ui`.

**Cons**
- Two drawer shells to maintain long-term (single vs compare). Mitigated by sharing `GenericDrawer` + factoring chrome into small helpers (close button, expand toggle, scenario-set navigator).
- Section ordering / labeling must be kept in sync with single-mode drawer.

**Effort**: 1–2 weeks.

#### Option B — Extend `TestcaseDrawer` natively (compare baked in)

Add `compareTestcaseIds?: string[]` (alternative to `testcaseId`) and let `TestcaseDrawer` render N columns when set.

**Shape**
- `TestcaseDrawer` body becomes a switch: `testcaseId` → single column (today's behavior); `compareTestcaseIds` → N columns in a row-aligned grid.
- Header chrome adapts ("Testcase 3 of 100" → "Comparing 5 scenarios").
- Footer hidden when `compareTestcaseIds` is set (always view-only).

**Pros**
- Single drawer API; consumers compose with one component regardless of compare or not.
- Less surface duplication.

**Cons**
- API complexity bleeds into every `TestcaseDrawer` consumer. Testset and playground will never need compare, so they pay the complexity tax for nothing.
- Synchronized-scroll, row-alignment, and scenario-set navigation logic lives inside `entity-ui` — a UI library package shouldn't know about evaluation-run semantics.
- The chrome behavior (footer, title, edited badge, prev/next) becomes a conditional tangle.

**Effort**: 1.5–2 weeks. Slightly higher than Option A because the package boundary makes it harder to test and refactor.

#### Option C — Injectable compare layout (drawer as shell + plug body)

Add a `renderBody?: (props) => ReactNode` slot to `TestcaseDrawer`. The compare adapter passes its own renderBody that renders the row-major grid, while still using the shell's chrome.

**Shape**
- `TestcaseDrawer` becomes a render-prop shell: chrome (close, title, prev/next, footer) is provided by the shell; the body is fully overridden via `renderBody` for compare.
- Add chrome-customization props: `titleOverride?: ReactNode`, `hidePrevNext?: boolean`, plus the `viewOnly` we already need.

**Pros**
- Maximum flexibility; `entity-ui` stays neutral about layout.
- The shell becomes generic enough to support future drawer variants too.

**Cons**
- Chrome semantics are still single-scenario-shaped (prev/next is per-scenario, title is per-scenario). The compare adapter needs override after override.
- At some point, "shell with everything overridable" is just two drawers in a trenchcoat — the abstraction does not pay for itself.
- Risk of `TestcaseDrawer` becoming a god-component over time.

**Effort**: 1.5–2 weeks, plus ongoing API maintenance cost.

#### Recommendation

**Option A (separate `EvalCompareDrawer` shell).**

Reasoning:
- The chrome semantics for compare are genuinely different from single-scenario (no per-scenario prev/next, no "Testcase N of M" title, scenario-set navigation instead).
- The body layout is genuinely different (row-major matrix vs single column stack).
- Keeping `TestcaseDrawer` focused on single-scenario keeps its API clean and its package boundary honest — `entity-ui` should not know about "evaluation runs" or "compare N scenarios".
- Shared building blocks (`TestcaseDataEditor`, `DrillInRootToolbar`, field renderer, type chips) factor cleanly and are reused per cell. The convergence we want lives at the cell level, not the shell level.
- Maintenance cost is bounded because the shell is mostly `GenericDrawer` + thin grid; the per-cell rendering is fully shared.
- Migrating to Option B in the future (if compare becomes a first-class `TestcaseDrawer` mode) is straightforward from this starting point — we'd just lift the body grid into `entity-ui`. The reverse migration (B → A) is harder.

If we ever need to compare *testset rows* (not eval scenarios), we can reuse `EvalCompareDrawer`'s patterns or generalize the shell at that point. Don't speculate ahead.

---

## 7. Risks, blockers, open questions

### Risks

1. **Compare mode regression.** If we ship phases 1–3 behind a flag while compare flows still use legacy, we have two drawers in production. Acceptable, but watch the cleanup.
2. **Online evaluation adapter parity.** Some scenarios don't have a real testcase — inputs live inside trace/step payloads. The adapter must compute the same normalized model (`inputValue`, outputs, evaluator metrics, run metrics) instead of falling back to legacy.
3. **Static metric columns.** Some evaluator metrics come from `group.staticMetricColumns` (definitions, not data). The Outputs/Metrics adapter needs to merge these with dynamic columns so we don't drop them.
4. **Section ordering.** Today the drawer's order follows the column groups' `order`. The new shell needs to preserve that (Inputs → Outputs → Evaluators), not invent its own.
5. **Per-step granularity for chains.** Multi-step invocations expose multiple output blobs. Phase 2 needs to render *all* invocation sections, not just the first one, to match the legacy behavior.
6. **`JsonEditor` parity.** Legacy uses `@agenta/ui/editor` directly with `disabled`. TestcaseDataEditor's `TestcaseDrillInFieldRenderer` uses the same `SharedEditor` under the hood. Confirm view-mode rendering is visually equivalent (no edit affordances, no toolbar).
7. **URL adapter complexity.** `urlFocusDrawer.ts` is non-trivial — touch carefully. Cover the open/close/navigate cases.

### Blockers

None. All required data atoms already exist. The work is purely composition.

### Decisions (2026-05-19, locked)

1. **Compare mode** — phase 4 builds **Option A: separate `EvalCompareDrawer` shell** (full plan in §6.4). Phases 1–3 ship under an env flag with compare URLs always falling through to legacy.
2. **Side panel** — **dropped** for this migration (see §5.5). No new slots; body scroll only.
3. **Evaluator metrics placement** — after outputs. Slot ordering rewired in phase 2: `renderContent` (Inputs) → `renderOutputs` → `renderEvaluatorMetrics` (see §5.7).
4. **Edit affordance** — view-only forever. No future edit toggle. `viewOnly` prop on `TestcaseDrawer` hides the footer + dirty tracking (see §5.6).
5. **Feature-flag mechanism** — env flag. `NEXT_PUBLIC_AGENTA_EVAL_UNIFIED_DRAWER` consumed via `getEnv()` (see Phase 1 deliverables).
6. **Online evaluations** — use an adapter design. The adapter takes trace/step data, computes inputs, outputs, evaluator metrics, and run metrics, then provides the same standard drawer model used for other evaluations. No row-level legacy fallback for online evaluations.
7. **Adapter boundary** — do **not** add evaluation behavior to the existing `SharedDrawers/TestcaseDrawer` / `TestcaseEditDrawer` adapter. That component remains the testset edit adapter. Evaluation gets its own `EvalTestcaseDrawerAdapter` over the shared `TestcaseDrawer` shell.

### Remaining items to validate during implementation

These didn't need explicit decisions, but they should be checked off as the phases land:

- **Static metric columns** (Risk #3) — confirm the OSS adapter merges `group.staticMetricColumns` with dynamic columns at phase 3 review.
- **Online evaluations** (Risk #2) — validate that trace/step-derived inputs, outputs, evaluator metrics, and run metrics all populate the normalized adapter model and render through the unified drawer.

---

## 8. Feasibility verdict

**Yes — this migration is feasible and well-shaped.**

The strongest reason: regular evaluation rows **already** source inputs from the same global `testcase` molecule we're consuming in the testset and playground flows. Online evaluation rows are different, but the difference is isolated to the adapter: trace/step data can be normalized into the same drawer-facing model. There is no reason to fork the drawer UI. Outputs and evaluator metrics need new slots, but those are purely additive on the `TestcaseDrawer` shell, and the underlying data fetchers (`scenarioStepsQueryFamily`, `evaluationAnnotationQueryAtomFamily`) are already in place and battle-tested.

The hardest item is compare mode, and we have a clean escape hatch (phase 4 / keep legacy alive behind a route condition) that lets the unification land incrementally.

**Estimated total effort to phase 3 completion: ~1.5–2 weeks.** Compare-mode redesign is a separate budget.

---

## 9. Appendix — concrete file pointers

### Eval drawer
- Global mount: [web/oss/src/components/AppGlobalWrappers/index.tsx](web/oss/src/components/AppGlobalWrappers/index.tsx)
- Shell: [web/oss/src/components/EvalRunDetails/components/FocusDrawer.tsx](web/oss/src/components/EvalRunDetails/components/FocusDrawer.tsx) (1551 LOC)
- State: [web/oss/src/components/EvalRunDetails/state/focusDrawerAtom.ts](web/oss/src/components/EvalRunDetails/state/focusDrawerAtom.ts)
- URL sync: [web/oss/src/components/EvalRunDetails/state/urlFocusDrawer.ts](web/oss/src/components/EvalRunDetails/state/urlFocusDrawer.ts)
- Side panel: `web/oss/src/components/EvalRunDetails/components/FocusDrawerSidePanel.tsx`
- Header: `web/oss/src/components/EvalRunDetails/components/FocusDrawerHeader.tsx`
- Sections data: `web/oss/src/components/EvalRunDetails/hooks/usePreviewTableData.ts`, `atoms/table/columnAccess.ts`

### Data atoms (reused as-is)
- Testcase: [web/oss/src/components/EvalRunDetails/atoms/scenarioTestcase.ts](web/oss/src/components/EvalRunDetails/atoms/scenarioTestcase.ts)
- Steps (outputs): [web/oss/src/components/EvalRunDetails/atoms/scenarioSteps.ts](web/oss/src/components/EvalRunDetails/atoms/scenarioSteps.ts)
- Annotations (metrics): [web/oss/src/components/EvalRunDetails/atoms/annotations.ts](web/oss/src/components/EvalRunDetails/atoms/annotations.ts)
- Per-cell hook: [web/oss/src/components/EvalRunDetails/hooks/useScenarioCellValue.ts](web/oss/src/components/EvalRunDetails/hooks/useScenarioCellValue.ts)
- Column types: [web/oss/src/components/EvalRunDetails/atoms/table/types.ts](web/oss/src/components/EvalRunDetails/atoms/table/types.ts)

### Testcase drawer (target)
- Shell: [web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx](web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx)
- Editor: [web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.tsx](web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.tsx)
- Field renderer: [web/packages/agenta-entity-ui/src/testcase/TestcaseDrillInFieldRenderer.tsx](web/packages/agenta-entity-ui/src/testcase/TestcaseDrillInFieldRenderer.tsx)
- Drill-in root toolbar: [web/packages/agenta-ui/src/drill-in/core/DrillInRootToolbar.tsx](web/packages/agenta-ui/src/drill-in/core/DrillInRootToolbar.tsx)

### Existing unified adapters (reference patterns)
- Testset table: [web/oss/src/components/SharedDrawers/TestcaseDrawer/index.tsx](web/oss/src/components/SharedDrawers/TestcaseDrawer/index.tsx)
- Playground focus: [web/packages/agenta-playground-ui/src/components/FocusDrawer/index.tsx](web/packages/agenta-playground-ui/src/components/FocusDrawer/index.tsx)
