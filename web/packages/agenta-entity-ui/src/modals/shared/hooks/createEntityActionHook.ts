/**
 * Entity Action Hook Factory
 *
 * Creates standardized hooks for entity modal actions (commit, save, delete).
 * Reduces boilerplate by providing a common pattern for all action hooks.
 */

import {useCallback} from "react"

import {useAtomValue, useSetAtom} from "jotai"
import type {Atom, WritableAtom} from "jotai"

import type {EntityReference, EntityType} from "../../types"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for creating a base entity action hook
 */
export interface CreateEntityActionHookConfig<TOpenArgs extends unknown[] = []> {
    /** Atom to open the modal (write-only, read value is ignored) */
    openAtom: WritableAtom<unknown, [entity: EntityReference, ...args: TOpenArgs], void>
    /** Atom to check loading state */
    loadingAtom: Atom<boolean>
    /** Atom to check if modal is open */
    openStateAtom: Atom<boolean>
}

/**
 * Return type for base entity action hook
 */
export interface UseEntityActionReturn<TOpenArgs extends unknown[] = []> {
    /** Trigger action by type, id, and optional name */
    actionEntity: (type: EntityType, id: string, name?: string, ...args: TOpenArgs) => void
    /** Trigger action by entity reference */
    actionEntityRef: (entity: EntityReference, ...args: TOpenArgs) => void
    /** Whether the action is in progress */
    isActioning: boolean
    /** Whether the modal is open */
    isOpen: boolean
}

/**
 * Return type for typed entity action hook (e.g., useTestsetCommit)
 */
export interface UseTypedEntityActionReturn<TOpenArgs extends unknown[] = []> {
    /** Trigger action for specific entity type */
    action: (id: string, name?: string, ...args: TOpenArgs) => void
    /** Whether the action is in progress */
    isActioning: boolean
    /** Whether the modal is open */
    isOpen: boolean
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a base entity action hook
 *
 * @param config - Hook configuration with atoms
 * @returns A hook function that provides entity action methods
 *
 * @example
 * ```typescript
 * const useEntityCommit = createEntityActionHook({
 *   openAtom: openCommitModalAtom,
 *   loadingAtom: commitModalLoadingAtom,
 *   openStateAtom: commitModalOpenAtom,
 * })
 *
 * // Usage in component
 * const { actionEntity, actionEntityRef, isActioning, isOpen } = useEntityCommit()
 * actionEntity("testset", "id-123", "My Testset")
 * ```
 */
export function createEntityActionHook<TOpenArgs extends unknown[] = []>(
    config: CreateEntityActionHookConfig<TOpenArgs>,
): () => UseEntityActionReturn<TOpenArgs> {
    const {openAtom, loadingAtom, openStateAtom} = config

    return function useEntityAction(): UseEntityActionReturn<TOpenArgs> {
        const openModal = useSetAtom(openAtom)
        const isActioning = useAtomValue(loadingAtom)
        const isOpen = useAtomValue(openStateAtom)

        const actionEntity = useCallback(
            (type: EntityType, id: string, name?: string, ...args: TOpenArgs) => {
                const entity: EntityReference = {type, id, name}
                openModal(entity, ...args)
            },
            [openModal],
        )

        const actionEntityRef = useCallback(
            (entity: EntityReference, ...args: TOpenArgs) => {
                openModal(entity, ...args)
            },
            [openModal],
        )

        return {
            actionEntity,
            actionEntityRef,
            isActioning,
            isOpen,
        }
    }
}

/**
 * Create a typed entity action hook for a specific entity type
 *
 * @param baseHook - The base entity action hook
 * @param entityType - The entity type this hook is for
 * @returns A hook function for the specific entity type
 *
 * @example
 * ```typescript
 * const useEntityCommit = createEntityActionHook({...})
 * const useTestsetCommit = createTypedEntityActionHook(useEntityCommit, "testset")
 *
 * // Usage in component
 * const { action, isActioning, isOpen } = useTestsetCommit()
 * action("id-123", "My Testset")
 * ```
 */
export function createTypedEntityActionHook<TOpenArgs extends unknown[] = []>(
    baseHook: () => UseEntityActionReturn<TOpenArgs>,
    entityType: EntityType,
): () => UseTypedEntityActionReturn<TOpenArgs> {
    return function useTypedEntityAction(): UseTypedEntityActionReturn<TOpenArgs> {
        const {actionEntity, isActioning, isOpen} = baseHook()

        const action = useCallback(
            (id: string, name?: string, ...args: TOpenArgs) => {
                actionEntity(entityType, id, name, ...args)
            },
            [actionEntity],
        )

        return {
            action,
            isActioning,
            isOpen,
        }
    }
}
