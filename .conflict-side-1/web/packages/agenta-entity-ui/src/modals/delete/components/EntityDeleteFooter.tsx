/**
 * EntityDeleteFooter Component
 *
 * Modal footer with cancel and delete buttons.
 */

import {useCallback} from "react"

import {message} from "@agenta/ui/app-message"
import {ModalFooter} from "@agenta/ui/components/modal"
import {useAtomValue, useSetAtom} from "jotai"

import {deleteModalLoadingAtom, deleteModalCanProceedAtom, executeDeleteAtom} from "../state"

interface EntityDeleteFooterProps {
    /** Callback when modal is closed/cancelled */
    onClose: () => void
    /** Callback when delete succeeds */
    onSuccess?: () => void
}

/**
 * EntityDeleteFooter
 *
 * Footer with:
 * - Cancel button
 * - Delete button (disabled if entities can't be deleted)
 * - Loading state during delete
 */
export function EntityDeleteFooter({onClose, onSuccess}: EntityDeleteFooterProps) {
    const isLoading = useAtomValue(deleteModalLoadingAtom)
    const canProceed = useAtomValue(deleteModalCanProceedAtom)
    const executeDelete = useSetAtom(executeDeleteAtom)

    const handleDelete = useCallback(async () => {
        const success = await executeDelete()
        if (success) {
            message.success("Deleted successfully")
            onSuccess?.()
        }
    }, [executeDelete, onSuccess])

    return (
        <ModalFooter
            onCancel={onClose}
            onConfirm={handleDelete}
            confirmLabel="Delete"
            isLoading={isLoading}
            canConfirm={canProceed}
            danger
        />
    )
}
