/**
 * Port Extraction Helpers
 *
 * Pure functions for deriving input/output ports from JSON schemas.
 * Used by workflow molecule selectors and integration helpers.
 *
 * @packageDocumentation
 */

import type {RunnablePort} from "../shared"

// ============================================================================
// JSON SCHEMA $ref RESOLUTION
// ============================================================================

/**
 * Resolve a JSON Schema node that may contain a `$ref` pointer.
 *
 * Supports local `$defs`-style references (e.g., `{"$ref": "#/$defs/result"}`).
 * When the node is not a `$ref` or the target is missing, returns the node as-is.
 *
 * @param node  - A JSON Schema node (may be a `$ref` object)
 * @param defs  - The `$defs` map from the root schema
 */
export function resolveSchemaRef(
    node: unknown,
    defs?: Record<string, unknown>,
): Record<string, unknown> {
    if (!node || typeof node !== "object") return {}
    const obj = node as Record<string, unknown>

    if (typeof obj.$ref === "string" && defs) {
        // Support "#/$defs/<key>" and "#/definitions/<key>" pointers
        const ref = obj.$ref as string
        const match = ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/)
        if (match) {
            const resolved = defs[match[1]]
            if (resolved && typeof resolved === "object") {
                return resolved as Record<string, unknown>
            }
        }
    }

    return obj
}

/**
 * Derive the effective type string from a schema node, resolving `$ref` if needed.
 */
export function resolveSchemaType(node: unknown, defs?: Record<string, unknown>): string {
    const resolved = resolveSchemaRef(node, defs)
    if (typeof resolved.type === "string") return resolved.type
    return "string"
}

// ============================================================================
// FORMATTING
// ============================================================================

/**
 * Format a key as a human-readable name.
 * Converts snake_case and camelCase to Title Case.
 */
export function formatKeyAsName(key: string): string {
    return key
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/^./, (str) => str.toUpperCase())
}

/**
 * Check whether a schema property is a system-level field annotated with
 * `x-ag-*` markers (e.g. `x-ag-context`, `x-ag-consent`, `x-ag-variables`,
 * `x-ag-content`, or `x-ag-type` for messages/message).  These are transport
 * fields managed by the runtime and should not appear as user-facing inputs.
 */
function isSystemField(prop: unknown): boolean {
    if (!prop || typeof prop !== "object") return false
    const obj = prop as Record<string, unknown>
    return Object.keys(obj).some((k) => k.startsWith("x-ag-"))
}

/**
 * Extract the set of system-level field names from an inputs schema.
 * Returns field names annotated with `x-ag-*` markers so callers can
 * filter template variables that collide with runtime-managed fields.
 */
export function extractSystemFieldNames(schema: unknown): Set<string> {
    if (!schema || typeof schema !== "object") return new Set()
    const s = schema as Record<string, unknown>
    const properties = s.properties as Record<string, unknown> | undefined
    if (!properties) return new Set()

    const names = new Set<string>()
    for (const [key, prop] of Object.entries(properties)) {
        if (isSystemField(prop)) names.add(key)
    }
    return names
}

/**
 * Extract input ports from a JSON schema.
 * Maps each top-level property to a RunnablePort, filtering out system-level
 * fields annotated with `x-ag-*` markers.
 */
export function extractInputPortsFromSchema(schema: unknown): RunnablePort[] {
    if (!schema || typeof schema !== "object") return []

    const s = schema as Record<string, unknown>
    const properties = s.properties as Record<string, unknown> | undefined
    const required = (s.required as string[]) || []
    const defs = (s.$defs ?? s.definitions) as Record<string, unknown> | undefined

    if (!properties) return []

    return Object.entries(properties)
        .filter(([, prop]) => !isSystemField(prop))
        .map(([key, prop]) => {
            const resolved = resolveSchemaRef(prop, defs)
            return {
                key,
                name: (resolved.title as string) || formatKeyAsName(key),
                type: resolveSchemaType(prop, defs),
                required: required.includes(key),
                schema: prop,
            }
        })
}

/**
 * Extract output ports from a JSON schema.
 * Handles both simple type schemas and object schemas with properties.
 * Resolves `$ref` pointers against the schema's `$defs` for proper type inference.
 */
export function extractOutputPortsFromSchema(schema: unknown): RunnablePort[] {
    if (!schema || typeof schema !== "object") return []

    const s = schema as Record<string, unknown>
    const defs = (s.$defs ?? s.definitions) as Record<string, unknown> | undefined

    // Handle simple type schema
    if (s.type && s.type !== "object") {
        return [
            {
                key: "output",
                name: "Output",
                type: s.type as string,
                schema,
            },
        ]
    }

    // Handle object schema
    const properties = s.properties as Record<string, unknown> | undefined
    if (!properties) {
        return [
            {
                key: "output",
                name: "Output",
                type: "unknown",
                schema,
            },
        ]
    }

    return Object.entries(properties).map(([key, prop]) => {
        const resolved = resolveSchemaRef(prop, defs)
        return {
            key,
            name: (resolved.title as string) || formatKeyAsName(key),
            type: resolveSchemaType(prop, defs),
            schema: prop,
        }
    })
}
