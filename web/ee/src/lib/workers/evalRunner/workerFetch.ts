/*
 * Web-worker compatible utilities for fetching & enriching scenario steps in bulk.
 *
 * These functions mirror the logic in `fetchScenarioStepsBulk` but avoid any
 * main-thread specifics (Jotai atoms, React hooks). They can be executed inside
 * a dedicated Web Worker to offload CPU-heavy enrichment for thousands of
 * scenarios.
 */

import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"
import {uuidToTraceId} from "@/oss/lib/hooks/useAnnotations/assets/helpers" // relative to this file
import type {
    IStepResponse,
    StepResponse,
    StepResponseStep,
    UseEvaluationRunScenarioStepsFetcherResult,
} from "@/oss/lib/hooks/useEvaluationRunScenarioSteps/types"

import {
    deserializeRunIndex,
    RunIndex,
} from "../../hooks/useEvaluationRunData/assets/helpers/buildRunIndex"
import {EvalRunDataContextType} from "../../hooks/useEvaluationRunData/types"

import {
    buildScenarioCore,
    computeTraceAndAnnotationRefs,
    decorateScenarioResult,
    fetchTraceAndAnnotationMaps,
} from "./pureEnrichment"
import {PreviewTestCase, PreviewTestSet} from "@/oss/lib/Types"

export const DEFAULT_BATCH_SIZE = 100
export const DEFAULT_BATCH_CONCURRENCY = 2

/**
 * Simplified, serialisable context passed from main thread to the worker.
 * (It extends the original `EvalRunDataContextType` but removes any functions
 *  and non-cloneable structures.)
 */
export interface WorkerEvalContext extends Omit<EvalRunDataContextType, "runIndex"> {
    runIndex: RunIndex
    jwt: string
    apiUrl: string
    projectId: string
}

// ------------- helpers -------------
function chunkArray<T>(arr: T[], size: number): T[][] {
    return Array.from({length: Math.ceil(arr.length / size)}, (_, i) =>
        arr.slice(i * size, i * size + size),
    )
}

/**
 * Fetch & enrich steps for one batch of scenarios.
 * Pure function without side-effects beyond network requests.
 */
