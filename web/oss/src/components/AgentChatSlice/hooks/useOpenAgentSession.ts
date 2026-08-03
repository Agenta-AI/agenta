import {useCallback} from "react"

import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {urlAtom} from "@/oss/state/url"

import {pendingSessionOpenAtom, type PendingSessionOpen} from "../state/pendingSessionOpen"

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
    const setPendingOpen = useSetAtom(pendingSessionOpenAtom)

    return useCallback(
        (target: PendingSessionOpen) => {
            setPendingOpen(target)
            // Clear on a failed navigation, or the target would be adopted by whatever agent
            // playground this browser opens next.
            router.push(`${baseAppURL}/${target.appId}/playground`).catch(() => {
                setPendingOpen(null)
            })
        },
        [router, baseAppURL, setPendingOpen],
    )
}
