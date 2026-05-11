# Migration Plan: `state/entities/` → `@agenta/entities`

## Overview

Migrate `web/oss/src/state/entities/` (legacy entity state management) to use `@agenta/entities` (package-based molecules). The legacy folder contains ~50+ exported atoms across 4 modules (shared, testcase, testset, trace) consumed by 51 unique files.

**Goal**: Eliminate `web/oss/src/state/entities/` entirely, replacing all imports with `@agenta/entities` equivalents.

**Constraint**: Zero regressions — every consumer must work identically after migration.

---

## Module Dependency Graph

```
testset → testcase  (dirtyState + mutations read testcase atoms)
testcase → testset  (barrel re-exports testset's save mutations)
trace → (independent)
all → shared        (createEntityDraftState, createEntityController)
```

No circular dependencies. Testset and testcase are tightly coupled.

---

## Phase 0: Preparation

### 0.1 Verify package molecules are feature-complete

Before migrating any consumer, confirm each package molecule covers all legacy use cases:

| Legacy Feature | testcaseMolecule | testsetMolecule | revisionMolecule | traceSpanMolecule |
|---|---|---|---|---|
| Entity data (merged draft) | `atoms.data(id)` | `atoms.data(id)` | `atoms.data(id)` | `atoms.data(id)` |
| Server data (no draft) | via `query(id).data` | via `query(id).data` | via `query(id).data` | `atoms.serverData(id)` |
| Draft only | `atoms.draft(id)` | — | — | `atoms.draft(id)` |
| isDirty | `atoms.isDirty(id)` | `atoms.isDirty(id)` | `atoms.isDirty(id)` | `atoms.isDirty(id)` |
| Cell subscription | `atoms.cell({id,col})` | — | — | — |
| Update draft | `actions.update` | `actions.update` | `actions.update` | `actions.update` |
| Discard draft | `actions.discard` | `actions.discard` | `actions.discard` | `actions.discard` |
| Discard all | `actions.discardAll` | — | — | — |
| Add entity | `actions.add` | — | `tableReducers.addRow` | — |
| Delete entity | `actions.delete` | `actions.delete` | `tableReducers.removeRow` | — |
| Batch update | `actions.batchUpdate` | — | — | — |
| Append entities | `actions.append` | — | `tableReducers.createRowsForRevision` | — |
| Column state | `atoms.columns`, `localColumns` | — | `atoms.effectiveColumns`, `pendingColumnOps` | — |
| Column mutations | — | — | `tableReducers.addColumn/removeColumn/renameColumn` | — |
| Display row IDs | `atoms.displayRowIds` | — | `atoms.effectiveRowIds` | — |
| Dirty summary | `atoms.hasUnsavedChanges` | `atoms.changesSummary` | `atoms.hasPendingChanges` | — |
| List query | — | `atoms.list(query)` | `atoms.list(query)` | — |
| Paginated store | `testcasePaginatedStore` | `testsetMolecule.paginated` | — | — |
| Latest revision | — | `latestRevision.selectors.data(id)` | — | — |
| DrillIn | `drillIn.*` | `drillIn.*` | `drillIn.*` | `drillIn.*` |
| Save/commit | — | `actions.save` | — | — |
| Cache invalidation | — | `invalidate.list()/.detail(id)` | — | — |
| Inputs/outputs | — | — | — | `atoms.inputs/outputs/agData` |

### 0.2 Identify gaps to fill before migration

Based on the comparison above, these legacy features may need package-side additions:

1. **`flattenTestcase` / `unflattenTestcase`** — Legacy schema utilities for converting nested testcase data to flat key-value pairs. Check if `testcaseMolecule` already handles this internally or if consumers need it.

2. **`currentRevisionIdAtom`** — Legacy global atom for "which revision are we editing." Package uses `testcaseMolecule.actions.setRevisionContext(revisionId)` and `revisionMolecule` per-ID atoms instead. Consumers that read this need a replacement.

3. **`testsetMetadataAtom` / `metadataLoadingAtom` / `metadataErrorAtom`** — Legacy metadata atoms. Check if `revisionMolecule.atoms.query(revisionId)` covers this.

