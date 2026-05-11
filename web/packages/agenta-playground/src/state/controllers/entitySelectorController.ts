/**
 * Entity Selector Controller
 *
 * Manages the entity selector modal state.
 *
 * ## Usage
 *
 * The modal state is managed through the EntitySelectorProvider in React.
 * Use the `useEntitySelector` hook to open the modal programmatically:
 *
 * ```typescript
 * import { useEntitySelector } from '@agenta/playground'
 *
 * const { open } = useEntitySelector()
 *
 * const handleAdd = async () => {
 *   const selection = await open({
 *     title: 'Add to Playground',
 *     allowedTypes: ['appRevision', 'evaluator'],
 *   })
 *   if (selection) {
 *     // Use selection.type, selection.id, selection.metadata
 *   }
 * }
 * ```
 *
 * Note: The Promise-based API is implemented in EntitySelectorProvider,
 * not in Jotai atoms, because Jotai's useSetAtom doesn't properly forward
 * Promise return values from write functions.
 */

import {atom} from "jotai"

import {entitySelectorOpenAtom, entitySelectorConfigAtom} from "../atoms/entitySelector"
import type {EntitySelectorConfig} from "../types"

const setEntitySelectorOpenAtom = atom(null, (_get, set, isOpen: boolean) => {
    set(entitySelectorOpenAtom, isOpen)
})

const setEntitySelectorConfigAtom = atom(null, (_get, set, config: EntitySelectorConfig) => {
    set(entitySelectorConfigAtom, config)
})

// ============================================================================
// CONTROLLER EXPORT
// ============================================================================

export const entitySelectorController = {
    /**
     * Selectors - functions that return atoms
     * These can be used with useAtomValue to read state,
     * or useSetAtom to write state directly.
     */
    selectors: {
        /** Is the modal open */
        isOpen: () => entitySelectorOpenAtom,

        /** Current modal configuration */
        config: () => entitySelectorConfigAtom,
    },

    actions: {
        setOpen: setEntitySelectorOpenAtom,
        setConfig: setEntitySelectorConfigAtom,
    },
}
