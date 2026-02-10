/**
 * Save Modal State
 *
 * Jotai atoms for managing save modal state.
 * Uses atomWithReset for clean reset on modal close.
 *
 * The save modal is for saving entities with a new name,
 * or creating new entities (save-as functionality).
 */

import {atom} from "jotai"
import {atomWithReset, RESET} from "jotai/utils"

import {getEntityAdapter} from "../adapters"
import type {EntityReference, EntityType} from "../types"

// ============================================================================
// CORE STATE ATOMS
// ============================================================================

/**
 * Whether the save modal is open
 */
export const saveModalOpenAtom = atomWithReset(false)

/**
 * Entity to be saved (null for new entity)
 */
export const saveModalEntityAtom = atomWithReset<EntityReference | null>(null)

/**
 * Entity type for new entities
 */
export const saveModalEntityTypeAtom = atomWithReset<EntityType | null>(null)

/**
 * Entity name input
 */
export const saveModalNameAtom = atomWithReset("")

/**
 * Whether to save as a new entity (copy)
 */
export const saveModalSaveAsNewAtom = atomWithReset(false)

/**
 * Loading state during save operation
 */
export const saveModalLoadingAtom = atomWithReset(false)

/**
 * Error from save operation
 */
export const saveModalErrorAtom = atomWithReset<Error | null>(null)

// ============================================================================
// DERIVED ATOMS
// ============================================================================

/**
 * Resolved entity type (from entity or default)
 */
export const saveModalResolvedTypeAtom = atom((get): EntityType | null => {
    const entity = get(saveModalEntityAtom)
    if (entity) return entity.type

    return get(saveModalEntityTypeAtom)
})

/**
 * Original entity name (for comparison)
 */
export const saveModalOriginalNameAtom = atom((get): string => {
    const entity = get(saveModalEntityAtom)
    if (!entity) return ""

    // If name is already provided, use it
    if (entity.name) return entity.name

    // Try to resolve via adapter
    const adapter = getEntityAdapter(entity.type)
    if (!adapter) return entity.id

    const entityData = get(adapter.dataAtom(entity.id))
    return adapter.getDisplayName(entityData)
})

/**
 * Whether name has been modified from original
 */
export const saveModalNameModifiedAtom = atom((get): boolean => {
    const entity = get(saveModalEntityAtom)
    if (!entity) return true // New entity, always "modified"

    const name = get(saveModalNameAtom)
    const originalName = get(saveModalOriginalNameAtom)

    return name !== originalName
})

/**
 * Whether save can proceed (has name)
 */
export const saveModalCanProceedAtom = atom((get): boolean => {
    const name = get(saveModalNameAtom)
    const isLoading = get(saveModalLoadingAtom)

    return name.trim().length > 0 && !isLoading
})

/**
 * Modal title based on context
 */
export const saveModalTitleAtom = atom((get): string => {
    const entity = get(saveModalEntityAtom)
    const saveAsNew = get(saveModalSaveAsNewAtom)

    if (!entity) return "Create New"
    if (saveAsNew) return "Save As"
    return "Save"
})

// ============================================================================
// ACTION ATOMS
// ============================================================================

/**
 * Reset all save modal state
 */
export const resetSaveModalAtom = atom(null, (_get, set) => {
    set(saveModalOpenAtom, RESET)
    set(saveModalEntityAtom, RESET)
    set(saveModalEntityTypeAtom, RESET)
    set(saveModalNameAtom, RESET)
    set(saveModalSaveAsNewAtom, RESET)
    set(saveModalLoadingAtom, RESET)
    set(saveModalErrorAtom, RESET)
})

/**
 * Open save modal for an existing entity
 */
