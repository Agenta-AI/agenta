# Gap Analysis: Testcase State Migration

Migration target: `web/oss/src/state/entities/testcase/` -> `@agenta/entities/testcase` (testcaseMolecule)

---

## 1. Legacy Testcase API Summary

Source: `web/oss/src/state/entities/testcase/`

### Schema & Types (`schema.ts`)

| Export | Kind | Description |
|--------|------|-------------|
| `testcaseSchema` | Zod schema | Validates raw API testcase |
| `testcasesResponseSchema` | Zod schema | Validates paginated query response |
| `FlattenedTestcase` | Type | **Data fields merged to top level** (no `.data` wrapper) |
| `flattenTestcase(tc)` | Function | Spreads `tc.data` onto top-level object |
| `unflattenTestcase(flat)` | Function | Moves non-system fields back into `.data` |

### Entity Core (`testcaseEntity.ts`)

| Export | Kind | Description |
|--------|------|-------------|
| `testcaseEntityAtomFamily` | atomFamily | Per-id FlattenedTestcase entity with draft overlay |
| `testcaseQueryAtomFamily` | atomFamily | Per-id query state (isPending, isError) |
| `testcaseIsDirtyAtomFamily` | atomFamily | Per-id dirty flag (column-aware comparison) |
| `testcaseCellAtomFamily` | atomFamily | `selectAtom`-based cell accessor `{id, column}` |
| `updateTestcaseAtom` | write atom | Merges partial update into draft (top-level fields) |
| `setTestcaseIdsAtom` | write atom | Bulk-sets entity IDs for paginated store |
| `newEntityIdsAtom` | atom | Set of locally-created entity IDs |
| `deletedEntityIdsAtom` | atom | Set of soft-deleted entity IDs |
| `batchUpdateColumnAtom` | write atom | Renames/deletes a column across all entities |
| `batchDeleteColumnAtom` | write atom | Removes column from all entity drafts |

### Column State (`columnState.ts`)

| Export | Kind | Description |
|--------|------|-------------|
| `Column` | Type | `{key: string; name: string}` |
| `ExpandedColumn` | Type | `{key, name, parentKey, subKey}` |
| `pendingColumnRenamesAtomFamily` | atomFamily(revisionId) | Map of old->new column renames |
| `pendingDeletedColumnsAtomFamily` | atomFamily(revisionId) | Set of columns pending deletion |
| `pendingAddedColumnsAtomFamily` | atomFamily(revisionId) | Set of newly added column names |
| `localColumnsAtomFamily` | atomFamily(revisionId) | Derived: server columns + pending ops applied |
| `currentColumnsAtom` | derived atom | localColumns for current revision |
| `expandedColumnsAtom` | derived atom | Recursively expanded object columns (MAX_DEPTH=5) |
| `addColumnAtom` | write atom | Adds a column (updates pending + entity drafts) |
| `deleteColumnAtom` | write atom | Deletes a column (updates pending + entity drafts) |
| `renameColumnAtom` | write atom | Renames a column (updates pending + entity drafts) |
| `addPendingAddedColumnAtom` | write atom | Direct pending-added mutation |
| `addPendingDeletedColumnAtom` | write atom | Direct pending-deleted mutation |
| `clearPendingAddedColumnsAtom` | write atom | Reset pending-added for revision |
| `clearPendingDeletedColumnsAtom` | write atom | Reset pending-deleted for revision |
| `clearPendingRenamesAtom` | write atom | Reset pending-renames for revision |
| `resetColumnsAtom` | write atom | Full column state reset for revision |

### Display Rows (`displayRows.ts`)

| Export | Kind | Description |
|--------|------|-------------|
| `DisplayRowRef` | Type | `{id: string; key: string}` |
| `displayRowRefsAtom` | derived atom | newIds + serverIds - deletedIds |
| `displayRowCellAtomFamily` | atomFamily | Cell value for display row |
| `displayRowAtomFamily` | atomFamily | Full row data |
| `isRowNewAtomFamily` | atomFamily | Is this row locally created? |
| `isRowDeletedAtomFamily` | atomFamily | Is this row soft-deleted? |
| `isRowDirtyAtomFamily` | atomFamily | Does this row have unsaved changes? |