async function processScenarioBatchWorker(
    scenarioIds: string[],
    context: WorkerEvalContext,
): Promise<Map<string, UseEvaluationRunScenarioStepsFetcherResult>> {
    const {runId, members, jwt, apiUrl, projectId} = context

    const params = new URLSearchParams()
    params.append("run_id", runId)
    params.append("project_id", projectId)
    scenarioIds.forEach((sid) => params.append("scenario_ids", sid))

    const resp = await fetch(`${apiUrl}/preview/evaluations/steps/?${params.toString()}`, {
        headers: {
            "Content-Type": "application/json",
            Authorization: jwt ? `Bearer ${jwt}` : "",
        },
        credentials: "include",
    })

    if (!resp.ok) {
        throw new Error(`Worker fetch failed ${resp.status}`)
    }

    const raw = (await resp.json()) as StepResponse

    // console.log("[workerFetch] response", resp, raw)

    // Convert to camelCase once
    const camelStepsAll = (raw.steps ?? []).map((st) => snakeToCamelCaseKeys<StepResponseStep>(st))

    // Group steps by scenarioId
    const perScenarioSteps = new Map<string, IStepResponse[]>()
    for (const step of camelStepsAll) {
        const sid = (step as any).scenarioId as string
        if (!perScenarioSteps.has(sid)) perScenarioSteps.set(sid, [])
        perScenarioSteps.get(sid)!.push(step)
    }

    // Collect testcase ids
    const testcaseIds = new Set<string>()
    for (const [_, stepsArr] of perScenarioSteps.entries()) {
        for (const s of stepsArr) {
            if (s.testcaseId) testcaseIds.add(s.testcaseId)
        }
    }

    // Fetch testcase data
    const testcaseResp = await fetch(
        `${apiUrl}/preview/simple/testsets/testcases/query?project_id=${projectId}`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: jwt ? `Bearer ${jwt}` : "",
            },
            credentials: "include",
            body: JSON.stringify({testcase_ids: Array.from(testcaseIds)}),
        },
    )
    const testcases = (await testcaseResp.json()) as {count: number; testcases: PreviewTestCase[]}

    // Group testcases by their testset_id for easier lookup
    const testcasesByTestsetId = (testcases.testcases || []).reduce(
        (acc, testcase) => {
            if (!acc[testcase.testset_id]) {
                acc[testcase.testset_id] = []
            }
            acc[testcase.testset_id].push(testcase)
            return acc
        },
        {} as Record<string, PreviewTestCase[]>,
    )

    // Update testsets with their matching testcases
    const updatedTestsets = context.testsets?.map((testset) => {
        const matchingTestcases = testcasesByTestsetId[testset.id] || []

        if (matchingTestcases.length > 0) {
            return {
                ...testset,
                data: {
                    ...testset.data,
                    testcase_ids: matchingTestcases?.map((tc) => tc.id),
                    testcases: matchingTestcases,
                },
            }
        }

        // Return testset as is if no matching testcases found
        return testset
    }) as PreviewTestSet[]

    // Update the context with the new testsets which have the fetched testcases
    context.testsets = updatedTestsets

    const scenarioMap = new Map<string, UseEvaluationRunScenarioStepsFetcherResult>()

    const runIndex = deserializeRunIndex(context.runIndex)
    for (const [sid, stepsArr] of perScenarioSteps.entries()) {
        const core = buildScenarioCore({
            steps: stepsArr,
            runIndex: runIndex,
            evaluators: context.evaluators,
            testsets: context.testsets,
            variants: context.variants,
            mappings: context.mappings,
        })

        // console.log("[workerFetch] core", core)
        const result: UseEvaluationRunScenarioStepsFetcherResult = {
            ...core,
            steps: stepsArr,
            count: stepsArr.length,
            next: undefined,
            mappings: context.mappings,
        } as any
        scenarioMap.set(sid, result)
    }

    // Enrich traces / annotations
    const {traceIds, annotationLinks} = computeTraceAndAnnotationRefs({
        steps: camelStepsAll,
        runIndex: runIndex,
        evaluators: context.evaluators || [],
    })

    const invocationStepsList = (raw.steps ?? []).filter((s: any) =>
        runIndex?.invocationKeys?.has?.(s.key),
    )

    const {traceMap, annotationMap} = await fetchTraceAndAnnotationMaps({
        traceIds,
        annotationLinks,
        members,
        invocationSteps: invocationStepsList,
        apiUrl,
        jwt,
        projectId,
    })

    for (const result of scenarioMap.values()) {
        decorateScenarioResult({
            result,
            traceMap,
            annotationMap,
            runIndex: runIndex,
            uuidToTraceId,
        })
    }

    return scenarioMap
}

/**
 * Process all batches with limited concurrency. Returns a merged Map.
 */
async function processAllBatchesWorker(
    scenarioIds: string[],
    context: WorkerEvalContext,
    concurrency: number,
    batchSize: number,
): Promise<Map<string, UseEvaluationRunScenarioStepsFetcherResult>> {
    const batches = chunkArray(scenarioIds, batchSize)
    const results: Map<string, UseEvaluationRunScenarioStepsFetcherResult>[] = []
    let idx = 0
    while (idx < batches.length) {
        const running = batches
            .slice(idx, idx + concurrency)
            .map((batch) => processScenarioBatchWorker(batch, context))
        const batchResults = await Promise.all(running)
        results.push(...batchResults)
        idx += concurrency
    }

    return mergeMaps(results)
}

// Helper: merge many Maps into one.
function mergeMaps<K, V>(maps: Map<K, V>[]): Map<K, V> {
    const merged = new Map<K, V>()
    for (const m of maps) {
        for (const [k, v] of m) merged.set(k, v)
    }
    return merged
}

/**
 * Public API for worker usage. Returns a serialisable array of entries.
 */
export async function fetchScenarioStepsBulkWorker(
    scenarioIds: string[],
    context: WorkerEvalContext,
    options?: {batchSize?: number; concurrency?: number},
): Promise<Map<string, UseEvaluationRunScenarioStepsFetcherResult>> {
    if (scenarioIds.length === 0)
        return new Map<string, UseEvaluationRunScenarioStepsFetcherResult>()
    const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE
    const concurrency = options?.concurrency ?? DEFAULT_BATCH_CONCURRENCY
    const map = await processAllBatchesWorker(scenarioIds, context, concurrency, batchSize)
    return map
}
