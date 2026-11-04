import {useCallback} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {playgroundController} from "@agenta/playground"
import {useStore} from "jotai"

import {useConfirmModal} from "../settings/useConfirmModal"

/**
 * Shows another revision in place of one on screen. A revision with unsaved edits asks first:
 * the edits go when it leaves the screen, and nothing else would bring them back.
 *
 * Returns the switch and the dialog to render.
 */
export const useSwitchRevision = () => {
    const store = useStore()
    const {confirm, modal} = useConfirmModal()

    const switchTo = useCallback(
        (currentRevisionId: string, newRevisionId: string) => {
            if (newRevisionId === currentRevisionId) return
            const show = () =>
                store.set(playgroundController.actions.switchEntity, {
                    currentEntityId: currentRevisionId,
                    newEntityId: newRevisionId,
                })
            if (!store.get(workflowMolecule.selectors.isDirty(currentRevisionId))) {
                show()
                return
            }
            confirm({
                title: "Discard unsaved changes?",
                message:
                    "You have local draft revisions or unsaved changes that will be lost if you leave. Are you sure you want to continue?",
                okText: "Discard",
                danger: true,
                onOk: () => {
                    store.set(workflowMolecule.actions.discard, currentRevisionId)
                    show()
                },
            })
        },
        [confirm, store],
    )

    return {switchTo, modal}
}