export const openSaveModalAtom = atom(
    null,
    (get, set, entity: EntityReference, saveAsNew?: boolean) => {
        // Reset first to clear any previous state
        set(resetSaveModalAtom)
        // Set entity
        set(saveModalEntityAtom, entity)
        // Set save-as-new mode
        set(saveModalSaveAsNewAtom, saveAsNew ?? false)

        // Initialize name from entity
        const adapter = getEntityAdapter(entity.type)
        if (adapter) {
            const entityData = get(adapter.dataAtom(entity.id))
            const name = adapter.getDisplayName(entityData)
            set(saveModalNameAtom, saveAsNew ? `${name} (copy)` : name)
        } else if (entity.name) {
            set(saveModalNameAtom, saveAsNew ? `${entity.name} (copy)` : entity.name)
        }

        // Open modal
        set(saveModalOpenAtom, true)
    },
)

/**
 * Open save modal for a new entity
 */
export const openSaveNewModalAtom = atom(
    null,
    (_get, set, entityType: EntityType, initialName?: string) => {
        // Reset first to clear any previous state
        set(resetSaveModalAtom)
        // Set entity type
        set(saveModalEntityTypeAtom, entityType)
        // Set initial name if provided
        if (initialName) {
            set(saveModalNameAtom, initialName)
        }
        // Open modal
        set(saveModalOpenAtom, true)
    },
)

/**
 * Close save modal without saving
 */
export const closeSaveModalAtom = atom(null, (_get, set) => {
    set(saveModalOpenAtom, false)
    // Note: Don't reset immediately - let afterClose handle it
})

/**
 * Update save name
 */
export const setSaveNameAtom = atom(null, (_get, set, name: string) => {
    set(saveModalNameAtom, name)
})

/**
 * Toggle save-as-new mode
 */
export const toggleSaveAsNewAtom = atom(null, (get, set) => {
    const current = get(saveModalSaveAsNewAtom)
    set(saveModalSaveAsNewAtom, !current)
})

/**
 * Execute save operation via adapter
 *
 * Returns the result from the adapter's saveAtom (e.g., new entity ID)
 */
export const executeSaveAtom = atom(null, async (get, set) => {
    const entity = get(saveModalEntityAtom)
    const entityType = get(saveModalResolvedTypeAtom)
    const name = get(saveModalNameAtom)
    const saveAsNew = get(saveModalSaveAsNewAtom)
    const canProceed = get(saveModalCanProceedAtom)

    if (!canProceed || !entityType) {
        set(saveModalErrorAtom, new Error("Cannot save: missing name or entity type"))
        return {success: false, error: "Missing name or entity type"}
    }

    const adapter = getEntityAdapter(entityType)
    if (!adapter?.saveAtom) {
        set(saveModalErrorAtom, new Error(`No save adapter for type: ${entityType}`))
        return {success: false, error: `No save adapter for type: ${entityType}`}
    }

    set(saveModalLoadingAtom, true)
    set(saveModalErrorAtom, null)

    try {
        // Execute save via adapter
        const newId = await set(adapter.saveAtom, {
            id: entity?.id,
            name: name.trim(),
            saveAsNew,
        })

        // Close modal on success
        set(saveModalOpenAtom, false)
        set(resetSaveModalAtom)

        return {success: true, id: newId, name: name.trim()}
    } catch (error) {
        set(saveModalErrorAtom, error as Error)
        set(saveModalLoadingAtom, false)
        return {success: false, error: (error as Error).message}
    }
})

// ============================================================================
// CONVENIENCE ATOMS
// ============================================================================

/**
 * Combined save modal state for components
 */
export const saveModalStateAtom = atom((get) => ({
    isOpen: get(saveModalOpenAtom),
    entity: get(saveModalEntityAtom),
    entityType: get(saveModalResolvedTypeAtom),
    name: get(saveModalNameAtom),
    originalName: get(saveModalOriginalNameAtom),
    saveAsNew: get(saveModalSaveAsNewAtom),
    nameModified: get(saveModalNameModifiedAtom),
    canProceed: get(saveModalCanProceedAtom),
    title: get(saveModalTitleAtom),
    isLoading: get(saveModalLoadingAtom),
    error: get(saveModalErrorAtom),
}))
