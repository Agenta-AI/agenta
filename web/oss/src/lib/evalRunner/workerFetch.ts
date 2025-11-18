/*
 * Web-worker compatible utilities for fetching & enriching scenario steps in bulk.
 *
 * These functions mirror the logic in `fetchScenarioStepsBulk` but avoid any
 * main-thread specifics (Jotai atoms, React hooks). They can be executed inside
 * a dedicated Web Worker to offload CPU-heavy enrichment for thousands of
 * scenarios.
 */

import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"
import {uuidToTraceId} from "@/oss/lib/traces/helpers" // relative to this file
import type {
    IStepResponse,
    StepResponse,
    StepResponseStep,
    UseEvaluationRunScenarioStepsFetcherResult,
} from "@/oss/lib/hooks/useEvaluationRunScenarioSteps/types"
import {PreviewTestcase, PreviewTestset} from "@/oss/lib/Types"

import {
    deserializeRunIndex,
    RunIndex,
} from "@agenta/oss/src/lib/hooks/useEvaluationRunData/assets/helpers/buildRunIndex"
import {EvalRunDataContextType} from "@agenta/oss/src/lib/hooks/useEvaluationRunData/types"

import {
    buildScenarioCore,
    computeTraceAndAnnotationRefs,
    decorateScenarioResult,
    fetchTraceAndAnnotationMaps,
} from "./pureEnrichment"

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
    /** IDs of variants that are chat-based (hasMessages in request schema) */
    chatVariantIds?: string[]
    uriObject?: {runtimePrefix: string; routePath?: string}
    /** Stable transformed parameters keyed by revision id */
    parametersByRevisionId?: Record<string, any>
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
    const {runId, members, jwt, apiUrl, projectId, appType} = context

    // Validate required parameters
    if (!runId || !projectId || !jwt || !apiUrl) {
        throw new Error("Missing required parameters for worker fetch")
    }

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

    if (validScenarioIds.length === 0) {
        return new Map()
    }

    // POST to results query endpoint with body { result: { run_id, run_ids, scenario_ids }, windowing: {} }
    const resultsUrl = `${apiUrl}/preview/evaluations/results/query?project_id=${encodeURIComponent(
        projectId,
    )}`
    const body: Record<string, any> = {
        result: {
            run_id: runId,
            run_ids: [runId],
            scenario_ids: validScenarioIds,
        },
        windowing: {},
    }

    const resp = await fetch(resultsUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: jwt ? `Bearer ${jwt}` : "",
        },
        credentials: "include",
        body: JSON.stringify(body),
    })

    if (!resp.ok) {
        throw new Error(`Worker fetch failed ${resp.status}`)
    }

    const raw = (await resp.json()) as StepResponse

    // Convert to camelCase once
    const camelStepsAll = (raw.results ?? []).map((st) =>
        snakeToCamelCaseKeys<StepResponseStep>(st),
    )

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

    // Fetch testcase data (updated endpoint)
    let updatedTestsets: PreviewTestset[] = Array.isArray(context.testsets)
        ? [...context.testsets]
        : []

    if (testcaseIds.size > 0 && updatedTestsets.length > 0) {
        const testcaseResp = await fetch(
            `${apiUrl}/preview/testcases/query?project_id=${encodeURIComponent(projectId)}`,
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

        if (testcaseResp.ok) {
            const testcases = (await testcaseResp.json()) as {
                count: number
                testcases: PreviewTestcase[]
            }

            // Group testcases by their testset_id for easier lookup
            const testcasesByTestsetId = (testcases.testcases || []).reduce(
                (acc, testcase) => {
                    if (!acc[testcase.testset_id]) {
                        acc[testcase.testset_id] = []
                    }
                    acc[testcase.testset_id].push(testcase)
                    return acc
                },
                {} as Record<string, PreviewTestcase[]>,
            )

            updatedTestsets = updatedTestsets.map((testset) => {
                const matchingTestcases = testcasesByTestsetId[testset.id] || []

                if (matchingTestcases.length > 0) {
                    return {
                        ...testset,
                        data: {
                            ...testset.data,
                            testcase_ids: matchingTestcases.map((tc) => tc.id),
                            testcases: matchingTestcases,
                        },
                    }
                }

                return testset
            }) as PreviewTestset[]
        }
    }

    context.testsets = updatedTestsets

    const scenarioMap = new Map<string, UseEvaluationRunScenarioStepsFetcherResult>()

    const runIndex = deserializeRunIndex(context.runIndex)
    const safeEvaluators = Array.isArray(context.evaluators) ? context.evaluators : []
    const safeTestsets = Array.isArray(context.testsets) ? context.testsets : []
    const safeVariants = Array.isArray(context.variants) ? context.variants : []
    const safeMappings = Array.isArray(context.mappings) ? context.mappings : context.mappings || []

    for (const [sid, stepsArr] of perScenarioSteps.entries()) {
        const core = buildScenarioCore({
            steps: stepsArr,
            runIndex: runIndex,
            evaluators: safeEvaluators,
            testsets: safeTestsets,
            variants: safeVariants,
            mappings: safeMappings,
            uriObject: context.uriObject,
            parametersByRevisionId: context.parametersByRevisionId,
            appType: appType,
        })

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
        runIndex?.invocationKeys?.has?.(s.stepKey),
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
