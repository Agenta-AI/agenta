import {useEffect} from "react"

import {useAtom} from "jotai"
import {useRouter} from "next/router"

import {evalAtomStore} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/store"

import {EvalRunUrlState, urlStateAtom} from "../state/urlState"

const OnlineUrlSync = () => {
    const router = useRouter()
    const store = evalAtomStore()
    const [urlState, setUrlState] = useAtom(urlStateAtom, {store})

    // Router -> Atom only (no Atom -> Router) to avoid loops
    useEffect(() => {
        if (!router.isReady) return
        const {view, scenarioId, compare} = router.query
        const queryView = Array.isArray(view) ? view[0] : (view as string | undefined)
        const v = (queryView as EvalRunUrlState["view"]) ?? "scenarios"

        // Parse compare parameter - can be a single string or array of strings
        let compareIds: string[] | undefined
        if (compare) {
            if (Array.isArray(compare)) {
                compareIds = compare.filter((id) => typeof id === "string" && id.length > 0)
            } else if (typeof compare === "string" && compare.length > 0) {
                compareIds = compare.includes(",")
                    ? compare
                          .split(",")
                          .map((id) => id.trim())
                          .filter(Boolean)
                    : [compare]
            }
        }

        const nextScenarioId = v === "focus" ? (scenarioId as string | undefined) : undefined

        // Guard: skip if no change
        const sameView = urlState.view === v
        const sameScenario = (urlState.scenarioId || undefined) === (nextScenarioId || undefined)
        const currCompareKey = (urlState.compare || []).join(",")
        const nextCompareKey = (compareIds || []).join(",")
        if (sameView && sameScenario && currCompareKey === nextCompareKey) return

        setUrlState({
            view: v,
            scenarioId: nextScenarioId,
            compare: compareIds,
        })
    }, [router.isReady, router.query.view, router.query.scenarioId, router.query.compare])

    return null
}

export default OnlineUrlSync