4. **`enableRevisionsListQueryAtom`** — Legacy toggle for enabling/disabling revision list queries. Package has `revisionMolecule.atoms.enableList` and `enableWithTestcases`.

5. **`testsetsListQueryAtomFamily(params)`** — Legacy list query with params. Package has `testsetMolecule.atoms.list(searchQuery)`.

6. **`fetchRevision` / `fetchRevisionsList` / `fetchVariantDetail`** — Legacy API functions used directly by some consumers. Package has equivalents in `@agenta/entities/testset` API exports.

7. **`NEW_TESTSET_ID` / `isNewTestsetId`** — Constants for new testset creation flow. Check if package provides equivalent.

8. **`saveNewTestsetAtom`** — Separate from `saveTestsetAtom`. Check package equivalent.

9. **`traceEntityAtomFamily` / `invalidateTraceEntityCache`** — Trace-level (not span-level) atoms. Package exports these from `@agenta/entities/trace`.

10. **`getValueAtPath`** — Utility imported by AddToTestsetDrawer. Package exports this from `@agenta/entities/trace`.

**Action**: For each gap, determine if:
- (a) Package already provides it (just different name/path)
- (b) Package needs a small addition
- (c) Consumer needs refactoring to use the molecule pattern differently

---

## Phase 1: Trace Module (Lowest Risk)

**Why first**: Independent (no cross-module dependencies), fewest consumers (8 files), highest API overlap.

### 1.1 Mapping Table

| Legacy Import | Replacement | Notes |
|---|---|---|
| `traceSpan` controller | `traceSpanMolecule` | API shape differs (controller → molecule) |
| `traceSpan.controller(id)` | `traceSpanMolecule.useController(id)` | Hook replacement |
| `traceSpan.selectors.data(id)` | `traceSpanMolecule.atoms.data(id)` | Same |
| `traceSpan.selectors.isDirty(id)` | `traceSpanMolecule.atoms.isDirty(id)` | Same |
| `traceSpan.selectors.stateful(id)` | `traceSpanMolecule.atoms.query(id)` | Different property names |
| `traceSpan.actions.update` | `traceSpanMolecule.actions.update` | Same |
| `traceSpan.actions.discard` | `traceSpanMolecule.actions.discard` | Same |
| `traceSpan.drillIn.*` | `traceSpanMolecule.drillIn.*` | Same API |
| `type TraceSpan` | `type TraceSpan` from `@agenta/entities/trace` | Same type |
| `traceEntityAtomFamily` | `traceEntityAtomFamily` from `@agenta/entities/trace` | Direct match |
| `invalidateTraceEntityCache` | `invalidateTraceEntityCache` from `@agenta/entities/trace` | Direct match |
| `getValueAtPath` | `getValueAtPath` from `@agenta/entities/trace` | Direct match |
| All schema exports (enums, Zod schemas) | Same names from `@agenta/entities/trace` | Direct match |

### 1.2 Consumer Files to Update

| File | What Changes |
|---|---|
| `DrillInView/TraceSpanDrillInView.tsx` | `traceSpan` → `traceSpanMolecule`; adapt controller/drillIn access |
| `SharedDrawers/TraceDrawer/components/.../OverviewTabItem/index.tsx` | `traceSpan` → `traceSpanMolecule` |
| `SharedDrawers/AddToTestsetDrawer/components/DataPreviewEditor.tsx` | `traceSpan` → `traceSpanMolecule` |
| `SharedDrawers/AddToTestsetDrawer/hooks/useTestsetDrawer.ts` | `getValueAtPath` → import from `@agenta/entities/trace` |
| `SharedDrawers/AddToTestsetDrawer/atoms/actions.ts` | `getValueAtPath` → import from `@agenta/entities/trace` |
| `SharedDrawers/AddToTestsetDrawer/atoms/saveState.ts` | `getValueAtPath` → import from `@agenta/entities/trace` |
| `EvalRunDetails/atoms/traces.ts` | `traceEntityAtomFamily`, `invalidateTraceEntityCache` → import from `@agenta/entities/trace` |
| `lib/traces/traceUtils.ts` | `type TraceSpan` → import from `@agenta/entities/trace` |

