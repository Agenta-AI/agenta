/**
 * Testcase State - Jotai atoms and molecule
 *
 * NOTE: Column operations (add/remove/rename) are now managed at revision level.
 * Use revision.tableReducers from @agenta/entities/testset instead.
 */

// Molecule (primary API)
export {testcaseMolecule, type TestcaseMolecule, type CreateTestcasesOptions} from "./molecule"

// Store atoms (for advanced use cases)
export {
    // Context
    currentRevisionIdAtom,
    setCurrentRevisionIdAtom,
    // ID tracking
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
    // Pending column state (derived from revision-level state)
    // NOTE: Use revision.tableReducers for mutations, these are read-only
    pendingColumnRenamesAtom,
    pendingDeletedColumnsAtom,
    pendingAddedColumnsAtom,
    // Query atoms
    testcaseQueryAtomFamily,
    // Draft atoms
    testcaseDraftAtomFamily,
    testcaseHasDraftAtomFamily,
    testcaseIsDirtyAtomFamily,
    // Entity atoms
    testcaseEntityAtomFamily,
    // Cell atoms
    testcaseCellAtomFamily,
    // Mutations
    updateTestcaseAtom,
    discardDraftAtom,
    discardAllDraftsAtom,
    batchUpdateTestcasesSyncAtom,
} from "./store"

// Data controller (unified data source abstraction)
export {testcaseDataController, type TestcaseDataConfig} from "./dataController"

// Paginated store for InfiniteVirtualTable
export {
    testcasePaginatedStore,
    testcaseFilters,
    testcasesRevisionIdAtom,
    testcasesSearchTermAtom,
    setDebouncedSearchTermAtom,
    testcasesPaginatedMetaAtom,
    initializeEmptyRevisionAtom,
    type TestcaseTableRow,
    type TestcasePaginatedMeta,
    type InitializeEmptyRevisionParams,
} from "./paginatedStore"
