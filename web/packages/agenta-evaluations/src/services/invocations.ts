/**
 * API helpers for persisting invocation results in evaluation scenarios.
 *
 * Note: The actual HTTP invocation is now handled by `executeWorkflowRevision`
 * from `@agenta/playground`, which uses the full playground execution
 * infrastructure (workflowMolecule URL resolution, concurrency limiting, etc.).
 *
 * This module provides only the persistence helpers that write trace references and
 * status updates back to the evaluation API (Fern-backed via @agenta/entities).
 */

import {setEvaluationResults} from "@agenta/entities/evaluationRun"
import {EvaluationStatus} from "@agenta/entities/evaluationRun"
import {setEvaluationScenarioStatuses} from "@agenta/entities/evaluationScenario"
import {projectIdAtom} from "@agenta/shared/state"
import {getDefaultStore} from "jotai"

export interface InvocationReferences {
    application?: {id: string}
    application_variant?: {id: string}
    application_revision?: {id: string}
}

/**
 * Convert a hex string (32 chars) to UUID format (with dashes).
 */
const hexToUuid = (hex: string): string => {
    if (hex.includes("-")) return hex
    if (hex.length !== 32) return hex
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Upsert a step result with invocation trace reference + status.
 *
 * `spanId`, `references`, and `outputs` are accepted for caller compatibility but NOT
 * persisted — `evaluation_results` has no such columns (the backend drops them). The
 * persisted link is `trace_id`; `error` and `status` are real columns.
 */
export const upsertStepResultWithInvocation = async ({
    runId,
    scenarioId,
    stepKey,
    traceId,
    status,
    error,
}: {
    runId: string
    scenarioId: string
    stepKey: string
    traceId?: string
    spanId?: string
    status: string
    references?: InvocationReferences
    outputs?: unknown
    error?: {message: string; stacktrace?: string}
}): Promise<void> => {
    const projectId = getDefaultStore().get(projectIdAtom)
    if (!projectId) return

    await setEvaluationResults({
        projectId,
        results: [
            {
                run_id: runId,
                scenario_id: scenarioId,
                step_key: stepKey,
                status,
                ...(traceId ? {trace_id: hexToUuid(traceId)} : {}),
                ...(error ? {error: error as Record<string, unknown>} : {}),
            },
        ],
    })
}

/**
 * Update a scenario's status.
 */
export const updateScenarioStatus = async (
    scenarioId: string,
    status: EvaluationStatus,
): Promise<void> => {
    const projectId = getDefaultStore().get(projectIdAtom)
    if (!projectId) return

    try {
        await setEvaluationScenarioStatuses({
            projectId,
            scenarios: [{id: scenarioId, status}],
        })
    } catch (error) {
        console.error("[updateScenarioStatus] Failed to update scenario status:", error)
    }
}
