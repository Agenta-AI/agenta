# Unified Testcase Editor — Audit & Gap Analysis

**Date:** 2026-05-19
**Branch:** `feat-frontend/testcase-view-update`
**Status:** Audit
**Purpose:** Compare current implementation against design Proposal V2 (per-field view-type dropdown) and identify functional gaps, UI/UX gaps, and next iteration work.

---

## 1. Context

The goal is **one unified testcase data editor** used by three surfaces:

| Surface | Mode | Wrapper |
|---|---|---|
| Testset table drawer (edit) | `edit` / `drawer` | [TestcaseEditDrawer/index.tsx](web/oss/src/components/TestcasesTableNew/components/TestcaseEditDrawer/index.tsx) |
| Playground (edit) | `edit` / `playground` | [PlaygroundTestcaseEditor.tsx](web/oss/src/components/Playground/Components/PlaygroundTestcaseEditor.tsx) |
| Read-only previews (view) | `view` / `inline` | (not yet wired) |

The shared editor lives at [TestcaseDataEditor.tsx](web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.tsx) and the drawer shell at [TestcaseDrawer.tsx](web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx).

**Design reference:** [ProposalV2DrillIn.tsx](web/apps/design-mockups/src/components/proposed/ProposalV2DrillIn.tsx) (Row 2 of [solutions-drill-in.tsx](web/apps/design-mockups/src/pages/solutions-drill-in.tsx)).

---

## 2. Functional Work Completed

| Plan Task | Status | Evidence |
|---|---|---|
| 1. Public types + pure helpers | DONE | [TestcaseDataEditor.types.ts](web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.types.ts), [TestcaseDataEditor.utils.ts](web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.utils.ts) |
| 2. `TestcaseDataEditor` drill-in component + editable field renderer | DONE | [TestcaseDataEditor.tsx](web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.tsx), [TestcaseDrillInFieldRenderer.tsx](web/packages/agenta-entity-ui/src/testcase/TestcaseDrillInFieldRenderer.tsx) |
| 3. `TestcaseCompactRows` for playground surface | **INTENTIONALLY DROPPED** | See 3.6 |
| 4. Package exports | DONE | [index.ts](web/packages/agenta-entity-ui/src/testcase/index.ts) |
| 5. Migrate testset table drawer to `TestcaseDataEditor` | DONE | [TestcaseEditDrawer/index.tsx](web/oss/src/components/TestcasesTableNew/components/TestcaseEditDrawer/index.tsx), [SharedDrawers/TestcaseDrawer/index.tsx](web/oss/src/components/SharedDrawers/TestcaseDrawer/index.tsx) |
| 6. Migrate playground editor to `TestcaseDataEditor` | PARTIAL | [PlaygroundTestcaseEditor.tsx](web/oss/src/components/Playground/Components/PlaygroundTestcaseEditor.tsx) uses shared editor with `surface="playground"`, but still owns its own Fields/JSON toggle (see 3.7) |
| 7. Read-only mode pass | NOT STARTED | No `mode="view"` call site exists yet |
| 8. Cleanup old duplication | NOT STARTED | `EntityDualViewEditor` and OSS `DrillInView/` still imported in playground for JSON editor |

**Net summary:** Tasks 1, 2, 4, 5 complete. Task 6 partially complete. Tasks 7, 8 not done. Task 3 dropped on purpose.

---

## 3. Gap vs Design Proposal V2

Proposal V2 ([ProposalV2DrillIn.tsx](web/apps/design-mockups/src/components/proposed/ProposalV2DrillIn.tsx)) defines the target visual model. The current implementation diverges from it in seven concrete ways.

### 3.1 Root toolbar — should be removed in V2, currently present

**V2:** No global root toolbar. View mode is **per-field only**. The drawer body is flat — fields stack directly under the drawer chrome header.

