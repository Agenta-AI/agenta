import {useLocalDraftWarning} from "@agenta/playground-ui/hooks"

import {useUnsavedGuard} from "../automations/useUnsavedGuard"
import {useConfirmModal} from "../settings/useConfirmModal"

/**
 * Asks before the playground is left with a local draft or unsaved edits: the browser's own
 * question when the page unloads, the app's dialog for a link inside the app.
 *
 * Returns the dialog to render.
 */
export const usePlaygroundLeaveGuard = () => {
    const hasUnsavedOrLocalDrafts = useLocalDraftWarning()
    const {confirm, modal} = useConfirmModal()
    useUnsavedGuard({
        dirty: hasUnsavedOrLocalDrafts,
        confirm,
        title: "Discard unsaved changes?",
        message:
            "You have local draft revisions or unsaved changes that will be lost if you leave. Are you sure you want to continue?",
    })
    return modal
}
