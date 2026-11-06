import {useEffect, useRef} from "react"

import {playgroundController, playgroundInitializedAtom} from "@agenta/playground"
import {useStore} from "jotai"

import {clearPlayground} from "../../state/clearPlayground"

/** The clear a closing drawer scheduled. A remount right after (React strict mode) cancels it. */
let pendingClear: ReturnType<typeof setTimeout> | null = null

/**
 * Puts the drawer's revision in the playground state, so the test pane can run it, and clears that
 * state when the drawer closes. A new id (previous, next, or the revision a commit made) takes the
 * place of the one shown, so the test cases stay.
 *
 * The drawer owns the playground state while it is open: mount it only on a page that has no
 * playground of its own.
 */
export const useDrawerPlaygroundSession = (revisionId: string) => {
    const store = useStore()
    const shownRef = useRef<string | null>(null)

    useEffect(() => {
        const ids = store.get(playgroundController.selectors.entityIds())
        const previous = shownRef.current
        shownRef.current = revisionId
        // A commit as a new variant already swapped the id in.
        if (ids.includes(revisionId)) return
        if (previous && ids.includes(previous)) {
            store.set(playgroundController.actions.switchEntity, {
                currentEntityId: previous,
                newEntityId: revisionId,
            })
            return
        }
        store.set(playgroundController.actions.addPrimaryNode, {
            type: "workflow",
            id: revisionId,
            label: revisionId,
        })
        store.set(playgroundInitializedAtom, true)
    }, [revisionId, store])

    // The clear waits one task: strict mode unmounts and mounts again at once. It is skipped when
    // something set the playground up meanwhile (Open in playground mounts the playground page).
    useEffect(() => {
        if (pendingClear) clearTimeout(pendingClear)
        pendingClear = null
        return () => {
            const nodesAtClose = store.get(playgroundController.selectors.nodes())
            pendingClear = setTimeout(() => {
                pendingClear = null
                if (store.get(playgroundController.selectors.nodes()) !== nodesAtClose) return
                clearPlayground(store)
            }, 0)
        }
    }, [store])
}