**Current:** [TestcaseDataEditor.tsx:81-90](web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.tsx#L81-L90) renders `DrillInRootToolbar` whenever `features.rootViewMode` is true (default for `drawer` and `playground` surfaces). This produces:
- A label row + "View as ▾" dropdown + collapse-all + copy buttons above the field list.
- A duplicated "View as ▾" affordance — once at root, once on every field.

**Why this conflicts:** V2's intent was to *replace* the global view mode with per-field control. Today we ship both.

**Fix direction:** Either drop the root toolbar entirely in the drawer surface, or repurpose it as a label-only header (no view-mode dropdown). Move collapse-all + copy into the drawer chrome title bar (next to "edited" badge + Add to queue) instead of a separate row.

### 3.2 Field header — too many controls, wrong chrome

**V2:** Each field has a flat row, `borderBottom: 1px solid rgba(5,23,41,0.06)`, white background, **only**:
- Left: field name + small kind chip (`string` / `boolean` / `object` / `chat`)
- Right: single "View as ▾" dropdown

**Current:** [DrillInFieldHeader.tsx:515](web/packages/agenta-ui/src/drill-in/core/DrillInFieldHeader.tsx#L515) renders inside `bg-[#FAFAFA] rounded-md border-solid border-[1px] border-[rgba(5,23,41,0.06)]` with up to six controls on the right: view-mode dropdown, copy, raw toggle, markdown toggle, drill-in button, map pin, delete.

**Fix direction:** Add a `headerVariant: "v2-flat" | "legacy"` prop to `DrillInContent` (or a slim `slim`/`bare` field-header variant) so the testcase surface can pick the flat row, while other drill-in consumers (trace span, evaluator) keep the existing chrome. The set of controls to **drop** for the testcase surface:
- raw mode toggle (covered by per-field JSON view mode)
- markdown toggle (covered by per-field markdown view mode)
- drill-in chevron button (V2 collapses nested objects inline via the Form/JSON view, no "drill in")
- copy (move to root or drop)
- delete + map (preserve only on the testset drawer surface, hide in playground)

### 3.3 Type chip — wrong vocabulary at top level

**V2:** The chip shows the **4-way top-level kind**: `string` / `boolean` / `object` / `chat` (see [proposalV2Views.ts:detectFieldKind](web/apps/design-mockups/src/components/proposed/proposalV2Views.ts#L51)). Numbers, nulls, primitive non-string scalars bucket as `string`. Arrays that aren't message arrays bucket as `object`.

**Current:** [TestcaseDataEditor.tsx:123-127](web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.tsx#L123-L127) injects `<TypeChip value={fieldValue} />`. Internal `inferVariant` resolves to the **6-way primitive vocabulary** (`string` / `number` / `boolean` / `null` / `json-object` / `json-array`) — see [type-chip system spec](docs/superpowers/specs/2026-05-12-type-chip-system-design.md).

**Fix direction:** Three options:
1. Add an `intent: "primitive" | "v2-toplevel"` prop to `TypeChip` so the same component can produce either vocabulary.
2. Pass a custom `getFieldTypeChip` from the testcase surface that wraps `TypeChip` with a v2-aware `variant` prop (cheapest — no changes to TypeChip).
3. Decide globally that primitives = 4-way and patch `inferVariant`. (Risky — affects every surface using TypeChip.)

Recommend option 2.

### 3.4 Per-field view options — wrong defaults and missing "Chat" / "Form" routes

**V2:** [getViewOptions](web/apps/design-mockups/src/components/proposed/proposalV2Views.ts#L81) yields:
- string → `[text (default), markdown, json, yaml]`
- boolean → `[text (default), json, yaml]`
- chat → `[chat (default), json, yaml]`
- object → `[form (default), json, yaml]`

**Current:** `TestcaseDataEditor` passes [`getViewOptions` from `@agenta/ui/drill-in`](web/packages/agenta-ui/src/drill-in/utils/getViewOptions.ts) which produces a different set (text/markdown/json/yaml/form) but **no `chat` option**. The field renderer also does not branch on `viewMode === "chat"`, so picking it would no-op.

**Fix direction:**
- Extend `getViewOptions` (or wrap it at the testcase surface) to add the `chat` option for message-shaped arrays.
- Teach [TestcaseDrillInFieldRenderer.tsx](web/packages/agenta-entity-ui/src/testcase/TestcaseDrillInFieldRenderer.tsx) to dispatch on `viewMode`:
  - `text` → SharedEditor plain text (current default branch)
  - `markdown` → SharedEditor markdown
  - `chat` → `ChatMessageList` from `@agenta/ui/chat-message`
  - `form` → recursive form view (Task 3 of V2 plan — uses `JsonObjectField` rail-style under flag `enableFormView`)
  - `json` / `yaml` → CodeEditor (current branch)

### 3.5 Form view — intentionally not wired

**V2:** Object values default to a labelled "Form" view (indent + vertical rail per nested level).

**Decision:** Skip the dedicated Form view for now. JSON/YAML cover object editing; the per-field view-mode dropdown stays without a `form` option. `enableFormView={false}` in [TestcaseDataEditor.tsx:88](web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.tsx#L88) is deliberate.

No work required.

### 3.6 Playground compact rows — intentionally dropped

**V2 / Plan Task 3:** Playground was originally specced to use a `TestcaseCompactRows` component with collapsed preview lines.

**Decision:** Drop the compact-rows concept. The playground shares the same flat-section V2 layout as the drawer. `surface="playground"` may still resolve different defaults later (e.g. tighter spacing) but does not branch into a separate component.

No work required for plan Task 3 (`TestcaseCompactRows.tsx` file). The `compactRows` feature flag and resolved-feature plumbing in [TestcaseDataEditor.utils.ts](web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.utils.ts) can be removed during cleanup.

### 3.7 Playground still owns its own Fields/JSON toggle

**V2:** No Fields/JSON segmented control. JSON is one of the per-field view options.

**Current:** [PlaygroundTestcaseEditor.tsx:168-199](web/oss/src/components/Playground/Components/PlaygroundTestcaseEditor.tsx#L168-L199) renders a custom Fields/JSON toggle in its header. When toggled to JSON it shows a separate `JsonEditorWithLocalState` for the entire data object.

**Fix direction:**
- Drop the Fields/JSON toggle.
- Provide a "View entire data as JSON" option at the root toolbar (or simply rely on each field's "View as JSON").
- Remove `JsonEditorWithLocalState` import from `PlaygroundTestcaseEditor.tsx` (Task 8 cleanup).

---

## 4. Drawer Shell Gaps (out-of-scope of Proposal V2 but on-branch)

These are not visual-design gaps — they are workflow/UX issues in the shell that wraps the editor.

### 4.1 Edit-mode segmented control was removed from drawer shell, but stay in renderContent props

[TestcaseDrawer.tsx](web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx) no longer renders the Fields/JSON `Segmented` in the title bar (it was removed during the V2-style refactor). But it still passes `editMode` + `onEditModeChange` through `TestcaseDrawerContentRenderProps` — currently unused downstream. This is dead state.

**Fix:** Drop `editMode` from `TestcaseDrawerContentRenderProps` once playground no longer needs its own JSON toggle (see 3.7).

### 4.2 "Apply and Continue Editing" / "Apply and Commit" / "Apply and Save Testset"

[TestcaseDrawer.tsx:236-285](web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx#L236-L285) has three commit-style buttons. The design mockups do not yet show this footer — confirm with design whether the three-button structure is final or should collapse to a single primary action with a kebab.

### 4.3 No evaluator-metric rendering hook

The user-stated requirement: *"render the test case evaluator metrics on the drawer based on flags from traces"*. The current shell has no slot for evaluator metric chips/rows. This will need:
- A `renderEvaluatorMetrics?: (testcaseId) => ReactNode` render prop on `TestcaseDrawerProps`.
- A wrapper in the testset-table adapter that subscribes to the run's annotations/metrics for this testcase and renders chips above or below the data editor.

Reference for evaluator metric chips: [TraceDrawer](#) (not opened yet; cross-check during implementation).

---

## 5. Concrete Punch List for Next Iteration

Ordered by impact ÷ effort.

### High impact, low effort
1. **Drop the global root toolbar in the drawer surface** (3.1). Move collapse-all + copy buttons into the drawer chrome title bar.
2. **Fix type-chip vocabulary at top level** (3.3). Add `getFieldTypeChip` adapter at the testcase surface that maps to v2 4-way vocabulary.
3. **Add `chat` option to per-field view dropdown** (3.4). Wrap `getViewOptions` at the testcase surface.
4. **Remove playground Fields/JSON toggle** (3.7). Delete `editMode` state, `toolbar` JSX, and the JSON branch from `PlaygroundTestcaseEditor.tsx`.

### High impact, medium effort
5. **Flat field-header variant** (3.2). Introduce `headerVariant="flat"` on `DrillInContent` (or a `slim` flag) and strip raw/markdown/drill-in/copy buttons for the testcase surface.
6. **Wire `chat` viewMode branch in `TestcaseDrillInFieldRenderer`** (3.4). Branch on `viewMode` so picking `chat` actually renders `ChatMessageList`. (`form` view is intentionally out — see 3.5.)

### Lower priority / future
7. **Evaluator metric slot** (4.3). Add `renderEvaluatorMetrics` render prop and wire it in the testset-table drawer adapter.
8. **Read-only mode call site** (Task 7 of original plan). Wire one `mode="view"` consumer (testset preview drawer or trace span input preview) to exercise the read-only path.
9. **Cleanup** (Task 8 of original plan). Remove `EntityDualViewEditor` + OSS `DrillInView/` testcase-only imports once playground no longer needs them. Also remove the `compactRows` flag from `TestcaseDataEditor` types/utils since 3.6 is dropped.

---

## 6. Files Most Affected by Next Iteration

| File | Change Type |
|---|---|
| [web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.tsx](web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.tsx) | Toolbar wiring, custom `getFieldTypeChip`, custom `getFieldViewModeOptions` |
| [web/packages/agenta-entity-ui/src/testcase/TestcaseDrillInFieldRenderer.tsx](web/packages/agenta-entity-ui/src/testcase/TestcaseDrillInFieldRenderer.tsx) | Branch on `viewMode`: text/markdown/chat/form/json/yaml |
| [web/packages/agenta-ui/src/drill-in/core/DrillInFieldHeader.tsx](web/packages/agenta-ui/src/drill-in/core/DrillInFieldHeader.tsx) | Add `variant="flat"` mode |
| [web/packages/agenta-ui/src/drill-in/core/DrillInContent.tsx](web/packages/agenta-ui/src/drill-in/core/DrillInContent.tsx) | Pass `variant` down + suppress drill-in chevron when flat |
| [web/oss/src/components/Playground/Components/PlaygroundTestcaseEditor.tsx](web/oss/src/components/Playground/Components/PlaygroundTestcaseEditor.tsx) | Strip Fields/JSON toggle, JSON branch, custom toolbar |
| [web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx](web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx) | Drop `editMode` from render props, add `renderEvaluatorMetrics` slot |

---

## 7. Architecture / Logic / Component-Design Audit

This section is separate from the design-gap analysis. It evaluates whether the **wiring** is sound regardless of how the UI looks.

### 7.1 Overall: layered correctly

| Layer | File | Status |
|---|---|---|
| Presentational editor (no state, no `@/oss/*`) | [TestcaseDataEditor.tsx](web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.tsx) | ✓ Good — pure `value`/`onChange` API |
| Drawer shell (no state, no `@/oss/*`) | [TestcaseDrawer.tsx](web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx) | ✓ Good — uses `renderContent` + `renderAddToQueue` render props |
| OSS adapter (binds entity state to shell) | [SharedDrawers/TestcaseDrawer/index.tsx](web/oss/src/components/SharedDrawers/TestcaseDrawer/index.tsx) | ✓ Good — `useAtomValue(testcase.selectors.*)`, `useSetAtom(testcase.controller(...))` |
| OSS content (binds entity state to editor) | [TestcaseEditDrawer/index.tsx](web/oss/src/components/TestcasesTableNew/components/TestcaseEditDrawer/index.tsx) | ✓ Good — same molecule pattern |
| Playground wrapper | [PlaygroundTestcaseEditor.tsx](web/oss/src/components/Playground/Components/PlaygroundTestcaseEditor.tsx) | ⚠ See 7.4 |

Package boundaries are clean. No `@/oss/*` imports leak into `@agenta/entity-ui`.

### 7.2 Single-ownership violations

- **Root toolbar ownership** — the V2 plan explicitly says *"Once a surface migrates to `TestcaseDataEditor`, the parent drawer/shell must not render its own `DrillInRootToolbar`."* Today this is honored — only `TestcaseDataEditor` owns it. ✓
- **View-mode state** — owned by `TestcaseDataEditor` via local `useState`. Resets to `text` on `key={testcaseId}` remount in the drawer. ✓ Correct, but means switching to YAML and navigating between testcases via next/prev loses the YAML choice. May be desirable or surprising — confirm with design.
- **`drillInPath` reset** — [TestcaseDrawer.tsx:97-109](web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx#L97-L109) resets `drillInPath` only on drawer close, **not on prev/next navigation between testcases**. If the user drills into a nested field and clicks next, the next testcase opens at the same path even if that path doesn't exist on the new testcase. **Bug.**

### 7.3 Dead / vestigial code in the shell

- [TestcaseDrawer.tsx:73](web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx#L73): `editMode` state + `onEditModeChange` callback piped through `TestcaseDrawerContentRenderProps`. No downstream consumer reads it. After the Fields/JSON segmented control was removed from the shell, this became dead state.
- [TestcaseEditDrawer/index.tsx:31](web/oss/src/components/TestcasesTableNew/components/TestcaseEditDrawer/index.tsx#L31): `onClose` declared as a prop but never used in the component body.
- [TestcaseEditDrawer/index.tsx:15-17,57-62](web/oss/src/components/TestcasesTableNew/components/TestcaseEditDrawer/index.tsx#L15-L17): `TestcaseEditDrawerContentRef` exposes `handleSave` via `useImperativeHandle`. `handleSave` is a no-op (edits already write through to the draft atom). The ref is forwarded but no caller invokes it. **Delete.**
- [TestcaseDrawer.tsx:111-113](web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx#L111-L113): `handleApply` just calls `onClose()`. The button is labelled *"Apply and Continue Editing"* which semantically suggests committing edits — but it just closes. Drafts are kept in the testcase atom regardless. **Misleading naming.** Rename or reconcile with what "apply" means.

### 7.4 Playground wrapper mixes concerns

`PlaygroundTestcaseEditor` still owns four concerns that should be split or removed:

1. **Custom header** with `SyncStateTag` + Fields/JSON toggle + `AddPropertyForm` — duplicates affordances the shared editor already provides (DrillInControls can add properties; dirty state shows in TestcaseDataEditor toolbar).
2. **Fields/JSON toggle + JSON branch** — see gap 3.7. Drop entirely.
3. **`jsonValue` memo + `handleJsonChange`** — only fed to the JSON branch. Will become dead code when the toggle is removed.
4. **Suggested-columns section** — playground-specific logic (prompt variables not yet on testcase). **This one is correctly kept in the playground wrapper** per the plan. ✓

After cleanup, `PlaygroundTestcaseEditor` should be a thin shell: `SyncStateTag` + `TestcaseDataEditor` + suggested columns list. Currently ~130 lines could shrink to ~60.

### 7.5 Column-filter projection: redundant and lossy

[TestcaseEditDrawer/index.tsx:70-77](web/oss/src/components/TestcasesTableNew/components/TestcaseEditDrawer/index.tsx#L70-L77) does:

```typescript
const editorValue = useMemo(() => {
    if (!testcaseData) return {}
    const values: Record<string, unknown> = {}
    for (const column of columns) {
        values[column.key] = testcaseData[column.key] ?? ""
    }
    return values
}, [columns, testcaseData])
```

Two issues:
- `TestcaseDataEditor` already uses the `columns` prop to project root items via [`getTestcaseRootItems`](web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.utils.ts) — so this filtering is redundant. Pass `testcaseData` directly.
- The `?? ""` fallback coerces `undefined` / `null` to empty string at the projection layer. This collapses the distinction between "key absent" and "key empty" — and pushes a string into a slot whose schema may be number / boolean / object. Move this default into the renderer (where it has dataType context) or drop it.

Net: this whole `useMemo` can be deleted. `value={testcaseData}` should work.

### 7.6 Dispatch shape: shallow `Partial<T>` is fine, but path-mode "direct" buys nothing here

The testcase entity is a **flat** key-value object (`FlattenedTestcase`). The columns in the drawer surface are all `pathMode: "direct"`. So `setTestcasePathValue` reduces to `{...value, [column.key]: nextValue}` for every column write. The dotted-key / nested-path machinery (`getValueAtPath` / `setValueAtPath`) is unused on this surface.

This is fine — the machinery exists for surfaces where nested writes matter (e.g. trace span drill-in). But it means `pathMode` is **currently a vestigial knob in the testcase domain**. Two options:
1. Hide it from the public API until a real use case appears.
2. Keep it for forward-compat; document that the testcase surface relies on the flat-key path.

### 7.7 Two ViewModeDropdown implementations

[DrillInRootToolbar.tsx:87-146](web/packages/agenta-ui/src/drill-in/core/DrillInRootToolbar.tsx#L87-L146) and [DrillInFieldHeader.tsx:372-431](web/packages/agenta-ui/src/drill-in/core/DrillInFieldHeader.tsx#L372-L431) define near-identical `ViewModeDropdown` components, each with their own copy of the `drill-in-view-mode-dropdown` CSS-injection block. **Extract once** into `@agenta/ui/drill-in/core/ViewModeDropdown.tsx` and reuse.

### 7.8 `TestcaseDataEditorProps.value` is too loosely typed

Typed `Record<string, unknown> | null | undefined`. For consumers that know the entity shape (e.g. testset rows derived from the testset schema), this throws away type safety. Making this generic — `<T extends Record<string, unknown>>` — would let consumers parameterize and gain compile-time guarantees on `onChange`'s payload too.

Not blocking — but worth doing once the API is locked.

### 7.9 `useMemo` over an atom-family factory

In [PlaygroundTestcaseEditor.tsx:60-61](web/oss/src/components/Playground/Components/PlaygroundTestcaseEditor.tsx#L60-L61):

```typescript
const entityData = useAtomValue(useMemo(() => testcaseMolecule.data(testcaseId), [testcaseId]))
const isDirty = useAtomValue(useMemo(() => testcaseMolecule.isDirty(testcaseId), [testcaseId]))
```

`testcaseMolecule.data` and `testcaseMolecule.isDirty` are atom families — calling them with the same `testcaseId` returns the **same** atom reference. The `useMemo` doesn't add value. Drop it:

```typescript
const entityData = useAtomValue(testcaseMolecule.data(testcaseId))
const isDirty = useAtomValue(testcaseMolecule.isDirty(testcaseId))
```

This also aligns with the molecule pattern's documented usage in [packages/agenta-entities/src/testcase/README.md](web/packages/agenta-entities/src/testcase/README.md).

### 7.10 Where the design plan and the current code disagree by accident

| Plan rule | Current state |
|---|---|
| "Default `pathMode` is `direct`" | ✓ Defaults to direct in [TestcaseDataEditor.utils.ts](web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.utils.ts) |
| "Playground compact editing must stay schema-aware. Numbers, booleans, nulls, JSON must not be coerced through a plain string input." | ⚠ The flat-section playground path now uses `TestcaseDrillInFieldRenderer`, which **does** branch on dataType (number → InputNumber, boolean → Switch, etc.). ✓ But the column-filter `?? ""` in 7.5 coerces missing values to string before they reach the renderer — partially breaks this rule. |
| "Hard requirement: `TestcaseDataEditor` must not use bare `DrillInContent` without a renderer" | ✓ `TestcaseDrillInFieldRenderer` is injected |
| "Root toolbar ownership is singular" | ✓ — only one toolbar (but see 3.1 — it shouldn't be there at all per V2 design) |

---

## 8. Architectural Punch List

Ordered, lower-impact items grouped:

### Bugs / correctness
1. **Reset `drillInPath` on prev/next testcase navigation** (7.2) — likely a one-line fix in [TestcaseDrawer.tsx](web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx) prev/next handlers.
2. **Drop `?? ""` coercion in `editorValue` projection** (7.5) — pass raw `testcaseData` to the editor.

### Dead code / API cleanup
3. **Remove `editMode` / `onEditModeChange` from `TestcaseDrawerContentRenderProps`** (7.3) once the playground's Fields/JSON toggle is gone (gap 3.7).
4. **Delete `TestcaseEditDrawerContentRef` + `handleSave` no-op + `forwardRef`** (7.3).
5. **Remove unused `onClose` prop on `TestcaseEditDrawerContent`** (7.3).
6. **Rename or rework `handleApply`** in [TestcaseDrawer.tsx](web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx) — "Apply and Continue Editing" should match what it does.
7. **Drop `useMemo` wrappers** around atom-family calls in `PlaygroundTestcaseEditor` (7.9).

### Consolidation
8. **Extract `ViewModeDropdown`** to one shared component (7.7).
9. **Slim down `PlaygroundTestcaseEditor`** to shell + shared editor + suggested-columns (7.4).
10. **Drop or hide `pathMode`** until a non-direct use case lands (7.6).
11. **Make `TestcaseDataEditorProps.value` generic** when stabilizing the public API (7.8).

---

## 9. Open Questions for Design / Product

1. Is the **chat** option in the per-field view dropdown a v1 requirement, or can it ship later? It is functionally distinct from json/markdown — needs the production `ChatMessageList` component, has different editing semantics.
2. Evaluator metrics on the drawer — what is the shape? Single row of chips with score per evaluator? Collapsible section with detailed breakdown? Where in the drawer (above / below / inside the data editor)?
3. Three-button footer — keep `Apply and Continue` + `Apply and Commit` + `Apply and Save Testset` as separate items, or collapse?
