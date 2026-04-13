# Gap Analysis: Migrating `state/entities/testset/` to `@agenta/entities/testset`

## 1. Legacy Testset APIs (Exported from `web/oss/src/state/entities/testset/index.ts`)

### Schema & Types (`revisionSchema.ts`)
| Export | Description |
|--------|-------------|
| `revisionSchema` | Zod schema for revision entity |
| `revisionListItemSchema` | Lighter Zod schema for revision list items |
| `revisionsResponseSchema` | Zod schema for revisions query response |
| `testsetSchema` | Zod schema for testset entity |
| `testsetsResponseSchema` | Zod schema for testsets query response |
| `variantSchema` | Zod schema for testset variant entity |
| `normalizeRevision` | Normalizes raw API response to `Revision` |
| `isV0Revision` | Check if revision is version 0 (draft) |
| `getVersionDisplay` | Format version as `v{n}` string |
| `Revision`, `RevisionListItem`, `RevisionsResponse`, `Testset`, `TestsetsResponse`, `Variant` | TypeScript types |

### Store Atoms (`store.ts`)
| Export | Description |
|--------|-------------|
| `testsetQueryAtomFamily(testsetId)` | Query atom for fetching single testset |
| `testsetsListQueryAtomFamily(searchQuery)` | Query atom for testsets list (with search) |
| `testsetEntityAtomFamily(testsetId)` | Entity atom with draft merged |
| `testsetServerDataAtomFamily(testsetId)` | Server data without draft |
| `testsetDraftState` | Draft state created via `createEntityDraftState` |
| `testsetHasDraftAtomFamily(testsetId)` | Boolean: has local draft |
| `testsetIsDirtyAtomFamily(testsetId)` | Boolean: draft differs from server |
| `updateTestsetDraftAtom` | Write atom to update testset draft |
| `discardTestsetDraftAtom` | Write atom to discard testset draft |
| `NEW_TESTSET_ID` | Constant `"new"` for unsaved testsets |
| `isNewTestsetId(id)` | Check if ID is `"new"` |
| `variantQueryAtomFamily(variantId)` | Query atom for single variant |
| `variantEntityAtomFamily(variantId)` | Variant entity atom |
| `fetchRevision`, `fetchRevisionsList`, `fetchTestsetsList`, `fetchTestsetDetail`, `fetchVariantDetail` | API fetch functions |
| `invalidateTestsetsListCache()`, `invalidateTestsetCache(id)`, `invalidateRevisionsListCache(id)` | Cache invalidation functions |

### Revision Entity (`revisionEntity.ts`)
| Export | Description |
|--------|-------------|
| `revisionQueryAtomFamily(revisionId)` | Query atom with batch fetching |
| `revisionEntityAtomFamily(revisionId)` | Entity atom (server + draft merged) |
| `revisionDraftAtomFamily(revisionId)` | Draft atom for local edits |
| `revisionHasDraftAtomFamily(revisionId)` | Boolean: has draft |
| `clearRevisionDraftAtom` | Write atom to clear a revision's draft |
| `revisionsListQueryAtomFamily(testsetId)` | Lazy-loaded revisions list query |
| `enableRevisionsListQueryAtom` | Write atom to enable lazy list query |
| `latestRevisionForTestsetAtomFamily(testsetId)` | Derived: latest non-v0 revision from list |
| `requestLatestRevisionAtom` | Write atom: request batch-fetched latest revision |
| `latestRevisionAtomFamily(testsetId)` | Read atom: cached latest revision info |
| `latestRevisionStatefulAtomFamily(testsetId)` | Read atom: `{data, isPending}` |
| `clearLatestRevisionCacheAtom` | Write atom to clear cache |
| `LatestRevisionInfo` | Type for latest revision display |

### Revision Controller (`controller.ts`)
| Export | Description |
|--------|-------------|
| `revision.controller(revisionId)` | Full controller atom: `[state, dispatch]` |
| `revision.selectors.query(id)` | Query state |
| `revision.selectors.data(id)` | Entity data (draft merged) |
| `revision.selectors.serverData(id)` | Raw server data |
| `revision.selectors.isDirty(id)` | Combines revision + aggregate dirty |
| `revision.selectors.columns(id)` | Current columns (from `columnState`) |
| `revision.selectors.expandedColumns(id)` | Expanded columns |
| `revision.selectors.pendingColumnOps(id)` | Pending renames/adds/deletes |
| `revision.selectors.hasColumnChanges(id)` | Boolean: has column ops |
| `revision.selectors.changesSummary(id)` | Changes summary for commit |
| `revision.selectors.testcaseColumns(id)` | Columns derived from testcases query |
| `revision.selectors.testcaseColumnsNormalized(id)` | Lowercase column names |
| `revision.selectors.withTestcasesQueryResult(id)` | Revision with testcases loading state |
| `revision.actions.updateMetadata` | Update revision draft |
| `revision.actions.addColumn` | Add column |
| `revision.actions.deleteColumn` | Delete column |
| `revision.actions.renameColumn` | Rename column |
| `revision.actions.discardDraft` | Discard draft |
| `revision.actions.resetColumns` | Reset columns |
| `revision.queries.list(testsetId)` | Revisions list query |
| `revision.queries.detail(revisionId)` | Revision detail query |
| `revision.queries.enableList` | Enable lazy list query |
| `revision.invalidate.list(testsetId)` | Invalidate revisions list cache |

