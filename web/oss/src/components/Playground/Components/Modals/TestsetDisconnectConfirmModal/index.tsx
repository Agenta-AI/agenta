import {loadableController} from "@agenta/entities/loadable"
import {playgroundController} from "@agenta/playground"
import {Button} from "@agenta/primitive-ui/components/button"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {EnhancedModal, ModalContent} from "@agenta/ui"
import {message} from "@agenta/ui/app-message"
import {useAtomValue, useSetAtom} from "jotai"

import {initialState, testsetDisconnectConfirmModalAtom} from "./store/state"

const TestsetDisconnectConfirmModal = () => {
    const {open, loadableId, isSaving, intent, meta, onComplete} = useAtomValue(
        testsetDisconnectConfirmModalAtom,
    )
    const setModalState = useSetAtom(testsetDisconnectConfirmModalAtom)
    const disconnectAndReset = useSetAtom(playgroundController.actions.disconnectAndResetToLocal)
    const commitChanges = useSetAtom(loadableController.actions.commitChanges)

    const targetName = meta?.targetTestsetName?.trim() || null
    const isChangeIntent = intent === "change-testset"

    const title = isChangeIntent
        ? targetName
            ? `Load ${targetName} test set?`
            : "Load different test set?"
        : "Save changes?"

    const descriptionLine1 = isChangeIntent
        ? targetName
            ? `You have unsaved changes. Do you want to save them before loading ${targetName} test set?`
            : "You have unsaved changes. Do you want to save them before loading a different test set?"
        : "You have unsaved changes. Do you want to save them before disconnecting the testset?"

    const descriptionLine2 = isChangeIntent
        ? "Loading testcases from a different testset will remove any previously loaded testcases."
        : "Unsaved testcases will convert into local testcases."

    const discardLabel = isChangeIntent ? "Discard & Load" : "Discard & disconnect"
    const saveLabel = isChangeIntent ? "Save & load" : "Save & disconnect"

    const handleCancel = () => {
        if (isSaving) return
        setModalState(initialState)
    }

    const handleDiscardAndDisconnect = () => {
        if (!loadableId || isSaving) return
        disconnectAndReset(loadableId)
        onComplete?.()
        setModalState(initialState)
    }

    const handleSaveAndDisconnect = async () => {
        if (!loadableId || isSaving) return

        setModalState((prev) => ({...prev, isSaving: true}))
        try {
            await commitChanges(loadableId)
            disconnectAndReset(loadableId, {preserveRows: true})
            onComplete?.()
            setModalState(initialState)
            message.success("Testset updated successfully")
        } catch (err) {
            message.error(err instanceof Error ? err.message : String(err))
            setModalState((prev) => ({...prev, isSaving: false}))
        }
    }

    return (
        <EnhancedModal
            open={open}
            onCancel={handleCancel}
            footer={
                <div className="flex items-center justify-end gap-2 pt-2">
                    <Button onClick={handleCancel} disabled={isSaving} variant="ghost">
                        Cancel
                    </Button>
                    <Button
                        onClick={handleDiscardAndDisconnect}
                        disabled={isSaving}
                        variant="destructive"
                    >
                        {discardLabel}
                    </Button>
                    <Button onClick={handleSaveAndDisconnect} disabled={isSaving}>
                        {isSaving ? <Spinner /> : null}
                        {saveLabel}
                    </Button>
                </div>
            }
            title={title}
            width={500}
        >
            <ModalContent gap="small">
                <span>{descriptionLine1}</span>
                <span>{descriptionLine2}</span>
            </ModalContent>
        </EnhancedModal>
    )
}

export default TestsetDisconnectConfirmModal
