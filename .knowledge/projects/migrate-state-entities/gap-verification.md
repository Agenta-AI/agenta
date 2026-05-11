# Gap Verification: `state/entities/` → `@agenta/entities` Migration

## Summary

Verified all 10 gaps listed in Phase 0.2 of `plan.md` against the actual package code. **8 of 10 gaps are fully resolved** in the package. The remaining 2 require minor consumer-side work, not package changes.

---

## Gap-by-Gap Verification

### Gap 1: `flattenTestcase` / `unflattenTestcase`

**Status: CONFIRMED — Not in package**

**Evidence:**
- Legacy definition: `web/oss/src/state/entities/testcase/schema.ts` (lines 149-179)
- `flattenTestcase` spreads `testcase.data` keys to the top level for table display; `unflattenTestcase` reverses it
- Package grep across `web/packages/agenta-entities/src/testcase/` returns zero matches for `flatten` or `unflatten`
- Package testcaseMolecule stores data in **nested format** (`testcase.data[columnKey]`) per molecule.ts line 759 comment

**Consumers (outside legacy state/):**
- `web/oss/src/components/TestcasesTableNew/hooks/api.ts` (line 3, 46) — imports `flattenTestcase` from legacy schema

**Recommended Resolution:**
- **(c) Consumer refactoring** — The package intentionally uses nested `Testcase` format throughout. The `testcasePaginatedStore` and `testcaseDataController` in the package already handle table row presentation internally. Consumers should migrate to reading `testcase.data[col]` via `testcaseMolecule.atoms.cell({id, column})` instead of flattening. If a standalone utility is still needed for edge cases (e.g., CSV export), add `flattenTestcase`/`unflattenTestcase` to `@agenta/entities/testcase` core as a pure utility — but this is low priority since the package's cell atom pattern eliminates most use cases.

---

### Gap 2: `currentRevisionIdAtom`

**Status: RESOLVED — Package provides it**

**Evidence:**
- Package has `currentRevisionIdAtom` at `web/packages/agenta-entities/src/testcase/state/store.ts` (line 41)
- Exported from `web/packages/agenta-entities/src/testcase/state/index.ts` (line 14)
- Also exported: `setCurrentRevisionIdAtom` (line 15)
- Used internally by testcase molecule, paginated store, and testset mutations

**Consumers:**
- 6 consumer files in `web/oss/src/components/` import from legacy `@/oss/state/entities/testset` or `@/oss/state/entities/testcase`
- These can directly switch to `import { currentRevisionIdAtom } from "@agenta/entities/testcase"`

**Recommended Resolution:**
- **(a) Package already provides it** — Direct import path swap. No code changes needed beyond updating import paths.

---

### Gap 3: `testsetMetadataAtom` / `metadataLoadingAtom` / `metadataErrorAtom`

**Status: CONFIRMED — Not in package (derived atoms specific to legacy)**

**Evidence:**
- Legacy definition: `web/oss/src/state/entities/testcase/queries.ts` (lines 210-254)
- `testsetMetadataAtom` is a derived atom composing `revisionQuery.data` + `testsetDetailQuery` data into a `TestsetMetadataInfo`-shaped object
- Package has the **type** `TestsetMetadataInfo` at `web/packages/agenta-entities/src/testcase/core/types.ts` (lines 118-129) with matching shape
- Package does NOT have an equivalent derived atom that combines revision + testset data into metadata

**Consumers:**
- `web/oss/src/components/TestcasesTableNew/index.tsx` (line 82) — reads `testsetMetadataAtom`
- `web/oss/src/components/TestcasesTableNew/hooks/useTestcasesTable.ts` (line 103) — reads `metadataLoadingAtom`

**Recommended Resolution:**
- **(c) Consumer refactoring** — These are UI-level derived atoms that compose revision + testset queries. Consumers should derive metadata locally:
  ```typescript
  const revisionData = useAtomValue(revisionMolecule.atoms.data(revisionId))
  const testsetData = useAtomValue(testsetMolecule.atoms.data(testsetId))
  // Compose metadata in component or local atom
  ```
  Alternatively, add a `testsetMetadataAtomFamily(revisionId)` to the package if multiple consumers need it. Given only 2 consumers, local derivation is cleaner.

---

### Gap 4: `enableRevisionsListQueryAtom`

**Status: RESOLVED — Package provides it**

**Evidence:**
- Package exports `enableRevisionsListQueryAtom` from `web/packages/agenta-entities/src/testset/state/index.ts` (line 27)
- Defined in `web/packages/agenta-entities/src/testset/state/store.ts`
- Also accessible via `revisionMolecule.reducers.enableList` per `web/packages/agenta-entities/src/testset/state/revisionMolecule.ts` (line 752)

**Consumers:**
- `web/oss/src/components/TestcasesTableNew/components/TestcaseHeader.tsx` (line 12)
- Several playground and AddToTestsetDrawer files

**Recommended Resolution:**
- **(a) Package already provides it** — Import from `@agenta/entities/testset` directly.

---

### Gap 5: `testsetsListQueryAtomFamily(params)`

