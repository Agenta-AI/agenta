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

import {entitySelectorOpenAtom, entitySelectorConfigAtom} from "../atoms/entitySelector"

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
}
