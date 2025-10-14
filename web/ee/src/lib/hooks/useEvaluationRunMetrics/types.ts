import {EvaluationStatus, SnakeToCamelCaseKeys} from "@/oss/lib/Types"

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
    createScenarioMetrics: (
        apiUrl: string,
        jwt: string,
        runId: string,
        entries: {
            scenarioId: string
            data: Record<string, number>
        }[],
    ) => Promise<any>
    updateMetric: (
        apiUrl: string,
        jwt: string,
        metricId: string,
        changes: {
            data?: Record<string, unknown>
            status?: string
            tags?: Record<string, unknown>
            meta?: Record<string, unknown>
        },
    ) => Promise<any>
    updateMetrics: (
        apiUrl: string,
        jwt: string,
        metrics: {
            id: string
            data?: Record<string, unknown>
            status?: string
            tags?: Record<string, unknown>
            meta?: Record<string, unknown>
        }[],
    ) => Promise<any>
    computeRunMetrics: (metrics: {data: Record<string, number>}[]) => Record<string, number>
}
