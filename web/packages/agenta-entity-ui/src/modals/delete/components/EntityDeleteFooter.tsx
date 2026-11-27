/**
 * EntityDeleteFooter Component
 *
 * Modal footer with cancel and delete buttons.
 */

import {useCallback} from "react"

import {createT, useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import deleteModalCatalog from "@agenta/i18n/catalogs/entityUi.deleteModal"
import {message} from "@agenta/ui/app-message"
import {Button, LoadingButton} from "@agenta/ui/ui"
import {useAtomValue, useSetAtom} from "jotai"

import {deleteModalLoadingAtom, deleteModalCanProceedAtom, executeDeleteAtom} from "../state"

const tNow = createT(deleteModalCatalog)

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
    const t = useT(deleteModalCatalog)
    const tCommon = useT(commonCatalog)
    const isLoading = useAtomValue(deleteModalLoadingAtom)
    const canProceed = useAtomValue(deleteModalCanProceedAtom)
    const executeDelete = useSetAtom(executeDeleteAtom)

    const handleDelete = useCallback(async () => {
        const success = await executeDelete()
        if (success) {
            message.success(tNow("entityUi.deleteModal.deleted"))
            onSuccess?.()
        }
    }, [executeDelete, onSuccess])

    return (
        <div className="flex w-full items-center justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={isLoading}>
                {tCommon("common.cancel")}
            </Button>
            <LoadingButton
                variant="destructive"
                loading={isLoading}
                disabled={!canProceed}
                onClick={handleDelete}
            >
                {t("entityUi.deleteModal.delete")}
            </LoadingButton>
        </div>
    )
}
