import {playgroundController} from "@agenta/playground"
import {EnhancedModal, ModalContent} from "@agenta/ui"
import {Button, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {initialKeepDraftRowsState, keepDraftRowsModalAtom} from "./store/state"

/**
 * Shown when connecting a test set would clear local draft rows (created
 * manually or by opening a trace in the playground). Lets the user keep the
 * drafts as unsaved additions to the loaded test set, or discard them.
 *
 * In chat mode only one testcase can load at a time, so the modal degrades
 * to a warning that loading replaces the drafted conversation.
 */
const KeepDraftRowsModal = () => {
    const {open, variant, draftCount, targetTestsetName, pendingPayload} =
        useAtomValue(keepDraftRowsModalAtom)
    const setModalState = useSetAtom(keepDraftRowsModalAtom)
    const connectToTestset = useSetAtom(playgroundController.actions.connectToTestset)
    const connectKeepingDrafts = useSetAtom(
        playgroundController.actions.connectToTestsetKeepingLocalRows,
    )

    const testsetLabel = targetTestsetName?.trim() || "the test set"
    const isChatVariant = variant === "chat-replace"

    const title = isChatVariant
        ? "Replace the current conversation?"
        : "Keep your draft test cases?"

    const descriptionLine1 = isChatVariant
        ? `Loading ${testsetLabel} replaces the conversation in the playground.`
        : draftCount === 1
          ? "You have 1 draft test case in the playground."
          : `You have ${draftCount} draft test cases in the playground.`

    const descriptionLine2 = isChatVariant
        ? "The chat playground loads one test case at a time, so the conversation cannot be kept."
        : `You can keep ${draftCount === 1 ? "it" : "them"} and load ${testsetLabel} alongside. Kept test cases stay unsaved until you sync changes back to the test set.`

    const handleClose = () => {
        setModalState(initialKeepDraftRowsState)
    }

    const handleDiscardAndLoad = () => {
        if (pendingPayload) connectToTestset(pendingPayload)
        handleClose()
    }

    const handleKeepAndLoad = () => {
        if (pendingPayload) connectKeepingDrafts(pendingPayload)
        handleClose()
    }

    return (
        <EnhancedModal
            open={open}
            onCancel={handleClose}
            footer={
                <div className="flex items-center justify-end gap-2 pt-2">
                    <Button type="text" onClick={handleClose}>
                        Cancel
                    </Button>
                    {isChatVariant ? (
                        <Button type="primary" danger onClick={handleDiscardAndLoad}>
                            Load and replace
                        </Button>
                    ) : (
                        <>
                            <Button danger onClick={handleDiscardAndLoad}>
                                Discard drafts
                            </Button>
                            <Button type="primary" onClick={handleKeepAndLoad}>
                                Keep and load
                            </Button>
                        </>
                    )}
                </div>
            }
            title={title}
            width={500}
        >
            <ModalContent gap="small">
                <Typography.Text>{descriptionLine1}</Typography.Text>
                <Typography.Text>{descriptionLine2}</Typography.Text>
            </ModalContent>
        </EnhancedModal>
    )
}

export default KeepDraftRowsModal
