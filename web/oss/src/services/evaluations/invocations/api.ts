/**
 * API functions for running invocations in evaluation scenarios.
 * These functions handle running an app revision with stable parameters
 * and updating step results with the invocation response.
 */

import axios from "@/oss/lib/api/assets/axiosConfig"
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

        // NOTE: Do NOT update scenario status here - invocation success means the scenario
        // is still pending annotation. Scenario status will be updated to "success" only
        // after the annotation is saved.

        return {
            success: true,
            response: responseData,
            traceId,
            spanId,
        }
    } catch (error: any) {
        console.error("[runInvocation] Error:", error)

        // Update step result with error status
        try {
            await upsertStepResultWithInvocation({
                runId,
                scenarioId,
                stepKey,
                status: "error",
                references,
            })
        } catch (updateError) {
            console.error("[runInvocation] Failed to update step result with error:", updateError)
        }

        return {
            success: false,
            error: error?.response?.data?.detail || error?.message || "Unknown error occurred",
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
}: {
    runId: string
    scenarioId: string
    stepKey: string
    traceId?: string
    spanId?: string
    status: string
    references?: InvocationReferences
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
