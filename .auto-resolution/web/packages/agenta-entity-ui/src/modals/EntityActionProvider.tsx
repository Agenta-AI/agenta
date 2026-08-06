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
 * import { useEntityActionDispatch, commitAction } from '@agenta/entity-ui'
 *
 * function MyComponent() {
 *   const dispatch = useEntityActionDispatch()
 *
 *   return (
 *     <Button onClick={() => dispatch(commitAction({type: 'revision', id, name}))}>
 *       Commit
 *     </Button>
 *   )
 * }
 * ```
 */

import {lazy, Suspense, type ReactNode} from "react"

import {EntityActionProvider} from "./actions"

// Lazy load modals to reduce initial bundle size
// The modals are only rendered when their respective atoms open them
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
    return (
        <EntityActionProvider guardConcurrentModals={guardConcurrentModals}>
            {children}
            <Suspense fallback={null}>
                {includeCommitModal && <EntityCommitModal />}
                {includeSaveModal && <EntitySaveModal />}
                {includeDeleteModal && <EntityDeleteModal />}
            </Suspense>
        </EntityActionProvider>
    )
}
