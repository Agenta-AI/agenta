import {atom, createStore} from "jotai"

import {UseEvaluationRunScenarioStepsFetcherResult} from "../../../useEvaluationRunScenarioSteps/types"
import {fetchScenarioViaWorkerAndCache} from "../helpers/fetchScenarioViaWorker"

import {evaluationRunIdAtom} from "./derived"
import {evaluationRunStateAtom} from "./evaluationRunStateAtom"

import {enrichedRunAtom} from "."

/*
  Bulk scenario-step prefetching for Evaluation Run screen.
  Delegates heavy lifting to the shared `fetchScenarioStepsBulk` helper created during the refactor.
  This atom fires once per run, fetches + enriches all steps in the background, and puts the result
  into `bulkStepsCacheAtom` for UI consumers.
*/

export const bulkStepsStatusAtom = atom<"idle" | "loading" | "done" | "error">("idle")

export const bulkStepsCacheAtom = atom<Map<string, UseEvaluationRunScenarioStepsFetcherResult>>(
    new Map(),
)

// Bulk fetch logic extracted to helper to reduce atom surface
export async function runBulkFetch(
    store: ReturnType<typeof createStore>,
    scenarioIds: string[],
    opts: {
        force?: boolean
        onComplete?: (map: Map<string, UseEvaluationRunScenarioStepsFetcherResult>) => void
    } = {},
): Promise<Map<string, UseEvaluationRunScenarioStepsFetcherResult>> {
    if (!scenarioIds.length) return new Map()

    const status = store.get(bulkStepsStatusAtom)
    if (!opts.force && (status === "loading" || status === "done")) {
        return store.get(bulkStepsCacheAtom)
    }

    const runId = store.get(evaluationRunIdAtom)
    const enrichedRun = store.get(enrichedRunAtom)
    const {runIndex} = store.get(evaluationRunStateAtom)
    if (!runId || !enrichedRun || !runIndex) return store.get(bulkStepsCacheAtom)

    store.set(bulkStepsStatusAtom, "loading")
    try {
        const params = {runId, evaluation: enrichedRun, runIndex}
        await fetchScenarioViaWorkerAndCache(scenarioIds, params)
        store.set(bulkStepsStatusAtom, "done")
        // return store.get(bulkStepsCacheAtom)
    } catch (err) {
        console.error("[bulk-steps] bulk fetch ERROR", err)
        store.set(bulkStepsStatusAtom, "error")
        // return store.get(bulkStepsCacheAtom)
    }
}
