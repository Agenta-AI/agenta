import {UseEvaluationRunScenarioStepsFetcherResult} from "../../../useEvaluationRunScenarioSteps/types"
import {evalAtomStore} from "../atoms"

import {buildAuthContext, buildEvalWorkerContext} from "./workerContext"

/**
 * Fetch one or more scenarios' steps via the Web-Worker in bulk and cache the
 * results inside `bulkStepsCacheAtom`.
 *
 * The helper returns the `Map` produced by the worker where each key is a
 * `scenarioId` and the value is the enriched steps result for that scenario.
 * If the worker fails to return data for a given scenario the entry will be
 * missing from the map – callers should handle that case by falling back to a
 * direct network request.
 */
// Deduplication cache to prevent multiple simultaneous calls for the same run
const inFlightFetches = new Map<
    string,
    Promise<Map<string, UseEvaluationRunScenarioStepsFetcherResult>>
>()

export const fetchScenarioViaWorkerAndCache = async (
    params: {
        runId: string
        evaluation: any
        runIndex: any
    },
    scenarioIds: string[],
): Promise<Map<string, UseEvaluationRunScenarioStepsFetcherResult>> => {
    // Safety checks for parameters
    if (!params || !params.runId) {
        return new Map()
    }

    // Ensure scenarioIds is an array
    const scenarioIdsArray = Array.isArray(scenarioIds) ? scenarioIds : []
    const cacheKey = `${params.runId}-${scenarioIdsArray.join(",")}`

    if (scenarioIdsArray.length === 0) {
        return new Map()
    }

    // Check if there's already an in-flight fetch for this exact request
    if (inFlightFetches.has(cacheKey)) {
        return inFlightFetches.get(cacheKey)!
    }

    // Create the promise and cache it immediately
    const fetchPromise = performFetch(params, scenarioIdsArray)
    inFlightFetches.set(cacheKey, fetchPromise)

    try {
        const result = await fetchPromise
        return result
    } finally {
        // Clean up the cache entry when done
        inFlightFetches.delete(cacheKey)
    }
}

const performFetch = async (
    params: {
        runId: string
        evaluation: any
        runIndex: any
    },
    scenarioIds: string[],
): Promise<Map<string, UseEvaluationRunScenarioStepsFetcherResult>> => {
    // Import run-scoped atoms at the top level

    const {scenarioStepLocalFamily: runScopedLocalFamily} = await import(
        "../atoms/runScopedScenarios"
    )

    let context
    try {
        context = buildEvalWorkerContext({
            runId: params.runId,
            evaluation: params.evaluation,
            runIndex: params.runIndex,
        })
    } catch (error) {
        throw error
    }

    const {jwt, apiUrl, projectId} = await buildAuthContext()
    const {fetchStepsViaWorker} = await import(
        "@/agenta-oss-common/lib/workers/evalRunner/bulkWorker"
    )

    const store = evalAtomStore()

    // Create a map to collect processed data for return
    const processedResults = new Map<string, UseEvaluationRunScenarioStepsFetcherResult>()

    await fetchStepsViaWorker({
        context: {
            ...context,
            jwt,
            apiUrl,
            projectId,
        },
        scenarioIds,
        onChunk: (chunk) => {
            chunk.forEach((val, key) => {
                // Save to individual scenario atoms
                store.set(runScopedLocalFamily({runId: params.runId, scenarioId: key}), (draft) => {
                    if (!draft) {
                        draft = {
                            steps: [],
                            annotationSteps: [],
                            invocationSteps: [],
                            inputSteps: [],
                        }
                    }

                    // Store existing optimistic step statuses before overwriting
                    const preserveOptimisticStatuses = (existingSteps: any[], newSteps: any[]) => {
                        if (!existingSteps || !newSteps) return newSteps

                        const shouldHoldOptimistic = (
                            existingStatus: string,
                            serverStatus?: string,
                        ) => {
                            if (!existingStatus) return false
                            const optimisticStates = ["running", "revalidating"]
                            if (!optimisticStates.includes(existingStatus)) return false

                            if (!serverStatus) return true

                            // Only keep optimistic states while the server still reports a non-final status
                            const transitionalStates = new Set([
                                "pending",
                                "running",
                                "annotating",
                                "revalidating",
                            ])

                            return transitionalStates.has(serverStatus)
                        }

                        return newSteps.map((newStep: any) => {
                            const existingStep = existingSteps.find(
                                (s: any) => s.stepKey === newStep.stepKey,
                            )
                            if (
                                existingStep?.status &&
                                shouldHoldOptimistic(existingStep.status, newStep.status)
                            ) {
                                return {...newStep, status: existingStep.status}
                            }
                            return newStep
                        })
                    }

                    // Merge server data while preserving optimistic statuses
                    for (const [k, v] of Object.entries(val)) {
                        if (
                            k === "invocationSteps" ||
                            k === "annotationSteps" ||
                            k === "inputSteps"
                        ) {
                            ;(draft as any)[k] = preserveOptimisticStatuses(
                                (draft as any)[k],
                                v as any[],
                            )
                        } else {
                            ;(draft as any)[k] = v
                        }
                    }
                })

                // Also collect the processed data for bulk cache return
                processedResults.set(key, {
                    state: "hasData",
                    data: val,
                })
            })
        },
    })

    // Return the aggregated results map so callers receive data
    return processedResults
}
