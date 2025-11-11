import {useEffect} from "react"

import {useAtom, useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {setUrlStateAtom, urlStateAtom} from "./state/urlState"

const UrlSync = () => {
    const router = useRouter()
    const urlState = useAtomValue(urlStateAtom)
    const setPartial = useAtom(setUrlStateAtom)[1] // write function

    // Router -> Atom (sync whenever relevant query params change)
    useEffect(() => {
        if (!router.isReady) return
        const {view, scenarioId} = router.query
        const v = (view as string | undefined) ?? "focus"
        setPartial({
            view: v as "focus" | "list" | "table",
            scenarioId: v === "focus" ? (scenarioId as string | undefined) : undefined,
        })
    }, [router.isReady, router.query.view, router.query.scenarioId])

    // Atom -> Router
    useEffect(() => {
        if (!router.isReady) return
        if (urlState.view === undefined) return // wait until atom populated
        // Build nextQuery starting from current router.query so that dynamic route params (app_id, evaluation_id, etc.) are preserved
        const nextQuery: Record<string, any> = {...router.query}
        // Apply view from atom
        if (urlState.view) nextQuery.view = urlState.view

        // Handle scenarioId depending on view
        if (urlState.view === "focus") {
            if (urlState.scenarioId !== undefined) {
                // atom resolved
                if (urlState.scenarioId) nextQuery.scenarioId = urlState.scenarioId
                else delete nextQuery.scenarioId
            } else if ("scenarioId" in router.query) {
                // keep existing router scenarioId until atom resolves
                nextQuery.scenarioId = router.query.scenarioId as string
            }
        } else {
            // non-scenario view – ensure scenarioId is gone
            delete nextQuery.scenarioId
        }

        // remove empty/undefined values
        Object.keys(nextQuery).forEach((k) => {
            if (nextQuery[k] === undefined || nextQuery[k] === "") {
                delete nextQuery[k]
            }
        })

        // console.debug("[UrlSync] urlState ->", urlState)
        // console.debug("[UrlSync] router.query before", router.query)
        // console.debug("[UrlSync] nextQuery built ->", nextQuery)

        let mustReplace = false
        // strip scenarioId for non-scenario views
        if (urlState.view !== "focus") {
            if ("scenarioId" in nextQuery) delete nextQuery.scenarioId
        }
        // Need replace if router still has scenarioId but nextQuery doesn't
        if ("scenarioId" in router.query && !("scenarioId" in nextQuery)) {
            mustReplace = true
        }
        // detect difference including removed keys
        const hasDiff =
            mustReplace ||
            Object.keys({...router.query, ...nextQuery}).some(
                (k) => router.query[k] !== nextQuery[k],
            )
        if (hasDiff) {
            router.replace(
                {
                    pathname: router.pathname,
                    query: nextQuery,
                },
                undefined,
                {shallow: !mustReplace},
            )
            console.debug(
                "[UrlSync] router.replace nextQuery",
                nextQuery,
                "mustReplace",
                mustReplace,
            )
        }
    }, [urlState])

    return null
}

export default UrlSync
