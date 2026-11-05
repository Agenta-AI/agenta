import {loadableController} from "@agenta/entities/loadable"
import {playgroundController} from "@agenta/playground"
import {useLocalDraftWarning} from "@agenta/playground-ui/hooks"
import {atom, useAtomValue} from "jotai"

import {useUnsavedGuard} from "../automations/useUnsavedGuard"
import {useConfirmModal} from "../settings/useConfirmModal"

/** Unsaved edits of the connected test set. */
const testsetHasLocalChangesAtom = atom((get) => {
    const loadableId = get(playgroundController.selectors.loadableId())
    return loadableId ? get(loadableController.selectors.hasLocalChanges(loadableId)) : false
})

/**
 * Asks before the playground is left with a local draft, unsaved edits or unsaved test set edits: the browser's own
 * question when the page unloads, the app's dialog for a link inside the app.
 *
 * Returns the dialog to render.
 */
export const usePlaygroundLeaveGuard = () => {
    const hasUnsavedOrLocalDrafts = useLocalDraftWarning()
    const hasTestsetChanges = useAtomValue(testsetHasLocalChangesAtom)
    const {confirm, modal} = useConfirmModal()
    useUnsavedGuard({
        dirty: hasUnsavedOrLocalDrafts || hasTestsetChanges,
        confirm,
        title: "Discard unsaved changes?",
        message:
            "You have local draft revisions or unsaved changes that will be lost if you leave. Are you sure you want to continue?",
    })
    return modal
}
