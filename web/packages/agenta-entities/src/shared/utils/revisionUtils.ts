/**
 * Shared Revision Utilities
 *
 * Common utilities for app revision entities (appRevision, legacyAppRevision).
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

/**
 * Extract runtime prefix from URI
 */
export function extractRuntimePrefix(uri: string | undefined | null): string | undefined {
    const parsed = parseRevisionUri(uri)
    return parsed?.runtimePrefix
}

/**
 * Extract route path from URI
 */
export function extractRoutePath(uri: string | undefined | null): string | undefined {
    const parsed = parseRevisionUri(uri)
    return parsed?.routePath
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
 * @deprecated Use extractRevisionParameters instead.
 */
export function extractAgConfig(
    parameters: Record<string, unknown> | undefined | null,
): RawAgConfig {
    return extractRevisionParameters(parameters)
}

/**
 * Extract revision parameters from enhanced variant data (cache redirect path)
 *
 * @param enhanced - Enhanced variant-like object with parameters
 * @returns The parameters object
 */
export function extractRevisionParametersFromEnhanced(
    enhanced:
        | {
              parameters?: Record<string, unknown>
          }
        | null
        | undefined,
): RawAgConfig {
    return extractRevisionParameters(enhanced?.parameters)
}

/**
 * @deprecated Use extractRevisionParametersFromEnhanced instead.
 */
export function extractAgConfigFromEnhanced(
    enhanced:
        | {
              parameters?: Record<string, unknown>
          }
        | null
        | undefined,
): RawAgConfig {
    return extractRevisionParametersFromEnhanced(enhanced)
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

/**
 * @deprecated Use extractRevisionParametersFromApiRevision instead.
 */
export function extractAgConfigFromApiRevision(
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
    return extractRevisionParametersFromApiRevision(apiRevision)
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
}

/**
 * Revision list item (camelCase, for selection)
 */
export interface RevisionListItem {
    id: string
    revision: number
    variantId: string
    appId?: string
    uri?: string
    commitMessage?: string
    createdAt?: string
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
    modified_by?: string
    config?: {
        config_name?: string
        parameters?: Record<string, unknown>
    }
}

/**
 * Raw app response from API (snake_case)
 */
export interface ApiApp {
    app_id: string
    app_name: string
    app_type?: string
    created_at?: string
    updated_at?: string
}

// ============================================================================
// TRANSFORM UTILITIES
// ============================================================================

/**
 * Transform raw app data (snake_case) to AppListItem (camelCase)
 */
export function transformAppToListItem(app: {
    app_id?: string
    id?: string
    app_name?: string
    name?: string
    app_type?: string
}): AppListItem {
    return {
        id: app.app_id || app.id || "",
        name: app.app_name || app.name || "",
        appType: app.app_type,
    }
}

/**
 * Transform raw variant data (snake_case) to VariantListItem (camelCase)
 */
export function transformVariantToListItem(
    variant: ApiVariant,
    fallbackAppId?: string,
): VariantListItem {
    return {
        id: variant.variant_id,
        name: variant.variant_name || variant.variant_id,
        appId: variant.app_id || fallbackAppId || "",
        baseId: variant.base_id,
        baseName: variant.base_name,
        uri: variant.uri,
    }
}

/**
 * Transform raw revision data (snake_case) to RevisionListItem (camelCase)
 */
export function transformRevisionToListItem(
    revision: ApiRevisionListItem,
    variantId: string,
    context?: {appId?: string; uri?: string},
): RevisionListItem {
    return {
        id: revision.id,
        revision: revision.revision,
        variantId,
        appId: context?.appId,
        uri: context?.uri,
        commitMessage: revision.commit_message,
        createdAt: revision.created_at,
        author: revision.modified_by,
        parameters: revision.config?.parameters,
    }
}

// ============================================================================
// ENHANCED VARIANT TYPES
// ============================================================================

/**
 * Enhanced variant structure (from variant revisions cache)
 *
 * This interface represents the cached variant data that may include
 * WorkflowRevisionData fields from the backend.
 */
export interface EnhancedVariantLike {
    id: string
    variantId?: string
    appId?: string
    revision: number | string
    prompts?: unknown[]
    parameters?: Record<string, unknown>
    uri?: string
    url?: string
    uriObject?: {
        routePath?: string
        runtimePrefix?: string
    }
    createdAt?: string
    created_at?: string
    updatedAt?: string
    updated_at?: string
    // WorkflowServiceConfiguration fields
    headers?: Record<string, unknown>
    schemas?: Record<string, unknown>
    script?: Record<string, unknown>
    runtime?: string | null
    // Legacy fields
    service?: Record<string, unknown>
    configuration?: Record<string, unknown>
}

/**
 * Extract URI info from enhanced variant data
 */
export function extractUriFromEnhanced(
    enhanced: EnhancedVariantLike | null | undefined,
): ParsedUriInfo | null {
    if (!enhanced) return null

    // Try uriObject first (pre-parsed)
    if (enhanced.uriObject?.runtimePrefix) {
        return {
            uri: enhanced.uri || "",
            runtimePrefix: enhanced.uriObject.runtimePrefix,
            routePath: enhanced.uriObject.routePath,
        }
    }

    // Fall back to parsing URI
    return parseRevisionUri(enhanced.uri || enhanced.url)
}
