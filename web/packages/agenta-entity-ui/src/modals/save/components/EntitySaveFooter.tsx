/**
 * EntitySaveFooter Component
 *
 * Modal footer with cancel and save buttons.
 */

import {useCallback} from "react"

import {message} from "@agenta/ui/app-message"
import {ModalFooter} from "@agenta/ui/components/modal"
import {useAtomValue, useSetAtom} from "jotai"

import {saveModalLoadingAtom, saveModalCanProceedAtom, executeSaveAtom} from "../state"

interface EntitySaveFooterProps {
    /** Callback when modal is closed/cancelled */
    onClose: () => void
    /** Callback when save succeeds */
    onSuccess?: (result: {id: string; name: string}) => void
}

/**
 * EntitySaveFooter
 *
 * Footer with:
 * - Cancel button
 * - Save button (disabled if no name)
 * - Loading state during save
 */
export function EntitySaveFooter({onClose, onSuccess}: EntitySaveFooterProps) {
    const isLoading = useAtomValue(saveModalLoadingAtom)
    const canProceed = useAtomValue(saveModalCanProceedAtom)
    const executeSave = useSetAtom(executeSaveAtom)

    const handleSave = useCallback(async () => {
        const result = await executeSave()
        if (result.success && result.id) {
            message.success("Saved successfully")
            onSuccess?.({id: result.id, name: result.name!})
        }
    }, [executeSave, onSuccess])

    return (
        <ModalFooter
            onCancel={onClose}
            onConfirm={handleSave}
            confirmLabel="Save"
            isLoading={isLoading}
            canConfirm={canProceed}
        />
    )
}
