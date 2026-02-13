/**
 * useEntityDelete Hook
 *
 * Hook for triggering entity deletion via the EntityDeleteModal.
 * Provides convenience methods for single and multi-entity deletion.
 *
 * NOTE: This hook doesn't use createEntityActionHook from ../shared because
 * delete operations have a fundamentally different pattern - they support
 * batch deletion with an array of entities, while the factory is designed
 * for single-entity operations with optional extra arguments.
 */

import {useCallback} from "react"

import {useAtomValue, useSetAtom} from "jotai"

import type {EntityType, EntityReference} from "../../types"
import {openDeleteModalAtom, deleteModalLoadingAtom, deleteModalOpenAtom} from "../state"

/**
 * Options for delete operations
 */
export interface DeleteOptions {
    /**
     * Callback to execute after successful deletion
     * Useful for navigation, refreshing data, etc.
     */
    onSuccess?: () => void
}

/**
 * Return type for useEntityDelete hook
 */
export interface UseEntityDeleteReturn {
    /**
     * Delete a single entity
     *
     * @param type Entity type
     * @param id Entity ID
     * @param name Optional display name
     * @param options Optional delete options (onSuccess callback)
     *
     * @example
     * ```tsx
     * const {deleteEntity} = useEntityDelete()
     *
     * // Simple delete
     * <Button onClick={() => deleteEntity('testset', testsetId, testsetName)}>
     *   Delete
     * </Button>
     *
     * // With callback for navigation after delete
     * deleteEntity('revision', revisionId, revisionName, {
     *   onSuccess: () => router.push('/testsets')
     * })
     * ```
     */
    deleteEntity: (type: EntityType, id: string, name?: string, options?: DeleteOptions) => void

    /**
     * Delete multiple entities
     *
     * @param entities Array of entity references
     * @param options Optional delete options (onSuccess callback)
     *
     * @example
     * ```tsx
     * const {deleteEntities} = useEntityDelete()
     *
     * const handleBulkDelete = () => {
     *   deleteEntities([
     *     {type: 'testset', id: '1', name: 'Testset 1'},
     *     {type: 'revision', id: '2', name: 'Revision 2'},
     *   ], {
     *     onSuccess: () => clearSelection()
     *   })
     * }
     * ```
     */
    deleteEntities: (entities: EntityReference[], options?: DeleteOptions) => void

    /**
     * Whether a delete operation is in progress
     */
    isDeleting: boolean

    /**
     * Whether the delete modal is open
     */
    isOpen: boolean
}

/**
 * Hook for triggering entity deletion
 *
 * @returns Delete functions and state
 *
 * @example
 * ```tsx
 * function TestsetCard({testset}: {testset: Testset}) {
 *   const {deleteEntity, isDeleting} = useEntityDelete()
 *
 *   return (
 *     <Card>
 *       <h3>{testset.name}</h3>
 *       <Button
 *         danger
 *         onClick={() => deleteEntity('testset', testset.id, testset.name)}
 *         loading={isDeleting}
 *       >
 *         Delete
 *       </Button>
 *     </Card>
 *   )
 * }
 * ```
 */
export function useEntityDelete(): UseEntityDeleteReturn {
    const openModal = useSetAtom(openDeleteModalAtom)
    const isDeleting = useAtomValue(deleteModalLoadingAtom)
    const isOpen = useAtomValue(deleteModalOpenAtom)

    const deleteEntity = useCallback(
        (type: EntityType, id: string, name?: string, options?: DeleteOptions) => {
            openModal({
                entities: [{type, id, name}],
                onSuccess: options?.onSuccess,
            })
        },
        [openModal],
    )

    const deleteEntities = useCallback(
        (entities: EntityReference[], options?: DeleteOptions) => {
            if (entities.length === 0) return
            openModal({
                entities,
                onSuccess: options?.onSuccess,
            })
        },
        [openModal],
    )

    return {
        deleteEntity,
        deleteEntities,
        isDeleting,
        isOpen,
    }
}

// ============================================================================
// CONVENIENCE HOOKS
// ============================================================================

/**
 * Hook specifically for deleting testsets
 *
 * @example
 * ```tsx
 * const {deleteTestset} = useTestsetDelete()
 *
 * <Button onClick={() => deleteTestset(testsetId, testsetName)}>
 *   Delete Testset
 * </Button>
 * ```
 */
export function useTestsetDelete() {
    const {deleteEntity, isDeleting, isOpen} = useEntityDelete()

    const deleteTestset = useCallback(
        (id: string, name?: string) => {
            deleteEntity("testset", id, name)
        },
        [deleteEntity],
    )

    return {deleteTestset, isDeleting, isOpen}
}

/**
 * Hook specifically for deleting variants
 */
export function useVariantDelete() {
    const {deleteEntity, isDeleting, isOpen} = useEntityDelete()

    const deleteVariant = useCallback(
        (id: string, name?: string) => {
            deleteEntity("variant", id, name)
        },
        [deleteEntity],
    )

    return {deleteVariant, isDeleting, isOpen}
}

/**
 * Hook specifically for deleting evaluators
 */
export function useEvaluatorDelete() {
    const {deleteEntity, isDeleting, isOpen} = useEntityDelete()

    const deleteEvaluator = useCallback(
        (id: string, name?: string) => {
            deleteEntity("evaluator", id, name)
        },
        [deleteEntity],
    )

    return {deleteEvaluator, isDeleting, isOpen}
}