### Testset Controller (`testsetController.ts`)
| Export | Description |
|--------|-------------|
| `testset.queries.list(searchQuery)` | Testsets list query |
| `testset.queries.detail(testsetId)` | Testset detail query |
| `testset.selectors.data(id)` | Entity data (draft merged) |
| `testset.selectors.serverData(id)` | Server data |
| `testset.selectors.query(id)` | Query state |
| `testset.selectors.hasDraft(id)` | Has draft |
| `testset.selectors.isDirty(id)` | Is dirty |
| `testset.actions.updateMetadata` | Update draft |
| `testset.actions.discardDraft` | Discard draft |
| `testset.invalidate.list()` | Invalidate list cache |
| `testset.invalidate.detail(id)` | Invalidate detail cache |
| `testset.paginated` | Paginated store for InfiniteVirtualTable |
| `testset.filters.searchTerm` | Search filter atom |
| `testset.filters.dateCreated` | Date created filter |
| `testset.filters.dateModified` | Date modified filter |
| `testset.filters.exportFormat` | Export format preference |

### Dirty State (`dirtyState.ts`)
| Export | Description |
|--------|-------------|
| `revisionIsDirtyAtom` | Current revision has draft changes |
| `hasAnyTestcaseDirtyAtom` | Any testcase has cell edits |
| `hasUnsavedChangesAtom` | Any unsaved change (cells + columns + new/deleted) |
| `changesSummaryAtom` | `{modifiedCount, addedCount, deletedCount, originalData, modifiedData}` |
| `hasMetadataChangesAtom` | Name/description changed |
| `testsetNameChangedAtom` | Name changed (simplified) |

### Mutations (`mutations.ts`)
| Export | Description |
|--------|-------------|
| `saveTestsetAtom` | Save existing testset (patch revision with delta) |
| `saveNewTestsetAtom` | Save new testset (create from scratch) |
| `clearChangesAtom` | Reset all local state |
| `SaveTestsetParams`, `SaveTestsetResult` | Types |

### Paginated Store (`paginatedStore.ts`)
| Export | Description |
|--------|-------------|
| `testsetPaginatedStore` | Paginated entity store for InfiniteVirtualTable |
| `testsetsSearchTermAtom` | Search filter (persisted with `atomWithStorage`) |
| `testsetsDateCreatedFilterAtom` | Date created filter |
| `testsetsDateModifiedFilterAtom` | Date modified filter |
| `testsetsExportFormatAtom` | Export format preference (persisted) |
| `TestsetApiRow`, `TestsetTableRow`, `TestsetDateRange`, `TestsetPaginatedMeta` | Types |

### Re-export from testcase module
| Export | Description |
|--------|-------------|
| `currentRevisionIdAtom` | Re-exported from `../testcase/queries` |

---

## 2. Package Testset/Revision Molecule APIs (`@agenta/entities/testset`)

### `testsetMolecule`
| API | Description | Legacy Equivalent |
|-----|-------------|-------------------|
| `testsetMolecule.data(id)` | Merged entity data | `testset.selectors.data(id)` |
| `testsetMolecule.query(id)` | Query state | `testset.selectors.query(id)` |
| `testsetMolecule.isDirty(id)` | Has unsaved changes | `testset.selectors.isDirty(id)` |
| `testsetMolecule.queryOptional(id)` | Null-safe query | No legacy equivalent |
| `testsetMolecule.dataOptional(id)` | Null-safe data | No legacy equivalent |
| `testsetMolecule.changesSummary` | Changes summary atom | `changesSummaryAtom` |
| `testsetMolecule.controller(id)` | State + dispatch pattern | No direct legacy equivalent |
| `testsetMolecule.atoms.*` | Extended atoms namespace | Matches legacy selectors |
| `testsetMolecule.actions.update` | Update draft | `testset.actions.updateMetadata` |
| `testsetMolecule.actions.discard` | Discard draft | `testset.actions.discardDraft` |
| `testsetMolecule.actions.save` | Unified save (new + existing) | `saveTestsetAtom` + `saveNewTestsetAtom` |
| `testsetMolecule.actions.delete` | Delete/archive testsets | No legacy equivalent |
| `testsetMolecule.selectors.*` | Deprecated selectors | Legacy `testset.selectors.*` |
| `testsetMolecule.paginated.store` | Paginated store | `testset.paginated.store` |
| `testsetMolecule.paginated.refreshAtom` | Refresh trigger | `testset.paginated.refreshAtom` |
| `testsetMolecule.paginated.controller` | Table controller | No legacy equivalent |
| `testsetMolecule.paginated.selectors` | Table selectors | No legacy equivalent |
| `testsetMolecule.paginated.actions` | Table actions | No legacy equivalent |
| `testsetMolecule.filters.*` | Filter atoms | `testset.filters.*` |
| `testsetMolecule.invalidate.list()` | Invalidate list cache | `testset.invalidate.list()` |
| `testsetMolecule.invalidate.detail(id)` | Invalidate detail cache | `testset.invalidate.detail(id)` |
| `testsetMolecule.latestRevision.*` | Latest revision API | `latestRevisionAtomFamily`, `requestLatestRevisionAtom`, etc. |
| `testsetMolecule.revisionsList.*` | Revisions list API | `revision.queries.list`, `revision.queries.enableList` |
| `testsetMolecule.save.reducer` | Unified save for new testsets | `saveNewTestsetAtom` |
| `testsetMolecule.createWithTestcases()` | Create testset with initial testcase | No legacy equivalent |
| `testsetMolecule.drillIn.*` | Path-based navigation | No legacy equivalent |
| `testsetMolecule.get.*` | Imperative reads | No legacy equivalent |
| `testsetMolecule.set.*` | Imperative writes | No legacy equivalent |

