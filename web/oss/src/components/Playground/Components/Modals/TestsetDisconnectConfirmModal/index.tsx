import {loadableController} from "@agenta/entities/loadable"
import {playgroundController} from "@agenta/playground"
import {message} from "@agenta/ui/app-message"
import {Button, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import {initialState, testsetDisconnectConfirmModalAtom} from "./store/state"

const TestsetDisconnectConfirmModal = () => {
    const {open, loadableId, isSaving} = useAtomValue(testsetDisconnectConfirmModalAtom)
    const setModalState = useSetAtom(testsetDisconnectConfirmModalAtom)
    const disconnectAndReset = useSetAtom(playgroundController.actions.disconnectAndResetToLocal)
    const commitChanges = useSetAtom(loadableController.actions.commitChanges)

    const handleCancel = () => {
        if (isSaving) return
        setModalState(initialState)
    }

    const handleDiscardAndDisconnect = () => {
        if (!loadableId || isSaving) return
        disconnectAndReset(loadableId)
        setModalState(initialState)
    }

    const handleSaveAndDisconnect = async () => {
        if (!loadableId || isSaving) return

        setModalState((prev) => ({...prev, isSaving: true}))
        try {
            await commitChanges(loadableId)
            disconnectAndReset(loadableId)
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
                    <Button type="text" onClick={handleCancel} disabled={isSaving}>
                        Cancel
                    </Button>
                    <Button danger onClick={handleDiscardAndDisconnect} disabled={isSaving}>
                        Discard &amp; disconnect
                    </Button>
                    <Button type="primary" onClick={handleSaveAndDisconnect} loading={isSaving}>
                        Save &amp; disconnect
                    </Button>
                </div>
            }
            title={"Save changes?"}
            width={500}
        >
            <div className="flex flex-col gap-1">
                <Typography.Text>
                    You have unsaved changes. Do you want to save them before disconnecting the
                    testset?
                </Typography.Text>
                <Typography.Text>
                    Unsaved testcases will convert into local testcases.
                </Typography.Text>
            </div>
        </EnhancedModal>
    )
}

export default TestsetDisconnectConfirmModal
