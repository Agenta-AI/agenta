/**
 * Shared Revision Utilities
 *
 * Common utilities for app revision entities.
 * Provides:
 * - URI parsing and runtime info extraction
 * - revision parameter extraction from various data formats
 * - Type guards for safe data handling
 * - Common list item types
 *
 * @module shared/utils/revisionUtils
 */

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if a value is an array
 */
export function isArray(value: unknown): value is unknown[] {
    return Array.isArray(value)
}

/**
 * Type guard to check if a value is a non-null object (not array)
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Safely get array from a value that might be an array or object with value property
 */
export function toArray(value: unknown): unknown[] {
    if (isArray(value)) return value
    if (isRecord(value) && isArray(value.value)) return value.value
    return []
}

/**
 * Check if a string is a valid UUID
 */
export function isValidUUID(id: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    return uuidRegex.test(id)
}

// ============================================================================
// URI PARSING
// ============================================================================

/**
 * Parsed URI information for revision endpoints
 */
export interface ParsedUriInfo {
    /** The full URI */
    uri: string
    /** Runtime prefix (protocol + host) e.g., "https://runtime.example.com" */
    runtimePrefix: string
    /** Route path segment e.g., "app-slug/v1" */
    routePath?: string
}

/**
 * Parse a revision URI to extract runtime prefix and route path
 *
 * URI format: https://runtime.example.com/app-slug/v1
 *
 * @param uri - The full URI string
 * @returns Parsed URI info or null if invalid
 */
export function parseRevisionUri(uri: string | undefined | null): ParsedUriInfo | null {
    if (!uri) return null

    try {
        const parsedUrl = new URL(uri)
        const runtimePrefix = `${parsedUrl.protocol}//${parsedUrl.host}`
        const routePath = parsedUrl.pathname.replace(/^\//, "").replace(/\/$/, "") || undefined

        return {
            uri,
            runtimePrefix,
            routePath,
        }
    } catch {
        // Invalid URL
        return null
    }
}

// ============================================================================
// REVISION PARAMETER EXTRACTION
// ============================================================================

/**
 * Raw parameters config type (schema-driven approach)
 */
export type RawAgConfig = Record<string, unknown>

/**
 * Extract raw parameters from revision parameters object
 *
 * The `parameters` field is the configuration payload (not nested inside ag_config).
 * Structure: parameters = { prompt: {...}, llm_config: {...}, ... }
 *
 * @param parameters - The parameters object from revision data
 * @returns The parameters object
 */
export function extractRevisionParameters(
    parameters: Record<string, unknown> | undefined | null,
): RawAgConfig {
    if (parameters && typeof parameters === "object" && Object.keys(parameters).length > 0) {
        return parameters
    }
    return {}
}

/**
 * Extract revision parameters from API revision response
 *
 * API response structure: revision.config.parameters = { prompt: {...}, ... }
 * The `parameters` field is the config payload directly.
 *
 * @param apiRevision - API revision response with config.parameters
 * @returns The parameters object
 */
export function extractRevisionParametersFromApiRevision(
    apiRevision:
        | {
              config?: {
                  parameters?: Record<string, unknown>
              }
              parameters?: Record<string, unknown>
          }
        | null
        | undefined,
): RawAgConfig {
    if (!apiRevision) return {}

    // Try direct parameters first (some API responses have it at top level)
    const directParams = isRecord(apiRevision.parameters) ? apiRevision.parameters : null
    const configParams = apiRevision.config?.parameters

    return directParams || configParams || {}
}

// ============================================================================
// LIST ITEM TYPES
// ============================================================================

/**
 * App list item (camelCase, for selection)
 */
export interface AppListItem {
    id: string
    name: string
    appType?: string
    [key: string]: unknown
}

/**
 * Variant list item (camelCase, for selection)
 */
export interface VariantListItem {
    id: string
    name: string
    appId: string
    baseId?: string
    baseName?: string
    uri?: string
    createdAt?: string
    updatedAt?: string
    createdAtTimestamp?: number
    updatedAtTimestamp?: number
}

/**
 * Revision list item (camelCase, for selection)
 */
export interface RevisionListItem {
    id: string
    revision: number
    variantId: string
    variantName?: string
    appId?: string
    uri?: string
    commitMessage?: string
    createdAt?: string
    updatedAt?: string
    createdAtTimestamp: number
    updatedAtTimestamp: number
    author?: string
    parameters?: Record<string, unknown>
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

/**
 * Raw variant response from API (snake_case)
 */
export interface ApiVariant {
    variant_id: string
    variant_name: string
    base_id: string
    base_name: string
    app_id: string
    uri?: string
    revision?: number
    created_at?: string
    updated_at?: string
}

/**
 * Raw revision list item from API (snake_case)
 */
export interface ApiRevisionListItem {
    id: string
    revision: number
    commit_message?: string
    created_at?: string
    updated_at?: string
    modified_by?: string
    config?: {
        config_name?: string
        parameters?: Record<string, unknown>
    }
}
