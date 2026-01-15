/**
 * useEntityCommit Hook
 *
 * Hook for triggering entity commit via the EntityCommitModal.
 * Uses the shared createEntityActionHook factory for the base implementation.
 */

import {useCallback, useMemo} from "react"

import {createEntityActionHook, createTypedEntityActionHook} from "../../shared"
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

// ============================================================================
// CONVENIENCE HOOKS
// ============================================================================

/**
 * Internal typed hook for revisions
 */
const useRevisionCommitBase = createTypedEntityActionHook(useEntityCommitBase, "revision")

/**
 * Hook specifically for committing revisions
 *
 * @example
 * ```tsx
 * const {commitRevision} = useRevisionCommit()
 *
 * <Button onClick={() => commitRevision(revisionId, revisionName)}>
 *   Commit Revision
 * </Button>
 * ```
 */
export function useRevisionCommit() {
    const {action, isActioning, isOpen} = useRevisionCommitBase()

    const commitRevision = useCallback(
        (id: string, name?: string, initialMessage?: string) => {
            action(id, name, initialMessage)
        },
        [action],
    )

    return {commitRevision, isCommitting: isActioning, isOpen}
}

/**
 * Internal typed hook for variants
 */
const useVariantCommitBase = createTypedEntityActionHook(useEntityCommitBase, "variant")

/**
 * Hook specifically for committing variants
 */
export function useVariantCommit() {
    const {action, isActioning, isOpen} = useVariantCommitBase()

    const commitVariant = useCallback(
        (id: string, name?: string, initialMessage?: string) => {
            action(id, name, initialMessage)
        },
        [action],
    )

    return {commitVariant, isCommitting: isActioning, isOpen}
}

// ============================================================================
// BOUND COMMIT HOOK
// ============================================================================

/**
 * Hook that returns a bound commit action based on entity state
 *
 * Returns `commit: null` when:
 * - Entity ID is missing/falsy
 * - `canCommit` option is false
 *
 * This allows cleaner component code without manual validation:
 *
 * @example
 * ```tsx
 * // Before (manual validation)
 * const {commitEntity} = useEntityCommit()
 * const handleCommit = useCallback(() => {
 *   if (!hasChanges || !revisionId) return
 *   commitEntity("revision", revisionId, name)
 * }, [hasChanges, revisionId, name, commitEntity])
 *
 * // After (validation handled by hook)
 * const {commit, canCommit} = useBoundCommit({
 *   type: "revision",
 *   id: revisionId,
 *   name,
 *   canCommit: hasChanges,
 * })
 *
 * <Button onClick={commit ?? undefined} disabled={!canCommit}>
 *   Commit
 * </Button>
 * ```
 */
export function useBoundCommit(options: UseBoundCommitOptions): UseBoundCommitReturn {
    const {type, id, name, canCommit: canCommitOption = true} = options
    const {commitEntity, isCommitting, isOpen} = useEntityCommit()

    // Determine if commit is available
    const canCommit = Boolean(id) && canCommitOption

    // Create bound commit action (null if not available)
    const commit = useMemo(() => {
        if (!canCommit || !id) return null
        return () => commitEntity(type, id, name)
    }, [canCommit, id, type, name, commitEntity])

    return {
        commit,
        isCommitting,
        isOpen,
        canCommit,
    }
}
