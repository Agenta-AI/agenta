/**
 * API helpers for persisting invocation results in evaluation scenarios.
 *
 * Note: The actual HTTP invocation is now handled by `executeWorkflowRevision`
 * from `@agenta/playground`, which uses the full playground execution
 * infrastructure (workflowMolecule URL resolution, concurrency limiting, etc.).
 *
 * This module provides only the persistence helpers that write trace/span
 * references and status updates back to the evaluation API.
 */

import axios from "@/oss/lib/api/assets/axiosConfig"
import {EvaluationStatus} from "@/oss/lib/Types"
import {getProjectValues} from "@/oss/state/project"

import {queryStepResults} from "../results/api"

const RESULTS_ENDPOINT = "/evaluations/results/"

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
 * Convert a hex span ID (16 chars) to UUID format by doubling it.
 */
const spanHexToUuid = (hex: string): string => {
    if (hex.includes("-")) return hex
    if (hex.length === 16) {
        const doubled = hex + hex
        return `${doubled.slice(0, 8)}-${doubled.slice(8, 12)}-${doubled.slice(12, 16)}-${doubled.slice(16, 20)}-${doubled.slice(20)}`
    }
    if (hex.length === 32) {
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    }
    return hex
}

/**
 * Upsert a step result with invocation trace/span reference and status.
 */
export const upsertStepResultWithInvocation = async ({
    runId,
    scenarioId,
    stepKey,
    traceId,
    spanId,
    status,
    references,
    outputs,
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
    const {projectId} = getProjectValues()

    // Convert hex IDs to UUID format if provided
    const traceIdUuid = traceId ? hexToUuid(traceId) : undefined
    const spanIdUuid = spanId ? spanHexToUuid(spanId) : undefined

    // Query for existing step result
    let existingResult: any = null
    try {
        const results = await queryStepResults({runId, scenarioId, stepKeys: [stepKey]})
        existingResult =
            results.find((r) => r.step_key === stepKey || (r as any).stepKey === stepKey) || null
    } catch {
        // Ignore query errors, will create new result
    }

    const resultPayload: Record<string, any> = {status}

    if (traceIdUuid) {
        resultPayload.trace_id = traceIdUuid
    }
    if (spanIdUuid) {
        resultPayload.span_id = spanIdUuid
    }
    if (references) {
        resultPayload.references = references
    }
    if (outputs !== undefined) {
        resultPayload.outputs = outputs
    }
    if (error) {
        resultPayload.error = error
    }

    if (existingResult?.id) {
        await axios.patch(`${RESULTS_ENDPOINT}?project_id=${projectId}`, {
            results: [{id: existingResult.id, ...resultPayload}],
        })
    } else {
        await axios.post(`${RESULTS_ENDPOINT}?project_id=${projectId}`, {
            results: [
                {
                    run_id: runId,
                    scenario_id: scenarioId,
                    step_key: stepKey,
                    ...resultPayload,
                },
            ],
        })
    }
}

/**
 * Update a scenario's status.
 */
export const updateScenarioStatus = async (
    scenarioId: string,
    status: EvaluationStatus,
): Promise<void> => {
    const {projectId} = getProjectValues()

    try {
        await axios.patch(`/evaluations/scenarios/?project_id=${projectId}`, {
            scenarios: [{id: scenarioId, status}],
        })
    } catch (error) {
        console.error("[updateScenarioStatus] Failed to update scenario status:", error)
    }
}