### Dirty State (`dirtyState.ts`)

| Export | Kind | Description |
|--------|------|-------------|
| `testcaseIsDirtyAtomFamily` | Re-export | Per-entity dirty flag |
| `hasAnyTestcaseDirtyAtom` | derived atom | Any testcase dirty in current revision |
| `hasUnsavedChangesAtom` | derived atom | Any dirty OR pending column ops |
| `changesSummaryAtom` | derived atom | `{modified, added, deleted, columnChanges}` counts |
| `ChangesSummary` | Type | Shape of the summary object |

### Queries (`queries.ts`)

| Export | Kind | Description |
|--------|------|-------------|
| `currentRevisionIdAtom` | atom | Currently selected revision ID |
| `revisionQueryAtom` | atomWithQuery | Fetches revision detail (flags, columns, version) |
| `testsetIdAtom` | derived atom | From revision query |
| `testsetDetailQueryAtom` | atomWithQuery | Fetches testset detail |
| `revisionsListQueryAtom` | atomWithQuery | Fetches revision list for testset |
| `testsetMetadataAtom` | derived atom | `{name, columns, testsetId, revisionVersion}` |
| `TestsetMetadata` | Type | Shape of metadata |
| `fetchTestcasesPage` | Function | HTTP fetch for one page of testcases |

### Mutations (`testcaseMutations.ts`)

| Export | Kind | Description |
|--------|------|-------------|
| `deleteTestcasesAtom` | write atom | Soft-delete testcases by ID |
| `addTestcaseAtom` | write atom | Add single empty testcase |
| `createTestcasesAtom` | write atom | Bulk-create from data rows (with dedup, column sync) |
| `appendTestcasesAtom` | write atom | Create + append to display rows |

### Save Operations (re-exported from testset module)

| Export | Kind | Description |
|--------|------|-------------|
| `saveTestsetAtom` | write atom | Commit changes to existing testset revision |
| `saveNewTestsetAtom` | write atom | Create new testset from current entities |
| `clearChangesAtom` | write atom | Discard all draft changes |

### Edit Session (`editSession.ts`)

| Export | Kind | Description |
|--------|------|-------------|
| `initializeEmptyRevisionAtom` | write atom | Sets up "input"/"correct_answer" columns + one row for new/draft revisions. Checks `revisionQueryAtom` flags internally. |

### Paginated Store (`paginatedStore.ts`)

| Export | Kind | Description |
|--------|------|-------------|
| `testcasePaginatedStore` | Store object | `{serverRows, clientRows, allRows, filters, fetchNextPage, reset, ...}` |
| `testcasesFetchingAtom` | derived atom | Is a page currently loading? |

### Controller (`controller.ts`)

| Export | Kind | Description |
|--------|------|-------------|
| `testcase` | Unified object | `.selectors.{data, isDirty, cell, isFetching}`, `.actions.{update, delete, add, create, append, discard}`, `.paginatedStore`, `.filters` |

### Atom Cleanup (`atomCleanup.ts`)

| Export | Kind | Description |
|--------|------|-------------|
| `cleanupTestcaseAtoms(id)` | Function | Removes entity/query/draft atoms for one ID |
| `cleanupTestcaseAtomsBatch(ids)` | Function | Batch cleanup |
| `cleanupOnRevisionChangeAtom` | write atom | Cleans up stale entities on revision switch |
| `localEntitiesRevisionAtom` | atom | Tracks which revision local entities belong to |

---

## 2. Package Testcase Molecule API Summary

Source: `web/packages/agenta-entities/src/testcase/`

### Data Format

**Nested `Testcase`**: cell values live inside `entity.data.{column}`, NOT at top level. There is no `FlattenedTestcase` equivalent. The package never flattens.

### Schema (`core/schema.ts`)

