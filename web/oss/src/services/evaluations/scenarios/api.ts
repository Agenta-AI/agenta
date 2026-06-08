/**
 * API functions for managing evaluation scenario and run status.
 *
 * Fully Fern-backed via @agenta/entities (evaluationRun + evaluationScenario).
 */

import {editEvaluationRun, queryEvaluationRuns} from "@agenta/entities/evaluationRun"
import {
    queryEvaluationScenarios,
    setEvaluationScenarioStatuses,
} from "@agenta/entities/evaluationScenario"

import {getProjectValues} from "@/oss/state/project"

/**
 * Update a scenario's status.
 *
 * Safe because the backend's scenario edit only carries id + status, so it can't
 * overwrite scenario data.
 */
export const updateScenarioStatus = async (scenarioId: string, status: string): Promise<void> => {
    const {projectId} = getProjectValues()
    if (!projectId) return

    await setEvaluationScenarioStatuses({
        projectId,
        scenarios: [{id: scenarioId, status}],
    })
}

/**
 * Check if all scenarios in a run are complete and update the run status accordingly.
 * Fetches the existing run first so the status edit preserves all other fields.
 */
export const checkAndUpdateRunStatus = async (runId: string): Promise<void> => {
    const {projectId} = getProjectValues()
    if (!projectId) return

    try {
        const scenarios = await queryEvaluationScenarios({projectId, runId})
        if (scenarios.length === 0) return

        // Terminal statuses that indicate a scenario is complete.
        const terminalStatuses = new Set([
            "success",
            "error",
            "failure",
            "failed",
            "errors",
            "cancelled",
        ])

        const allComplete = scenarios.every((scenario) =>
            terminalStatuses.has(scenario.status?.toLowerCase() ?? ""),
        )
        if (!allComplete) return

        const hasErrors = scenarios.some((scenario) => {
            const status = scenario.status?.toLowerCase() ?? ""
            return ["error", "failure", "failed", "errors"].includes(status)
        })

        const newRunStatus = hasErrors ? "errors" : "success"

        // Fetch the existing run so the PATCH preserves all fields (status edit only).
        const {runs} = await queryEvaluationRuns({projectId, ids: [runId]})
        const existingRun = runs[0]
        if (!existingRun) return

        await editEvaluationRun({
            projectId,
            runId,
            run: {...(existingRun as Record<string, unknown>), id: runId, status: newRunStatus},
        })
    } catch (error) {
        console.error("[checkAndUpdateRunStatus] Failed:", error)
    }
}
