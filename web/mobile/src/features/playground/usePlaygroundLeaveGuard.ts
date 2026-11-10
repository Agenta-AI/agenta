import {loadableController} from "@agenta/entities/loadable"
import {isLocalDraftId} from "@agenta/entities/shared"
import {playgroundController} from "@agenta/playground"
import {useLocalDraftWarning} from "@agenta/playground-ui/hooks"
import {atom, useAtomValue} from "jotai"

import {useUnsavedGuard} from "../automations/useUnsavedGuard"
import {useConfirmModal} from "../settings/useConfirmModal"

/**
 * What leaving the page would lose: a local copy of a revision (it has no saved revision to come
 * back to) and the unsaved edits of the connected test set. The edits of a saved revision are not
 * in it: they stay when the page is left, as in the old playground.
 */
const loseOnLeaveAtom = atom((get) => {
    const hasLocalCopy = get(playgroundController.selectors.nodes()).some((node) =>
        isLocalDraftId(node.entityId),
    )
    const loadableId = get(playgroundController.selectors.loadableId())
    const testsetChanged = loadableId
        ? get(loadableController.selectors.hasLocalChanges(loadableId))
        : false
    return hasLocalCopy || testsetChanged
})

/**
 * The browser asks before the page unloads with any unsaved edit, as in the old playground: a
 * reload loses them all. A link inside the app goes straight through when the edits stay (the
 * edits of saved revisions); it asks first only when something would be lost (a local copy, or
 * unsaved test set edits).
 *
 * Returns the dialog to render.
 */
export const usePlaygroundLeaveGuard = () => {
    useLocalDraftWarning()
    const loseOnLeave = useAtomValue(loseOnLeaveAtom)
    const {confirm, modal} = useConfirmModal()
    useUnsavedGuard({
        dirty: loseOnLeave,
        confirm,
        title: "Discard unsaved changes?",
        message:
            "You have local draft revisions or unsaved changes that will be lost if you leave. Are you sure you want to continue?",
    })
    return modal
}
