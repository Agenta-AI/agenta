/**
 * EntityDeleteModal Component
 *
 * Performance-optimized delete modal that uses lazy rendering.
 * Uses EnhancedModal for consistent styling and auto-contained height.
 */

import {useCallback, useEffect} from "react"

import {EnhancedModal} from "@agenta/ui"
import {useAtomValue, useSetAtom} from "jotai"

import type {EntityDeleteModalProps, EntityReference} from "../../types"
import {deleteModalOpenAtom, deleteModalEntitiesAtom, resetDeleteModalAtom} from "../state"

import {EntityDeleteContent} from "./EntityDeleteContent"
import {EntityDeleteFooter} from "./EntityDeleteFooter"
import {EntityDeleteTitle} from "./EntityDeleteTitle"

/**
 * EntityDeleteModal
 *
 * A modal for deleting entities with:
 * - Lazy rendering (content mounts only when modal opens)
 * - Multi-entity support with grouping by type
 * - Adapter-based entity resolution
 * - Warning display for entities with delete restrictions
 *
 * @example
 * ```tsx
 * // Using with atoms (recommended)
 * import {useEntityDelete, EntityDeleteModal} from '@agenta/entities/ui'
 *
 * function MyComponent() {
 *   const {deleteEntity} = useEntityDelete()
 *
 *   return (
 *     <>
 *       <Button onClick={() => deleteEntity('testset', testsetId)}>
 *         Delete
 *       </Button>
 *       <EntityDeleteModal />
 *     </>
 *   )
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Using with external control
 * const [open, setOpen] = useState(false)
 * const [entities, setEntities] = useState<EntityReference[]>([])
 *
 * <EntityDeleteModal
 *   open={open}
 *   onClose={() => setOpen(false)}
 *   entities={entities}
 * />
 * ```
 */
export function EntityDeleteModal({
    open: externalOpen,
    onClose,
    entities: externalEntities,
    onSuccess,
}: EntityDeleteModalProps) {
    // ========== STATE ==========
    const atomOpen = useAtomValue(deleteModalOpenAtom)
    const setEntities = useSetAtom(deleteModalEntitiesAtom)
    const resetModal = useSetAtom(resetDeleteModalAtom)

    // Use external control if provided, otherwise use atoms
    const isOpen = externalOpen ?? atomOpen

    // ========== EFFECTS ==========

    // Sync external entities to atoms
    useEffect(() => {
        if (externalEntities && externalEntities.length > 0) {
            setEntities(externalEntities)
        }
    }, [externalEntities, setEntities])

    // ========== HANDLERS ==========

    const handleClose = useCallback(() => {
        onClose?.()
        if (!externalOpen) {
            // Using internal atoms, reset state
            resetModal()
        }
    }, [onClose, externalOpen, resetModal])

    const handleAfterClose = useCallback(() => {
        // EnhancedModal handles lazy render reset
    }, [])

    const handleSuccess = useCallback(() => {
        onSuccess?.()
        handleClose()
    }, [onSuccess, handleClose])

    // ========== RENDER ==========

    return (
        <EnhancedModal
            open={isOpen}
            onCancel={handleClose}
            afterClose={handleAfterClose}
            title={<EntityDeleteTitle />}
            footer={<EntityDeleteFooter onClose={handleClose} onSuccess={handleSuccess} />}
            styles={{
                body: {
                    paddingTop: 16,
                },
            }}
        >
            <EntityDeleteContent />
        </EnhancedModal>
    )
}

// ============================================================================
// IMPERATIVE API
// ============================================================================

/**
 * Props for the imperative delete function
 */
export interface DeleteEntitiesOptions {
    /** Callback after successful delete */
    onSuccess?: () => void
    /** Callback if delete fails */
    onError?: (error: Error) => void
}

/**
 * Create an imperative delete handler
 *
 * This is useful when you need to trigger deletion from outside React
 * or from a callback that doesn't have access to hooks.
 *
 * @param setOpenDeleteModal - Setter from useSetAtom(openDeleteModalAtom)
 * @param options - Optional callbacks
 * @returns A function to delete entities
 *
 * @example
 * ```tsx
 * const openDeleteModal = useSetAtom(openDeleteModalAtom)
 *
 * const handleContextMenuDelete = (entities: EntityReference[]) => {
 *   openDeleteModal(entities)
 * }
 * ```
 */
export function createDeleteHandler(
    setOpenDeleteModal: (entities: EntityReference[]) => void,
    _options?: DeleteEntitiesOptions,
): (entities: EntityReference[]) => void {
    return (entities: EntityReference[]) => {
        setOpenDeleteModal(entities)
    }
}