| Export | Kind | Description |
|--------|------|-------------|
| `testcaseSchema` | Zod schema | Same fields, nested `.data` |
| `Testcase` | Type | `z.infer<typeof testcaseSchema>` (nested) |
| `testcaseSchemas` | Schema set | `.base`, `.local`, `.update` via `createEntitySchemaSet` |
| `createLocalTestcase(input?)` | Function | Factory with validation, returns `{success, data}` or `{success, errors}` |
| `testcasesResponseSchema` | Zod schema | Paginated response |
| `testsetMetadataSchema` | Zod schema | `{name, columns, testsetId, revisionVersion}` |
| `SYSTEM_FIELDS` | Set | Fields excluded from dirty comparison |
| `isSystemField(field)` | Function | Check if field is system |

### Column Types (`core/types.ts`)

| Export | Kind | Description |
|--------|------|-------------|
| `TestcaseColumn` | Type | `{key: string; label: string}` (NOT `name`) |
| `ExpandedColumn` | Type | `{key, fullPath, nestedKey, label}` (different shape from legacy) |

### Molecule (`state/molecule.ts` + `state/store.ts`)

**Top-level selectors:**

| Selector | Equivalent Legacy | Notes |
|----------|-------------------|-------|
| `testcaseMolecule.data(id)` | `testcaseEntityAtomFamily(id)` | Returns nested `Testcase`, not `FlattenedTestcase` |
| `testcaseMolecule.query(id)` | `testcaseQueryAtomFamily(id)` | Same shape |
| `testcaseMolecule.isDirty(id)` | `testcaseIsDirtyAtomFamily(id)` | Column-aware, same concept |
| `testcaseMolecule.ids` | (part of paginated store) | All known entity IDs |
| `testcaseMolecule.newIds` | `newEntityIdsAtom` | Same |
| `testcaseMolecule.deletedIds` | `deletedEntityIdsAtom` | Same |

**Atoms namespace (`testcaseMolecule.atoms.*`):**

| Atom | Equivalent Legacy | Notes |
|------|-------------------|-------|
| `.cell({id, column})` | `testcaseCellAtomFamily` | Reads from `entity.data[column]` |
| `.displayRowIds` | `displayRowRefsAtom` | Returns `DisplayRowRef[]` (same shape) |
| `.hasUnsavedChanges` | `hasUnsavedChangesAtom` | Same |
| `.columns` | `currentColumnsAtom` | Returns `TestcaseColumn[]` (uses `label` not `name`) |
| `.localColumns(revisionId)` | `localColumnsAtomFamily(revisionId)` | Same concept |
| `.selectionDraft.*` | N/A (new) | For TestsetSelectionModal |
| `.currentSelection` | N/A (new) | Selection result |

**Actions namespace (`testcaseMolecule.actions.*`):**

| Action | Equivalent Legacy | Notes |
|--------|-------------------|-------|
| `.update({id, ...data})` | `updateTestcaseAtom` | Merges into `.data` (nested) |
| `.discard(id)` | (part of controller) | Single entity |
| `.discardAll` | `clearChangesAtom` | All entities |
| `.add` | `addTestcaseAtom` | Creates empty testcase |
| `.delete(ids)` | `deleteTestcasesAtom` | Soft-delete |
| `.append(rows)` | `appendTestcasesAtom` | Create + append |
| `.create(rows, opts)` | `createTestcasesAtom` | Bulk create with dedup |
| `.batchUpdate({column, ...})` | `batchUpdateColumnAtom` | Column rename/delete across entities |
| `.setRevisionContext(revId)` | `currentRevisionIdAtom` setter | Sets working revision |
| `.initializeEmptyRevision(opts)` | `initializeEmptyRevisionAtom` | **Different signature**: accepts `{serverTotalCount, isNewTestset}` |

**Loadable capability (per-revision):**

| Selector | Description |
|----------|-------------|
| `.loadable.rows(revisionId)` | Rows for loadable bridge |
| `.loadable.columns(revisionId)` | Columns for loadable bridge |
| `.loadable.hasChanges(revisionId)` | Dirty flag for loadable |

**Paginated store:** `testcasePaginatedStore` -- same pattern as legacy but rows are identity-only (`{id, key}`), entity data fetched via molecule.

**Data controller:** `testcaseDataController` -- unified data source abstraction (local vs server mode). No legacy equivalent.

### What the Package Does NOT Export

