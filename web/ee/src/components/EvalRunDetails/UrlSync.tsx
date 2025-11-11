import {useEffect} from "react"

import {useAtom, useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {evalAtomStore} from "../../lib/hooks/useEvaluationRunData/assets/atoms/store"

import {EvalRunUrlState, runViewTypeAtom, urlStateAtom} from "./state/urlState"
import {useRunId} from "@/oss/contexts/RunIdContext"

const UrlSync = ({evalType}: {evalType: "auto" | "human"}) => {
    const router = useRouter()
    const store = evalAtomStore()

    // Use global store for all atom reads/writes to ensure consistency
    const [urlState, setUrlState] = useAtom(urlStateAtom, {store})
    const viewType = useAtomValue(runViewTypeAtom, {store})

    // Router -> Atom (sync whenever relevant query params change)
    useEffect(() => {
        if (!router.isReady) return
        const {view, scenarioId, compare} = router.query
        const queryView = Array.isArray(view) ? view[0] : (view as string | undefined)
        const fallbackView =
            (viewType as string | undefined) ?? (evalType === "auto" ? "test-cases" : "focus")
        const v = queryView ?? fallbackView

        // Parse compare parameter - can be a single string or array of strings
        let compareIds: string[] | undefined
        if (compare) {
            if (Array.isArray(compare)) {
                compareIds = compare.filter((id) => typeof id === "string" && id.length > 0)
            } else if (typeof compare === "string" && compare.length > 0) {
                // Handle comma-separated string or single ID
                compareIds = compare.includes(",")
                    ? compare
                          .split(",")
                          .map((id) => id.trim())
                          .filter(Boolean)
                    : [compare]
            }
        }

        setUrlState({
            view: v as EvalRunUrlState["view"],
            scenarioId: v === "focus" ? (scenarioId as string | undefined) : undefined,
            compare: compareIds,
        })
    }, [
        evalType,
        router.isReady,
        router.query.view,
        router.query.scenarioId,
        router.query.compare,
        viewType,
    ])

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

        // Handle compare parameter
        if (urlState.compare && urlState.compare.length > 0) {
            // Convert array to comma-separated string for URL
            nextQuery.compare = urlState.compare.join(",")
        } else {
            delete nextQuery.compare
        }

        // remove empty/undefined values
        Object.keys(nextQuery).forEach((k) => {
            if (nextQuery[k] === undefined || nextQuery[k] === "") {
                delete nextQuery[k]
            }
        })

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
        }
    }, [urlState])

    return null
}

export default UrlSync
