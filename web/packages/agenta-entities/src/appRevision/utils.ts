/**
 * AppRevision Utilities
 *
 * Schema adapter utilities for app revision entities.
 * These support the schema-aware DrillIn navigation.
 *
 * @packageDocumentation
 */

import type {EntitySchema, EntitySchemaProperty as SchemaProperty} from "../shared"

// ============================================================================
// SCHEMA EXTRACTION
// ============================================================================

/**
 * Extract the prompt schema from agConfigSchema.
 * Identifies properties with x-parameters.prompt === true
 */
export function extractPromptSchema(agConfigSchema: EntitySchema | null): EntitySchema | null {
    if (!agConfigSchema?.properties) return null

    const promptProps: Record<string, SchemaProperty> = {}
    const required: string[] = []

    for (const [key, prop] of Object.entries(agConfigSchema.properties)) {
        const xParams = prop?.["x-parameters"] as Record<string, unknown> | undefined
        if (xParams?.prompt === true) {
            promptProps[key] = prop
            if (agConfigSchema.required?.includes(key)) {
                required.push(key)
            }
        }
    }

    if (Object.keys(promptProps).length === 0) return null

    return {
        type: "object",
        properties: promptProps,
        required: required.length > 0 ? required : undefined,
    }
}

/**
 * Extract custom (non-prompt) properties schema from agConfigSchema.
 */
export function extractCustomPropertiesSchema(
    agConfigSchema: EntitySchema | null,
): EntitySchema | null {
    if (!agConfigSchema?.properties) return null

    const customProps: Record<string, SchemaProperty> = {}
    const required: string[] = []

    for (const [key, prop] of Object.entries(agConfigSchema.properties)) {
        const xParams = prop?.["x-parameters"] as Record<string, unknown> | undefined
        // Include if NOT a prompt property
        if (!xParams?.prompt) {
            customProps[key] = prop
            if (agConfigSchema.required?.includes(key)) {
                required.push(key)
            }
        }
    }

    if (Object.keys(customProps).length === 0) return null

    return {
        type: "object",
        properties: customProps,
        required: required.length > 0 ? required : undefined,
    }
}

/**
 * Get keys for prompt properties
 */
export function getPromptKeys(agConfigSchema: EntitySchema | null): string[] {
    if (!agConfigSchema?.properties) return []

    const keys: string[] = []
    for (const [key, prop] of Object.entries(agConfigSchema.properties)) {
        const propObj = prop as Record<string, unknown>
        const xParams = propObj?.["x-parameters"] as Record<string, unknown> | undefined
        if (xParams?.prompt === true) {
            keys.push(key)
        }
    }
    return keys
}

/**
 * Get keys for custom (non-prompt) properties
 */
export function getCustomPropertyKeys(agConfigSchema: EntitySchema | null): string[] {
    if (!agConfigSchema?.properties) return []

    const keys: string[] = []
    for (const [key, prop] of Object.entries(agConfigSchema.properties)) {
        const propObj = prop as Record<string, unknown>
        const xParams = propObj?.["x-parameters"] as Record<string, unknown> | undefined
        if (!xParams?.prompt) {
            keys.push(key)
        }
    }
    return keys
}

// ============================================================================
// FORMAT HELPERS
// ============================================================================

/**
 * Format a key as a human-readable name
 * e.g., "llm_config" -> "Llm Config"
 */
export function formatKeyAsName(key: string): string {
    const withSpaces = key.replace(/_/g, " ")
    const withCamelSpaces = withSpaces.replace(/([a-z])([A-Z])/g, "$1 $2")
    return withCamelSpaces
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ")
}

// ============================================================================
// ENHANCED VALUE UTILITIES
// ============================================================================

/**
 * Unwrap an Enhanced<T> value to get the raw value
 */
export function unwrapEnhanced<T>(enhanced: unknown): T | undefined {
    if (enhanced === null || enhanced === undefined) return undefined

    if (typeof enhanced === "object" && "value" in enhanced) {
        return (enhanced as {value: T}).value
    }

    return enhanced as T
}

// ============================================================================
// SCHEMA-AWARE DRILL-IN
// ============================================================================

/**
 * Configuration for schema-aware DrillIn
 */
export interface SchemaAwareDrillInConfig {
    getSchema: (revisionId: string) => EntitySchema | null
    getSchemaAtPath: (revisionId: string, path: (string | number)[]) => EntitySchema | null
}

/**
 * Create a schema-aware DrillIn configuration.
 * This enables schema-driven navigation through agConfig data.
 */
export function createSchemaAwareDrillIn(config: SchemaAwareDrillInConfig) {
    return {
        getSchema: config.getSchema,
        getSchemaAtPath: config.getSchemaAtPath,
        isSchemaAware: true as const,
    }
}