| Legacy Export | Status | Notes |
|---------------|--------|-------|
| `FlattenedTestcase` | **Missing** | Package uses nested format only |
| `flattenTestcase` / `unflattenTestcase` | **Missing** | No flattening concept |
| `Column` (with `.name`) | **Changed** | Now `TestcaseColumn` with `.label` |
| `ExpandedColumn` (with `.parentKey`, `.subKey`) | **Changed** | Now has `.fullPath`, `.nestedKey` |
| `expandedColumnsAtom` | **Missing** | Column expansion utility not exposed |
| `pendingColumnRenamesAtomFamily` | **Internalized** | Merged into `pendingColumnOpsAtomFamily` |
| `pendingDeletedColumnsAtomFamily` | **Internalized** | Merged |
| `pendingAddedColumnsAtomFamily` | **Internalized** | Merged |
| `addPendingAddedColumnAtom` | **Missing** | No direct pending mutation exposed |
| `addPendingDeletedColumnAtom` | **Missing** | No direct pending mutation exposed |
| `clearPendingAddedColumnsAtom` | **Missing** | No direct pending clear exposed |
| `clearPendingDeletedColumnsAtom` | **Missing** | No direct pending clear exposed |
| `clearPendingRenamesAtom` | **Missing** | No direct pending clear exposed |
| `resetColumnsAtom` | **Missing** | No full column state reset exposed |
| `addColumnAtom` / `deleteColumnAtom` / `renameColumnAtom` | **Missing** | High-level column CRUD not exposed |
| `displayRowCellAtomFamily` | **Missing** | Use `testcaseMolecule.atoms.cell` instead |
| `displayRowAtomFamily` | **Missing** | Use `testcaseMolecule.data(id)` instead |
| `isRowNewAtomFamily` / `isRowDeletedAtomFamily` / `isRowDirtyAtomFamily` | **Missing** | Can be derived from `newIds`/`deletedIds`/`isDirty` |
| `changesSummaryAtom` / `ChangesSummary` | **Missing** | Not in package |
| `revisionQueryAtom` | **Missing** | Lives in testset package, not testcase |
| `testsetDetailQueryAtom` | **Missing** | Lives in testset package |
| `revisionsListQueryAtom` | **Missing** | Lives in testset package |
| `testsetMetadataAtom` | **Missing** | Lives in testset package |
| `TestsetMetadata` | **Partial** | Schema exists but no composed atom |
| `saveTestsetAtom` / `saveNewTestsetAtom` | **Missing** | Not in testcase package (testset concern) |
| `clearChangesAtom` | **Equivalent** | `testcaseMolecule.actions.discardAll` |
| `cleanupTestcaseAtoms` / batch | **Different** | Package uses molecule lifecycle cleanup |
| `localEntitiesRevisionAtom` | **Missing** | No direct equivalent |
| `testcasesFetchingAtom` | **Missing** | Use paginated store loading state |
| `setTestcaseIdsAtom` | **Missing** | Package manages internally |

---

## 3. Consumer Mapping

### TestcasesTableNew (primary consumer)

