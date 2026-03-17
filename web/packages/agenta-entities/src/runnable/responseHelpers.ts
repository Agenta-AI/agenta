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
 * Handles two response formats:
 * - v3 format: `{ version: "3.0", data: "plain text", tree: {...} }`
 * - Legacy format: `{ data: { outputs: {...} }, status: {...} }`
 *
 * Returns a normalized `{ output, trace }` object.
 */
export function normalizeWorkflowResponse(responseData: unknown): {
    output: unknown
    trace?: {id: string; spanId?: string}
} {
    const data = responseData as Record<string, unknown> | null | undefined
    const nestedData = data?.data
    // v3: data.data is a string (the plain output text)
    if (typeof nestedData === "string") {
        return {
            output: nestedData,
            trace:
                data?.trace_id || data?.tree_id
                    ? {
                          id: (data?.trace_id || data?.tree_id) as string,
                          ...(data?.span_id ? {spanId: data.span_id as string} : {}),
                      }
                    : undefined,
        }
    }
    // Legacy: data.data is an object with .outputs
    const nestedObj = nestedData as Record<string, unknown> | undefined
    const output = nestedObj?.outputs ?? data?.outputs ?? data
    return {
        output,
        trace: data?.trace_id
            ? {
                  id: data.trace_id as string,
                  ...(data?.span_id ? {spanId: data.span_id as string} : {}),
              }
            : undefined,
    }
}
