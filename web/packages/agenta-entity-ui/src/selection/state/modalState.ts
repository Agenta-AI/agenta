/**
 * Modal State for Entity Selector
 *
 * Jotai atoms for managing entity selector modal state.
 * Provides a promise-based API for opening the modal and getting selections.
 */

import {atom} from "jotai"
import {atomWithReset, RESET} from "jotai/utils"

import type {
    EntitySelectionResult,
    EntitySelectorConfig,
    EntitySelectorResolver,
    SelectableEntityType,
} from "../types"

// ============================================================================
// CORE STATE
// ============================================================================

/**
 * Whether the entity selector modal is open
 */
export const entitySelectorOpenAtom = atomWithReset(false)

/**
 * Current selector configuration
 */
export const entitySelectorConfigAtom = atomWithReset<EntitySelectorConfig | null>(null)

/**
 * Promise resolver for the current selection
 */
export const entitySelectorResolverAtom = atomWithReset<EntitySelectorResolver | null>(null)

/**
 * Currently selected entity type tab
 */
export const entitySelectorActiveTypeAtom = atomWithReset<SelectableEntityType | null>(null)

// ============================================================================
// DERIVED STATE
// ============================================================================

/**
 * Allowed entity types from config
 */
export const entitySelectorAllowedTypesAtom = atom((get) => {
    const config = get(entitySelectorConfigAtom)
    return config?.allowedTypes ?? []
})

/**
 * Modal title from config
 */
export const entitySelectorTitleAtom = atom((get) => {
    const config = get(entitySelectorConfigAtom)
    return config?.title ?? "Select Entity"
})

/**
 * Configured adapters
 */
export const entitySelectorAdaptersAtom = atom((get) => {
    const config = get(entitySelectorConfigAtom)
    return config?.adapters ?? []
})

// ============================================================================
// ACTION ATOMS
// ============================================================================

/**
 * Reset all modal state
 */
export const resetEntitySelectorAtom = atom(null, (_get, set) => {
    set(entitySelectorOpenAtom, RESET)
    set(entitySelectorConfigAtom, RESET)
    set(entitySelectorResolverAtom, RESET)
    set(entitySelectorActiveTypeAtom, RESET)
})

/**
 * Open the entity selector modal
 *
 * Returns a promise that resolves with the selection or null if cancelled.
 *
 * @example
 * ```typescript
 * const openSelector = useSetAtom(openEntitySelectorAtom)
 *
 * const selection = await openSelector({
 *   allowedTypes: ['appRevision', 'evaluatorRevision'],
 *   title: 'Add to Playground'
 * })
 *
 * if (selection) {
 *   console.log('Selected:', selection)
 * }
 * ```
 */
export const openEntitySelectorAtom = atom(
    null,
    async (_get, set, config: EntitySelectorConfig): Promise<EntitySelectionResult | null> => {
        // Reset previous state
        set(resetEntitySelectorAtom)

        // Set config
        set(entitySelectorConfigAtom, config)

        // Set initial active type if only one type is allowed
        if (config.allowedTypes && config.allowedTypes.length === 1) {
            set(entitySelectorActiveTypeAtom, config.allowedTypes[0])
        }

        // Create promise for selection
        return new Promise<EntitySelectionResult | null>((resolve) => {
            set(entitySelectorResolverAtom, resolve as EntitySelectorResolver)
            set(entitySelectorOpenAtom, true)
        })
    },
)

/**
 * Close the modal with a selection
 */
export const closeEntitySelectorWithSelectionAtom = atom(
    null,
    (get, set, selection: EntitySelectionResult) => {
        const resolver = get(entitySelectorResolverAtom)
        if (resolver) {
            resolver(selection)
        }
        set(resetEntitySelectorAtom)
    },
)

/**
 * Close the modal without selection (cancel)
 */
export const closeEntitySelectorAtom = atom(null, (get, set) => {
    const resolver = get(entitySelectorResolverAtom)
    if (resolver) {
        resolver(null)
    }
    set(resetEntitySelectorAtom)
})

/**
 * Force close without resolving (for cleanup)
 */
export const forceCloseEntitySelectorAtom = atom(null, (_get, set) => {
    set(resetEntitySelectorAtom)
})

/**
 * Set active entity type tab
 */
export const setEntitySelectorActiveTypeAtom = atom(
    null,
    (_get, set, type: SelectableEntityType) => {
        set(entitySelectorActiveTypeAtom, type)
    },
)

// ============================================================================
// CONTROLLER EXPORT
// ============================================================================

/**
 * Entity selector controller for modal state management
 *
 * @example
 * ```typescript
 * // Check if modal is open
 * const isOpen = useAtomValue(entitySelectorController.selectors.isOpen())
 *
 * // Open the modal
 * const open = useSetAtom(entitySelectorController.actions.open)
 * const selection = await open({ allowedTypes: ['appRevision'] })
 *
 * // Close with selection
 * const close = useSetAtom(entitySelectorController.actions.close)
 * close(selection)
 * ```
 */
export const entitySelectorController = {
    selectors: {
        isOpen: () => entitySelectorOpenAtom,
        config: () => entitySelectorConfigAtom,
        allowedTypes: () => entitySelectorAllowedTypesAtom,
        title: () => entitySelectorTitleAtom,
        activeType: () => entitySelectorActiveTypeAtom,
        adapters: () => entitySelectorAdaptersAtom,
    },
    actions: {
        open: openEntitySelectorAtom,
        close: closeEntitySelectorAtom,
        closeWithSelection: closeEntitySelectorWithSelectionAtom,
        forceClose: forceCloseEntitySelectorAtom,
        setActiveType: setEntitySelectorActiveTypeAtom,
        reset: resetEntitySelectorAtom,
    },
}
