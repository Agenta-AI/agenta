/**
 * EntityActionProvider
 *
 * A convenience component that combines the EntityActionProvider context
 * with all entity modals (commit, save, delete) in one place.
 *
 * This is the recommended way to set up entity modals in your app.
 * Mount this once at the app root.
 *
 * @example
 * ```tsx
 * // In app root or layout
 * import { EntityModalsProvider } from '@agenta/entity-ui'
 *
 * function App() {
 *   return (
 *     <EntityModalsProvider>
 *       <MainContent />
 *     </EntityModalsProvider>
 *   )
 * }
 *
 * // In any component
 * import { useEntityActionDispatch } from '@agenta/entity-ui'
 *
 * function MyComponent() {
 *   const dispatch = useEntityActionDispatch()
 *
 *   return (
 *     <Button onClick={() => dispatch({type: 'commit', entity: {type: 'revision', id, name}})}>
 *       Commit
 *     </Button>
 *   )
 * }
 * ```
 */

import {lazy, Suspense, type ReactNode} from "react"

import {useHasOpened} from "@agenta/ui/hooks"
import {useAtomValue} from "jotai"

import {EntityActionProvider} from "./actions"
import {commitModalOpenAtom} from "./commit/state"
import {deleteModalOpenAtom} from "./delete/state"
import {saveModalOpenAtom} from "./save/state"

// A lazy component downloads when it first renders, so each modal renders from its first open.
const EntityCommitModal = lazy(() =>
    import("./commit").then((mod) => ({default: mod.EntityCommitModal})),
)
const EntityDeleteModal = lazy(() =>
    import("./delete").then((mod) => ({default: mod.EntityDeleteModal})),
)
const EntitySaveModal = lazy(() => import("./save").then((mod) => ({default: mod.EntitySaveModal})))

// ============================================================================
// TYPES
// ============================================================================

/**
 * Props for EntityModalsProvider
 */
export interface EntityModalsProviderProps {
    /** Child components */
    children: ReactNode
    /** Whether to render the commit modal (default: true) */
    includeCommitModal?: boolean
    /** Whether to render the save modal (default: true) */
    includeSaveModal?: boolean
    /** Whether to render the delete modal (default: true) */
    includeDeleteModal?: boolean
    /**
     * Whether to guard against opening multiple modals simultaneously.
     * When true, dispatch will be a no-op if a modal is already open.
     * Default: true
     */
    guardConcurrentModals?: boolean
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Combined provider that includes EntityActionProvider and all entity modals
 *
 * This is the recommended way to set up entity modals in your app.
 * Mount this once at the app root to enable the unified action dispatch system.
 *
 * Features:
 * - Renders all entity modals (commit, save, delete) in one place
 * - Provides the EntityActionProvider context for dispatch
 * - Modals are controlled via atoms and the dispatch function
 *
 * @example
 * ```tsx
 * // Basic usage
 * <EntityModalsProvider>
 *   <App />
 * </EntityModalsProvider>
 *
 * // Selective modals (e.g., only delete)
 * <EntityModalsProvider
 *   includeCommitModal={false}
 *   includeSaveModal={false}
 * >
 *   <App />
 * </EntityModalsProvider>
 * ```
 */
export function EntityModalsProvider({
    children,
    includeCommitModal = true,
    includeSaveModal = true,
    includeDeleteModal = true,
    guardConcurrentModals = true,
}: EntityModalsProviderProps) {
    const commitOpened = useHasOpened(useAtomValue(commitModalOpenAtom))
    const saveOpened = useHasOpened(useAtomValue(saveModalOpenAtom))
    const deleteOpened = useHasOpened(useAtomValue(deleteModalOpenAtom))

    return (
        <EntityActionProvider guardConcurrentModals={guardConcurrentModals}>
            {children}
            <Suspense fallback={null}>
                {includeCommitModal && commitOpened && <EntityCommitModal />}
                {includeSaveModal && saveOpened && <EntitySaveModal />}
                {includeDeleteModal && deleteOpened && <EntityDeleteModal />}
            </Suspense>
        </EntityActionProvider>
    )
}
