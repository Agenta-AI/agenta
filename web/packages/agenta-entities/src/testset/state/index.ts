/**
 * Testset State - Molecules and Query Atoms
 */

// Molecules
export {
    revisionMolecule,
    invalidateRevisionsListCache,
    type RevisionMolecule,
} from "./revisionMolecule"
export {
    testsetMolecule,
    invalidateTestsetsListCache,
    invalidateTestsetCache,
    type TestsetMolecule,
} from "./testsetMolecule"

// Low-level store atoms (for advanced use cases)
export {
    // Revision atoms
    currentTestsetIdForRevisionsAtom,
    revisionIdsAtom,
    setRevisionIdsAtom,
    revisionQueryAtomFamily,
    revisionDraftAtomFamily,
    revisionsListQueryAtomFamily,
    enableRevisionsListQueryAtom,
    latestRevisionForTestsetAtomFamily,
    // Latest revision helpers (for OSS table cells)
    latestRevisionQueryAtomFamily,
    latestRevisionAtomFamily,
    latestRevisionStatefulAtomFamily,
    requestLatestRevisionAtom,
    // Testset atoms
    testsetQueryAtomFamily,
    testsetDraftAtomFamily,
    testsetsListQueryAtomFamily,
    // Variant atoms
    variantQueryAtomFamily,
} from "./store"

// Paginated store (for InfiniteVirtualTable integration)
export {
    testsetPaginatedStore,
    testsetFilters,
    testsetsPaginatedMetaAtom,
    // Individual filter atoms (for direct access)
    testsetsSearchTermAtom,
    testsetsExportFormatAtom,
    testsetsDateCreatedAtom,
    testsetsDateModifiedAtom,
} from "./paginatedStore"

// Revision table state (for unified table component)
export {
    revisionTableState,
    pendingColumnOpsAtomFamily,
    pendingRowOpsAtomFamily,
    hasPendingChangesAtomFamily,
    addColumnReducer,
    removeColumnReducer,
    renameColumnReducer,
    addRowReducer,
    removeRowReducer,
    removeRowsReducer,
    clearPendingOpsReducer,
    createEffectiveColumnsAtomFamily,
    createEffectiveRowIdsAtomFamily,
    createRowRefsAtomFamily,
    type TableColumn,
    type RowRef,
    type PendingColumnOps,
    type PendingRowOps,
    type ColumnRenameOp,
} from "./revisionTableState"

// Mutation atoms (save, clear, track changes)
export {
    // Legacy save atoms (use saveReducer for new code)
    saveTestsetAtom,
    saveNewTestsetAtom,
    // Unified save reducer (preferred)
    saveReducer,
    saveStateAtom,
    // Clone reducers (two-layer: local and backend)
    cloneLocalReducer,
    cloneBackendReducer,
    // Delete reducer (for EntityDeleteModal adapter)
    deleteTestsetsReducer,
    // Other mutations
    clearChangesAtom,
    changesSummaryAtom,
    hasUnsavedChangesAtom,
    // Types
    type SaveTestsetParams,
    type SaveTestsetResult,
    type SaveNewTestsetParams,
    type SaveNewTestsetResult,
    type CloneLocalParams,
    type CloneLocalResult,
    type CloneBackendParams,
    type CloneBackendResult,
    type ChangesSummary,
    type SaveState,
    type SaveParams,
} from "./mutations"
