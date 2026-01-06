/**
 * Testcase Entity Module
 *
 * Manages testcase entities with:
 * - Batch fetching for concurrent requests
 * - Cache redirect from paginated query cache
 * - Complex draft state with column change tracking
 * - Cell-level subscriptions for fine-grained reactivity
 * - Entity controllers for unified API access
 */

// Schema exports
export {
    testcaseSchema,
    testcasesResponseSchema,
    flattenTestcase,
    unflattenTestcase,
    type Testcase,
    type FlattenedTestcase,
    type TestcasesResponse,
} from "./schema"

// Query atoms
export {
    currentRevisionIdAtom,
    revisionQueryAtom,
    testsetIdAtom,
    testsetDetailQueryAtom,
    revisionsListQueryAtom,
    fetchTestcasesPage,
    testsetMetadataAtom,
    metadataLoadingAtom,
    metadataErrorAtom,
    PAGE_SIZE,
    type RevisionData,
    type RevisionListItem,
    type TestcasesPage,
    type TestsetMetadata,
} from "./queries"

// Entity atoms
export {
    testcaseIdsAtom,
    setTestcaseIdsAtom,
    resetTestcaseIdsAtom,
    newEntityIdsAtom,
    addNewEntityIdAtom,
    removeNewEntityIdAtom,
    clearNewEntityIdsAtom,
    deletedEntityIdsAtom,
    markDeletedAtom,
    unmarkDeletedAtom,
    clearDeletedIdsAtom,
    // Query atom family (single source of truth for server data)
    testcaseQueryAtomFamily,
    testcaseDraftAtomFamily,
    testcaseHasDraftAtomFamily,
    testcaseIsDirtyAtomFamily,
    testcaseEntityAtomFamily,
    testcaseCellAtomFamily,
    updateTestcaseAtom,
    discardDraftAtom,
    discardAllDraftsAtom,
    batchUpdateTestcasesSyncAtom,
    renameColumnInTestcasesAtom,
    deleteColumnFromTestcasesAtom,
    addColumnToTestcasesAtom,
} from "./testcaseEntity"

// Column state
export {
    currentColumnsAtom,
    expandedColumnsAtom,
    pendingColumnRenamesAtom,
    pendingAddedColumnsAtom,
    pendingDeletedColumnsAtom,
    addColumnAtom,
    deleteColumnAtom,
    renameColumnAtom,
    resetColumnsAtom,
    clearPendingRenamesAtom,
    clearPendingAddedColumnsAtom,
    clearPendingDeletedColumnsAtom,
    type Column,
    type ExpandedColumn,
} from "./columnState"

// Display rows
export {displayRowRefsAtom, type DisplayRowRef} from "./displayRows"

// Edit session
export {initializeEmptyRevisionAtom} from "./editSession"

// Testcase mutations
export {
    addTestcaseAtom,
    appendTestcasesAtom,
    createTestcasesAtom,
    deleteTestcasesAtom,
    type AddTestcaseResult,
    type CreateTestcasesOptions,
    type CreateTestcasesResult,
} from "./testcaseMutations"

// Revision-level mutations (save, clear changes)
export {
    saveTestsetAtom,
    saveNewTestsetAtom,
    clearChangesAtom,
    type SaveTestsetParams,
    type SaveTestsetResult,
    type SaveNewTestsetParams,
    type SaveNewTestsetResult,
} from "../testset/mutations"

// Atom cleanup (for revision changes)
export {cleanupOnRevisionChangeAtom} from "./atomCleanup"

// Paginated store exports
export {
    testcasePaginatedStore,
    testcasesRevisionIdAtom,
    testcasesSearchTermAtom,
    setDebouncedSearchTermAtom,
    testcasesPaginatedMetaAtom,
    testcasesFetchingAtom,
    PAGE_SIZE as TESTCASES_PAGE_SIZE,
    type TestcaseTableRow,
    type TestcasePaginatedMeta,
} from "./paginatedStore"

// Entity API (unified API - recommended for most use cases)
export {
    testcase,
    type TestcaseAction,
    type TestcaseColumn,
    type TestcaseControllerState,
} from "./controller"
