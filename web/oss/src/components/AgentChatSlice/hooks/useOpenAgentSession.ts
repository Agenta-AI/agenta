import {useCallback} from "react"

import {playgroundSessionPath} from "@agenta/sessions/link"
import {
    addPendingSessionOpenAtom,
    removePendingSessionOpensAtom,
    type PendingSessionOpen,
} from "@agenta/sessions/state"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {urlAtom} from "@/oss/state/url"

/**
 * Open a session on its agent's playground from anywhere in the app: stash the target, then
 * navigate. `AgentChatPanel` adopts it once the chat scope resolves, so a session this browser has
 * never seen still opens — its transcript hydrates from the durable records.
 *
 * The target also rides the URL (`?session_id=`), so the address bar names what you are looking at
 * and a reload comes back to it. The stashed target stays: it carries the title the tab shows
 * before records hydrate, and a fresh session's id, which the URL only learns once it exists.
 *
 * No revision is pinned: the playground resolves its own default. Continuing under the exact config
 * the session last ran with is a separate concern (see the sessions UX plan).
 */
export function useOpenAgentSession(): (target: PendingSessionOpen) => void {
    const router = useRouter()
    const {baseAppURL} = useAtomValue(urlAtom)
    const addPendingOpen = useSetAtom(addPendingSessionOpenAtom)
    const removePendingOpens = useSetAtom(removePendingSessionOpensAtom)

    return useCallback(
        (target: PendingSessionOpen) => {
            const path = playgroundSessionPath(baseAppURL, target.appId, target.sessionId)
            if (!path) return
            addPendingOpen(target)
            // Clear on a failed navigation, or the target would be adopted by whatever agent
            // playground this browser opens next. Only OUR entry — others may be in flight.
            router.push(path).catch(() => {
                removePendingOpens([target])
            })
        },
        [router, baseAppURL, addPendingOpen, removePendingOpens],
    )
}
