/**
 * Testset Entity Module
 *
 * Manages testset, revision, and variant entities with:
 * - Zod schema validation
 * - Query atoms with cache redirect (no explicit hydration)
 * - Batch fetching for revisions
 * - Entity controllers for unified API access
 */

// Schema exports
export {
    revisionSchema,
    revisionListItemSchema,
    revisionsResponseSchema,
    testsetSchema,
    testsetsResponseSchema,
    variantSchema,
    normalizeRevision,
    isV0Revision,
    getVersionDisplay,
    type Revision,
    type RevisionListItem,
    type RevisionsResponse,
    type Testset,
    type TestsetsResponse,
    type Variant,
} from "./revisionSchema"

// Testset entity atoms
export {
    // Query atoms (single source of truth for server data)
    testsetQueryAtomFamily,
    testsetsListQueryAtomFamily,
    // Entity atoms (with draft merged)
    testsetEntityAtomFamily,
    // Server data (without draft)
    testsetServerDataAtomFamily,
    // Draft state atoms
    testsetDraftState,
    testsetHasDraftAtomFamily,
    testsetIsDirtyAtomFamily,
    updateTestsetDraftAtom,
    discardTestsetDraftAtom,
    // New testset helpers
    NEW_TESTSET_ID,
    isNewTestsetId,
    // Variant query atoms
    variantQueryAtomFamily,
    variantEntityAtomFamily,
    // API functions
    fetchRevision,
    fetchRevisionsList,
    fetchTestsetsList,
    fetchTestsetDetail,
    fetchVariantDetail,
    // Cache invalidation
    invalidateTestsetsListCache,
    invalidateTestsetCache,
    invalidateRevisionsListCache,
    // Param types
    type RevisionListParams,
    type RevisionDetailParams,
    type TestsetListParams,
    type TestsetDetailParams,
    type VariantDetailParams,
} from "./store"

// Revision entity atoms
export {
    // Query atoms
    revisionQueryAtomFamily,
    // Entity atoms (includes draft merging)
    revisionEntityAtomFamily,
    // Draft atoms
    revisionDraftAtomFamily,
    revisionHasDraftAtomFamily,
    clearRevisionDraftAtom,
    // Revisions list query (for dropdown)
    revisionsListQueryAtomFamily,
    enableRevisionsListQueryAtom,
    // Latest revision - derived from revisions list query (preferred)
    latestRevisionForTestsetAtomFamily,
    // Latest revision (legacy - batch fetches latest revision per testset)
    requestLatestRevisionAtom,
    latestRevisionAtomFamily,
    latestRevisionStatefulAtomFamily,
    clearLatestRevisionCacheAtom,
    type LatestRevisionInfo,
} from "./revisionEntity"

// Re-export currentRevisionIdAtom from testcase queries (canonical location)
export {currentRevisionIdAtom} from "../testcase/queries"

// Dirty state (revision-level + aggregate testcase dirty states)
export {
    revisionIsDirtyAtom,
    hasAnyTestcaseDirtyAtom,
    hasUnsavedChangesAtom,
    changesSummaryAtom,
    hasMetadataChangesAtom,
    testsetNameChangedAtom,
    type ChangesSummary,
} from "./dirtyState"

// Mutations (revision-level: save, clear changes)
export {
    saveTestsetAtom,
    clearChangesAtom,
    type SaveTestsetParams,
    type SaveTestsetResult,
} from "./mutations"

// Revision controller (unified API for revision entity + column operations)
// Access all revision functionality through the `revision` API:
//   - revision.controller(id) - Full state + dispatch
//   - revision.selectors.* - Fine-grained subscriptions
//   - revision.actions.* - For use in other atoms
//   - revision.queries.* - List and detail queries
//   - revision.invalidate.* - Cache invalidation
export {
    revision,
    type RevisionControllerState,
    type RevisionAction,
    type Column,
    type ExpandedColumn,
} from "./controller"

// Testset controller (unified API for testset queries)
// Access testset functionality through the `testset` API:
//   - testset.queries.list(searchQuery) - List query
//   - testset.queries.detail(id) - Detail query
//   - testset.selectors.* - Entity access
//   - testset.invalidate.* - Cache invalidation
//   - testset.paginated.* - Paginated store for InfiniteVirtualTable
//   - testset.filters.* - Filter atoms for paginated queries
export {
    testset,
    type TestsetApiRow,
    type TestsetTableRow,
    type TestsetDateRange,
    type TestsetPaginatedMeta,
} from "./testsetController"

// Paginated store (for direct access if needed)
export {testsetPaginatedStore} from "./paginatedStore"
