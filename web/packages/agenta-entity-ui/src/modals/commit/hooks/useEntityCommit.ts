/**
 * useEntityCommit Hook
 *
 * Hook for triggering entity commit via the EntityCommitModal.
 * Uses the shared createEntityActionHook factory for the base implementation.
 */

import {createEntityActionHook} from "../../shared"
import type {EntityReference, EntityType} from "../../types"
import {openCommitModalAtom, commitModalLoadingAtom, commitModalOpenAtom} from "../state"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Return type for useEntityCommit hook
 */
export interface UseEntityCommitReturn {
    /**
     * Commit an entity
     *
     * @param type Entity type
     * @param id Entity ID
     * @param name Optional display name
     * @param initialMessage Optional initial commit message
     *
     * @example
     * ```tsx
     * const {commitEntity} = useEntityCommit()
     *
     * <Button onClick={() => commitEntity('revision', revisionId, revisionName)}>
     *   Commit
     * </Button>
     * ```
     */
    commitEntity: (type: EntityType, id: string, name?: string, initialMessage?: string) => void

    /**
     * Commit an entity with full reference
     *
     * @param entity Entity reference
     * @param initialMessage Optional initial commit message
     *
     * @example
     * ```tsx
     * const {commitEntityRef} = useEntityCommit()
     *
     * commitEntityRef({type: 'revision', id: revisionId, name: 'My Revision'}, 'Initial message')
     * ```
     */
    commitEntityRef: (entity: EntityReference, initialMessage?: string) => void

    /**
     * Whether a commit operation is in progress
     */
    isCommitting: boolean

    /**
     * Whether the commit modal is open
     */
    isOpen: boolean
}

/**
 * Options for useBoundCommit hook
 */
export interface UseBoundCommitOptions {
    /** Entity type */
    type: EntityType
    /** Entity ID - if falsy, commit action will be null */
    id: string | null | undefined
    /** Display name for the entity */
    name?: string
    /** Whether commit is allowed (e.g., hasChanges) - if false, commit action will be null */
    canCommit?: boolean
    /** Optional metadata to pass to the commit context (e.g., loadableId for playground) */
    metadata?: Record<string, unknown>
}

/**
 * Return type for useBoundCommit hook
 */
export interface UseBoundCommitReturn {
    /**
     * Commit action - null if entity ID is missing or canCommit is false
     * When non-null, can be called directly or passed to onClick
     */
    commit: (() => void) | null

    /**
     * Whether a commit operation is in progress
     */
    isCommitting: boolean

    /**
     * Whether the commit modal is open
     */
    isOpen: boolean

    /**
     * Whether commit is available (id exists and canCommit is true)
     */
    canCommit: boolean
}

// ============================================================================
// BASE HOOK (using factory)
// ============================================================================

/**
 * Internal hook created from factory
 */
const useEntityCommitBase = createEntityActionHook<[initialMessage?: string]>({
    openAtom: openCommitModalAtom,
    loadingAtom: commitModalLoadingAtom,
    openStateAtom: commitModalOpenAtom,
})

/**
 * Hook for triggering entity commit
 *
 * @returns Commit functions and state
 *
 * @example
 * ```tsx
 * function RevisionCard({revision}: {revision: Revision}) {
 *   const {commitEntity, isCommitting} = useEntityCommit()
 *
 *   return (
 *     <Card>
 *       <h3>{revision.name}</h3>
 *       <Button
 *         onClick={() => commitEntity('revision', revision.id, revision.name)}
 *         loading={isCommitting}
 *       >
 *         Commit Changes
 *       </Button>
 *     </Card>
 *   )
 * }
 * ```
 */
export function useEntityCommit(): UseEntityCommitReturn {
    const {actionEntity, actionEntityRef, isActioning, isOpen} = useEntityCommitBase()

    return {
        commitEntity: actionEntity,
        commitEntityRef: actionEntityRef,
        isCommitting: isActioning,
        isOpen,
    }
}
