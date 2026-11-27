/**
 * EntitySaveFooter Component
 *
 * Modal footer with cancel and save buttons.
 */

import {useCallback} from "react"

import {createT, useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import saveModalCatalog from "@agenta/i18n/catalogs/entityUi.saveModal"
import {message} from "@agenta/ui/app-message"
import {Button, LoadingButton} from "@agenta/ui/ui"
import {useAtomValue, useSetAtom} from "jotai"

import {saveModalLoadingAtom, saveModalCanProceedAtom, executeSaveAtom} from "../state"

const tNow = createT(saveModalCatalog)

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
    const t = useT(saveModalCatalog)
    const tCommon = useT(commonCatalog)
    const isLoading = useAtomValue(saveModalLoadingAtom)
    const canProceed = useAtomValue(saveModalCanProceedAtom)
    const executeSave = useSetAtom(executeSaveAtom)

    const handleSave = useCallback(async () => {
        const result = await executeSave()
        if (result.success && result.id) {
            message.success(tNow("entityUi.saveModal.saved"))
            onSuccess?.({id: result.id, name: result.name!})
        }
    }, [executeSave, onSuccess])

    return (
        <div className="flex w-full items-center justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={isLoading}>
                {tCommon("common.cancel")}
            </Button>
            <LoadingButton loading={isLoading} disabled={!canProceed} onClick={handleSave}>
                {t("entityUi.saveModal.save")}
            </LoadingButton>
        </div>
    )
}