| File | Legacy APIs Used | Package Equivalent | Migration Notes |
|------|------------------|--------------------|-----------------|
| `hooks/useTestcasesTable.ts` | `displayRowRefsAtom`, `initializeEmptyRevisionAtom`, `revisionQueryAtom`, `saveNewTestsetAtom`, `saveTestsetAtom`, `testcase.actions.*`, `testsetIdAtom`, `clearChangesAtom`, `FlattenedTestcase` | `testcaseMolecule.atoms.displayRowIds`, `testcaseMolecule.actions.initializeEmptyRevision` (different sig), molecule actions, `testcaseMolecule.actions.discardAll` | **Blocking**: `FlattenedTestcase` type removed; `revisionQueryAtom`/`testsetIdAtom`/save atoms not in testcase package; `initializeEmptyRevision` signature change |
| `atoms/tableStore.ts` | `testcasePaginatedStore`, `cleanupOnRevisionChangeAtom`, `clearPendingAddedColumnsAtom`, `clearPendingDeletedColumnsAtom`, `clearPendingRenamesAtom`, `resetColumnsAtom`, `setTestcaseIdsAtom` | `testcasePaginatedStore` (package), molecule lifecycle cleanup | **Blocking**: No direct pending column clear atoms; `setTestcaseIdsAtom` not exposed; cleanup approach different |
| `components/TestcaseCell.tsx` | `testcase.selectors.cell({id, column})` | `testcaseMolecule.atoms.cell({id, column})` | **Compatible**: Same concept, reads from `.data` in package |
| `components/TestcaseEditDrawer/index.tsx` | `testcase` controller (cast as `any`), `Column` type | `testcaseMolecule` controller, `TestcaseColumn` type | **Minor**: Column type rename (`name` -> `label`), controller shape may differ |
| `components/TestcaseSelectionCell.tsx` | `testcase.selectors.isDirty(id)` | `testcaseMolecule.isDirty(id)` | **Compatible** |
| `hooks/useTestcaseActions.ts` | `TestsetMetadata` type | testset package type | **Testset coupling**: Not a testcase concern |
| `index.tsx` | `currentRevisionIdAtom`, `revisionsListQueryAtom`, `testsetMetadataAtom` | testset package atoms | **Testset coupling**: These are testset-level atoms re-exported through testcase |
| `hooks/types.ts` | `Column`, `ChangesSummary`, `DisplayRowRef`, `FlattenedTestcase` | `TestcaseColumn` (renamed), **missing** `ChangesSummary`, `DisplayRowRef` (exists in package), **missing** `FlattenedTestcase` | **Blocking**: `FlattenedTestcase` and `ChangesSummary` not in package |
| `hooks/api.ts` | `flattenTestcase`, `testcasesResponseSchema` | **missing** `flattenTestcase`, `testcasesResponseSchema` (exists) | **Blocking**: No flatten utility |
| `utils/groupColumns.ts` | `Column` type | `TestcaseColumn` type | **Minor**: Field rename |
| `atoms/revisionContext.ts` | `currentRevisionIdAtom` | `testcaseMolecule.actions.setRevisionContext` | **Compatible** with different API shape |

### EvalRunDetails

| File | Legacy APIs Used | Package Equivalent | Migration Notes |
|------|------------------|--------------------|-----------------|
| `atoms/scenarioTestcase.ts` | `testcase.selectors.data(id)`, `testcaseQueryAtomFamily`, `FlattenedTestcase` | `testcaseMolecule.data(id)`, `testcaseMolecule.query(id)` | **CRITICAL**: Expects `FlattenedTestcase` -- accesses cell values at top level (e.g., `entity.country`). Package returns nested `entity.data.country`. Every downstream access pattern breaks. |

### AddToTestsetDrawer

| File | Legacy APIs Used | Package Equivalent | Migration Notes |
|------|------------------|--------------------|-----------------|
| `atoms/localEntities.ts` | `testcase.actions.create/delete/update`, `localEntitiesRevisionAtom`, `addPendingAddedColumnAtom`, `addPendingDeletedColumnAtom`, `clearPendingAddedColumnsAtom`, `clearPendingDeletedColumnsAtom`, `currentColumnsAtom`, `localColumnsAtomFamily`, `newEntityIdsAtom`, `currentRevisionIdAtom` | Molecule actions (create/delete/update exist), `testcaseMolecule.newIds`, `testcaseMolecule.atoms.columns` | **Blocking**: No direct pending column mutation atoms; `localEntitiesRevisionAtom` missing; `addPendingAddedColumnAtom`/`addPendingDeletedColumnAtom` not exposed |
| `atoms/previewSync.ts` | `testcase.actions.create/delete`, `currentColumnsAtom` | Molecule actions, `testcaseMolecule.atoms.columns` | **Compatible** after column type rename |
| `atoms/drawerState.ts` | `addColumnAtom`, `currentColumnsAtom` | **Missing** `addColumnAtom`, `testcaseMolecule.atoms.columns` | **Blocking**: No high-level `addColumnAtom` |
| `atoms/saveState.ts` | `currentColumnsAtom` | `testcaseMolecule.atoms.columns` | **Minor**: Column type rename |
| `hooks/useSaveTestset.ts` | `currentColumnsAtom`, `saveTestsetAtom` | `testcaseMolecule.atoms.columns`, testset save atom | **Testset coupling**: save atom is testset concern |
| `hooks/useTestsetDrawer.ts` | `currentColumnsAtom` | `testcaseMolecule.atoms.columns` | **Minor**: Column type rename |

