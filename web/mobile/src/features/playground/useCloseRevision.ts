import {useCallback} from "react"

import {isLocalDraftId} from "@agenta/entities/shared"
import {discardLocalServerDataAtom, workflowMolecule} from "@agenta/entities/workflow"
import {playgroundController} from "@agenta/playground"
import {useStore} from "jotai"

import {useConfirmModal} from "../settings/useConfirmModal"

/**
 * Takes one revision off the compare view. With unsaved edits it asks first. Its edits go with
 * it, so they do not come back when the revision is opened again; a local draft goes entirely.
 *
 * Returns the close and the dialog to render.
 */
export const useCloseRevision = () => {
    const store = useStore()
    const {confirm, modal} = useConfirmModal()

    const close = useCallback(
        (revisionId: string) => {
            const isLocalDraft = isLocalDraftId(revisionId)
            const remove = () => {
                store.set(playgroundController.actions.removeEntity, revisionId)
                if (isLocalDraft) store.set(discardLocalServerDataAtom, revisionId)
                else store.set(workflowMolecule.actions.discard, revisionId)
            }
            if (!store.get(workflowMolecule.selectors.isDirty(revisionId))) {
                remove()
                return
            }
            confirm({
                title: "Discard unsaved changes?",
                message: isLocalDraft
                    ? "This draft has uncommitted changes. Closing it will discard all changes."
                    : "You have unsaved changes in this variant. Closing it will discard these changes.",
                okText: "Discard",
                danger: true,
                onOk: remove,
            })
        },
        [confirm, store],
    )

    return {close, modal}
}
