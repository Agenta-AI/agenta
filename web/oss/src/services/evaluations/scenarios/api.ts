/**
 * API functions for managing evaluation scenario and run status.
 */

import axios from "@/oss/lib/api/assets/axiosConfig"
import {invalidatePreviewRunCache} from "@/oss/lib/hooks/usePreviewEvaluations/assets/previewRunBatcher"
import {getProjectValues} from "@/oss/state/project"

/**
 * Update a scenario's status.
 * This is safe because EvaluationScenarioEdit only has id and status fields,
 * so it won't overwrite any other data.
 */
export const updateScenarioStatus = async (scenarioId: string, status: string): Promise<void> => {
    const {projectId} = getProjectValues()

    await axios.patch(`/preview/evaluations/scenarios/?project_id=${projectId}`, {
        scenarios: [{id: scenarioId, status}],
    })
}

/**
 * Check if all scenarios in a run are complete and update the run status accordingly.
 * This fetches the existing run data first to avoid overwriting the data field.
 */
export const checkAndUpdateRunStatus = async (runId: string): Promise<void> => {
    const {projectId} = getProjectValues()

    try {
        // Query all scenarios for this run
        const scenariosResponse = await axios.post(
            `/preview/evaluations/scenarios/query?project_id=${projectId}`,
            {
                scenario: {run_ids: [runId]},
                windowing: {limit: 1000},
            },
        )

        const scenarios = scenariosResponse.data?.scenarios ?? []
        if (scenarios.length === 0) return

        // Terminal statuses that indicate a scenario is complete
        const terminalStatuses = new Set([
            "success",
            "error",
            "failure",
            "failed",
            "errors",
            "cancelled",
        ])

        // Check if all scenarios have terminal status
        const allComplete = scenarios.every((scenario: {status?: string}) =>
            terminalStatuses.has(scenario.status?.toLowerCase() ?? ""),
        )

        if (!allComplete) return

        // Determine run status based on scenario statuses
        const hasErrors = scenarios.some((scenario: {status?: string}) => {
            const status = scenario.status?.toLowerCase() ?? ""
            return ["error", "failure", "failed", "errors"].includes(status)
        })

        const newRunStatus = hasErrors ? "errors" : "success"

        // Fetch the existing run data first to preserve all fields
        const runResponse = await axios.post(
            `/preview/evaluations/runs/query?project_id=${projectId}`,
            {run: {ids: [runId]}},
        )

        const existingRun = runResponse.data?.runs?.[0]
        if (!existingRun) return

        // Update run status by sending the complete run object with only status changed
        await axios.patch(`/preview/evaluations/runs/${runId}`, {
            run: {...existingRun, id: runId, status: newRunStatus},
        })

        // Invalidate the preview run cache so the header refetches fresh data
        if (projectId) {
            invalidatePreviewRunCache(projectId, runId)
        }
    } catch (error) {
        console.error("[checkAndUpdateRunStatus] Failed:", error)
    }
}