**Status: RESOLVED — Package provides it**

**Evidence:**
- Package exports `testsetsListQueryAtomFamily` from `web/packages/agenta-entities/src/testset/state/index.ts` (line 37)
- Defined in `web/packages/agenta-entities/src/testset/state/store.ts`
- Also accessible via `testsetMolecule.atoms.list(searchQuery)` per testsetMolecule

**Consumers:**
- `web/oss/src/components/pages/evaluations/NewEvaluation/Components/NewEvaluationModalInner.tsx` (line 21)
- `web/oss/src/components/EvaluationRunsTablePOC/components/filters/EvaluationRunsHeaderFilters.tsx` (line 12)
- `web/oss/src/components/EvaluationRunsTablePOC/components/filters/EvaluationRunsFiltersContent.tsx` (line 8)

**Recommended Resolution:**
- **(a) Package already provides it** — Direct import swap.

---

### Gap 6: `fetchRevision` / `fetchRevisionsList` / `fetchVariantDetail`

**Status: RESOLVED — Package provides all three**

**Evidence:**
- Package exports all three from `web/packages/agenta-entities/src/testset/index.ts` (lines 114-121):
  - `fetchRevision` (line 114)
  - `fetchRevisionsList` (line 117)
  - `fetchVariantDetail` (line 121)
- Defined in `web/packages/agenta-entities/src/testset/api/api.ts`
- No consumer files outside `state/entities/` import these directly from the legacy path (confirmed via grep)

**Recommended Resolution:**
- **(a) Package already provides it** — These are already available. Legacy internal consumers will be eliminated when the legacy module is deleted.

---

### Gap 7: `NEW_TESTSET_ID` / `isNewTestsetId`

**Status: RESOLVED — Package provides both**

**Evidence:**
- Package exports both from `web/packages/agenta-entities/src/testset/index.ts` (lines 83-84):
  - `NEW_TESTSET_ID` (line 83)
  - `isNewTestsetId` (line 84)
- Defined in `web/packages/agenta-entities/src/testset/core/schema.ts`

**Recommended Resolution:**
- **(a) Package already provides it** — Direct import swap from `@agenta/entities/testset`.

---

### Gap 8: `saveNewTestsetAtom`

**Status: RESOLVED — Package provides it**

**Evidence:**
- Package exports `saveNewTestsetAtom` from `web/packages/agenta-entities/src/testset/state/index.ts` (line 81)
- Defined in `web/packages/agenta-entities/src/testset/state/mutations.ts` (line 458)
- Also used internally by `testsetMolecule` for entity-mode creation (testsetMolecule.ts lines 672-673)

**Consumers:**
- `web/oss/src/components/Playground/Components/TestsetDropdown/index.tsx`
- `web/oss/src/components/Playground/Components/Modals/LoadTestsetModal/assets/LoadTestsetModalFooter/index.tsx`

**Recommended Resolution:**
- **(a) Package already provides it** — Import from `@agenta/entities/testset`.

---

### Gap 9: `traceEntityAtomFamily` / `invalidateTraceEntityCache`

**Status: RESOLVED — Package provides both**

**Evidence:**
- Package exports both from `web/packages/agenta-entities/src/trace/index.ts` (lines 173, 179):
  - `traceEntityAtomFamily` (line 173)
  - `invalidateTraceEntityCache` (line 179)
- Defined in `web/packages/agenta-entities/src/trace/state/store.ts`
- Also exports derived atoms: `traceRootSpanAtomFamily`, `traceInputsAtomFamily`, `traceOutputsAtomFamily`
- Error classes also exported: `SpanNotFoundError`, `TraceNotFoundError`

**Recommended Resolution:**
- **(a) Package already provides it** — Direct import swap from `@agenta/entities/trace`.

---

### Gap 10: `getValueAtPath`

**Status: RESOLVED — Package provides it (two locations)**

**Evidence:**
- Exported from `@agenta/entities/trace` at `web/packages/agenta-entities/src/trace/index.ts` (line 129)
- Also available from `@agenta/shared/utils` at `web/packages/agenta-shared/src/utils/pathUtils.ts`
- Defined in trace utils: `web/packages/agenta-entities/src/trace/utils/selectors.ts`

**Recommended Resolution:**
- **(a) Package already provides it** — Import from `@agenta/entities/trace` for trace-related consumers, or `@agenta/shared/utils` for general use.

---

## New Gaps Discovered

### New Gap A: `FlattenedTestcase` type missing from package

**Evidence:**
- Legacy defines `FlattenedTestcase` in `web/oss/src/state/entities/testcase/schema.ts`
- No match in package: grep for `FlattenedTestcase` across `web/packages/agenta-entities/src/testcase/` returns zero results
- Used by `web/oss/src/components/TestcasesTableNew/hooks/api.ts` and `web/oss/src/components/TestcasesTableNew/hooks/types.ts`

**Resolution:** This type is a byproduct of the `flattenTestcase` function (Gap 1). If consumers migrate to the nested `Testcase` format + cell atoms, this type becomes unnecessary. If `flattenTestcase` is added as a utility, the type should be added alongside it.

