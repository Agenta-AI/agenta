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
 * Whether a field key represents evaluator pass/fail verdict semantics.
 */
export function isVerdictFieldKey(key: string): boolean {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "")
    return (
        normalized === "success" ||
        normalized === "passed" ||
        normalized === "ispass" ||
        normalized === "ispassed"
    )
}

/**
 * Parse boolean-like evaluator values.
 * Supports booleans, 0/1 numbers, "true"/"false" strings, and `{value: ...}` wrappers.
 */
export function parseBooleanLikeValue(value: unknown): boolean | null {
    if (typeof value === "boolean") return value
    if (typeof value === "number" && (value === 0 || value === 1)) return value === 1
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase()
        if (normalized === "true") return true
        if (normalized === "false") return false
        return null
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const rec = value as Record<string, unknown>
    if ("value" in rec) return parseBooleanLikeValue(rec.value)
    if ("success" in rec) return parseBooleanLikeValue(rec.success)
    if ("passed" in rec) return parseBooleanLikeValue(rec.passed)
    return null
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
