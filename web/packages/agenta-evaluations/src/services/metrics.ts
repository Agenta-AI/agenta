/**
 * Scenario metric mutation API.
 *
 * Relocated from `web/oss/src/services/runMetrics/api` (only the live export
 * survived the move — the statistics helpers there were dead code and the
 * stats types already live in `@agenta/shared/metrics`).
 */

import {axios} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {getDefaultStore} from "jotai"

const METRICS_ENDPOINT = "/evaluations/metrics/"

interface ScenarioMetricRecord {
    id?: string
    scenario_id?: string
    scenarioId?: string
    status?: string
    data?: Record<string, unknown>
}

export interface UpsertScenarioMetricDataParams {
    runId: string
    scenarioId: string
    /** Metric data to store (stepKey -> metricKey -> metricData) */
    data: Record<string, Record<string, unknown>>
}

/**
 * Create or update scenario-level metrics.
 *
 * Queries existing metrics for the scenario, merges the new data on top, then
 * PATCHes the existing metric or POSTs a new one.
 */
export const upsertScenarioMetricData = async ({
    runId,
    scenarioId,
    data,
}: UpsertScenarioMetricDataParams): Promise<unknown> => {
    const projectId = getDefaultStore().get(projectIdAtom)
    if (!projectId) return null

    // First, query existing metrics for this scenario
    let existingMetric: ScenarioMetricRecord | undefined
    try {
        const queryResponse = await axios.post(
            `${METRICS_ENDPOINT}query`,
            {
                metrics: {
                    run_ids: [runId],
                    scenario_ids: [scenarioId],
                },
                windowing: {},
            },
            {params: {project_id: projectId}},
        )

        const existingMetrics: ScenarioMetricRecord[] = Array.isArray(queryResponse?.data?.metrics)
            ? queryResponse.data.metrics
            : []
        existingMetric = existingMetrics.find(
            (m) => (m?.scenario_id || m?.scenarioId) === scenarioId,
        )
    } catch (error) {
        console.warn("[upsertScenarioMetricData] Failed to query existing metrics", error)
    }

    // Merge new data with existing data
    const mergedData = {
        ...(existingMetric?.data || {}),
        ...data,
    }

    // Update existing or create new
    if (existingMetric?.id) {
        return axios.patch(
            METRICS_ENDPOINT,
            {
                metrics: [
                    {
                        id: existingMetric.id,
                        data: mergedData,
                        status: existingMetric.status || "success",
                    },
                ],
            },
            {params: {project_id: projectId}},
        )
    }

    return axios.post(
        METRICS_ENDPOINT,
        {
            metrics: [
                {
                    run_id: runId,
                    scenario_id: scenarioId,
                    data: mergedData,
                    status: "success",
                },
            ],
        },
        {params: {project_id: projectId}},
    )
}
