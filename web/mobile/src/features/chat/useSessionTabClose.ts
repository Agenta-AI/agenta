import {useCallback} from "react"

import {sessionRoutePath} from "@agenta/sessions/link"
import {nearestSurvivingTab, sessionTabScope, useCloseSessionTabs} from "@agenta/sessions/state"
import {useRouter} from "next/router"

/**
 * Close session tabs, and go wherever losing the current one leaves you.
 *
 * Closing is LOCAL: the sessions themselves are untouched, so a closed one stays in the history
 * menu and on the sessions page, and opening it makes it a tab again. A session is a URL here, so
 * closing the tab you are on is a route change to the nearest survivor.
 */
export const useSessionTabClose = ({
    agentId,
    sessionId,
    base,
}: {
    agentId?: string | null
    sessionId: string
    /** `/w/:workspace/p/:project` */
    base: string
}) => {
    const router = useRouter()
    const close = useCloseSessionTabs(sessionTabScope(agentId))
    return useCallback(
        (ids: readonly string[], ordered: readonly string[]) => {
            if (ids.length === 0) return
            const survivor = nearestSurvivingTab(ordered, new Set(ids), sessionId)
            if (!ids.includes(sessionId) || !survivor || survivor === sessionId) {
                close(ids)
                return
            }
            // Land on the survivor BEFORE dropping the tab: the session you are on always rejoins
            // the set, so closing it while still routed to it would reopen it a beat later.
            void router.push(sessionRoutePath(base, survivor)).then(
                () => close(ids),
                () => close(ids),
            )
        },
        [base, close, router, sessionId],
    )
}
