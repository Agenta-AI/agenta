/**
 * Response Normalization Helpers
 *
 * Pure functions for normalizing workflow execution responses.
 *
 * @packageDocumentation
 */

/**
 * Normalize a workflow execution response.
 *
 * Handles the following response formats:
 * - v3 format: `{ version: "3.0", data: "plain text", tree: {...} }`
 * - Invoke format: `{ data: { outputs: "..." | {...} }, trace_id, span_id, status }`
 * - Legacy format: `{ data: { outputs: {...} }, status: {...} }`
 *
 * The `{serviceUrl}/invoke` endpoint serializes handler return values as
 * JSON-encoded strings in `data.outputs`. This function decodes them to extract
 * the actual output value.
 *
 * Returns a normalized `{ output, trace }` object.
 */
export function normalizeWorkflowResponse(responseData: unknown): {
    output: unknown
    trace?: {id: string; spanId?: string}
} {
    const data = responseData as Record<string, unknown> | null | undefined
    const nestedData = data?.data

    // Build trace from top-level or nested trace IDs
    const traceId = (data?.trace_id || data?.tree_id) as string | undefined
    const spanId = data?.span_id as string | undefined
    const trace = traceId ? {id: traceId, ...(spanId ? {spanId} : {})} : undefined

    // v3: data.data is a plain string (the output text)
    if (typeof nestedData === "string") {
        return {output: nestedData, trace}
    }

    // Invoke / legacy: data.data is an object with .outputs
    const nestedObj = nestedData as Record<string, unknown> | undefined
    let output: unknown = nestedObj?.outputs ?? data?.outputs ?? data

    // The invoke endpoint serializes handler return values as JSON-encoded strings.
    // Decode the string to extract the actual value.
    if (typeof output === "string") {
        try {
            output = JSON.parse(output)
        } catch {
            // Not JSON — use as-is
        }
    }

    return {output, trace}
}
