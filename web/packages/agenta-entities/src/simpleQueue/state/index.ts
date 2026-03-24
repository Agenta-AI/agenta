/**
 * SimpleQueue State
 *
 * Jotai atoms and molecule for simple queue entity state management.
 */

// ============================================================================
// MOLECULE (Primary API)
// ============================================================================

export {simpleQueueMolecule, type SimpleQueueMolecule, type QueueScenarioProgress} from "./molecule"

// ============================================================================
// STORE ATOMS
// ============================================================================

export {
    // List query
    simpleQueuesListQueryAtom,
    simpleQueuesListDataAtom,
    // Single entity
    simpleQueueQueryAtomFamily,
    simpleQueueDraftAtomFamily,
    simpleQueueEntityAtomFamily,
    simpleQueueIsDirtyAtomFamily,
    // Draft mutations
    updateSimpleQueueDraftAtom,
    discardSimpleQueueDraftAtom,
    // Server mutations
    createSimpleQueueAtom,
    deleteSimpleQueueAtom,
    deleteSimpleQueuesAtom,
    addTracesToQueueAtom,
    addTestcasesToQueueAtom,
    // Cache invalidation
    invalidateSimpleQueuesListCache,
    invalidateSimpleQueueCache,
    invalidateScenarioProgressCache,
} from "./molecule"

// ============================================================================
// PAGINATED STORE
// ============================================================================

export {
    simpleQueuePaginatedStore,
    simpleQueueKindFilterAtom,
    simpleQueueSearchTermAtom,
    type SimpleQueueTableRow,
} from "./paginatedStore"

// ============================================================================
// TASKS PAGINATED STORE
// ============================================================================

export {
    simpleQueueTasksPaginatedStore,
    taskQueueIdAtom,
    taskStatusFilterAtom,
    taskUserIdAtom,
    type SimpleQueueTaskRow,
} from "./tasksPaginatedStore"
