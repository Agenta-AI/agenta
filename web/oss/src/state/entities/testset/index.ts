/**
 * Testset Entity Module
 *
 * Manages testset, revision, and variant entities with:
 * - Zod schema validation
 * - Query atoms with cache redirect (no explicit hydration)
 * - Batch fetching for revisions
 * - Stateful atoms for simplified entity access
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
    // Query atoms
    testsetQueryAtomFamily,
    testsetsListQueryAtomFamily,
    // Server state
    testsetServerStateAtomFamily,
    // Entity atoms
    testsetEntityAtomFamily,
    // Variant query atoms
    variantQueryAtomFamily,
    variantServerStateAtomFamily,
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
    // Legacy stores (deprecated - kept for backward compatibility)
    revisionStore,
    testsetStore,
    variantStore,
} from "./store"

// Revision entity atoms
export {
    // Query atoms
    revisionQueryAtomFamily,
    // Server state
    revisionServerStateAtomFamily,
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

// Stateful atoms (combines entity + query state in single atom)
export {
    testsetStatefulAtomFamily,
    revisionStatefulAtomFamily,
    variantStatefulAtomFamily,
} from "./statefulAtoms"
