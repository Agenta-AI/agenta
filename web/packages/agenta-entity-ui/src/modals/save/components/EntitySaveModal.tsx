/**
 * EntitySaveModal Component
 *
 * Performance-optimized modal shell for saving entities.
 * Uses EnhancedModal for lazy rendering and consistent styling.
 */

import {useEffect, useCallback} from "react"

import {EnhancedModal} from "@agenta/ui/components/modal"
import {useAtomValue, useSetAtom} from "jotai"

import type {EntityReference, EntityType} from "../../types"
import {
    saveModalOpenAtom,
    resetSaveModalAtom,
    openSaveModalAtom,
    openSaveNewModalAtom,
    closeSaveModalAtom,
} from "../state"

import {EntitySaveContent} from "./EntitySaveContent"
import {EntitySaveFooter} from "./EntitySaveFooter"
import {EntitySaveTitle} from "./EntitySaveTitle"

export interface EntitySaveModalProps {
    /** External control - override atom state */
    open?: boolean
    /** Callback when modal closes */
    onClose?: () => void
    /** Entity to save (omit for new entity) */
    entity?: EntityReference
    /** Whether to open in save-as-new mode */
    saveAsNew?: boolean
    /** Entity type for new entities */
    defaultEntityType?: EntityType
    /** Initial name for new entities */
    initialName?: string
    /** Callback after successful save */
    onSuccess?: (result: {id: string; name: string}) => void
}

/**
 * EntitySaveModal
 *
 * A performance-optimized modal for saving entities.
 *
 * Features:
 * - Lazy rendering: content only mounts when modal opens
 * - Atom-based state: no prop drilling
 * - Adapter pattern: works with any registered entity type
 * - Save-as-new: create copies of existing entities
 *
 * Usage:
 * ```tsx
 * // Method 1: Using atoms for existing entity
 * const openModal = useSetAtom(openSaveModalAtom)
 * openModal({type: 'testset', id: testsetId}, true) // true = save as new
 *
 * // Method 2: Using atoms for new entity
 * const openNewModal = useSetAtom(openSaveNewModalAtom)
 * openNewModal('testset', 'My New Testset')
 *
 * // Render modal anywhere in tree
 * <EntitySaveModal />
 *
 * // Method 3: External control
 * <EntitySaveModal
 *   open={isOpen}
 *   entity={{type: 'testset', id: testsetId}}
 *   saveAsNew={true}
 *   onClose={() => setIsOpen(false)}
 *   onSuccess={(result) => console.log('Saved:', result.id)}
 * />
 * ```
 */
export function EntitySaveModal({
    open: externalOpen,
    onClose,
    entity: externalEntity,
    saveAsNew,
    defaultEntityType,
    initialName,
    onSuccess,
}: EntitySaveModalProps) {
    const internalOpen = useAtomValue(saveModalOpenAtom)
    const resetModal = useSetAtom(resetSaveModalAtom)
    const openModal = useSetAtom(openSaveModalAtom)
    const openNewModal = useSetAtom(openSaveNewModalAtom)
    const closeModal = useSetAtom(closeSaveModalAtom)

    // Determine actual open state
    const isOpen = externalOpen ?? internalOpen

    // Initialize with external props if provided
    useEffect(() => {
        if (externalOpen) {
            if (externalEntity) {
                openModal(externalEntity, saveAsNew)
            } else if (defaultEntityType) {
                openNewModal(defaultEntityType, initialName)
            }
        }
    }, [
        externalOpen,
        externalEntity,
        saveAsNew,
        defaultEntityType,
        initialName,
        openModal,
        openNewModal,
    ])

    const handleClose = useCallback(() => {
        closeModal()
        onClose?.()
    }, [closeModal, onClose])

    const handleAfterClose = useCallback(() => {
        resetModal()
    }, [resetModal])

    const handleSuccess = useCallback(
        (result: {id: string; name: string}) => {
            onSuccess?.(result)
        },
        [onSuccess],
    )

    return (
        <EnhancedModal
            open={isOpen}
            onCancel={handleClose}
            afterClose={handleAfterClose}
            title={<EntitySaveTitle />}
            footer={<EntitySaveFooter onClose={handleClose} onSuccess={handleSuccess} />}
        >
            <EntitySaveContent />
        </EnhancedModal>
    )
}