### `revisionMolecule`
| API | Description | Legacy Equivalent |
|-----|-------------|-------------------|
| `revisionMolecule.data(id)` | Merged entity data | `revision.selectors.data(id)` |
| `revisionMolecule.query(id)` | Query state | `revision.selectors.query(id)` |
| `revisionMolecule.isDirty(id)` | Has unsaved changes | `revision.selectors.isDirty(id)` |
| `revisionMolecule.queryOptional(id)` | Null-safe query | No legacy equivalent |
| `revisionMolecule.dataOptional(id)` | Null-safe data | No legacy equivalent |
| `revisionMolecule.controller(id)` | State + dispatch | `revision.controller(id)` |
| `revisionMolecule.atoms.withTestcases(id)` | Revision with testcases | `revisionWithTestcasesQueryAtomFamily` |
| `revisionMolecule.atoms.withTestcasesQueryResult(id)` | Query result | `revision.selectors.withTestcasesQueryResult(id)` |
| `revisionMolecule.atoms.testcaseColumns(id)` | Base columns from testcases | `revision.selectors.testcaseColumns(id)` |
| `revisionMolecule.atoms.expandedColumns(id)` | Expanded columns | `revision.selectors.expandedColumns(id)` |
| `revisionMolecule.atoms.testcaseColumnsNormalized(id)` | Lowercase column names | `revision.selectors.testcaseColumnsNormalized(id)` |
| `revisionMolecule.atoms.list(testsetId)` | Revisions list | `revision.queries.list(testsetId)` |
| `revisionMolecule.atoms.latestForTestset(id)` | Latest revision | `latestRevisionForTestsetAtomFamily` |
| `revisionMolecule.atoms.enableList` | Enable lazy list query | `revision.queries.enableList` |
| `revisionMolecule.atoms.enableWithTestcases` | Enable testcases query | No legacy equivalent (auto-enabled) |
| `revisionMolecule.atoms.serverRowIds(id)` | Server testcase IDs from revision | No legacy equivalent |
| `revisionMolecule.atoms.pendingColumnOps(id)` | Pending column ops | `revision.selectors.pendingColumnOps(id)` |
| `revisionMolecule.atoms.pendingRowOps(id)` | Pending row ops | No legacy equivalent |
| `revisionMolecule.atoms.effectiveColumns(id)` | Base + pending columns | `revision.selectors.columns(id)` |
| `revisionMolecule.atoms.effectiveRowIds(id)` | Server + pending row IDs | No legacy equivalent |
| `revisionMolecule.atoms.effectiveTestcaseIds(id)` | Semantic alias | No legacy equivalent |
| `revisionMolecule.atoms.effectiveTestcases(id)` | Resolved testcase data | No legacy equivalent |
| `revisionMolecule.atoms.rowRefs(id)` | Row refs with __isNew/__isDeleted | No legacy equivalent |
| `revisionMolecule.atoms.hasPendingChanges(id)` | Has pending ops | `revision.selectors.hasColumnChanges(id)` (partial) |
| `revisionMolecule.atoms.isLoading(id)` | Loading state | No legacy equivalent |
| `revisionMolecule.atoms.testcasesIds(id)` | Testcase IDs from relation | No legacy equivalent |
| `revisionMolecule.atoms.testcases(id)` | Testcase entities from relation | No legacy equivalent |
| `revisionMolecule.actions.update` | Update draft | `revision.actions.updateMetadata` |
| `revisionMolecule.actions.discard` | Discard draft | `revision.actions.discardDraft` |
| `revisionMolecule.actions.delete` | Delete/archive revisions | No legacy equivalent |
| `revisionMolecule.tableReducers.*` | Column/row operations | `revision.actions.*` (different shape) |
| `revisionMolecule.table.*` | Imperative table API | No legacy equivalent |
| `revisionMolecule.drillIn.*` | Path-based navigation | No legacy equivalent |
| `revisionMolecule.get.*` | Imperative reads | No legacy equivalent |
| `revisionMolecule.set.*` | Imperative writes | No legacy equivalent |

---

## 3. Consumer Mapping Table

