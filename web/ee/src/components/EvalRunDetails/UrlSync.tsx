import {useEffect, useRef} from "react"

import {useAtom, useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {EvalRunUrlState, runViewTypeAtom, urlStateAtom} from "./state/urlState"

const UrlSync = ({evalType}: {evalType: "auto" | "human" | "online"}) => {
    const router = useRouter()

    // Use global store for all atom reads/writes to ensure consistency
    const [urlState, setUrlState] = useAtom(urlStateAtom)

    // Track the last applied router->atom key to avoid re-applying the same state
    const lastAppliedKeyRef = useRef<string | null>(null)
    const initializedRef = useRef<boolean>(false)
    const viewType = useAtomValue(runViewTypeAtom)

    // Router -> Atom (sync whenever relevant query params change)
    useEffect(() => {
        if (!router.isReady) return
        const {view, scenarioId, compare} = router.query
        const queryView = Array.isArray(view) ? view[0] : (view as string | undefined)
        const fallbackView =
            evalType === "auto" ? "testcases" : evalType === "online" ? "results" : "focus"
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

        const nextScenarioId = v === "focus" ? (scenarioId as string | undefined) : undefined
        const nextKey = `${v}|${nextScenarioId || ""}|${(compareIds || []).join(",")}`
        const curr = urlState
        const sameView = curr.view === (v as EvalRunUrlState["view"])
        const sameScenario = (curr.scenarioId || undefined) === (nextScenarioId || undefined)
        const currCompareKey = (curr.compare || []).join(",")
        const nextCompareKey = (compareIds || []).join(",")
        const sameCompare = currCompareKey === nextCompareKey

        if (lastAppliedKeyRef.current === nextKey && sameView && sameScenario && sameCompare) return

        setUrlState({
            view: v as EvalRunUrlState["view"],
            scenarioId: nextScenarioId,
            compare: compareIds,
        })
        lastAppliedKeyRef.current = nextKey
        initializedRef.current = true
    }, [router.isReady, evalType, router.query.view, router.query.scenarioId, router.query.compare])

    // Atom -> Router
    const lastReplacedKeyRef = useRef<string | null>(null)
    useEffect(() => {
        if (!router.isReady) return
        if (urlState.view === undefined) return // wait until atom populated
        if (evalType === "online") return
        // Early guard: if router already matches atom state, do nothing
        const rView = (router.query.view as string) || ""
        const rScenario = (router.query.scenarioId as string) || ""
        const rCompare = Array.isArray(router.query.compare)
            ? router.query.compare.join(",")
            : (router.query.compare as string) || ""
        const aView = urlState.view || ""
        const aScenario = urlState.view === "focus" ? urlState.scenarioId || "" : ""
        const aCompare = (urlState.compare || []).join(",")
        if (rView === aView && rScenario === aScenario && rCompare === aCompare) {
            return
        }
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
        // detect difference including removed keys (normalize arrays to strings for compare)
        const normalize = (q: Record<string, any>) => {
            const copy: Record<string, any> = {}
            for (const k of Object.keys(q)) {
                const val = q[k]
                if (Array.isArray(val)) copy[k] = val.join(",")
                else copy[k] = val
            }
            return copy
        }
        const currNorm = normalize(router.query as any)
        const nextNorm = normalize(nextQuery)
        const allKeys = new Set([...Object.keys(currNorm), ...Object.keys(nextNorm)])
        let hasDiff = mustReplace
        if (!hasDiff) {
            for (const k of allKeys) {
                if (currNorm[k] !== nextNorm[k]) {
                    hasDiff = true
                    break
                }
            }
        }
        // Fast-path guard: if router already equals desired key, skip replace
        const routerKey = `${(router.query.view as string) || ""}|${(router.query.scenarioId as string) || ""}|${
            (typeof router.query.compare === "string"
                ? router.query.compare
                : Array.isArray(router.query.compare)
                  ? router.query.compare?.join(",")
                  : "") || ""
        }`
        const desiredKey = `${nextQuery.view || ""}|${nextQuery.scenarioId || ""}|${(nextQuery.compare as string) || ""}`
        if (routerKey === desiredKey) {
            lastReplacedKeyRef.current = desiredKey
            return
        }

        if (hasDiff && lastReplacedKeyRef.current !== desiredKey) {
            router.replace(
                {
                    pathname: router.pathname,
                    query: nextQuery,
                },
                undefined,
                {shallow: !mustReplace},
            )
            lastReplacedKeyRef.current = desiredKey
        }
    }, [urlState])

    return null
}

export default UrlSync
