/**
 * Entity Action Context
 *
 * React context and provider for the entity action dispatch system.
 * Provides a unified dispatch function for opening entity modals.
 */

import {createContext, useCallback, useContext, useMemo, type ReactNode} from "react"

import {useAtomValue, useSetAtom} from "jotai"

import {openCommitModalAtom, commitModalOpenAtom, commitModalLoadingAtom} from "../commit/state"
import {openDeleteModalAtom, deleteModalOpenAtom, deleteModalLoadingAtom} from "../delete/state"
import {
    openSaveModalAtom,
    openSaveNewModalAtom,
    saveModalOpenAtom,
    saveModalLoadingAtom,
} from "../save/state"
import {useSaveOrCommit} from "../useSaveOrCommit"

import {reduceEntityModalAction, type EntityActionHelpers} from "./reducer"
import type {EntityModalAction, ActiveModal, EntityActionState} from "./types"

// ============================================================================
// CONTEXT TYPES
// ============================================================================

/**
 * Entity action dispatch function
 */
export type EntityActionDispatch = (action: EntityModalAction) => void

/**
 * Context value for entity actions
 */
export interface EntityActionContextValue {
    /** Dispatch an entity modal action */
    dispatch: EntityActionDispatch
    /** Current state of the action system */
    state: EntityActionState
}

// ============================================================================
// CONTEXT
// ============================================================================

const EntityActionContext = createContext<EntityActionContextValue | null>(null)

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Hook to get the entity action dispatch function
 *
 * @returns Dispatch function for entity modal actions
 * @throws Error if used outside of EntityActionProvider
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const dispatch = useEntityActionDispatch()
 *
 *   const handleCommit = () => {
 *     dispatch({
 *       type: 'commit',
 *       entity: {type: 'revision', id: revisionId, name: 'My Revision'},
 *       initialMessage: 'Initial commit'
 *     })
 *   }
 *
 *   return <Button onClick={handleCommit}>Commit</Button>
 * }
 * ```
 */
export function useEntityActionDispatch(): EntityActionDispatch {
    const context = useContext(EntityActionContext)
    if (!context) {
        throw new Error("useEntityActionDispatch must be used within EntityActionProvider")
    }
    return context.dispatch
}

/**
 * Hook to get the current entity action state
 *
 * @returns Current state including activeModal, isOpen, isLoading
 * @throws Error if used outside of EntityActionProvider
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const {activeModal, isOpen, isLoading} = useEntityActionState()
 *
 *   if (isLoading) return <Spinner />
 *
 *   return <div>Active modal: {activeModal ?? 'none'}</div>
 * }
 * ```
 */
export function useEntityActionState(): EntityActionState {
    const context = useContext(EntityActionContext)
    if (!context) {
        throw new Error("useEntityActionState must be used within EntityActionProvider")
    }
    return context.state
}

/**
 * Hook to check if any modal is currently open (guard hook)
 *
 * Useful for preventing multiple modals from opening simultaneously.
 *
 * @returns Whether any entity modal is open
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const isModalOpen = useEntityActionGuard()
 *   const dispatch = useEntityActionDispatch()
 *
 *   const handleAction = () => {
 *     if (isModalOpen) return // Prevent opening another modal
 *     dispatch({type: 'commit', entity})
 *   }
 * }
 * ```
 */
export function useEntityActionGuard(): boolean {
    const context = useContext(EntityActionContext)
    if (!context) {
        throw new Error("useEntityActionGuard must be used within EntityActionProvider")
    }
    return context.state.isOpen
}

// ============================================================================
// PROVIDER IMPLEMENTATION
// ============================================================================

/**
 * Props for EntityActionProvider
 */
export interface EntityActionProviderProps {
    /** Child components */
    children: ReactNode
    /**
     * Whether to guard against opening multiple modals simultaneously.
     * When true, dispatch will be a no-op if a modal is already open.
     * Default: true
     */
    guardConcurrentModals?: boolean
}

/**
 * Internal hook that creates the dispatch function and state
 */
function useEntityActionContextValue(guardConcurrentModals: boolean): EntityActionContextValue {
    // Get modal open atoms
    const openCommitModal = useSetAtom(openCommitModalAtom)
    const openSaveModal = useSetAtom(openSaveModalAtom)
    const openNewModal = useSetAtom(openSaveNewModalAtom)
    const openDeleteModal = useSetAtom(openDeleteModalAtom)

    // Get saveOrCommit hook
    const {saveOrCommit} = useSaveOrCommit()

    // Get modal state atoms
    const commitOpen = useAtomValue(commitModalOpenAtom)
    const saveOpen = useAtomValue(saveModalOpenAtom)
    const deleteOpen = useAtomValue(deleteModalOpenAtom)

    const commitLoading = useAtomValue(commitModalLoadingAtom)
    const saveLoading = useAtomValue(saveModalLoadingAtom)
    const deleteLoading = useAtomValue(deleteModalLoadingAtom)

    // Build helpers object
    const helpers: EntityActionHelpers = useMemo(
        () => ({
            commit: (entity, initialMessage) => {
                openCommitModal(entity, initialMessage)
            },
            save: (entity, saveAsNew) => {
                openSaveModal(entity, saveAsNew)
            },
            create: (type, initialName) => {
                openNewModal(type, initialName)
            },
            remove: (entities, onSuccess) => {
                openDeleteModal({entities, onSuccess})
            },
            saveOrCommit: (entity, state, options) => {
                saveOrCommit(entity, state, options)
            },
        }),
        [openCommitModal, openSaveModal, openNewModal, openDeleteModal, saveOrCommit],
    )

    // Compute isOpen early for guard check
    const isOpen = commitOpen || saveOpen || deleteOpen

    // Create dispatch function with optional guard
    const dispatch = useCallback(
        (action: EntityModalAction) => {
            // Guard against concurrent modals if enabled
            if (guardConcurrentModals && isOpen) {
                if (process.env.NODE_ENV === "development") {
                    console.warn(
                        "[EntityActions] Dispatch blocked: a modal is already open. " +
                            "Set guardConcurrentModals=false to allow concurrent modals.",
                    )
                }
                return
            }
            reduceEntityModalAction(action, helpers)
        },
        [helpers, guardConcurrentModals, isOpen],
    )

    // Compute state
    const activeModal: ActiveModal = commitOpen
        ? "commit"
        : saveOpen
          ? "save"
          : deleteOpen
            ? "delete"
            : null

    const isLoading = commitLoading || saveLoading || deleteLoading

    const state: EntityActionState = useMemo(
        () => ({
            activeModal,
            isOpen,
            isLoading,
        }),
        [activeModal, isOpen, isLoading],
    )

    return useMemo(() => ({dispatch, state}), [dispatch, state])
}

/**
 * Provider component for entity action dispatch
 *
 * This provider should be mounted once at the app root, alongside
 * the entity modal components (EntityCommitModal, EntitySaveModal, EntityDeleteModal).
 *
 * @example
 * ```tsx
 * // In app root or layout
 * function App() {
 *   return (
 *     <EntityActionProvider>
 *       <EntityCommitModal />
 *       <EntitySaveModal />
 *       <EntityDeleteModal />
 *       <MainContent />
 *     </EntityActionProvider>
 *   )
 * }
 * ```
 */
export function EntityActionProvider({
    children,
    guardConcurrentModals = true,
}: EntityActionProviderProps) {
    const value = useEntityActionContextValue(guardConcurrentModals)

    return <EntityActionContext.Provider value={value}>{children}</EntityActionContext.Provider>
}
