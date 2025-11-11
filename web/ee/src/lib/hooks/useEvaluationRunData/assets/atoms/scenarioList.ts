import {atom} from "jotai"
import {createStore} from "jotai/vanilla"

import {getCurrentProject} from "@/oss/contexts/project.context"
import {getAgentaApiUrl} from "@/oss/lib/helpers/utils"
import type {IScenario} from "@/oss/lib/hooks/useEvaluationRunScenarios/types"
import {getJWT} from "@/oss/services/api"

import {fetchScenarioListViaWorker} from "../helpers/fetchScenarioListViaWorker"

import {evaluationRunIdAtom, enrichedRunAtom, evaluationRunStateAtom} from "."

// Holds full scenario array
export const scenarioListCacheAtom = atom<IScenario[] | null>(null)

export const scenarioListStatusAtom = atom<"idle" | "loading" | "done" | "error">("idle")

// write-only atom to trigger worker fetch once
export const prefetchScenarioListAtom = atom(null, async (get, set) => {
    const status = get(scenarioListStatusAtom)
    const cached = get(scenarioListCacheAtom)
    if (status === "loading" || (status === "done" && cached?.length)) return
    const runId = get(evaluationRunIdAtom)
    const enrichedRun = get(enrichedRunAtom) as any
    if (!runId || !enrichedRun) return

    const {projectId} = getCurrentProject()
    const apiUrl = getAgentaApiUrl()
    const jwt = await getJWT()
    if (!jwt) {
        console.warn("[scenario-list] No JWT available – skipping fetch")
        return
    }
    set(scenarioListStatusAtom, "loading")
    try {
        const scenarios = await fetchScenarioListViaWorker({apiUrl, jwt, projectId, runId})

        set(scenarioListCacheAtom, scenarios)
        set(scenarioListStatusAtom, "done")
        // propagate to legacy state for existing consumers
        set(evaluationRunStateAtom, (draft: any) => {
            draft.scenarios = scenarios.map((s, idx) => ({...s, scenarioIndex: idx + 1}))
        })
    } catch (err) {
        console.error("[scenario-list] worker error", err)
        set(scenarioListStatusAtom, "error")
    }
})

// attach helper like bulk steps
export function attachScenarioListPrefetch(store: ReturnType<typeof createStore>) {
    store.sub(enrichedRunAtom, () => {
        const enriched = store.get(enrichedRunAtom)
        const status = store.get(scenarioListStatusAtom)
        const cached = store.get(scenarioListCacheAtom)
        if (enriched && status === "idle" && !cached?.length) {
            store.set(prefetchScenarioListAtom)
        }
    })
}
