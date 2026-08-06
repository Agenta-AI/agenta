/**
 * useEntitySelector Hook
 *
 * Convenience hook for opening the entity selector modal.
 * Provides a simpler API than using the controller atoms directly.
 */

import {useCallback} from "react"

import {useSetAtom, useAtomValue} from "jotai"

import {
    openEntitySelectorAtom,
    closeEntitySelectorAtom,
    forceCloseEntitySelectorAtom,
    entitySelectorOpenAtom,
} from "../../state/modalState"
import type {EntitySelectionResult, EntitySelectorConfig} from "../../types"

// ============================================================================
// TYPES
// ============================================================================

export interface UseEntitySelectorResult {
    /**
     * Open the entity selector modal
     * Returns a promise that resolves with the selection or null if cancelled
     */
    open: (config: EntitySelectorConfig) => Promise<EntitySelectionResult | null>

    /**
     * Close the modal (cancel)
     */
    close: () => void

    /**
     * Force close without resolving (for cleanup)
     */
    forceClose: () => void

    /**
     * Whether the modal is currently open
     */
    isOpen: boolean
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for opening the entity selector modal
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { open, isOpen } = useEntitySelector()
 *
 *   const handleAdd = async () => {
 *     const selection = await open({
 *       title: 'Add to Playground',
 *       allowedTypes: ['appRevision', 'evaluatorRevision'],
 *       adapters: [appRevisionAdapter, evaluatorRevisionAdapter],
 *     })
 *
 *     if (selection) {
 *       console.log('Selected:', selection.type, selection.id)
 *     }
 *   }
 *
 *   return <Button onClick={handleAdd}>Add Entity</Button>
 * }
 * ```
 */
export function useEntitySelector(): UseEntitySelectorResult {
    const openSelector = useSetAtom(openEntitySelectorAtom)
    const closeSelector = useSetAtom(closeEntitySelectorAtom)
    const forceCloseSelector = useSetAtom(forceCloseEntitySelectorAtom)
    const isOpen = useAtomValue(entitySelectorOpenAtom)

    const open = useCallback(
        (config: EntitySelectorConfig): Promise<EntitySelectionResult | null> => {
            return openSelector(config)
        },
        [openSelector],
    )

    const close = useCallback(() => {
        closeSelector()
    }, [closeSelector])

    const forceClose = useCallback(() => {
        forceCloseSelector()
    }, [forceCloseSelector])

    return {
        open,
        close,
        forceClose,
        isOpen,
    }
}