| Consumer File | Legacy APIs Used | Package Equivalent | Migration Notes |
|---|---|---|---|
| **References/ReferenceLabels.tsx** | `latestRevisionForTestsetAtomFamily`, `revision` (selectors.data, selectors.testcaseColumns) | `revisionMolecule.atoms.latestForTestset(id)`, `revisionMolecule.data(id)`, `revisionMolecule.atoms.testcaseColumns(id)` | Direct API map. Package `enableRevisionsListQueryAtom` requires `{testsetId, projectId}` vs legacy just `testsetId`. |
| **References/cells/TestsetCells.tsx** | `revision` (selectors.testcaseColumnsNormalized) | `revisionMolecule.atoms.testcaseColumnsNormalized(id)` | Direct map. |
| **EvaluationRunsTablePOC/.../EvaluationRunsFiltersContent.tsx** | `testsetsListQueryAtomFamily` | `testsetMolecule.atoms.list(searchQuery)` | Direct map. |
| **EvaluationRunsTablePOC/.../EvaluationRunsHeaderFilters.tsx** | `testsetsListQueryAtomFamily` | `testsetMolecule.atoms.list(searchQuery)` | Direct map. |
| **evaluations/NewEvaluation/.../NewEvaluationModalInner.tsx** | `testsetsListQueryAtomFamily` | `testsetMolecule.atoms.list(searchQuery)` | Direct map. |
| **evaluations/autoEvaluation/.../EvaluatorVariantModal.tsx** | `revision` (selectors.testcaseColumns, selectors.testcaseColumnsNormalized) | `revisionMolecule.atoms.testcaseColumns(id)`, `revisionMolecule.atoms.testcaseColumnsNormalized(id)` | Direct map. Needs `enableWithTestcases` call in package. |
| **evaluations/autoEvaluation/.../DebugSection.tsx** | `revision` (selectors.testcaseColumns) | `revisionMolecule.atoms.testcaseColumns(id)` | Same as above. |
| **pages/testset/modals/UploadTestset.tsx** | `invalidateTestsetsListCache` | `testsetMolecule.invalidate.list()` | Direct map. |
| **pages/testset/modals/CreateTestset.tsx** | `invalidateTestsetsListCache` | `testsetMolecule.invalidate.list()` | Direct map. |
| **pages/testset/modals/CreateTestsetFromScratch.tsx** | `invalidateTestsetsListCache`, `TestsetTableRow` (type) | `testsetMolecule.invalidate.list()`, `TestsetTableRow` from `@agenta/entities/testset` | Direct map. |
| **pages/testset/modals/index.tsx** | `TestsetTableRow` (type) | `TestsetTableRow` from `@agenta/entities/testset` | Type-only import, direct map. |
| **TestsetsTable/TestsetsTable.tsx** | `fetchRevisionsList`, `testset` (paginated, filters, invalidate), `TestsetTableRow` (type) | `fetchRevisionsList` from `@agenta/entities/testset`, `testsetMolecule.paginated.*`, `testsetMolecule.filters.*` | Paginated store shape differs (see Section 6). |
| **TestsetsTable/.../TestsetsHeaderFilters.tsx** | `testset` (filters.searchTerm, filters.dateCreated, filters.dateModified) | `testsetMolecule.filters.searchTerm`, `testsetMolecule.filters.dateCreated`, `testsetMolecule.filters.dateModified` | **GAP**: Legacy `searchTerm` uses `atomWithStorage` (persisted), package uses plain `atom` (not persisted). See Section 5. |
| **TestsetsTable/.../CommitMessageCell.tsx** | `latestRevisionStatefulAtomFamily`, `requestLatestRevisionAtom` | `testsetMolecule.latestRevision.selectors.stateful(id)`, `testsetMolecule.latestRevision.request` | **GAP**: Legacy `requestLatestRevisionAtom` takes just `testsetId`, package takes `{testsetId, projectId}`. Consumers need projectId context. |
| **TestsetsTable/.../LatestCommitMessage.tsx** | `latestRevisionAtomFamily`, `requestLatestRevisionAtom` | `testsetMolecule.latestRevision.selectors.data(id)`, `testsetMolecule.latestRevision.request` | Same gap as CommitMessageCell. |
| **TestsetsTable/atoms/tableStore.ts** | `testset` (paginated.store, filters.exportFormat) | `testsetMolecule.paginated.store`, `testsetMolecule.filters.exportFormat` | Direct map, but paginated store shape may differ. |
| **TestsetsTable/atoms/filters.ts** | `testset` (filters.dateCreated, filters.dateModified), `TestsetDateRange` (type) | `testsetMolecule.filters.dateCreated`, `testsetMolecule.filters.dateModified` | Direct map. |
| **TestcasesTableNew/index.tsx** | `NEW_TESTSET_ID`, `testset` (selectors.data, invalidate.list) | `NEW_TESTSET_ID`, `testsetMolecule.data(id)`, `testsetMolecule.invalidate.list()` | Direct map. |
| **TestcasesTableNew/.../TestcaseHeader.tsx** | `enableRevisionsListQueryAtom` | `revisionMolecule.atoms.enableList` (via `useSetAtom`) | **GAP**: Legacy takes `testsetId` string, package takes `{testsetId, projectId}` object. |
| **TestcasesTableNew/.../useTestcasesTable.ts** | `changesSummaryAtom`, `hasUnsavedChangesAtom`, `revision` (selectors.columns, selectors.expandedColumns, controller, queries.list, queries.enableList, actions.addColumn) | `testsetMolecule.changesSummary`, `hasUnsavedChangesAtom` from package mutations, `revisionMolecule.atoms.effectiveColumns`, `revisionMolecule.controller`, etc. | **GAP**: Legacy `changesSummaryAtom` has `{modifiedCount, addedCount, deletedCount, originalData, modifiedData}`. Package has `{newTestcases, updatedTestcases, deletedTestcases, renamedColumns, addedColumns, deletedColumns, hasChanges}`. Different shapes. |
| **TestcasesTableNew/.../useTestcaseActions.ts** | `revision` (actions, invalidate), `invalidateTestsetCache`, `invalidateTestsetsListCache`, `invalidateRevisionsListCache` | `revisionMolecule.tableReducers.*`, `testsetMolecule.invalidate.*` | **GAP**: Legacy column actions (`addColumn`, `deleteColumn`, `renameColumn`) are global singletons. Package actions are revision-scoped (`{revisionId, columnKey}`). |
| **TestcasesTableNew/hooks/types.ts** | `RevisionListItem` (type from `revisionSchema`) | `RevisionListItem` from `@agenta/entities/testset` | Direct map, import path changes. |
| **SharedDrawers/AddToTestsetDrawer/.../useSaveTestset.ts** | `fetchRevisionsList`, `invalidateRevisionsListCache`, `invalidateTestsetCache`, `invalidateTestsetsListCache` | Package API exports directly | Direct map. |
| **SharedDrawers/AddToTestsetDrawer/.../useTestsetRevisionSelect.ts** | `currentRevisionIdAtom` | `currentRevisionIdAtom` (re-exported from testcase module) | **GAP**: `currentRevisionIdAtom` is from `state/entities/testcase/queries`. The package has `currentRevisionIdAtom` in `@agenta/entities/testcase/state/store`. Need to verify it's the same atom instance. |
| **SharedDrawers/AddToTestsetDrawer/.../previewSync.ts** | `currentRevisionIdAtom` | Same as above | Same gap. |
| **SharedDrawers/AddToTestsetDrawer/.../actions.ts** | `currentRevisionIdAtom` | Same as above | Same gap. |
| **SharedDrawers/AddToTestsetDrawer/.../localEntities.ts** | `currentRevisionIdAtom` | Same as above | Same gap. |
| **SharedDrawers/AddToTestsetDrawer/.../cascaderState.ts** | `RevisionListItem` (type), `enableRevisionsListQueryAtom` (from `revisionEntity`) | `RevisionListItem` from package, `revisionMolecule.atoms.enableList` | Import from internal `revisionEntity` module needs redirect to public API. |
| **SharedDrawers/AddToTestsetDrawer/.../testsetQueries.ts** | `revisionsListQueryAtomFamily` | `revisionMolecule.atoms.list(testsetId)` | Direct map, but package revisions list needs `enableRevisionsListQueryAtom({testsetId, projectId})` first. |
| **SharedDrawers/AddToTestsetDrawer/.../RevisionLabel.tsx** | `RevisionListItem` (type) | `RevisionListItem` from `@agenta/entities/testset` | Direct map. |
| **Playground/.../TestsetDropdown/index.tsx** | `saveNewTestsetAtom` (from `mutations`) | `testsetMolecule.save.reducer` or `saveNewTestsetAtom` from package | Direct import from internal `mutations` module needs redirect. |
| **Playground/.../TestsetDropdown/CreateTestsetCardWrapper.tsx** | `enableRevisionsListQueryAtom`, `invalidateTestsetCache`, `invalidateTestsetsListCache` | `revisionMolecule.atoms.enableList`, `testsetMolecule.invalidate.*` | Same `enableRevisionsListQueryAtom` signature gap. |
| **Playground/.../LoadTestsetModal/.../LoadTestsetModalContent.tsx** | `testset` (queries.list) | `testsetMolecule.atoms.list(searchQuery)` | Direct map. |
| **Playground/.../LoadTestsetModal/.../TestsetListSidebar.tsx** | `revision`, `testset` (queries.list, selectors) | `revisionMolecule.*`, `testsetMolecule.*` | Direct map. |
| **Playground/.../LoadTestsetModal/.../CreateTestsetCard.tsx** | `enableRevisionsListQueryAtom` | `revisionMolecule.atoms.enableList` | Same signature gap. |
| **state/testsetSelection/atoms.ts** | `latestRevisionForTestsetAtomFamily`, `RevisionListItem` (type) | `testsetMolecule.latestRevision.selectors.data(id)` or `latestRevisionForTestsetAtomFamily` from package | **Note**: The package exports `latestRevisionForTestsetAtomFamily` directly for adapters. |
| **lib/hooks/usePreviewEvaluations/index.ts** | `fetchRevision` | `fetchRevision` from `@agenta/entities/testset` | Direct map. |

