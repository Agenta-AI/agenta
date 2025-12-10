/**
 * API functions for evaluation results (steps).
 * These functions use axios with automatic project ID injection.
 */

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getProjectValues} from "@/oss/state/project"

const RESULTS_ENDPOINT = "/preview/evaluations/results/"

/**
 * Convert a hex string (32 chars) to UUID format (with dashes)
 */
const hexToUuid = (hex: string): string => {
    // If already in UUID format (contains dashes), return as-is
    if (hex.includes("-")) return hex
    // If not 32 chars, return as-is (invalid hex)
    if (hex.length !== 32) return hex
    // Insert dashes at positions 8, 12, 16, 20
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Convert a hex span ID (16 chars) to UUID format by doubling it.
 * e.g., "912e71fb57cb9c62" -> "912e71fb-57cb-9c62-912e-71fb57cb9c62"
 */
const spanHexToUuid = (hex: string): string => {
    // If already in UUID format (contains dashes), return as-is
    if (hex.includes("-")) return hex
    // If 16 chars (span hex), double it to make 32 chars
    if (hex.length === 16) {
        const doubled = hex + hex
        return `${doubled.slice(0, 8)}-${doubled.slice(8, 12)}-${doubled.slice(12, 16)}-${doubled.slice(16, 20)}-${doubled.slice(20)}`
    }
    // If 32 chars, convert to UUID
    if (hex.length === 32) {
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    }
    return hex
}

export interface StepResult {
    id?: string
    run_id: string
    scenario_id: string
    step_key: string
    status: string
    trace_id?: string
    span_id?: string
    references?: Record<string, any>
    data?: Record<string, any>
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
    const {projectId} = getProjectValues()

    const response = await axios.post(`${RESULTS_ENDPOINT}query?project_id=${projectId}`, {
        result: {
            run_ids: [runId],
            scenario_ids: [scenarioId],
            ...(stepKeys?.length ? {step_keys: stepKeys} : {}),
        },
        windowing: {},
    })

    const data = response.data
    return Array.isArray(data.results) ? data.results : Array.isArray(data.steps) ? data.steps : []
}

/**
 * Update step results (PATCH).
 */
export const updateStepResults = async (results: Partial<StepResult>[]): Promise<any> => {
    const {projectId} = getProjectValues()

    return axios.patch(`${RESULTS_ENDPOINT}?project_id=${projectId}`, {
        results,
    })
}

/**
 * Create step results (POST).
 */
export const createStepResults = async (results: StepResult[]): Promise<any> => {
    const {projectId} = getProjectValues()

    return axios.post(`${RESULTS_ENDPOINT}?project_id=${projectId}`, {
        results,
    })
}

/**
 * Upsert a step result with annotation reference.
 * This function queries for an existing step result and either updates it or creates a new one.
 *
 * @param runId - The evaluation run ID
 * @param scenarioId - The scenario ID
 * @param stepKey - The step key (e.g., "default-xxx.evaluator-slug")
 * @param annotationTraceId - The trace ID of the annotation
 * @param annotationSpanId - The span ID of the annotation
 * @param status - The step status (default: "success")
 */
export const upsertStepResultWithAnnotation = async ({
    runId,
    scenarioId,
    stepKey,
    annotationTraceId,
    annotationSpanId,
    status = "success",
}: {
    runId: string
    scenarioId: string
    stepKey: string
    annotationTraceId: string
    annotationSpanId: string
    status?: string
}): Promise<void> => {
    const {projectId} = getProjectValues()

    // Convert hex IDs to UUID format (the API expects UUIDs with dashes)
    // Annotation API returns hex format: "<annotation_trace_id_hex>"
    // Step result API expects UUID format: "<annotation_trace_id_uuid>"
    const traceIdUuid = hexToUuid(annotationTraceId)
    const spanIdUuid = spanHexToUuid(annotationSpanId)

    console.log("[upsertStepResultWithAnnotation] Input:", {
        runId,
        scenarioId,
        stepKey,
        annotationTraceId,
        annotationSpanId,
        traceIdUuid,
        spanIdUuid,
        status,
    })

    // Query for existing step result
    let existingResult: StepResult | null = null
    try {
        const results = await queryStepResults({runId, scenarioId, stepKeys: [stepKey]})
        console.log("[upsertStepResultWithAnnotation] Query results:", results)
        existingResult =
            results.find((r) => r.step_key === stepKey || (r as any).stepKey === stepKey) || null
        console.log("[upsertStepResultWithAnnotation] Found existing:", existingResult)
    } catch (err) {
        console.error("[upsertStepResultWithAnnotation] Query error:", err)
        // Ignore query errors, will create new result
    }

    if (existingResult?.id) {
        // Update existing result - only send trace_id and span_id (no references wrapper)
        console.log("[upsertStepResultWithAnnotation] Updating existing result:", {
            id: existingResult.id,
            status,
            trace_id: traceIdUuid,
            span_id: spanIdUuid,
        })
        const response = await axios.patch(`${RESULTS_ENDPOINT}?project_id=${projectId}`, {
            results: [
                {
                    id: existingResult.id,
                    status,
                    trace_id: traceIdUuid,
                    span_id: spanIdUuid,
                },
            ],
        })
        console.log("[upsertStepResultWithAnnotation] Update response:", response.data)
    } else {
        // Create new result - only send trace_id and span_id (no references wrapper)
        console.log("[upsertStepResultWithAnnotation] Creating new result:", {
            run_id: runId,
            scenario_id: scenarioId,
            step_key: stepKey,
            status,
            trace_id: traceIdUuid,
            span_id: spanIdUuid,
        })
        const response = await axios.post(`${RESULTS_ENDPOINT}?project_id=${projectId}`, {
            results: [
                {
                    run_id: runId,
                    scenario_id: scenarioId,
                    step_key: stepKey,
                    status,
                    trace_id: traceIdUuid,
                    span_id: spanIdUuid,
                },
            ],
        })
        console.log("[upsertStepResultWithAnnotation] Create response:", response.data)
    }
}
