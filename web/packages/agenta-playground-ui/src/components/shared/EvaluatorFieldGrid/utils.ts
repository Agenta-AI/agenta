import type {SchemaProperty} from "@agenta/entities"
import type {RunnablePort} from "@agenta/entities/runnable"

/**
 * Convert snake_case/camelCase key to human-readable label.
 * "some_field" → "Some field"
 * "someField" → "Some Field"
 */
export function formatFieldLabel(key: string): string {
    return key
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/^./, (c) => c.toUpperCase())
}

/**
 * Build a schema map from output ports.
 * Returns { fieldKey → SchemaProperty | undefined }
 */
export function buildSchemaMap(
    outputPorts: RunnablePort[],
): Record<string, SchemaProperty | undefined> {
    const map: Record<string, SchemaProperty | undefined> = {}
    for (const port of outputPorts) {
        map[port.key] = port.schema as SchemaProperty | undefined
    }
    return map
}

/**
 * Extract display entries from a fullResult's output.
 * Handles all response nesting patterns:
 *   - output.response.data.outputs (legacyEvaluator)
 *   - output.response.outputs (evaluatorRevision)
 *   - output.response (generic)
 * Returns [key, value] pairs with null/undefined values filtered out,
 * or null if no displayable data exists.
 */
export function extractDisplayEntries(output: unknown): [string, unknown][] | null {
    const outputObj = output as Record<string, unknown> | undefined
    const responseData = outputObj?.response as Record<string, unknown> | undefined
    const nestedData = responseData?.data as Record<string, unknown> | undefined
    const displayData = nestedData?.outputs ?? responseData?.outputs ?? nestedData ?? responseData

    if (!displayData || typeof displayData !== "object") return null

    const entries = Object.entries(displayData).filter(([, v]) => v !== undefined && v !== null)
    return entries.length > 0 ? entries : null
}