---

## 4. Gaps List

### GAP-1: `enableRevisionsListQueryAtom` Signature Difference
- **Severity**: Medium
- **Legacy**: Takes a `string` (testsetId)
- **Package**: Takes `{testsetId: string, projectId: string}`
- **Affected consumers**: `TestcaseHeader.tsx`, `CreateTestsetCardWrapper.tsx`, `CreateTestsetCard.tsx`, `cascaderState.ts`
- **Fix**: At each call site, pass `{testsetId, projectId}` instead of just `testsetId`. All affected consumers already have access to `projectIdAtom`.

### GAP-2: `requestLatestRevisionAtom` Signature Difference
- **Severity**: Medium
- **Legacy**: Takes just `testsetId: string`
- **Package**: Takes `{testsetId: string, projectId: string}`
- **Affected consumers**: `CommitMessageCell.tsx`, `LatestCommitMessage.tsx`
- **Fix**: Pass `{testsetId, projectId}`. These are table cell components that render in a project context, so `projectId` is available.

### GAP-3: `changesSummaryAtom` Shape Difference
- **Severity**: High
- **Legacy shape**: `{modifiedCount, addedCount, deletedCount, originalData, modifiedData}`
- **Package shape**: `{newTestcases, updatedTestcases, deletedTestcases, renamedColumns, addedColumns, deletedColumns, hasChanges}`
- **Affected consumers**: `useTestcasesTable.ts` (reads counts and passes to commit modal), `TestcasesTableNew/index.tsx`
- **Fix**: The package shape is richer (includes column ops). Consumers need to adapt:
  - `modifiedCount` -> `updatedTestcases`
  - `addedCount` -> `newTestcases`
  - `deletedCount` -> `deletedTestcases`
  - `originalData`/`modifiedData` (JSON diff strings) -> Not in package. The commit modal may need a separate derived atom if it needs diff view data.

