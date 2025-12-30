/**
 * Testset Entity Module
 *
 * Manages testset and revision entities with:
 * - Zod schema validation
 * - Entity store with normalized caching
 * - Batch fetching for latest revisions
 * - Compatible with useEntity/useEntityList hooks
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

// Store export (use with useEntity/useEntityList hooks)
export {
    revisionStore,
    testsetStore,
    variantStore,
    fetchRevision,
    fetchRevisionsList,
    fetchTestsetsList,
    fetchTestsetDetail,
    fetchVariantDetail,
    type RevisionListParams,
    type RevisionDetailParams,
    type TestsetListParams,
    type TestsetDetailParams,
    type VariantDetailParams,
} from "./store"

// Revision entity atoms (use these directly instead of wrapper atoms)
export {
    // Revisions list query (for dropdown)
    revisionsListQueryAtomFamily,
    enableRevisionsListQueryAtom,
    // Latest revision - derived from revisions list query (preferred)
    latestRevisionForTestsetAtomFamily,
    // Latest revision (legacy - batch fetches latest revision per testset)
    requestLatestRevisionAtom,
    latestRevisionAtomFamily,
    clearLatestRevisionCacheAtom,
    // Entity pattern atoms - use these directly
    revisionEntityAtomFamily,
    revisionDraftAtomFamily,
    revisionHasDraftAtomFamily,
    clearRevisionDraftAtom,
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

// Stateful atoms (combines entity cache + query in single atom)
export {
    testsetStatefulAtomFamily,
    revisionStatefulAtomFamily, // Includes batch fetching + draft merging
    variantStatefulAtomFamily, // Variant contains name and description
} from "./statefulAtoms"