### New Gap B: `testsetMetadataAtom` composition pattern not in package

**Evidence:**
- See Gap 3 above. The package has `TestsetMetadataInfo` type but no atom that produces it.
- Only 2 consumer files need this.

**Resolution:** Consumer-side derivation (see Gap 3).

### New Gap C: `expandedColumnsAtom` naming/access difference

**Evidence:**
- Legacy: `expandedColumnsAtom` in `web/oss/src/state/entities/testcase/columnState.ts` (line 570) — a standalone derived atom
- Package: `expandedTestcaseColumnsAtomFamily(revisionId)` in `web/packages/agenta-entities/src/testset/state/revisionMolecule.ts` (line 744) — requires `revisionId` parameter
- Exported via `revisionMolecule.atoms.expandedColumns(revisionId)`

**Resolution:** Already provided, just different access pattern. Consumers must pass `revisionId` explicitly instead of relying on implicit `currentRevisionIdAtom`.

### New Gap D: `invalidateRevisionsListCache` access pattern

**Evidence:**
- Package exports it at top level: `web/packages/agenta-entities/src/testset/index.ts` (line 40)
- Function signature at `web/packages/agenta-entities/src/testset/state/store.ts` (line 637): `invalidateRevisionsListCache(testsetId: string): void`
- Legacy has equivalent in `web/oss/src/state/entities/testset/store.ts`

**Resolution:** Already provided, direct swap.

---

## Shared Utilities Comparison Table

| Legacy Utility | Location | Package Equivalent | Package Location | Status |
|---|---|---|---|---|
| `createEntityDraftState` | `state/entities/shared/createEntityDraftState.ts` | `createEntityDraftState` | `shared/molecule/createEntityDraftState.ts` | Equivalent exists |
| `createEntityController` | `state/entities/shared/createEntityController.ts` | `createEntityController` | `shared/molecule/createEntityController.ts` | Equivalent exists |
| `createPaginatedEntityStore` | `state/entities/shared/createPaginatedEntityStore.ts` | `createPaginatedEntityStore` | `shared/paginated/createPaginatedEntityStore.ts` | Equivalent exists |
| `createStatefulEntityAtomFamily` | `state/entities/shared/createStatefulEntityAtomFamily.ts` | No direct equivalent | — | Subsumed by `createMolecule` |
| `EntityAPI` type | `state/entities/shared/createEntityController.ts` | `EntityAPI` type | `shared/molecule/createEntityController.ts` | Equivalent exists |
| `EntityDrillIn` type | `state/entities/shared/createEntityController.ts` | `EntityDrillIn` type | `shared/molecule/createEntityController.ts` | Equivalent exists |
| `PathItem` type | `state/entities/shared/createEntityController.ts` | `PathItem` type | `shared/molecule/createEntityController.ts` | Equivalent exists |
| `QueryResult` type | `state/entities/shared/createStatefulEntityAtomFamily.ts` | `QueryResult` type | Exported from `@agenta/entities/shared` | Equivalent exists |
| `QueryState` type | `state/entities/shared/createEntityController.ts` | `QueryState` type | `shared/molecule/types.ts` | Equivalent exists |
| `PaginatedEntityStore` type | `state/entities/shared/createPaginatedEntityStore.ts` | `PaginatedEntityStore` type | `shared/paginated/createPaginatedEntityStore.ts` | Equivalent exists |

**Key finding:** Every shared factory and type from the legacy `state/entities/shared/` has a direct equivalent in the package at `@agenta/entities/shared`. The legacy shared module can be deleted once testcase and testset modules are migrated, with no package additions needed.

---

## Overall Assessment

### Migration Readiness: HIGH

- **8 of 10 original gaps are fully resolved** in the package with direct import swaps
- **2 gaps require consumer refactoring** (flattenTestcase, testsetMetadataAtom), not package changes
- **All 4 shared utilities** have package equivalents
- **All types** (EntityAPI, EntityDrillIn, PathItem, QueryState, etc.) are exported from the package

### Recommended Order of Operations

1. **No package changes needed** — The package is feature-complete for this migration
2. **Proceed directly to Phase 1** (Trace) — all trace gaps verified as resolved
3. **For Phase 3-4** (Testset/Testcase):
   - `flattenTestcase` consumers need refactoring to use cell atoms or nested data access
   - `testsetMetadataAtom` consumers (2 files) need local derivation from revision + testset atoms
   - `expandedColumnsAtom` consumers need to pass `revisionId` explicitly

### Risk Items

| Item | Risk | Mitigation |
|---|---|---|
| `flattenTestcase` removal | MEDIUM | Affects data pipeline in TestcasesTableNew — verify paginated store handles table rows without flattening |
| `testsetMetadataAtom` | LOW | Only 2 consumers, simple derivation |
| `currentRevisionIdAtom` dual location | LOW | Package has its own at `@agenta/entities/testcase` — legacy consumers just need import swap |
| Shared factory deletion timing | LOW | Only delete after all 3 entity modules (trace, testset, testcase) are migrated |