### GAP-4: Column Actions Are Global vs Revision-Scoped
- **Severity**: High
- **Legacy**: `revision.actions.addColumn`, `revision.actions.deleteColumn`, `revision.actions.renameColumn` are global singleton atoms (imported from `testcase/columnState`). They don't take a `revisionId`.
- **Package**: `revisionMolecule.tableReducers.addColumn`, etc. take `{revisionId, columnKey}`.
- **Affected consumers**: `useTestcaseActions.ts`, `useTestcasesTable.ts`, `revision.controller` dispatch actions
- **Fix**: At each call site, include the current `revisionId`. This is a better design but requires threading `revisionId` through to each action call site.

### GAP-5: `currentRevisionIdAtom` Cross-Module Dependency
- **Severity**: Medium
- **Legacy**: Re-exported from `testset/index.ts` but lives in `testcase/queries.ts`
- **Package**: Lives in `@agenta/entities/testcase/state/store.ts`
- **Affected consumers**: `useTestsetRevisionSelect.ts`, `previewSync.ts`, `actions.ts`, `localEntities.ts`
- **Fix**: Import from `@agenta/entities/testcase` instead. Need to verify these are the same logical atom (they should be, since the package testset mutations already import it from `../../testcase/state/store`).

### GAP-6: `searchTerm` Persistence Difference
- **Severity**: Low
- **Legacy**: `testsetsSearchTermAtom` uses `atomWithStorage` (persisted to localStorage)
- **Package**: `testsetsSearchTermAtom` uses plain `atom` (not persisted)
- **Affected consumers**: `TestsetsHeaderFilters.tsx`, `TestsetsTable.tsx`
- **Fix**: Either update the package to use `atomWithStorage` to match legacy behavior, or accept the behavior change (search term resets on page reload). The latter is arguably better UX.

### GAP-7: Legacy `latestRevisionAtomFamily` Returns `LatestRevisionInfo` vs Package Returns `Revision | null`
- **Severity**: Medium
- **Legacy**: `latestRevisionAtomFamily` returns `LatestRevisionInfo | null` with `{revisionId, version, message, createdAt, author}`
- **Package**: `testsetMolecule.latestRevision.selectors.data(id)` returns `Revision | null` (full revision object)
- **Affected consumers**: `LatestCommitMessage.tsx`, `state/testsetSelection/atoms.ts`
- **Fix**: Consumers accessing `data.revisionId` need to change to `data.id`. Other fields like `version`, `message`, `createdAt` map naturally. The package returns richer data.

### GAP-8: Internal Module Imports
- **Severity**: Low
- **Legacy**: Some consumers import directly from internal modules (e.g., `@/oss/state/entities/testset/mutations`, `@/oss/state/entities/testset/revisionEntity`, `@/oss/state/entities/testset/revisionSchema`)
- **Package**: All public API should be imported from `@agenta/entities/testset`
- **Affected consumers**: `TestsetDropdown/index.tsx` (imports from `mutations`), `cascaderState.ts` (imports from `revisionEntity`), `hooks/types.ts` (imports from `revisionSchema`)
- **Fix**: Use package public exports. All needed types/atoms are exported from the package index.

