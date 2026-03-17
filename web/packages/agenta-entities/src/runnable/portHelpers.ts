/**
 * Port Extraction Helpers
 *
 * Pure functions for deriving input/output ports from JSON schemas.
 * Used by workflow molecule selectors and integration helpers.
 *
 * @packageDocumentation
 */

import type {RunnablePort} from "../shared"

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
 * Extract input ports from a JSON schema.
 * Maps each top-level property to a RunnablePort.
 */
export function extractInputPortsFromSchema(schema: unknown): RunnablePort[] {
    if (!schema || typeof schema !== "object") return []

    const s = schema as Record<string, unknown>
    const properties = s.properties as Record<string, unknown> | undefined
    const required = (s.required as string[]) || []

    if (!properties) return []

    return Object.entries(properties).map(([key, prop]) => {
        const p = prop as Record<string, unknown>
        return {
            key,
            name: (p.title as string) || formatKeyAsName(key),
            type: (p.type as string) || "string",
            required: required.includes(key),
            schema: prop,
        }
    })
}

/**
 * Extract output ports from a JSON schema.
 * Handles both simple type schemas and object schemas with properties.
 */
export function extractOutputPortsFromSchema(schema: unknown): RunnablePort[] {
    if (!schema || typeof schema !== "object") return []

    const s = schema as Record<string, unknown>

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
        const p = prop as Record<string, unknown>
        return {
            key,
            name: (p.title as string) || formatKeyAsName(key),
            type: (p.type as string) || "string",
            schema: prop,
        }
    })
}
