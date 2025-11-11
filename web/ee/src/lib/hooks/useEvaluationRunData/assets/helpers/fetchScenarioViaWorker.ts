import type {EnrichedEvaluationRun} from "@/oss/lib/hooks/usePreviewEvaluations/types"

import {UseEvaluationRunScenarioStepsFetcherResult} from "../../../useEvaluationRunScenarioSteps/types"
import {evalAtomStore, evaluationRunStateAtom} from "../atoms"
// import {bulkStepsCacheAtom} from "../atoms/bulkFetch"
import {scenarioStepLocalFamily} from "../atoms/scenarios"

import type {RunIndex} from "./buildRunIndex"
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
export const fetchScenarioViaWorkerAndCache = async (
    scenarioIds: string[],
    params: {
        runId: string
        evaluation: EnrichedEvaluationRun
        runIndex: RunIndex
    },
): Promise<Map<string, UseEvaluationRunScenarioStepsFetcherResult>> => {
    const context = buildEvalWorkerContext({
        runId: params.runId,
        evaluation: params.evaluation,
        runIndex: params.runIndex,
    })

    const {jwt, apiUrl, projectId} = await buildAuthContext()
    const {fetchStepsViaWorker} = await import("@/agenta-oss-common/lib/workers/evalRunner/bulkWorker")

    const store = evalAtomStore()
    const map = await fetchStepsViaWorker(
        scenarioIds,
        {
            ...context,
            jwt,
            apiUrl,
            projectId,
        },
        {
            onChunk: (chunk) => {
                chunk.forEach((val, key) => {
                    store.set(scenarioStepLocalFamily(key), (draft) => {
                        if (!draft) draft = {}
                        for (const [k, v] of Object.entries(val)) {
                            draft[k] = v
                        }
                    })
                })
            },
        },
    )

    //     // ---- resort scenarios based on testcase order once bulk is ready ----
    try {
        const {scenarios = [], enrichedRun} = store.get(evaluationRunStateAtom) as any
        const testcaseOrder: string[] = enrichedRun?.testsets?.[0]?.data?.testcase_ids ?? []
        if (scenarios.length && testcaseOrder.length) {
            const getTc = (sid: string) => {
                const scenarioSteps = store.get(scenarioStepLocalFamily(sid))
                return scenarioSteps?.steps?.find((s: any) => s?.testcaseId)?.testcaseId
            }
            const sorted = [...scenarios]
            // const sorted = [...scenarios].sort(
            //     (a: any, b: any) =>
            //         testcaseOrder.indexOf(getTc(a.id) ?? "") -
            //         testcaseOrder.indexOf(getTc(b.id) ?? ""),
            // )
            if (sorted.some((s, i) => s.id !== scenarios[i]?.id)) {
                store.set(evaluationRunStateAtom, (draft: any) => {
                    draft.scenarios = sorted
                })
            }
        }
    } catch (err) {
        console.error("[scenario-sort] failed", err)
    }
}
