import {useEffect} from "react"

import {sessionStatusesAtom} from "@agenta/chat/state"
import {useStore} from "jotai"

import {showTabRunBadge} from "./faviconBadge"
import {
    reduceTabRunBadge,
    tabRunBadge,
    type TabRunBadgeEvent,
    type TabRunBadgeState,
} from "./tabRunBadge"

/** Null-rendering: badges the favicon with this tab's run state while the user is away. */
export const TabRunFavicon = () => {
    const store = useStore()
    useEffect(() => {
        // A store subscription, not `useAtomValue`: a run's transitions never re-render this.
        let state: TabRunBadgeState = {
            hidden: document.hidden,
            statuses: store.get(sessionStatusesAtom),
            settled: null,
        }
        let shown = tabRunBadge(state)
        if (shown) showTabRunBadge(shown)

        const dispatch = (event: TabRunBadgeEvent) => {
            state = reduceTabRunBadge(state, event)
            const next = tabRunBadge(state)
            if (next === shown) return
            shown = next
            showTabRunBadge(next)
        }
        const onVisibility = () => dispatch({type: "visibility", hidden: document.hidden})
        const unsubscribe = store.sub(sessionStatusesAtom, () =>
            dispatch({type: "status", statuses: store.get(sessionStatusesAtom)}),
        )
        document.addEventListener("visibilitychange", onVisibility)
        return () => {
            unsubscribe()
            document.removeEventListener("visibilitychange", onVisibility)
            if (shown) showTabRunBadge(null)
        }
    }, [store])
    return null
}