### GAP-9: `revision.controller` Dispatch Actions Shape
- **Severity**: Medium
- **Legacy controller** dispatch takes `RevisionAction` union type: `{type: "addColumn", name}`, `{type: "deleteColumn", key}`, `{type: "renameColumn", oldName, newName, rowDataMap?}`, `{type: "discardDraft"}`, `{type: "resetColumns"}`
- **Package controller** uses standard molecule controller with `dispatch.update(changes)` and `dispatch.discard()`. Column/row actions use separate `tableReducers`.
- **Affected consumers**: `useTestcasesTable.ts` (uses controller dispatch for column actions)
- **Fix**: Split dispatch calls: use `revisionMolecule.controller` for metadata, use `revisionMolecule.tableReducers.*` for column/row operations.

### GAP-10: `saveTestsetAtom` in Mutations
- **Severity**: Low
- **Legacy**: `saveTestsetAtom` builds delta from global column state (`currentColumnsAtom`, `pendingColumnRenamesAtom`, etc.)
- **Package**: `saveTestsetAtom` builds delta from revision-scoped state (`pendingColumnOpsAtomFamily(revisionId)`)
- **Affected consumers**: `useTestcaseActions.ts` (calls save)
- **Fix**: This is handled internally by the package mutations. No consumer-facing change needed.

---

## 5. Paginated Store Differences

### Legacy (`paginatedStore.ts`)
- Uses `createPaginatedEntityStore` from `../shared`
- Meta atom: `testsetsPaginatedMetaAtom` with `{projectId, searchTerm, dateCreatedFilter, dateModifiedFilter}`
- Filter atoms: `testsetsSearchTermAtom` (persisted), `testsetsDateCreatedFilterAtom`, `testsetsDateModifiedFilterAtom`, `testsetsExportFormatAtom` (persisted)
- Fetch function: Direct axios call to `/preview/testsets/query`
- Row types: `TestsetApiRow` -> `TestsetTableRow extends InfiniteTableRowBase`
- Exposed as `testsetPaginatedStore` with `.store`, `.refreshAtom`

### Package (`state/paginatedStore.ts`)
- Uses same `createPaginatedEntityStore` pattern from `../../shared/paginated`
- Meta atom: `testsetsPaginatedMetaAtom` with `{projectId, searchTerm?, dateCreated?, dateModified?}`
- Filter atoms: `testsetsSearchTermAtom` (NOT persisted), `testsetsExportFormatAtom` (persisted), `testsetsDateCreatedAtom`, `testsetsDateModifiedAtom`
- Fetch function: Direct axios call to same endpoint
- Row types: Same structure
- Exposed via `testsetMolecule.paginated` with `.store`, `.refreshAtom`, `.controller`, `.selectors`, `.actions`
- Additional: `listCountsConfig: { totalCountMode: "unknown" }` for server count handling

### Key Differences
1. **Filter atom names**: `testsetsDateCreatedFilterAtom` (legacy) vs `testsetsDateCreatedAtom` (package)
2. **Search term persistence**: Legacy persists to localStorage, package does not
3. **Package has richer paginated API**: `.controller`, `.selectors`, `.actions` in addition to `.store`
4. **Meta shape**: Legacy uses `dateCreatedFilter`/`dateModifiedFilter`, package uses `dateCreated`/`dateModified`
5. **Fetch URL construction**: Package appends search as URL query param (`?search=...`), legacy puts it in POST body (`testset: {name: ...}`)

---

## 6. Recommended Migration Approach Per Consumer

### Tier 1: Drop-in Replacements (Type-only or simple atom swaps)
These consumers use only types, cache invalidation functions, or simple query atoms that map 1:1.

| Consumer | Approach |
|---|---|
| `pages/testset/modals/UploadTestset.tsx` | Replace import path. `invalidateTestsetsListCache` is exported from package. |
| `pages/testset/modals/CreateTestset.tsx` | Same as above. |
| `pages/testset/modals/CreateTestsetFromScratch.tsx` | Replace import path for both `invalidateTestsetsListCache` and `TestsetTableRow`. |
| `pages/testset/modals/index.tsx` | Type-only import, just change path. |
| `References/cells/TestsetCells.tsx` | Change `revision.selectors.testcaseColumnsNormalized` -> `revisionMolecule.atoms.testcaseColumnsNormalized`. |
| `EvaluationRunsTablePOC/.../EvaluationRunsFiltersContent.tsx` | Change `testsetsListQueryAtomFamily` -> `testsetMolecule.atoms.list`. |
| `EvaluationRunsTablePOC/.../EvaluationRunsHeaderFilters.tsx` | Same. |
| `evaluations/NewEvaluation/.../NewEvaluationModalInner.tsx` | Same. |
| `lib/hooks/usePreviewEvaluations/index.ts` | Change `fetchRevision` import to `@agenta/entities/testset`. |
| `SharedDrawers/AddToTestsetDrawer/.../RevisionLabel.tsx` | Type-only import change. |
| `TestcasesTableNew/hooks/types.ts` | Type-only import change. |
| `SharedDrawers/AddToTestsetDrawer/.../useSaveTestset.ts` | Function imports map directly. |

