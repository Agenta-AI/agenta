import {EvaluationStatus, SnakeToCamelCaseKeys} from "@/oss/lib/Types"
import type {
    computeRunMetrics,
    createScenarioMetrics,
    updateMetric,
    updateMetrics,
} from "@/oss/services/runMetrics/api"

// Raw API response type for one metric (snake_case)
export interface MetricResponse {
    id: string
    run_id: string
    scenario_id?: string
    status?: EvaluationStatus
    data: {
        outputs: Record<string, unknown>
    }
    created_at?: string
    // …other fields in snake_case if backend adds more…
}

// CamelCased version of MetricResponse
export type Metric = SnakeToCamelCaseKeys<MetricResponse>

// Options for fetching metrics (pagination & filters)
export interface UseEvaluationRunMetricsOptions {
    limit?: number
    next?: string
    scenarioIds?: string[]
    statuses?: string[]
}

// Result returned by useEvaluationRunMetrics hook
export interface UseEvaluationRunMetricsResult {
    metrics: Metric[] | undefined
    count?: number
    next?: string
    isLoading: boolean
    isError: boolean
    swrData: import("swr").SWRResponse<
        {
            metrics: MetricResponse[]
            count: number
            next?: string
        },
        any
    >
    mutate: () => Promise<any>
    // Mirror the actual service signatures (the hook re-exports them verbatim).
    createScenarioMetrics: typeof createScenarioMetrics
    updateMetric: typeof updateMetric
    updateMetrics: typeof updateMetrics
    computeRunMetrics: typeof computeRunMetrics
}