### 1.3 Adapter Needed: `EntityAPI` Interface

Three files import `EntityAPI` and `EntityDrillIn` from `@/oss/state/entities/shared` and use it with the trace controller. These interfaces expect:

```typescript
interface EntityAPI<T> {
  controller: EntityControllerAtomFamily<T>
  selectors: EntitySelectors<T>
  actions: EntityActions<T>
  drillIn?: EntityDrillIn<T>
}
```

The package molecules don't implement this interface directly. Options:
- **(a)** Create a thin adapter function `moleculeToEntityAPI(molecule)` that maps molecule API → `EntityAPI` shape
- **(b)** Update `DrillInView` components to accept molecule API directly
- **(c)** Keep `EntityAPI` type in a local file (not in `state/entities/shared`)

**Recommendation**: Option (b) — update DrillInView to accept molecules directly. This is cleaner long-term and DrillInView has only 3 files.

### 1.4 Verification Steps

1. `pnpm build-oss` — no type errors
2. Manual test: Open a trace in the trace drawer → verify data loads
3. Manual test: Drill into trace span attributes → verify navigation works
4. Manual test: Add trace data to testset → verify getValueAtPath works
5. Manual test: Open evaluation run details → verify trace data loads

### 1.5 Cleanup

After all consumers updated:
- Delete `web/oss/src/state/entities/trace/` folder
- Remove `trace` re-exports from `web/oss/src/state/entities/index.ts`

---

## Phase 2: Shared Module (Types Only)

**Why second**: After trace migration, `shared/` is only used by 3 files (DrillInView + PlaygroundTestcaseEditor) for type imports (`EntityAPI`, `EntityDrillIn`, `PathItem`).

### 2.1 If Phase 1 chose option (b) — DrillInView accepts molecules directly

Then shared module consumers are:
- `DrillInView/EntityDualViewEditor.tsx` — needs `EntityDrillIn` type (or updated to molecule drillIn type)
- `DrillInView/EntityDrillInView.tsx` — needs `EntityAPI` type (or updated to molecule type)
- `Playground/Components/PlaygroundTestcaseEditor.tsx` — needs `EntityAPI`, `EntityDrillIn`, `PathItem`

