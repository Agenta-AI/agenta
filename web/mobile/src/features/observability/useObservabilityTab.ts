import {useCallback} from "react"

import {useRouter} from "next/router"

import {currentQuery} from "./bindTraceDrawerSeams"

export type ObservabilityTab = "traces" | "sessions"

/**
 * The open tab lives in the address bar as `?tab=sessions`, the old app's param, so a reload or
 * a link keeps it. Traces is the default and has no param.
 */
export const useObservabilityTab = () => {
    const router = useRouter()
    const tab: ObservabilityTab = router.query.tab === "sessions" ? "sessions" : "traces"

    const setTab = useCallback(
        (next: ObservabilityTab) => {
            const query = currentQuery(router, window.location.search)
            if (next === "sessions") query.tab = "sessions"
            else delete query.tab
            void router.replace({pathname: router.pathname, query}, undefined, {shallow: true})
        },
        [router],
    )

    return [tab, setTab] as const
}
