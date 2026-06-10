/**
 * API functions for evaluation results (steps).
 *
 * Fully Fern-backed (via @agenta/entities/evaluationRun). The result endpoints carry only
 * the columns the backend actually persists — notably NOT `span_id`/`references`/`data`
 * (`evaluation_results` has no such columns); the result↔trace link is `trace_id`.
 */

import {queryEvaluationResults, setEvaluationResults} from "@agenta/entities/evaluationRun"
import {projectIdAtom} from "@agenta/shared/state"
import {getDefaultStore} from "jotai"

/**
 * Convert a hex string (32 chars) to UUID format (with dashes).
 */
const hexToUuid = (hex: string): string => {
    // If already in UUID format (contains dashes), return as-is
    if (hex.includes("-")) return hex
    // If not 32 chars, return as-is (invalid hex)
    if (hex.length !== 32) return hex
    // Insert dashes at positions 8, 12, 16, 20
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export interface StepResult {
    id?: string
    run_id: string
    scenario_id: string
    step_key: string
    status: string
    trace_id?: string
    references?: Record<string, unknown>
    data?: Record<string, unknown>
}

export interface QueryResultsParams {
    runId: string
    scenarioId: string
    stepKeys?: string[]
}

/**
 * Query step results for a specific scenario.
 */
export const queryStepResults = async ({
    runId,
    scenarioId,
    stepKeys,
}: QueryResultsParams): Promise<StepResult[]> => {
    const projectId = getDefaultStore().get(projectIdAtom)
    if (!projectId) return []

    const results = await queryEvaluationResults({
        projectId,
        runId,
        scenarioIds: [scenarioId],
        stepKeys,
    })
    return results as unknown as StepResult[]
}

/**
 * Upsert a step result that links a scenario step to an annotation's trace.
 *
 * The backend setter upserts on the natural key (run_id, scenario_id, step_key,
 * repeat_idx), so a single call handles both create and edit — no `id` needed.
 *
 * `annotationSpanId` is accepted for caller compatibility but intentionally NOT sent:
 * `evaluation_results` has no `span_id` column, so the backend drops it. The persisted
 * link is `trace_id`.
 *
 * @param runId - The evaluation run ID
 * @param scenarioId - The scenario ID
 * @param stepKey - The step key (e.g., "default-xxx.evaluator-slug")
 * @param annotationTraceId - The trace ID of the annotation (hex or UUID)
 * @param annotationSpanId - The span ID of the annotation (unused; see above)
 * @param status - The step status (default: "success")
 */
export const upsertStepResultWithAnnotation = async ({
    runId,
    scenarioId,
    stepKey,
    annotationTraceId,
    status = "success",
}: {
    runId: string
    scenarioId: string
    stepKey: string
    annotationTraceId: string
    annotationSpanId: string
    status?: string
}): Promise<void> => {
    const projectId = getDefaultStore().get(projectIdAtom)
    if (!projectId) return

    // The API expects UUID format (with dashes); the annotation API returns hex.
    const traceIdUuid = hexToUuid(annotationTraceId)

    await setEvaluationResults({
        projectId,
        results: [
            {
                run_id: runId,
                scenario_id: scenarioId,
                step_key: stepKey,
                status,
                trace_id: traceIdUuid,
            },
        ],
    })
}
