import {createStore} from "jotai"

import {UseEvaluationRunScenarioStepsFetcherResult} from "../../../useEvaluationRunScenarioSteps/types"
import {fetchScenarioViaWorkerAndCache} from "../helpers/fetchScenarioViaWorker"

import {
    bulkStepsStatusFamily,
    bulkStepsCacheFamily,
    evaluationRunStateFamily,
    enrichedRunFamily,
} from "./runScopedAtoms"

/*
  Bulk scenario-step prefetching for Evaluation Run screen.
  Updated to work with run-scoped atom families instead of global atoms.
  This allows multiple evaluation runs to have independent bulk fetch states.
*/

// Legacy exports for backward compatibility during migration
// These will be removed once all components are migrated
export const bulkStepsStatusAtom = bulkStepsStatusFamily("__legacy__")

// Bulk fetch logic updated to work with run-scoped atom families
export async function runBulkFetch(
    store: ReturnType<typeof createStore>,
    runId: string,
    scenarioIds: string[],
    opts: {
        force?: boolean
        onComplete?: (map: Map<string, UseEvaluationRunScenarioStepsFetcherResult>) => void
        silent?: boolean
    } = {},
): Promise<Map<string, UseEvaluationRunScenarioStepsFetcherResult>> {
    if (!scenarioIds || !scenarioIds.length) {
        return new Map()
    }

    const status = store.get(bulkStepsStatusFamily(runId))

    if (!opts.force && (status === "loading" || status === "done")) {
        const cachedData = store.get(bulkStepsCacheFamily(runId))

        return cachedData
    }

    const enrichedRun = store.get(enrichedRunFamily(runId))
    const evaluationRunState = store.get(evaluationRunStateFamily(runId))
    const runIndex = evaluationRunState?.runIndex

    // Validate scenario IDs and filter out skeleton/placeholder IDs
    const validScenarioIds = scenarioIds.filter((id) => {
        if (!id || typeof id !== "string") return false

        // Skip skeleton/placeholder IDs gracefully
        if (id.startsWith("skeleton-") || id.startsWith("placeholder-")) {
            return false
        }

        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        return uuidRegex.test(id)
    })

    // Use filtered valid IDs
    scenarioIds = validScenarioIds

    // Early return if no valid scenario IDs remain after filtering
    if (scenarioIds.length === 0) {
        return store.get(bulkStepsCacheFamily(runId))
    }

    if (!runId || !enrichedRun || !runIndex) {
        return store.get(bulkStepsCacheFamily(runId))
    }

    if (!opts.silent) {
        store.set(bulkStepsStatusFamily(runId), "loading")
    }
    // return
    try {
        const params = {runId, evaluation: enrichedRun, runIndex}

        const workerResult =
            (await fetchScenarioViaWorkerAndCache(params, scenarioIds)) || new Map()

        // Write all results to the bulk cache atom at once
        store.set(bulkStepsCacheFamily(runId), (draft) => {
            const next = draft ? new Map(draft) : new Map()
            for (const [scenarioId, scenarioSteps] of workerResult?.entries() || []) {
                if (scenarioSteps) {
                    next.set(scenarioId, scenarioSteps)
                }
            }
            return next
        })

        if (!opts.silent) {
            store.set(bulkStepsStatusFamily(runId), "done")
        }

        if (typeof opts.onComplete === "function") {
            opts.onComplete(workerResult)
        }

        return workerResult
    } catch (err) {
        console.error("[bulk-steps] bulk fetch ERROR", err)
        if (!opts.silent) {
            store.set(bulkStepsStatusFamily(runId), "error")
        }
        return store.get(bulkStepsCacheFamily(runId))
    }

    return store.get(bulkStepsCacheFamily(runId))
}