### Playground LoadTestsetModal

| File | Legacy APIs Used | Package Equivalent | Migration Notes |
|------|------------------|--------------------|-----------------|
| `LoadTestsetModalFooter/index.tsx` | `saveNewTestsetAtom` | Not in testcase package | **Testset coupling**: save is testset concern |
| `hooks/useSelectedTestcasesData.ts` | `testcase.selectors.data(id)` | `testcaseMolecule.data(id)` | **Blocking**: Expects flat data access pattern (`entity[columnKey]`). Package returns nested `.data[columnKey]`. |

### DrillInView

| File | Legacy APIs Used | Package Equivalent | Migration Notes |
|------|------------------|--------------------|-----------------|
| `TestcaseDrillInView.tsx` | `testcase` controller, `TestcaseColumn` type | `testcaseMolecule` controller | **Minor**: Column type exists in package under same name but different shape |

---

## 4. Gap List

### Blocking Gaps

| # | Gap | Severity | Affected Consumers | Description |
|---|-----|----------|--------------------|-------------|
| G1 | **FlattenedTestcase removed** | **BLOCKING** | `scenarioTestcase.ts`, `useTestcasesTable.ts`, `hooks/types.ts`, `hooks/api.ts`, `useSelectedTestcasesData.ts` | Package uses nested `Testcase` with `.data` property. All consumers accessing cell values at top level (`entity.country`) will break. Need either: (a) compatibility adapter that flattens on read, or (b) rewrite all consumers to use `entity.data.country`. |
| G2 | **Column type field rename** (`name` -> `label`) | **BLOCKING** | All column consumers (~12 files) | `Column.name` becomes `TestcaseColumn.label`. Breaks every column mapping, display, and type reference. |
| G3 | **ExpandedColumn shape change** | **BLOCKING** | `groupColumns.ts`, column expansion consumers | Legacy `{key, name, parentKey, subKey}` vs package `{key, fullPath, nestedKey, label}`. Different structure for nested column display. |
| G4 | **Pending column operation atoms not exposed** | **BLOCKING** | `localEntities.ts`, `tableStore.ts` | `addPendingAddedColumnAtom`, `addPendingDeletedColumnAtom`, `clearPending*` atoms are internalized in the package. AddToTestsetDrawer directly manipulates these for column sync workflows. |
| G5 | **High-level column CRUD atoms missing** | **BLOCKING** | `drawerState.ts`, TestcasesTableNew column operations | `addColumnAtom`, `deleteColumnAtom`, `renameColumnAtom` not exposed. These combine pending state updates + entity batch updates. |
| G6 | **`expandedColumnsAtom` not exposed** | **BLOCKING** | TestcasesTableNew column grouping | Recursive object column expansion (MAX_DEPTH=5) not available in package. |
| G7 | **`initializeEmptyRevisionAtom` signature mismatch** | **BLOCKING** | `useTestcasesTable.ts`, `tableStore.ts` | Legacy reads `revisionQueryAtom` internally to check flags. Package version requires `{serverTotalCount, isNewTestset}` params -- callers must be updated. |
| G8 | **`changesSummaryAtom` / `ChangesSummary` missing** | **MODERATE** | `hooks/types.ts`, save confirmation UI | Summary of `{modified, added, deleted, columnChanges}` counts. Could be built as derived atom in consumer. |
| G9 | **`flattenTestcase` / `unflattenTestcase` missing** | **BLOCKING** | `hooks/api.ts`, any code transforming API responses for legacy table | Package has no flattening utilities since it never flattens. |
| G10 | **`localEntitiesRevisionAtom` missing** | **MODERATE** | `localEntities.ts` | Tracks which revision local entities belong to. Needed for revision-switch cleanup. Package uses molecule lifecycle instead. |
| G11 | **Row status atoms missing** | **LOW** | Display row rendering | `isRowNewAtomFamily`, `isRowDeletedAtomFamily`, `isRowDirtyAtomFamily` not directly exposed. Derivable from `newIds`/`deletedIds`/`isDirty`. |
| G12 | **`setTestcaseIdsAtom` not exposed** | **MODERATE** | `tableStore.ts` | Package manages entity IDs internally through paginated store. Consumer must adapt. |
| G13 | **`testcasesFetchingAtom` missing** | **LOW** | Loading indicator | Derivable from paginated store state. |

