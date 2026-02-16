import {EvaluationStatus, PreviewTestset, WorkspaceMember} from "@/oss/lib/Types"

import {Evaluation} from "../../Types"
import type {Metric} from "../useEvaluationRunMetrics/types"
import type {IScenario} from "../useEvaluationRunScenarios/types"
import type {
    IStepResponse,
    UseEvaluationRunScenarioStepsFetcherResult,
} from "../useEvaluationRunScenarioSteps/types"
import {EvaluatorDto} from "../useEvaluators/types"
import type {EnrichedEvaluationRun, EvaluationRun} from "../usePreviewEvaluations/types"

import {RunIndex} from "./assets/helpers/buildRunIndex"

export interface ScenarioStatus {
    status:
        | "pending"
        | "running"
        | "revalidating"
        | "success"
        | "error"
        | "cancelled"
        | "done"
        | "failed"
    result?: {
        data?: unknown
    }
    error?: string
}

export interface ScenarioStatusCounts {
    total: number
    pending: number
    running: number
    done: number
    success: number
    failed: number
    cancelled: number
}

export type ScenarioStatusMap = Record<string, ScenarioStatus>

export interface IStatusMeta {
    total: number
    completed: number
    pending: number
    inProgress: number
    error: number
    cancelled: number
    success: number
    percentComplete: number
    statusSummary: Record<string, number>
    timeline: {scenarioId: string; status: string}[]
    timestamps: Record<string, {startedAt?: number; endedAt?: number}>
    transitions: Record<string, {status: string; timestamp: number}[]>
    durations: Record<string, number | undefined>
    statusDurations: Record<string, Record<string, number>>
}

export interface EvaluationRunState {
    rawRun?: EvaluationRun | Evaluation
    isPreview?: boolean
    enrichedRun?: EnrichedEvaluationRun
    /** Whether this evaluation is being used for comparison */
    isComparison?: boolean
    /** Whether this is the base evaluation being compared against */
    isBase?: boolean
    /** Position in comparison view (1 for base, 2+ for comparisons) */
    compareIndex?: number
    /** Stable color index used for UI styling independent of baseline swaps */
    colorIndex?: number
    scenarios?: IScenario[]
    /** Summary of scenario statuses and timings */
    statusMeta: IStatusMeta
    steps?: {
        inputStep?: IStepResponse
        invocationStep?: IStepResponse
        annotationSteps?: IStepResponse[]
        mainInputParams: any
        secondaryInputParams: any
        scenarioIndex: string
        count: number
        next?: string
    }
    metrics?: {
        data: Metric[]
        count: number
        next?: string
    }
    isLoading: {run: boolean; scenarios: boolean; steps: boolean; metrics: boolean}
    isError: {run: boolean; scenarios: boolean; steps: boolean; metrics: boolean}
    /**
     * Map of scenarioId to scenario steps and related data
     */
    scenarioSteps?: Record<string, UseEvaluationRunScenarioStepsFetcherResult>
    /** Pre-computed index of steps and mappings for this run */
    runIndex?: import("./assets/helpers/buildRunIndex").RunIndex
}

export type LoadingStep = "eval-run" | "scenarios" | "scenario-steps" | null
export interface ScenarioStepProgress {
    completed: number
    total: number
    percent: number
}

export interface EvaluationLoadingState {
    isLoadingEvaluation: boolean
    isLoadingScenarios: boolean
    isLoadingSteps: boolean
    isLoadingMetrics: boolean
    isRefreshingMetrics: boolean
    activeStep: LoadingStep
    scenarioStepProgress: ScenarioStepProgress
}

export interface OptimisticScenarioOverride {
    status: EvaluationStatus
    /**
     * UI-only status used to indicate intermediate states like
     * "revalidating" or "annotating" that are not recognised by the backend
     */
    uiStatus?: "revalidating" | "annotating"
    result?: any
}

export interface EvalRunDataContextType {
    runId: string
    mappings: any
    members: WorkspaceMember[]
    evaluators: EvaluatorDto[]
    testsets: PreviewTestset[]
    variants: any[]
    /**
     * Given an array of scenario IDs, fetches step data for each, and then
     * enriches each step list with inputStep, invocationStep, trace, annotationSteps,
     * and invocationParameters. Caches the results in `bulkStepsCacheAtom`.
     *
     * @param scenarioIds array of scenario IDs
     * @param context the `EvalRunDataContextType` object containing runId, mappings, members, evaluators, testsets, and variants
     * @param set the jotai `set` callback
     */
    runIndex?: RunIndex
}
