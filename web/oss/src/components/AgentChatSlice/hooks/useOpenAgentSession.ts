import {useCallback} from "react"

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
            addPendingOpen(target)
            // Clear on a failed navigation, or the target would be adopted by whatever agent
            // playground this browser opens next. Only OUR entry — others may be in flight.
            router.push(`${baseAppURL}/${target.appId}/playground`).catch(() => {
                removePendingOpens([target])
            })
        },
        [router, baseAppURL, addPendingOpen, removePendingOpens],
    )
}
