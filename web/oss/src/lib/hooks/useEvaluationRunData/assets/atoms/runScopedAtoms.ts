import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithImmer} from "jotai-immer"

import {UseEvaluationRunScenarioStepsFetcherResult} from "../../../useEvaluationRunScenarioSteps/types"
import {EvaluationRunState} from "../../types"
import {initialState} from "../constants"
import type {BasicStats} from "../types"

/**
 * Run-scoped atom families
 *
 * These atoms replace the global atoms that were previously tied to a single "active" run.
 * Each atom family is keyed by runId, allowing multiple evaluation runs to coexist
 * without interfering with each other.
 */

// Core evaluation run state - replaces global evaluationRunStateAtom
export const evaluationRunStateFamily = atomFamily((runId: string) => {
    if (runId === undefined || runId === null || runId === "") {
        console.error(`[evaluationRunStateFamily] ERROR: Invalid runId received: ${runId}`)
        console.trace("Stack trace for invalid runId:")
    }
    return atomWithImmer<EvaluationRunState>(initialState)
}, deepEqual)

// Bulk fetch status - replaces global bulkStepsStatusAtom
export const bulkStepsStatusFamily = atomFamily(
    (runId: string) => atom<"idle" | "loading" | "done" | "error">("idle"),
    deepEqual,
)

// Bulk fetch cache - replaces global bulkStepsCacheAtom
export const bulkStepsCacheFamily = atomFamily(
    (runId: string) => atom<Map<string, UseEvaluationRunScenarioStepsFetcherResult>>(new Map()),
    deepEqual,
)

// Bulk fetch requested flag - for tracking if bulk fetch has been initiated
export const bulkStepsRequestedFamily = atomFamily((runId: string) => atom(false), deepEqual)

// Bulk started flag - guard so init fires once per run
export const bulkStartedFamily = atomFamily((runId: string) => atom(false), deepEqual)

// Derived atoms that depend on run state
export const enrichedRunFamily = atomFamily(
    (runId: string) => atom((get) => get(evaluationRunStateFamily(runId)).enrichedRun),
    deepEqual,
)

export const runIndexFamily = atomFamily(
    (runId: string) => atom((get) => get(evaluationRunStateFamily(runId)).runIndex),
    deepEqual,
)

export const evaluationRunIdFamily = atomFamily(
    (runId: string) =>
        atom(() => {
            // Use runId directly since it's the identifier we need
            return runId
        }),
    deepEqual,
)

// Loading state family - replaces global loadingStateAtom
export const loadingStateFamily = atomFamily(
    (runId: string) =>
        atomWithImmer({
            isLoadingEvaluation: false,
            isLoadingScenarios: false,
            isLoadingMetrics: false,
            isRefreshingMetrics: false,
            activeStep: null as string | null,
        }),
    deepEqual,
)

// Run-scoped metric atom families - replaces global metric atoms
export const runMetricsRefreshFamily = atomFamily((runId: string) => atom(0), deepEqual)

export const runMetricsCacheFamily = atomFamily((runId: string) => atom<any[]>([]), deepEqual)

export const runMetricsStatsCacheFamily = atomFamily(
    (runId: string) => atom<Record<string, BasicStats>>({}),
    deepEqual,
)

/**
 * Helper type for accessing all run-scoped atoms for a specific run
 */
export interface RunScopedAtoms {
    runId: string
    evaluationRunState: ReturnType<typeof evaluationRunStateFamily>
    bulkStepsStatus: ReturnType<typeof bulkStepsStatusFamily>
    bulkStepsCache: ReturnType<typeof bulkStepsCacheFamily>
    bulkStepsRequested: ReturnType<typeof bulkStepsRequestedFamily>
    bulkStarted: ReturnType<typeof bulkStartedFamily>
    enrichedRun: ReturnType<typeof enrichedRunFamily>
    runIndex: ReturnType<typeof runIndexFamily>
    evaluationRunId: ReturnType<typeof evaluationRunIdFamily>
    loadingState: ReturnType<typeof loadingStateFamily>
    runMetricsRefresh: ReturnType<typeof runMetricsRefreshFamily>
    runMetricsCache: ReturnType<typeof runMetricsCacheFamily>
    runMetricsStatsCache: ReturnType<typeof runMetricsStatsCacheFamily>
}