These are all type-only imports. The package exports equivalent types:
- `PathItem` → exported from `@agenta/entities/shared` (as `PathItem`)
- `EntityAPI` / `EntityDrillIn` → Not directly in package (they're legacy controller types)

**Action**: Define a local interface in DrillInView that accepts either legacy controller or molecule. Or, since these components are being updated to accept molecules (Phase 1), these types become unnecessary.

### 2.2 Cleanup

After trace + DrillInView migration:
- Delete `web/oss/src/state/entities/shared/` folder
- The `createEntityDraftState`, `createEntityController`, `createPaginatedEntityStore`, `createStatefulEntityAtomFamily` factories are only used by testcase/testset/trace stores internally — they go away when those modules go away

---

## Phase 3: Testset Module (Medium Risk)

**Why third**: Testset module is consumed by ~28 files. It depends on testcase module internally, but external consumers use it independently. Migration can proceed without touching testcase internals.

### 3.1 Mapping Table — Testset Controller

| Legacy Import | Replacement | Notes |
|---|---|---|
| `testset` controller | `testsetMolecule` | Different API shape |
| `testset.queries.list(searchQuery)` | `testsetMolecule.atoms.list(searchQuery)` | Name change |
| `testset.queries.detail(id)` | `testsetMolecule.atoms.query(id)` | Name change |
| `testset.selectors.data(id)` | `testsetMolecule.atoms.data(id)` | Same |
| `testset.selectors.isDirty(id)` | `testsetMolecule.atoms.isDirty(id)` | Same |
| `testset.invalidate.list()` | `testsetMolecule.invalidate.list()` | Same |
| `testset.invalidate.detail(id)` | `testsetMolecule.invalidate.detail(id)` | Same |
| `testset.paginated.*` | `testsetMolecule.paginated.*` | Same |
| `testset.filters.*` | `testsetMolecule.filters.*` | Same |
| `type TestsetTableRow` | Check if same type in `testsetMolecule.paginated` | May need re-export |

### 3.2 Mapping Table — Revision Controller

| Legacy Import | Replacement | Notes |
|---|---|---|
| `revision` controller | `revisionMolecule` | Different API shape |
| `revision.controller(id)` | `revisionMolecule.useController(id)` | Hook replacement |
| `revision.selectors.data(id)` | `revisionMolecule.atoms.data(id)` | Same |
| `revision.selectors.isDirty(id)` | `revisionMolecule.atoms.isDirty(id)` | Same |
| `revision.selectors.columns(id)` | `revisionMolecule.atoms.testcaseColumns(id)` | Name change |
| `revision.actions.addColumn` | `revisionMolecule.tableReducers.addColumn` | Different namespace |
| `revision.actions.deleteColumn` | `revisionMolecule.tableReducers.removeColumn` | Rename |
| `revision.actions.renameColumn` | `revisionMolecule.tableReducers.renameColumn` | Same |
| `revision.actions.save` | `testsetMolecule.actions.save` | Moved to testset |
| `revision.actions.discard` | `revisionMolecule.actions.discard` | Same |

### 3.3 Mapping Table — Standalone Atoms

| Legacy Import | Replacement | Notes |
|---|---|---|
| `testsetsListQueryAtomFamily(params)` | `testsetMolecule.atoms.list(searchQuery)` | Params simplified |
| `revisionsListQueryAtomFamily(params)` | `revisionMolecule.atoms.list(query)` | Similar |
| `enableRevisionsListQueryAtom` | `revisionMolecule.atoms.enableList` | Name change |
| `latestRevisionForTestsetAtomFamily(id)` | `testsetMolecule.latestRevision.selectors.data(id)` | Restructured |
| `latestRevisionAtomFamily(id)` | `testsetMolecule.latestRevision.selectors.data(id)` | Unified |
| `requestLatestRevisionAtom` | `testsetMolecule.latestRevision.request(params)` | Restructured |
| `invalidateTestsetsListCache()` | `testsetMolecule.invalidate.list()` | Same |
| `invalidateTestsetCache(id)` | `testsetMolecule.invalidate.detail(id)` | Same |
| `invalidateRevisionsListCache(testsetId)` | Check if `revisionMolecule` provides this | May need addition |
| `fetchRevision(params)` | `fetchRevision` from `@agenta/entities/testset` | API layer export |
| `fetchRevisionsList(params)` | `fetchRevisionsList` from `@agenta/entities/testset` | API layer export |
| `NEW_TESTSET_ID` | Check `@agenta/entities/testset` exports | May need re-export |
| `changesSummaryAtom` | `testsetMolecule.atoms.changesSummary` | Restructured |
| `hasUnsavedChangesAtom` | Derived from `revisionMolecule.atoms.hasPendingChanges(id)` | Check equivalence |
| `currentRevisionIdAtom` | No global equivalent — revision ID comes from URL/props | Consumers must pass ID |
| `saveTestsetAtom` | `testsetMolecule.actions.save` or `saveTestsetAtom` from `@agenta/entities/testset` | Re-exported |
| `saveNewTestsetAtom` | `testsetMolecule.set.create(params)` | Check equivalence |

### 3.4 Consumer Files to Update (28 files)

**TestsetsTable (5 files)**:
- `TestsetsTable.tsx` — `testset` controller → `testsetMolecule`
- `atoms/filters.ts` — `testset` controller → `testsetMolecule`
- `atoms/tableStore.ts` — `testset` controller → `testsetMolecule`
- `components/LatestCommitMessage.tsx` — `latestRevisionAtomFamily` → `testsetMolecule.latestRevision`
- `components/TestsetsHeaderFilters.tsx` — `testset` controller → `testsetMolecule`

**TestcasesTableNew (6 files)** — these also use testset imports:
- `index.tsx` — `NEW_TESTSET_ID`, `testset` controller
- `hooks/useTestcasesTable.ts` — `changesSummaryAtom`, `hasUnsavedChangesAtom`, `revision`
- `hooks/useTestcaseActions.ts` — `revision`, cache invalidation
- `components/TestcaseHeader.tsx` — `enableRevisionsListQueryAtom`
- `atoms/revisionContext.ts` — `currentRevisionIdAtom`

**AddToTestsetDrawer (7 files)**:
- Various atoms + hooks using `currentRevisionIdAtom`, `revisionsListQueryAtomFamily`, `enableRevisionsListQueryAtom`

**Playground (4 files)**:
- `TestsetDropdown/index.tsx` — `saveNewTestsetAtom` from testset/mutations
- `LoadTestsetModal` components — `testset`, `revision`, `enableRevisionsListQueryAtom`

**Evaluations (5 files)**:
- `NewEvaluationModalInner.tsx` — `testsetsListQueryAtomFamily`
- `EvaluatorVariantModal.tsx` — `revision`
- `DebugSection.tsx` — `revision`
- `EvaluationRunsHeaderFilters.tsx` — `testsetsListQueryAtomFamily`
- `EvaluationRunsFiltersContent.tsx` — `testsetsListQueryAtomFamily`

**References (2 files)**:
- `ReferenceLabels.tsx` — `latestRevisionForTestsetAtomFamily`, `revision`
- `cells/TestsetCells.tsx` — `revision`

**Pages (4 files)**:
- `testset/modals/UploadTestset.tsx` — `invalidateTestsetsListCache`
- `testset/modals/CreateTestset.tsx` — `invalidateTestsetsListCache`
- `testset/modals/CreateTestsetFromScratch.tsx` — `invalidateTestsetsListCache`, `TestsetTableRow`
- `testset/modals/index.tsx` — `TestsetTableRow`

### 3.5 Critical Decision: `currentRevisionIdAtom`

Legacy has a global `currentRevisionIdAtom` that acts as a shared context atom — "which revision is the user currently editing." This is used by:
- TestcasesTableNew (read)
- AddToTestsetDrawer (read)
- Testset dirty state (read)
- Testset mutations (read)

The package doesn't have a global equivalent because revision context flows through props/params. Options:
- **(a)** Keep `currentRevisionIdAtom` as a standalone atom in `state/` (not in entities/)
- **(b)** Move it to the consuming component's local store
- **(c)** Add it to `testsetMolecule` as a context atom

**Recommendation**: Option (a) — it's a UI navigation concern, not entity state. Move to `state/testset/atoms.ts` or the testcase table's own store.

### 3.6 Verification Steps

1. `pnpm build-oss` — no type errors
2. Manual test: Testsets list page → verify list loads, filters work, pagination works
3. Manual test: Click into testset → verify revision loads, testcases display
4. Manual test: Edit testcase data → verify dirty state shows
5. Manual test: Save changes → verify commit works, cache invalidates
6. Manual test: Create new testset → verify creation flow
7. Manual test: Upload CSV testset → verify upload flow
8. Manual test: Latest commit message column → verify displays correctly
9. Manual test: Evaluation creation → verify testset dropdown populates
10. Manual test: Add trace to testset drawer → verify full flow

### 3.7 Cleanup

After all consumers updated:
- Delete `web/oss/src/state/entities/testset/` folder
- Remove testset re-exports from `web/oss/src/state/entities/index.ts`

---

## Phase 4: Testcase Module (Highest Risk)

**Why last**: Most consumers (30+ files), tightly coupled with testset (cross-module dependencies), most complex legacy API (columns, display rows, bulk mutations, cleanup).

### 4.1 Mapping Table — Testcase Controller

| Legacy Import | Replacement | Notes |
|---|---|---|
| `testcase` controller | `testcaseMolecule` | Different API shape |
| `testcase.controller(id)` | `testcaseMolecule.useController(id)` | Hook replacement |
| `testcase.selectors.data(id)` | `testcaseMolecule.atoms.data(id)` | Same |
| `testcase.selectors.isDirty(id)` | `testcaseMolecule.atoms.isDirty(id)` | Same |
| `testcase.selectors.stateful(id)` | `testcaseMolecule.atoms.query(id)` | Different property names |
| `testcase.selectors.cell({id,col})` | `testcaseMolecule.atoms.cell({id, column})` | Param name `col` → `column` |
| `testcase.actions.update` | `testcaseMolecule.actions.update` | Same |
| `testcase.actions.discard` | `testcaseMolecule.actions.discard` | Same |
| `testcase.actions.add` | `testcaseMolecule.actions.add` | Same |
| `testcase.actions.append` | `testcaseMolecule.actions.append` | Same |
| `testcase.actions.delete` | `testcaseMolecule.actions.delete` | Same |
| `testcase.drillIn.*` | `testcaseMolecule.drillIn.*` | Same |

### 4.2 Mapping Table — Standalone Atoms

| Legacy Import | Replacement | Notes |
|---|---|---|
| `testcaseQueryAtomFamily(id)` | `testcaseMolecule.atoms.query(id)` | Unified |
| `testcaseDraftAtomFamily(id)` | `testcaseMolecule.atoms.draft(id)` | Unified |
| `testcaseHasDraftAtomFamily(id)` | Derived from `testcaseMolecule.atoms.isDirty(id)` | Slightly different semantics |
| `testcaseIsDirtyAtomFamily(id)` | `testcaseMolecule.atoms.isDirty(id)` | Same |
| `testcaseEntityAtomFamily(id)` | `testcaseMolecule.atoms.data(id)` | Same |
| `testcaseCellAtomFamily({id,col})` | `testcaseMolecule.atoms.cell({id, column})` | Param rename |
| `testcaseIdsAtom` | `testcaseMolecule.atoms.ids` | Same concept |
| `setTestcaseIdsAtom` | Via `testcaseMolecule.actions.setRevisionContext` | Different mechanism |
| `resetTestcaseIdsAtom` | Via `testcaseMolecule.actions.setRevisionContext` | Different mechanism |
| `newEntityIdsAtom` | `testcaseMolecule.atoms.newIds` | Same concept |
| `deletedEntityIdsAtom` | `testcaseMolecule.atoms.deletedIds` | Same concept |
| `currentColumnsAtom` | `testcaseMolecule.atoms.columns` | Same concept |
| `expandedColumnsAtom` | Check if molecule exposes this | May need addition |
| `addColumnAtom` | `revisionMolecule.tableReducers.addColumn` | Moved to revision |
| `deleteColumnAtom` | `revisionMolecule.tableReducers.removeColumn` | Moved to revision |
| `renameColumnAtom` | `revisionMolecule.tableReducers.renameColumn` | Moved to revision |
| `pendingColumnRenamesAtom` | `revisionMolecule.atoms.pendingColumnOps(id)` | Consolidated |
| `pendingAddedColumnsAtom` | `revisionMolecule.atoms.pendingColumnOps(id)` | Consolidated |
| `pendingDeletedColumnsAtom` | `revisionMolecule.atoms.pendingColumnOps(id)` | Consolidated |
| `displayRowRefsAtom` | `revisionMolecule.atoms.rowRefs(id)` | Moved to revision |
| `cleanupOnRevisionChangeAtom` | Molecule lifecycle handles this | Built into molecule |
| `initializeEmptyRevisionAtom` | `testcaseMolecule.actions.initializeEmptyRevision` | Same concept |
| `updateTestcaseAtom` | `testcaseMolecule.actions.update` | Same |
| `discardDraftAtom` | `testcaseMolecule.actions.discard` | Same |
| `discardAllDraftsAtom` | `testcaseMolecule.actions.discardAll` | Same |
| `batchUpdateTestcasesSyncAtom` | `testcaseMolecule.actions.batchUpdate` | Same |
| `addTestcaseAtom` | `testcaseMolecule.actions.add` | Same |
| `appendTestcasesAtom` | `testcaseMolecule.actions.append` | Same |
| `createTestcasesAtom` | `testcaseMolecule.actions.create` | Same |
| `deleteTestcasesAtom` | `testcaseMolecule.actions.delete` | Same |
| `renameColumnInTestcasesAtom` | via `revisionMolecule.tableReducers.renameColumn` | Moved |
| `deleteColumnFromTestcasesAtom` | via `revisionMolecule.tableReducers.removeColumn` | Moved |
| `addColumnToTestcasesAtom` | via `revisionMolecule.tableReducers.addColumn` | Moved |
| `saveTestsetAtom` | `testsetMolecule.actions.save` or `saveTestsetAtom` from `@agenta/entities/testset` | From testset |
| `clearChangesAtom` | Via discard + clear pending ops | Composed |
| `testcasePaginatedStore` | `testcasePaginatedStore` from `@agenta/entities/testcase` | Direct |
| `flattenTestcase` | Check `@agenta/entities/testcase` exports | May be internal |
| `unflattenTestcase` | Check `@agenta/entities/testcase` exports | May be internal |
| `testcasesResponseSchema` | From `@agenta/entities/testcase` | Same |
| `type FlattenedTestcase` | From `@agenta/entities/testcase` | Same |
| `type Column` | Likely `testcaseMolecule` column type | May need type alias |

### 4.3 Consumer Files to Update (30+ files)

**TestcasesTableNew (11 files)** — Heaviest consumer:
- `atoms/tableStore.ts` — `cleanupOnRevisionChangeAtom`, `setTestcaseIdsAtom`
- `atoms/revisionContext.ts` — `currentRevisionIdAtom`
- `hooks/api.ts` — `flattenTestcase`, `testcasesResponseSchema`
- `hooks/types.ts` — `Column`, `ChangesSummary`, `DisplayRowRef`, `FlattenedTestcase`
- `hooks/useTestcaseActions.ts` — `TestsetMetadata` type
- `hooks/useTestcasesTable.ts` — (testset imports, handled in Phase 3)
- `utils/groupColumns.ts` — `Column` type
- `index.tsx` — `testcase` controller, query atoms
- `components/TestcaseCell.tsx` — `testcase` controller
- `components/TestcaseSelectionCell.tsx` — `testcase` controller
- `components/TestcaseEditDrawer.tsx` — `testcase`, `Column`, `FlattenedTestcase`

**AddToTestsetDrawer (7 files)**:
- `atoms/localEntities.ts` — Heavy: `testcase`, `newEntityIdsAtom`, column atoms, `localEntitiesRevisionAtom`
- `atoms/drawerState.ts` — `addColumnAtom`, `currentColumnsAtom`
- `atoms/saveState.ts` — `currentColumnsAtom`
- `atoms/previewSync.ts` — `testcase`, `currentColumnsAtom`
- `hooks/useSaveTestset.ts` — `currentColumnsAtom`, `saveTestsetAtom`
- `hooks/useTestsetDrawer.ts` — `currentColumnsAtom`

**DrillInView (2 files)**:
- `TestcaseDrillInView.tsx` — `testcase`, `TestcaseColumn`, `Column`

**EvalRunDetails (1 file)**:
- `atoms/scenarioTestcase.ts` — `testcase`, `FlattenedTestcase`, `testcaseQueryAtomFamily`

**Playground (3 files)**:
- `PlaygroundTestcaseEditor.tsx` — `testcase`, `EntityAPI`, `EntityDrillIn`, `PathItem`
- `TestsetDropdown/index.tsx` — `saveNewTestsetAtom` (testset/mutations)
- `LoadTestsetModal/assets/LoadTestsetModalFooter/index.tsx` — `saveNewTestsetAtom`
- `LoadTestsetModal/hooks/useSelectedTestcasesData.ts` — `testcase`

### 4.4 Key Risk: Column State Coupling

Legacy column state (`currentColumnsAtom`, `pendingColumnRenamesAtom`, etc.) is shared between testcase entity and testset mutations. In the package, column state lives in `revisionMolecule`, not `testcaseMolecule`.

**Migration path**:
1. Consumers currently doing `get(currentColumnsAtom)` → `get(revisionMolecule.atoms.effectiveColumns(revisionId))`
2. Consumers currently doing `set(addColumnAtom, key)` → `set(revisionMolecule.tableReducers.addColumn, {revisionId, key})`
3. This means consumers need access to `revisionId` — which they get from `currentRevisionIdAtom` (moved in Phase 3)

### 4.5 Key Risk: `localEntitiesRevisionAtom` and Cleanup

The AddToTestsetDrawer uses `localEntitiesRevisionAtom` from `testcase/atomCleanup` to track which revision context local entities belong to. The package molecule handles cleanup via lifecycle hooks. Need to verify the cleanup behavior matches.

### 4.6 Verification Steps

1. `pnpm build-oss` — no type errors
2. Manual test: Open testset → verify testcases table loads with correct columns
3. Manual test: Edit a cell → verify draft state, dirty indicator
4. Manual test: Add/delete column → verify column operations
5. Manual test: Add/delete row → verify row operations
6. Manual test: Save changes → verify full commit flow
7. Manual test: Rename column → verify rename propagates to all testcases
8. Manual test: Discard changes → verify revert works
9. Manual test: Pagination → verify infinite scroll loads more
10. Manual test: Search testcases → verify search works
11. Manual test: DrillIn edit → verify nested data editing
12. Manual test: Create new testset from scratch → verify empty revision flow
13. Manual test: Add trace to testset drawer → verify full flow with column mapping
14. Manual test: Evaluation run details → verify scenario testcases load
15. Manual test: Playground testcase editor → verify edit + drill-in works

### 4.7 Cleanup

After all consumers updated:
- Delete `web/oss/src/state/entities/testcase/` folder
- Delete `web/oss/src/state/entities/shared/` folder (no longer needed — testcase was last consumer)
- Delete `web/oss/src/state/entities/index.ts`
- Delete the `web/oss/src/state/entities/` folder entirely

---

## Phase 5: Final Cleanup

### 5.1 Remove Legacy Types

Check if `Column`, `ExpandedColumn`, `TestcaseColumn`, `ChangesSummary`, `DisplayRowRef`, `FlattenedTestcase`, `TestsetMetadata` types are used anywhere outside the migrated files. If so, ensure they're exported from the package or defined locally.

### 5.2 Remove Legacy API Functions

Check if `fetchRevision`, `fetchRevisionsList`, `fetchVariantDetail`, `fetchTestcasesPage` are used outside `state/entities/`. If so, point imports to `@agenta/entities/testset` or `@agenta/entities/testcase`.

### 5.3 Remove Schema Re-exports

Legacy re-exports Zod schemas (`testcaseSchema`, `testcasesResponseSchema`, etc.). Ensure all consumers import from `@agenta/entities/*` directly.

### 5.4 Verify No Remaining Imports

```bash
grep -r "state/entities/" web/oss/src/ --include="*.ts" --include="*.tsx"
```

Should return zero results.

### 5.5 Build + Test

1. `pnpm build-oss` — clean build
2. `pnpm lint-fix` — no new lint errors
3. Full E2E test suite if available

---

## Risk Assessment

| Phase | Risk | Impact | Mitigation |
|---|---|---|---|
| Phase 1 (Trace) | LOW | 8 files, simple 1:1 mapping | DrillIn adapter needed |
| Phase 2 (Shared) | LOW | 3 files, type-only imports | Falls away after Phase 1 |
| Phase 3 (Testset) | MEDIUM | 28 files, `currentRevisionIdAtom` decision | Keep as standalone atom |
| Phase 4 (Testcase) | HIGH | 30+ files, column coupling, cleanup logic | Test every flow manually |

---

## Timeline Estimate

Each phase should be done as a separate PR:
- **Phase 0**: Gap analysis (research only)
- **Phase 1 + 2**: Trace + Shared — single PR
- **Phase 3**: Testset — single PR
- **Phase 4 + 5**: Testcase + Final cleanup — single PR

---

## Open Questions

1. Does `testcaseMolecule` expose `flattenTestcase`/`unflattenTestcase`? Or are they internal?
2. Does `revisionMolecule` expose `invalidateRevisionsListCache`?
3. Does `testsetMolecule` export `NEW_TESTSET_ID`?
4. Is `saveNewTestsetAtom` equivalent to `testsetMolecule.set.create(params)`?
5. Does `testcaseMolecule.atoms.columns` return the same shape as legacy `currentColumnsAtom`?
6. Is `hasDraftAtomFamily(id)` semantically different from `isDirty(id)` in the package? (Legacy has both)
7. Does molecule lifecycle cleanup match `cleanupOnRevisionChangeAtom` behavior?
8. Does `revisionMolecule.atoms.pendingColumnOps(id)` expose separate add/delete/rename or a single object?
