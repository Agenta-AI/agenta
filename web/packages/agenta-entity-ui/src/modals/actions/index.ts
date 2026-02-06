/**
 * Entity Modal Actions
 *
 * Unified action dispatch system for entity modals.
 * Provides a single entry point for opening commit, save, and delete modals.
 *
 * @example
 * ```tsx
 * import {
 *   EntityActionProvider,
 *   useEntityActionDispatch,
 *   commitAction,
 * } from '@agenta/entity-ui/modals'
 *
 * // In app root
 * <EntityActionProvider>
 *   <EntityCommitModal />
 *   <EntitySaveModal />
 *   <EntityDeleteModal />
 *   <App />
 * </EntityActionProvider>
 *
 * // In component
 * const dispatch = useEntityActionDispatch()
 * dispatch(commitAction({type: 'revision', id, name}))
 * ```
 */

// ============================================================================
// TYPES
// ============================================================================

export type {
    EntityModalAction,
    CommitAction,
    SaveAction,
    CreateAction,
    DeleteAction,
    SaveOrCommitAction,
    ActiveModal,
    EntityActionState,
} from "./types"

// ============================================================================
// ACTION CREATORS
// ============================================================================

export {commitAction, saveAction, createAction, deleteAction, saveOrCommitAction} from "./types"

// ============================================================================
// REDUCER
// ============================================================================

export {reduceEntityModalAction, type EntityActionHelpers} from "./reducer"

// ============================================================================
// CONTEXT & HOOKS
// ============================================================================

export {
    EntityActionProvider,
    useEntityActionDispatch,
    useEntityActionState,
    useEntityActionGuard,
    type EntityActionDispatch,
    type EntityActionContextValue,
    type EntityActionProviderProps,
} from "./context"