### Non-Blocking Differences

| # | Difference | Impact | Notes |
|---|-----------|--------|-------|
| D1 | Query atoms (`revisionQueryAtom`, `testsetMetadataAtom`, etc.) | N/A | These are testset-level concerns, not testcase. They should come from `@agenta/entities/testset` or OSS testset state. |
| D2 | Save atoms (`saveTestsetAtom`, `saveNewTestsetAtom`) | N/A | Testset-level. Keep importing from testset module. |
| D3 | Atom cleanup approach | Low | Package uses molecule lifecycle. May need adapter for revision-switch cleanup pattern. |
| D4 | Batch fetcher cache strategy | Low | Legacy checks paginated cache first; package checks individual query cache. Functionally equivalent for consumers. |

---

## 5. Testset-Testcase Coupling

The legacy testcase module re-exports several testset-level atoms, creating a tight coupling that consumers rely on:

### What comes from testset, re-exported through testcase

```
testcase/index.ts re-exports:
  - currentRevisionIdAtom     <- queries.ts (owns atom, but conceptually testset-level)
  - revisionQueryAtom         <- queries.ts (fetches revision from testset API)
  - testsetIdAtom             <- queries.ts (derived from revision)
  - testsetDetailQueryAtom    <- queries.ts (fetches testset detail)
  - revisionsListQueryAtom    <- queries.ts (fetches revision list)
  - testsetMetadataAtom       <- queries.ts (derived from revision + testset)
  - saveTestsetAtom           <- testset/mutations (re-exported)
  - saveNewTestsetAtom        <- testset/mutations (re-exported)
  - clearChangesAtom          <- testset/mutations (re-exported)
  - hasAnyTestcaseDirtyAtom   <- dirtyState.ts (reads testcaseIsDirty for all IDs)
  - hasUnsavedChangesAtom     <- dirtyState.ts (combines dirty + column pending)
  - changesSummaryAtom        <- dirtyState.ts (counts changes)
```

### Coupling impact on migration

1. **Consumers importing from `@/oss/state/entities/testcase` for testset atoms** must be redirected to the testset module directly.

2. **The package correctly separates concerns**: `testcaseMolecule` does NOT include testset queries or save operations. This is the right design but means consumers need two import sources.

3. **Revision context is shared**: Both testcase and testset need to know the current revision. The package uses `testcaseMolecule.actions.setRevisionContext(revisionId)` to set this, but the atom is owned by testset-level state.

### Recommended separation

```
Consumer needs testcase data/mutations:
  -> import from @agenta/entities/testcase (testcaseMolecule)

Consumer needs revision/testset metadata:
  -> import from @agenta/entities/testset (or OSS testset state)

Consumer needs save operations:
  -> import from testset module (saveTestsetAtom, saveNewTestsetAtom)

Consumer needs dirty summary:
  -> Build derived atoms in OSS state layer combining testcaseMolecule + testset state
```

---

## 6. Recommended Migration Approach

### Phase 1: Package Augmentation (Pre-Migration)

Add missing capabilities to the package before migrating any consumer.

| Task | Priority | Effort |
|------|----------|--------|
| **Expose column CRUD actions** (`addColumn`, `deleteColumn`, `renameColumn`) in `testcaseMolecule.actions` | P0 | Medium |
| **Expose pending column atoms** (or provide equivalent actions) for direct manipulation | P0 | Medium |
| **Expose `expandedColumnsAtom`** or port column expansion to molecule | P0 | Low |
| **Add `changesSummaryAtom`** to molecule atoms namespace | P1 | Low |
| **Add row status atoms** (`isRowNew`, `isRowDeleted`, `isRowDirty`) to molecule atoms | P2 | Low |
| **Align `initializeEmptyRevision` signature** or document migration path | P0 | Low |

