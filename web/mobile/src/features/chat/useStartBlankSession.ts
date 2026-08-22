import {useCallback} from "react"

import {markSessionFresh} from "@agenta/chat/state"
import {useRouter} from "next/router"

/**
 * Start a BLANK session with an agent and land on it.
 *
 * Sessions are routes in this app, so "new session" is a minted id plus a navigation — the id is
 * client-side and the session becomes real on the backend when its first message lands, which is
 * the same handoff Home's composer uses (`?agent=` carries the agent, because a session with no
 * turns yet cannot name its own).
 *
 * The `+` controls used to route to the agent's overview instead, which is a different intent: it
 * shows the agent and its existing sessions rather than opening an empty one to type into.
 */
export const useStartBlankSession = (base: string) => {
    const router = useRouter()
    return useCallback(
        (agentId: string) => {
            const sessionId = crypto.randomUUID()
            // Brand-new, never-run: the backend has no records for it yet. Without this the
            // conversation treats the empty hydration as a KNOWN session whose history was pruned
            // and shows "this session has no replayable history", which is alarming and false —
            // nothing was lost, it simply has not happened yet.
            markSessionFresh(sessionId)
            void router.push(`${base}/sessions/${sessionId}?agent=${agentId}`)
        },
        [base, router],
    )
}
