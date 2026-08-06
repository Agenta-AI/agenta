/**
 * Entity Delete Modal
 *
 * Components, hooks, and state for deleting entities.
 */

// ============================================================================
// COMPONENTS
// ============================================================================

export {
    EntityDeleteModal,
    createDeleteHandler,
    EntityDeleteTitle,
    EntityDeleteContent,
    EntityDeleteFooter,
} from "./components"
export type {DeleteEntitiesOptions} from "./components"

// ============================================================================
// HOOKS
// ============================================================================

export {useEntityDelete, useTestsetDelete, useVariantDelete, useEvaluatorDelete} from "./hooks"
export type {UseEntityDeleteReturn, DeleteOptions} from "./hooks"

// ============================================================================
// STATE
// ============================================================================

export {
    // Core atoms
    deleteModalOpenAtom,
    deleteModalEntitiesAtom,
    deleteModalLoadingAtom,
    deleteModalErrorAtom,
    // Derived atoms
    deleteModalGroupsAtom,
    deleteModalNamesAtom,
    deleteModalWarningsAtom,
    deleteModalBlockedAtom,
    deleteModalCanProceedAtom,
    deleteModalCountAtom,
    deleteModalStateAtom,
    // Action atoms
    resetDeleteModalAtom,
    openDeleteModalAtom,
    closeDeleteModalAtom,
    executeDeleteAtom,
} from "./state"
