/**
 * useEntitySave Hook
 *
 * Hook for triggering entity save via the EntitySaveModal.
 * Uses the shared createEntityActionHook factory for the base implementation.
 */

import {useCallback} from "react"

import {useSetAtom} from "jotai"

import {createEntityActionHook} from "../../shared"
import type {EntityType, EntityReference} from "../../types"
import {
    openSaveModalAtom,
    openSaveNewModalAtom,
    saveModalLoadingAtom,
    saveModalOpenAtom,
} from "../state"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Return type for useEntitySave hook
 */
export interface UseEntitySaveReturn {
    /**
     * Save an existing entity
     *
     * @param type Entity type
     * @param id Entity ID
     * @param name Optional display name
     * @param saveAsNew Whether to save as a new copy
     *
     * @example
     * ```tsx
     * const {saveEntity} = useEntitySave()
     *
     * <Button onClick={() => saveEntity('testset', testsetId, testsetName)}>
     *   Save
     * </Button>
     * ```
     */
    saveEntity: (type: EntityType, id: string, name?: string, saveAsNew?: boolean) => void

    /**
     * Save an entity with full reference
     *
     * @param entity Entity reference
     * @param saveAsNew Whether to save as a new copy
     *
     * @example
     * ```tsx
     * const {saveEntityRef} = useEntitySave()
     *
     * saveEntityRef({type: 'testset', id: testsetId}, true) // save as new
     * ```
     */
    saveEntityRef: (entity: EntityReference, saveAsNew?: boolean) => void

    /**
     * Create a new entity
     *
     * @param type Entity type to create
     * @param initialName Optional initial name
     *
     * @example
     * ```tsx
     * const {createEntity} = useEntitySave()
     *
     * <Button onClick={() => createEntity('testset', 'My New Testset')}>
     *   Create Testset
     * </Button>
     * ```
     */
    createEntity: (type: EntityType, initialName?: string) => void

    /**
     * Whether a save operation is in progress
     */
    isSaving: boolean

    /**
     * Whether the save modal is open
     */
    isOpen: boolean
}

// ============================================================================
// BASE HOOK (using factory)
// ============================================================================

/**
 * Internal hook created from factory (for existing entity save)
 */
const useEntitySaveBase = createEntityActionHook<[saveAsNew?: boolean]>({
    openAtom: openSaveModalAtom,
    loadingAtom: saveModalLoadingAtom,
    openStateAtom: saveModalOpenAtom,
})

/**
 * Hook for triggering entity save
 *
 * @returns Save functions and state
 *
 * @example
 * ```tsx
 * function TestsetCard({testset}: {testset: Testset}) {
 *   const {saveEntity, isSaving} = useEntitySave()
 *
 *   return (
 *     <Card>
 *       <h3>{testset.name}</h3>
 *       <Button
 *         onClick={() => saveEntity('testset', testset.id, testset.name)}
 *         loading={isSaving}
 *       >
 *         Save Changes
 *       </Button>
 *     </Card>
 *   )
 * }
 * ```
 */
export function useEntitySave(): UseEntitySaveReturn {
    const {actionEntity, actionEntityRef, isActioning, isOpen} = useEntitySaveBase()
    const openNewModal = useSetAtom(openSaveNewModalAtom)

    // Create entity uses a different atom (openSaveNewModalAtom)
    const createEntity = useCallback(
        (type: EntityType, initialName?: string) => {
            openNewModal(type, initialName)
        },
        [openNewModal],
    )

    return {
        saveEntity: actionEntity,
        saveEntityRef: actionEntityRef,
        createEntity,
        isSaving: isActioning,
        isOpen,
    }
}

// ============================================================================
// CONVENIENCE HOOKS
// ============================================================================

/**
 * Hook specifically for saving testsets
 *
 * @example
 * ```tsx
 * const {saveTestset, createTestset} = useTestsetSave()
 *
 * <Button onClick={() => saveTestset(testsetId)}>Save</Button>
 * <Button onClick={() => createTestset('New Testset')}>Create</Button>
 * ```
 */
export function useTestsetSave() {
    const {saveEntity, createEntity, isSaving, isOpen} = useEntitySave()

    const saveTestset = useCallback(
        (id: string, name?: string, saveAsNew?: boolean) => {
            saveEntity("testset", id, name, saveAsNew)
        },
        [saveEntity],
    )

    const createTestset = useCallback(
        (initialName?: string) => {
            createEntity("testset", initialName)
        },
        [createEntity],
    )

    return {saveTestset, createTestset, isSaving, isOpen}
}

/**
 * Hook specifically for saving variants
 */
export function useVariantSave() {
    const {saveEntity, createEntity, isSaving, isOpen} = useEntitySave()

    const saveVariant = useCallback(
        (id: string, name?: string, saveAsNew?: boolean) => {
            saveEntity("variant", id, name, saveAsNew)
        },
        [saveEntity],
    )

    const createVariant = useCallback(
        (initialName?: string) => {
            createEntity("variant", initialName)
        },
        [createEntity],
    )

    return {saveVariant, createVariant, isSaving, isOpen}
}
