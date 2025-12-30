/**
 * Testcase Entity Module
 *
 * Manages testcase entities with:
 * - Batch fetching for concurrent requests
 * - Cache redirect from paginated query cache
 * - Complex draft state with column change tracking
 * - Cell-level subscriptions for fine-grained reactivity
 * - Stateful atoms for simplified entity access
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
    variantDetailQueryAtom,
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
    testcaseQueryAtomFamily,
    testcaseDraftAtomFamily,
    testcaseHasDraftAtomFamily,
    testcaseIsDirtyAtomFamily,
    testcaseEntityAtomFamily,
    testcaseServerStateAtomFamily,
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
    type ColumnDef,
} from "./columnState"

// Display rows
export {
    displayRowRefsAtom,
    type DisplayRowRef,
} from "./displayRows"

// Edit session
export {
    initializeEmptyRevisionAtom,
} from "./editSession"

// Drill-in state (for JSON viewer modals)
export {
    drillInStateAtom,
    drillInPathAtom,
    drillInValueAtom,
    resetDrillInAtom,
    setDrillInPathAtom,
    getValueAtPath,
    setValueAtPathAtom,
    toggleFieldAtom,
    toggleRawModeAtom,
    type DrillInState,
} from "./drillInState"

// Mutations
export {
    addTestcaseAtom,
    appendTestcasesAtom,
    deleteTestcasesAtom,
    saveTestsetAtom,
    clearChangesAtom,
    type AddTestcaseResult,
} from "./mutations"

// Atom cleanup (for revision changes)
export {
    cleanupOnRevisionChangeAtom,
} from "./atomCleanup"

// Stateful atoms (combines entity cache + query in single atom)
export {
    testcaseStatefulAtomFamily,
} from "./statefulAtoms"
