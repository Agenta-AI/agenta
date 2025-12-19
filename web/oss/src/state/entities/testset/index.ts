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
    normalizeRevision,
    isV0Revision,
    getVersionDisplay,
    type Revision,
    type RevisionListItem,
    type RevisionsResponse,
    type Testset,
    type TestsetsResponse,
} from "./revisionSchema"

// Store export (use with useEntity/useEntityList hooks)
export {
    revisionStore,
    fetchRevision,
    fetchRevisionsList,
    type RevisionListParams,
    type RevisionDetailParams,
} from "./store"

// Revision entity atoms
export {
    // Revisions list query (for dropdown)
    revisionsListQueryAtomFamily,
    // Latest revision (for testsets list - batch fetches latest revision per testset)
    requestLatestRevisionAtom,
    latestRevisionAtomFamily,
    clearLatestRevisionCacheAtom,
    type LatestRevisionInfo,
} from "./revisionEntity"

// Testset metadata management (uses revisionDraftAtomFamily - same pattern as testcases)
export {
    // Context
    currentRevisionIdAtom,
    // Current values (from revision entity: server + draft merged)
    currentTestsetNameAtom,
    currentDescriptionAtom,
    // Write atoms (update revision draft)
    setLocalTestsetNameAtom,
    setLocalDescriptionAtom,
    resetMetadataDraftAtom,
    // Dirty state
    testsetNameChangedAtom,
    descriptionChangedAtom,
    hasMetadataChangesAtom,
    // Derived
    currentTestsetIdAtom,
    currentRevisionVersionAtom,
} from "./testsetMetadata"

// Dirty state (revision-level + aggregate testcase dirty states)
export {
    revisionIsDirtyAtom,
    hasAnyTestcaseDirtyAtom,
    hasUnsavedChangesAtom,
    changesSummaryAtom,
    type ChangesSummary,
} from "./dirtyState"

// Mutations (revision-level: save, clear changes)
export {
    saveTestsetAtom,
    clearChangesAtom,
    type SaveTestsetParams,
    type SaveTestsetResult,
} from "./mutations"
