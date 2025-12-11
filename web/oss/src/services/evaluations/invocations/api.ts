/**
 * API functions for running invocations in evaluation scenarios.
 * These functions handle running an app revision with stable parameters
 * and updating step results with the invocation response.
 */

import axios from "@/oss/lib/api/assets/axiosConfig"
import {EvaluationStatus} from "@/oss/lib/Types"
import {getProjectValues} from "@/oss/state/project"

import {queryStepResults} from "../results/api"

const RESULTS_ENDPOINT = "/preview/evaluations/results/"

export interface InvocationReferences {
    application?: {id: string}
    application_variant?: {id: string}
    application_revision?: {id: string}
}

export interface RunInvocationParams {
    /** The evaluation run ID */
    runId: string
    /** The scenario ID */
    scenarioId: string
    /** The step key for the invocation (e.g., "variant-name-xxx") */
    stepKey: string
    /** The app's runtime URL (e.g., "https://app.agenta.ai/variant/xxx") */
    appUrl: string
    /** The application ID */
    appId: string
    /** The request body to send to the app (transformed parameters + inputs) */
    requestBody: Record<string, any>
    /** References to store in the step result */
    references?: InvocationReferences
}

export interface InvocationResult {
    success: boolean
    response?: any
    error?: string
    traceId?: string
    spanId?: string
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
 * Run an invocation for a scenario and update the step result.
 *
 * This function:
 * 1. Calls the app's /test endpoint with the request body
 * 2. Extracts trace_id and span_id from the response
 * 3. Updates or creates the step result with the invocation response
 *
 * @param params - The invocation parameters
 * @returns The invocation result with success status and response data
 */
export const runInvocation = async (params: RunInvocationParams): Promise<InvocationResult> => {
    const {runId, scenarioId, stepKey, appUrl, appId, requestBody, references} = params
    const {projectId} = getProjectValues()

    if (!projectId) {
        return {success: false, error: "Project ID is required"}
    }

    try {
        // 1. Call the app's /test endpoint
        const testUrl = `${appUrl}/test`
        const queryParams = new URLSearchParams({
            application_id: appId,
            project_id: projectId,
        })

        const response = await axios.post(`${testUrl}?${queryParams.toString()}`, requestBody, {
            headers: {
                "Content-Type": "application/json",
                "ngrok-skip-browser-warning": "1",
            },
        })

        // 2. Extract trace_id and span_id from the response
        // The response may contain trace info in different locations
        const responseData = response.data
        const traceId =
            responseData?.trace_id ||
            responseData?.traceId ||
            responseData?.tree?.nodes?.[0]?.trace_id ||
            responseData?.tree?.trace_id
        const spanId =
            responseData?.span_id ||
            responseData?.spanId ||
            responseData?.tree?.nodes?.[0]?.span_id ||
            responseData?.tree?.span_id

        // 3. Update or create the step result
        await upsertStepResultWithInvocation({
            runId,
            scenarioId,
            stepKey,
            traceId,
            spanId,
            status: "success",
            references,
        })

        return {
            success: true,
            response: responseData,
            traceId,
            spanId,
        }
    } catch (error: any) {
        console.error("[runInvocation] Error:", error)

        // Extract error message from various response formats
        const extractErrorMessage = (err: any): string => {
            const detail = err?.response?.data?.detail
            // Handle nested detail object with message property
            if (detail && typeof detail === "object" && detail.message) {
                return detail.message
            }
            // Handle array of validation errors
            if (Array.isArray(detail)) {
                return detail.map((d: any) => d.msg || d.message || JSON.stringify(d)).join("; ")
            }
            // Handle string detail
            if (typeof detail === "string") {
                return detail
            }
            // Fallback to error message
            return err?.message || "Unknown error occurred"
        }

        const errorMessage = extractErrorMessage(error)

        // Update step result with failure status and error details
        try {
            await upsertStepResultWithInvocation({
                runId,
                scenarioId,
                stepKey,
                status: "failure",
                references,
                error: {
                    message: errorMessage,
                    stacktrace: error?.response?.data?.detail?.stacktrace || error?.stack,
                },
            })

            // Update scenario status to failure
            await updateScenarioStatus(scenarioId, EvaluationStatus.FAILURE)
        } catch (updateError) {
            console.error("[runInvocation] Failed to update step result with error:", updateError)
        }

        return {
            success: false,
            error: errorMessage,
        }
    }
}

/**
 * Upsert a step result with invocation reference.
 */
const upsertStepResultWithInvocation = async ({
    runId,
    scenarioId,
    stepKey,
    traceId,
    spanId,
    status,
    references,
    error,
}: {
    runId: string
    scenarioId: string
    stepKey: string
    traceId?: string
    spanId?: string
    status: string
    references?: InvocationReferences
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

    const resultPayload: Record<string, any> = {
        status,
    }

    if (traceIdUuid) {
        resultPayload.trace_id = traceIdUuid
    }
    if (spanIdUuid) {
        resultPayload.span_id = spanIdUuid
    }
    if (error) {
        resultPayload.error = error
    }

    if (existingResult?.id) {
        // Update existing result
        await axios.patch(`${RESULTS_ENDPOINT}?project_id=${projectId}`, {
            results: [
                {
                    id: existingResult.id,
                    ...resultPayload,
                },
            ],
        })
    } else {
        // Create new result
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
const updateScenarioStatus = async (
    scenarioId: string,
    status: EvaluationStatus,
): Promise<void> => {
    const {projectId} = getProjectValues()

    try {
        await axios.patch(`/preview/evaluations/scenarios/?project_id=${projectId}`, {
            scenarios: [{id: scenarioId, status}],
        })
    } catch (error) {
        console.error("[updateScenarioStatus] Failed to update scenario status:", error)
    }
}

/**
 * Check if all scenarios in a run are complete and update the run status accordingly.
 * A run is considered complete when all its scenarios have a terminal status (success, error, failure).
 */
const _checkAndUpdateRunStatus = async (runId: string): Promise<void> => {
    const {projectId} = getProjectValues()

    try {
        // Query all scenarios for this run
        const scenariosResponse = await axios.post(
            `/preview/evaluations/scenarios/query?project_id=${projectId}`,
            {
                scenario: {run_ids: [runId]},
                windowing: {limit: 1000}, // Get all scenarios
            },
        )

        const scenarios = scenariosResponse.data?.scenarios ?? []

        if (scenarios.length === 0) {
            return
        }

        // Terminal statuses that indicate a scenario is complete
        const terminalStatuses = new Set([
            EvaluationStatus.SUCCESS,
            EvaluationStatus.ERROR,
            EvaluationStatus.FINISHED,
            EvaluationStatus.FINISHED_WITH_ERRORS,
            EvaluationStatus.FAILURE,
            EvaluationStatus.FAILED,
            EvaluationStatus.ERRORS,
            EvaluationStatus.CANCELLED,
            // Also check string values in case API returns different format
            "success",
            "error",
            "failure",
            "failed",
            "errors",
            "cancelled",
            "EVALUATION_FINISHED",
            "EVALUATION_FINISHED_WITH_ERRORS",
            "EVALUATION_FAILED",
        ])

        // Check if all scenarios have terminal status
        const allComplete = scenarios.every((scenario: {status?: string}) =>
            terminalStatuses.has(scenario.status ?? ""),
        )

        if (!allComplete) {
            return
        }

        // Determine run status based on scenario statuses
        const hasErrors = scenarios.some(
            (scenario: {status?: string}) =>
                scenario.status === EvaluationStatus.ERROR ||
                scenario.status === EvaluationStatus.FAILURE ||
                scenario.status === EvaluationStatus.FAILED ||
                scenario.status === EvaluationStatus.ERRORS ||
                scenario.status === "error" ||
                scenario.status === "failure" ||
                scenario.status === "failed" ||
                scenario.status === "errors" ||
                scenario.status === "EVALUATION_FAILED",
        )

        const runStatus = hasErrors
            ? EvaluationStatus.FINISHED_WITH_ERRORS
            : EvaluationStatus.FINISHED

        // Update run status
        await axios.patch(`/preview/evaluations/runs/${runId}?project_id=${projectId}`, {
            run: {id: runId, status: runStatus},
        })

        console.log(`[checkAndUpdateRunStatus] Run ${runId} status updated to ${runStatus}`)
    } catch (error) {
        console.error("[checkAndUpdateRunStatus] Failed to check/update run status:", error)
    }
}
