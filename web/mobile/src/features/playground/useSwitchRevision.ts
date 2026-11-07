import {useCallback} from "react"

import {playgroundController} from "@agenta/playground"
import {useStore} from "jotai"

/**
 * Shows another revision in place of one on screen. It switches at once, as in the old
 * playground: unsaved edits of the revision it leaves stay, and show again as a draft when that
 * revision is opened again.
 */
export const useSwitchRevision = () => {
    const store = useStore()

    return useCallback(
        (currentRevisionId: string, newRevisionId: string) => {
            if (newRevisionId === currentRevisionId) return
            store.set(playgroundController.actions.switchEntity, {
                currentEntityId: currentRevisionId,
                newEntityId: newRevisionId,
            })
        },
        [store],
    )
}
