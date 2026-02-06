/**
 * Delete Modal State
 *
 * Jotai atoms for managing delete modal state.
 * Uses atomWithReset for clean reset on modal close.
 */

import {atom} from "jotai"
import {atomWithReset, RESET} from "jotai/utils"

import {getEntityAdapter} from "../adapters"
import {groupEntitiesByType} from "../types"
import type {EntityReference, EntityGroup} from "../types"

// ============================================================================
// CORE STATE ATOMS
// ============================================================================

/**
 * Whether the delete modal is open
 */
export const deleteModalOpenAtom = atomWithReset(false)

/**
 * Entities to be deleted
 */
export const deleteModalEntitiesAtom = atomWithReset<EntityReference[]>([])

/**
 * Success callback to be called after successful deletion
 */
export const deleteModalOnSuccessAtom = atomWithReset<(() => void) | null>(null)

/**
 * Loading state during delete operation
 */
export const deleteModalLoadingAtom = atomWithReset(false)

/**
 * Error from delete operation
 */
export const deleteModalErrorAtom = atomWithReset<Error | null>(null)

// ============================================================================
// DERIVED ATOMS
// ============================================================================

/**
 * Entities grouped by type for display
 */
export const deleteModalGroupsAtom = atom((get): EntityGroup[] => {
    const entities = get(deleteModalEntitiesAtom)
    return groupEntitiesByType(entities)
})

/**
 * Resolved entity names via adapters
 */
export const deleteModalNamesAtom = atom((get): string[] => {
    const entities = get(deleteModalEntitiesAtom)

    return entities.map((ref) => {
        // If name is already provided, use it
        if (ref.name) return ref.name

        // Try to resolve via adapter
        const adapter = getEntityAdapter(ref.type)
        if (!adapter) return ref.id

        const entity = get(adapter.dataAtom(ref.id))
        return adapter.getDisplayName(entity)
    })
})

/**
 * Warning messages from adapters
 */
export const deleteModalWarningsAtom = atom((get): string[] => {
    const entities = get(deleteModalEntitiesAtom)
    const warnings: string[] = []

    for (const ref of entities) {
        const adapter = getEntityAdapter(ref.type)
        if (!adapter?.getDeleteWarning) continue

        const entity = get(adapter.dataAtom(ref.id))
        const warning = adapter.getDeleteWarning(entity)
        if (warning) warnings.push(warning)
    }

    return warnings
})

/**
 * Entities that cannot be deleted (based on adapter.canDelete)
 */
export const deleteModalBlockedAtom = atom((get): EntityReference[] => {
    const entities = get(deleteModalEntitiesAtom)
    const blocked: EntityReference[] = []

    for (const ref of entities) {
        const adapter = getEntityAdapter(ref.type)
        if (!adapter?.canDelete) continue

        const entity = get(adapter.dataAtom(ref.id))
        if (!adapter.canDelete(entity)) {
            blocked.push(ref)
        }
    }

    return blocked
})

/**
 * Whether delete can proceed (no blocked entities)
 */
export const deleteModalCanProceedAtom = atom((get): boolean => {
    const blocked = get(deleteModalBlockedAtom)
    const entities = get(deleteModalEntitiesAtom)
    return entities.length > 0 && blocked.length === 0
})

/**
 * Total count of entities to delete
 */
export const deleteModalCountAtom = atom((get): number => {
    return get(deleteModalEntitiesAtom).length
})

// ============================================================================
// ACTION ATOMS
// ============================================================================

/**
 * Reset all delete modal state
 */
export const resetDeleteModalAtom = atom(null, (_get, set) => {
    set(deleteModalOpenAtom, RESET)
    set(deleteModalEntitiesAtom, RESET)
    set(deleteModalOnSuccessAtom, RESET)
    set(deleteModalLoadingAtom, RESET)
    set(deleteModalErrorAtom, RESET)
})

/**
 * Options for opening the delete modal
 */
export interface OpenDeleteModalOptions {
    entities: EntityReference[]
    onSuccess?: () => void
}

/**
 * Open delete modal with entities and optional callback
 */
export const openDeleteModalAtom = atom(null, (_get, set, options: OpenDeleteModalOptions) => {
    // Reset first to clear any previous state
    set(resetDeleteModalAtom)

    // Set new entities
    set(deleteModalEntitiesAtom, options.entities)
    // Set callback if provided
    if (options.onSuccess) {
        set(deleteModalOnSuccessAtom, options.onSuccess)
    }
    // Open modal
    set(deleteModalOpenAtom, true)
})

/**
 * Close delete modal without deleting
 */
export const closeDeleteModalAtom = atom(null, (_get, set) => {
    set(deleteModalOpenAtom, false)
    // Note: Don't reset immediately - let afterClose handle it
    // This allows for exit animations
})

/**
 * Execute delete operation via adapters
 */
export const executeDeleteAtom = atom(null, async (get, set) => {
    const groups = get(deleteModalGroupsAtom)
    const canProceed = get(deleteModalCanProceedAtom)
    const onSuccess = get(deleteModalOnSuccessAtom)

    if (!canProceed) {
        set(deleteModalErrorAtom, new Error("Some entities cannot be deleted"))
        return false
    }

    set(deleteModalLoadingAtom, true)
    set(deleteModalErrorAtom, null)

    try {
        // Delete each entity type via its adapter's reducer
        for (const group of groups) {
            const adapter = getEntityAdapter(group.type)
            if (!adapter) {
                console.warn(`[EntityModals] No adapter for type: ${group.type}`)
                continue
            }

            const ids = group.entities.map((e) => e.id)
            await set(adapter.deleteAtom, ids)
        }

        // Close modal on success
        set(deleteModalOpenAtom, false)

        // Call onSuccess callback before reset (so callback has access to deleted entities if needed)
        if (onSuccess) {
            onSuccess()
        }

        set(resetDeleteModalAtom)
        return true
    } catch (error) {
        set(deleteModalErrorAtom, error as Error)
        set(deleteModalLoadingAtom, false)
        return false
    }
})

// ============================================================================
// CONVENIENCE ATOMS
// ============================================================================

/**
 * Combined delete modal state for components
 */
export const deleteModalStateAtom = atom((get) => ({
    isOpen: get(deleteModalOpenAtom),
    entities: get(deleteModalEntitiesAtom),
    groups: get(deleteModalGroupsAtom),
    names: get(deleteModalNamesAtom),
    warnings: get(deleteModalWarningsAtom),
    blocked: get(deleteModalBlockedAtom),
    canProceed: get(deleteModalCanProceedAtom),
    count: get(deleteModalCountAtom),
    isLoading: get(deleteModalLoadingAtom),
    error: get(deleteModalErrorAtom),
}))
