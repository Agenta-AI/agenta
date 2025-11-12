import {useMemo} from "react"

import useSWR from "swr"

import {
    METRICS_ENDPOINT,
    createScenarioMetrics,
    updateMetric,
    updateMetrics,
    computeRunMetrics,
} from "@/oss/services/runMetrics/api"

import {fetcher} from "./assets/utils"
import type {
    MetricResponse,
    Metric,
    UseEvaluationRunMetricsOptions,
    UseEvaluationRunMetricsResult,
} from "./types"

/**
 * Hook to fetch and create metrics for a specific evaluation run (and optionally scenario).
 *
 * @param runId      The UUID of the evaluation run. If falsy, fetching is skipped.
 * @param options    Optional filters/pagination: { limit, next, scenarioIds, statuses }.
 */
const useEvaluationRunMetrics = (
    runIds: string | string[] | null | undefined,
    scenarioId?: string | null,
    options?: UseEvaluationRunMetricsOptions,
): UseEvaluationRunMetricsResult => {
    // Build query parameters
    const queryParams = new URLSearchParams()

    // Append one or many run_ids query params
    if (runIds) {
        if (Array.isArray(runIds) && runIds.length > 0) {
            // Ensure deterministic ordering for SWR key stability
            const sorted = [...runIds].sort()
            sorted.forEach((id) => queryParams.append("run_ids", id))
        } else {
            queryParams.append("run_ids", runIds)
        }
    }
    if (options?.limit !== undefined) {
        queryParams.append("limit", options.limit.toString())
    }
    if (options?.next) {
        queryParams.append("next", options.next)
    }
    if (scenarioId) {
        queryParams.append("scenario_ids", scenarioId)
    } else if (options?.scenarioIds) {
        options.scenarioIds.forEach((sid) => queryParams.append("scenario_ids", sid))
    }
    if (options?.statuses) {
        options.statuses.forEach((st) => queryParams.append("status", st))
    }

    const swrKey = useMemo(() => {
        const queryRunIds = queryParams.getAll("run_ids").filter((a) => a !== "undefined" && !!a)
        const queryScenarioIds = queryParams
            .getAll("scenario_ids")
            .filter((a) => a !== "undefined" && !!a)

        return queryRunIds.length > 0 || queryScenarioIds.length > 0
            ? `${METRICS_ENDPOINT}?${queryParams.toString()}`
            : null
    }, [queryParams])

    // SWR response typed to raw MetricResponse[]
    const swrData = useSWR<{
        metrics: MetricResponse[]
        count: number
        next?: string
    }>(swrKey, fetcher)

    // Convert raw MetricResponse[] to camelCase Metric[]
    const rawMetrics = swrData.data?.metrics
    const camelMetrics: Metric[] | undefined = rawMetrics
        ? rawMetrics.map((item) => item)
        : undefined

    const totalCount = swrData.data?.count
    const nextToken = swrData.data?.next

    return {
        get metrics() {
            return camelMetrics
        },
        get count() {
            return totalCount
        },
        get next() {
            return nextToken
        },
        get isLoading() {
            return !swrData.error && !swrData.data
        },
        get isError() {
            return !!swrData.error
        },
        swrData,
        mutate: () => swrData.mutate(),
        createScenarioMetrics,
        updateMetric,
        updateMetrics,
        computeRunMetrics,
    }
}

export default useEvaluationRunMetrics