### Phase 2: Adapter Layer (Compatibility Bridge)

Create a thin adapter in `web/oss/src/state/entities/testcase/` that bridges the package to legacy consumer expectations.

```
state/entities/testcase/compat.ts
  - flattenTestcase(tc: Testcase): FlattenedTestcase
  - unflattenTestcase(flat: FlattenedTestcase): Testcase
  - Column -> TestcaseColumn adapter (name <-> label)
  - ExpandedColumn adapter (legacy shape <-> package shape)
  - flattenedDataAtomFamily(id) -- reads molecule.data(id), returns flattened
```

This allows consumers to migrate incrementally without a big-bang rewrite.

### Phase 3: Migrate Consumers (by risk/complexity)

#### Low Risk (migrate first)

| Consumer | Strategy |
|----------|----------|
| `TestcaseCell.tsx` | Direct swap: `testcase.selectors.cell` -> `testcaseMolecule.atoms.cell`. No flatten needed (cell reads individual column values). |
| `TestcaseSelectionCell.tsx` | Direct swap: `testcase.selectors.isDirty` -> `testcaseMolecule.isDirty`. |
| `atoms/saveState.ts` | Swap `currentColumnsAtom` -> `testcaseMolecule.atoms.columns`. Update column field access (`name` -> `label`). |
| `atoms/revisionContext.ts` | Swap `currentRevisionIdAtom` to testset module import. |

#### Medium Risk

| Consumer | Strategy |
|----------|----------|
| `TestcasesTableNew/index.tsx` | Redirect testset atoms (`revisionsListQueryAtom`, `testsetMetadataAtom`) to testset module. Keep testcase atoms on molecule. |
| `hooks/useTestcasesTable.ts` | Use molecule actions. Replace `FlattenedTestcase` with `Testcase` or use adapter. Redirect save/testset atoms. |
| `atoms/tableStore.ts` | Use package paginated store. Replace column clear atoms with molecule column actions. Adapt cleanup to molecule lifecycle. |
| `atoms/previewSync.ts` | Swap create/delete to molecule actions. Use molecule columns. |
| `atoms/drawerState.ts` | Requires `addColumnAtom` to be exposed in package (Phase 1 dependency). |
| `DrillInView/TestcaseDrillInView.tsx` | Swap controller. Adapt column type. |

#### High Risk (migrate last)

| Consumer | Strategy |
|----------|----------|
| `atoms/localEntities.ts` | Heavy pending column manipulation. Requires Phase 1 column CRUD exposure. Use adapter for `localEntitiesRevisionAtom`. |
| `atoms/scenarioTestcase.ts` | **CRITICAL**: Deeply assumes flat data access. Options: (a) use `flattenedDataAtomFamily` adapter, (b) rewrite downstream to use `entity.data[col]`. Option (a) is safer. |
| `useSelectedTestcasesData.ts` | Same flat data assumption. Use adapter or rewrite access pattern. |
| `hooks/api.ts` | Uses `flattenTestcase` for API response processing. If table moves to nested format, this can be removed. Otherwise use adapter. |

### Phase 4: Cleanup

After all consumers migrated:

1. Remove `web/oss/src/state/entities/testcase/` legacy files
2. Remove `compat.ts` adapter (if consumers have been updated to use nested format)
3. Update barrel exports to point to package

### Migration Order Summary

```
Phase 1: Augment package (column CRUD, expanded columns, summary atom)
    |
Phase 2: Create compat adapter (flatten/unflatten, column type bridge)
    |
Phase 3a: Low-risk consumers (cells, selection, simple column reads)
    |
Phase 3b: Medium-risk consumers (table, drawer, paginated store)
    |
Phase 3c: High-risk consumers (local entities, scenario testcase, data access)
    |
Phase 4: Remove legacy state + adapter
```

**Estimated total effort**: Medium-Large. The data format difference (flat vs nested) is the single biggest risk factor. Using an adapter layer makes the migration incremental and reversible.