### Tier 2: Small Adapter Changes Needed
These require small parameter shape changes or API renames.

| Consumer | Approach |
|---|---|
| `References/ReferenceLabels.tsx` | Change `latestRevisionForTestsetAtomFamily` -> `testsetMolecule.latestRevision.selectors.data(id)`. Change `revision.selectors.*` -> `revisionMolecule.*`. |
| `TestsetsTable/.../CommitMessageCell.tsx` | Change `requestLatestRevisionAtom` to pass `{testsetId, projectId}`. Change `latestRevisionStatefulAtomFamily` -> `testsetMolecule.latestRevision.selectors.stateful`. |
| `TestsetsTable/.../LatestCommitMessage.tsx` | Same pattern. Adapt `LatestRevisionInfo` field access (`revisionId` -> `id`). |
| `TestcasesTableNew/.../TestcaseHeader.tsx` | Change `enableRevisionsListQueryAtom(testsetId)` -> `enableRevisionsListQueryAtom({testsetId, projectId})`. |
| `Playground/.../CreateTestsetCardWrapper.tsx` | Same `enableRevisionsListQueryAtom` signature change. |
| `Playground/.../CreateTestsetCard.tsx` | Same. |
| `Playground/.../LoadTestsetModal/.../LoadTestsetModalContent.tsx` | Change `testset.queries.list` -> `testsetMolecule.atoms.list`. |
| `Playground/.../TestsetDropdown/index.tsx` | Change internal import `saveNewTestsetAtom` from `mutations` -> package export. |
| `SharedDrawers/AddToTestsetDrawer/.../cascaderState.ts` | Change internal import from `revisionEntity` -> package public API. Change `enableRevisionsListQueryAtom` signature. |
| `SharedDrawers/AddToTestsetDrawer/.../testsetQueries.ts` | Change `revisionsListQueryAtomFamily` -> `revisionMolecule.atoms.list`. |
| `SharedDrawers/AddToTestsetDrawer/.../useTestsetRevisionSelect.ts` | Import `currentRevisionIdAtom` from testcase package. |
| `SharedDrawers/AddToTestsetDrawer/.../previewSync.ts` | Same. |
| `SharedDrawers/AddToTestsetDrawer/.../actions.ts` | Same. |
| `SharedDrawers/AddToTestsetDrawer/.../localEntities.ts` | Same. |
| `state/testsetSelection/atoms.ts` | Use package `latestRevisionForTestsetAtomFamily`. |
| `evaluations/.../EvaluatorVariantModal.tsx` | Change `revision.selectors.*` -> `revisionMolecule.atoms.*`. Add `enableWithTestcases` call. |
| `evaluations/.../DebugSection.tsx` | Same. |

### Tier 3: Significant Refactoring Required
These consumers use the legacy `revision` controller or column state in ways that differ substantially from the package.

| Consumer | Approach |
|---|---|
| `TestcasesTableNew/.../useTestcasesTable.ts` | **Heaviest migration.** Uses `revision.controller` dispatch for column actions, `changesSummaryAtom` (different shape), `hasUnsavedChangesAtom`, `revision.selectors.columns`, `revision.selectors.expandedColumns`, `revision.queries.list`, `revision.queries.enableList`. Must switch to `revisionMolecule.controller` + `revisionMolecule.tableReducers.*` for column ops. Adapt `changesSummaryAtom` shape. |
| `TestcasesTableNew/.../useTestcaseActions.ts` | Uses `revision.actions.*` (global column actions) and multiple invalidation functions. Must thread `revisionId` into all column/row action calls using `revisionMolecule.tableReducers.*`. |
| `TestsetsTable/TestsetsTable.tsx` | Uses `testset.paginated`, `testset.filters`, `fetchRevisionsList`. Paginated store shape is similar but test for compatibility. |
| `TestsetsTable/atoms/tableStore.ts` | Re-exports paginated store. Update to package. |
| `TestsetsTable/.../TestsetsHeaderFilters.tsx` | Uses `testset.filters.*`. Package filter atom names differ slightly. |
| `TestcasesTableNew/index.tsx` | Uses `NEW_TESTSET_ID`, `testset.selectors.data`. Moderate changes. |
| `Playground/.../TestsetListSidebar.tsx` | Uses both `revision` and `testset` APIs. Needs full API swap. |

### Migration Order Recommendation
1. **Phase 1**: Tier 1 consumers (drop-in replacements) - low risk, high count
2. **Phase 2**: Tier 2 consumers (small adapter changes) - medium risk, medium effort
3. **Phase 3**: Tier 3 consumers (significant refactoring) - high effort, critical path
   - Start with `TestsetsTable` (paginated store migration)
   - Then `TestcasesTableNew` (controller + column actions migration)
   - Finally `Playground` consumers

### Pre-Migration Requirements
Before starting migration, resolve these package-level items:
1. Decide on `searchTerm` persistence behavior (GAP-6)
2. Ensure `currentRevisionIdAtom` from testcase package is the same logical atom used by legacy testset module (GAP-5)
3. Consider adding `originalData`/`modifiedData` diff strings to package `changesSummaryAtom` if the commit modal needs them (GAP-3)
