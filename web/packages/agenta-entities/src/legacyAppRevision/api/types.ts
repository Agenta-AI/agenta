/**
 * Schema Types for LegacyAppRevision
 *
 * Core type definitions for schema state and endpoint schemas.
 * Moved from appRevision/core.ts to eliminate the dependency.
 */

import {z} from "zod"

import type {EntitySchema, EntitySchemaProperty} from "../../shared"

// Re-export from shared for convenience
export type {EntitySchema, EntitySchemaProperty}

// ============================================================================
// APP SERVICE TYPE
// ============================================================================

/**
 * Known service types for app revisions.
 *
 * - `completion`: Standard completion service with known OpenAPI schema
 * - `chat`: Standard chat service with known OpenAPI schema (includes messages)
 * - `custom`: Custom app with user-defined endpoints and schema
 *
 * For completion and chat services, the OpenAPI schema is identical across
 * all revisions of the same type, enabling prefetching at the app level.
 */
export const APP_SERVICE_TYPES = {
    COMPLETION: "completion",
    CHAT: "chat",
    CUSTOM: "custom",
} as const

export type AppServiceType = (typeof APP_SERVICE_TYPES)[keyof typeof APP_SERVICE_TYPES]

/**
 * Service route paths for known service types.
 * These are the paths used to construct the OpenAPI spec URLs.
 */
export const SERVICE_ROUTE_PATHS: Record<string, string> = {
    [APP_SERVICE_TYPES.COMPLETION]: "services/completion",
    [APP_SERVICE_TYPES.CHAT]: "services/chat",
}

/**
 * Determine whether an app type string maps to a known (prefetchable) service type.
 *
 * Backend returns app_type values like:
 * - "chat", "completion" (friendly tags)
 * - "SERVICE:chat", "SERVICE:completion" (enum values)
 * - "TEMPLATE:simple_chat", "TEMPLATE:simple_completion" (legacy templates)
 * - "custom", "CUSTOM", "SDK_CUSTOM" (custom apps)
 *
 * @returns The normalized service type, or null if not a known service type
 */
export function resolveServiceType(appType: string | undefined | null): AppServiceType | null {
    if (!appType) return null

    const normalized = appType.toLowerCase()

    if (
        normalized === "chat" ||
        normalized === "service:chat" ||
        normalized === "template:simple_chat" ||
        normalized === "chat (old)"
    ) {
        return APP_SERVICE_TYPES.CHAT
    }

    if (
        normalized === "completion" ||
        normalized === "service:completion" ||
        normalized === "template:simple_completion" ||
        normalized === "completion (old)"
    ) {
        return APP_SERVICE_TYPES.COMPLETION
    }

    return null
}

// ============================================================================
// ENDPOINT SCHEMA
// ============================================================================

/**
 * Schema extracted for a specific endpoint.
 * Used in api/schema.ts for OpenAPI schema extraction.
 */
export interface EndpointSchema {
    /** The endpoint path (e.g., "/test", "/run") */
    endpoint?: string
    /** The full constructed path (e.g., "/my-app/v1/test") */
    path?: string
    /** Raw request schema from OpenAPI */
    requestSchema?: unknown
    /** ag_config schema extracted from request */
    agConfigSchema?: EntitySchema | null
    /** inputs schema for dynamic inputs */
    inputsSchema?: EntitySchema | null
    /** outputs schema extracted from response */
    outputsSchema?: EntitySchema | null
    /** messages schema for chat variants */
    messagesSchema?: EntitySchemaProperty | null
    /** List of all request property names */
    requestProperties?: string[]
    /** Generic schema for backward compatibility */
    schema?: unknown
}

// Zod schema for optional validation
export const endpointSchemaSchema = z.object({
    endpoint: z.string().optional(),
    path: z.string().optional(),
    requestSchema: z.unknown().optional(),
    agConfigSchema: z.unknown().optional(),
    inputsSchema: z.unknown().optional(),
    outputsSchema: z.unknown().optional(),
    messagesSchema: z.unknown().optional(),
    requestProperties: z.array(z.string()).optional(),
    schema: z.unknown().optional(),
})

// ============================================================================
// REVISION SCHEMA STATE
// ============================================================================

/**
 * Complete schema state for a revision.
 * Contains all extracted schemas and metadata.
 */
export interface RevisionSchemaState {
    /** Raw OpenAPI schema */
    openApiSchema?: unknown | null
    /** Primary ag_config schema (from /test or /run) */
    agConfigSchema?: EntitySchema | null
    /** Prompt schema (x-parameters.prompt === true) */
    promptSchema?: EntitySchema | null
    /** Custom properties schema (non-prompt properties) */
    customPropertiesSchema?: EntitySchema | null
    /** Primary outputs schema (from /test or /run response) */
    outputsSchema?: EntitySchema | null
    /** Per-endpoint schemas */
    endpoints?: {
        test?: EndpointSchema | null
        run?: EndpointSchema | null
        generate?: EndpointSchema | null
        generateDeployed?: EndpointSchema | null
        /** Root path endpoint for custom apps using @ag.route("/") */
        root?: EndpointSchema | null
    }
    /** Available endpoint names */
    availableEndpoints?: string[]
    /** Primary endpoint schema (first available in priority: test > run > generate > generateDeployed > root) */
    primaryEndpoint?: EndpointSchema | null
    /** Is this a chat variant (has messages) */
    isChatVariant?: boolean
    /** Runtime prefix URL */
    runtimePrefix?: string
    /** Route path segment */
    routePath?: string
    /** Loading state */
    isLoading?: boolean
    /** Error message */
    error?: string
}

// Zod schema for optional validation
export const revisionSchemaStateSchema = z.object({
    openApiSchema: z.unknown().optional(),
    agConfigSchema: z.unknown().optional(),
    promptSchema: z.unknown().optional(),
    customPropertiesSchema: z.unknown().optional(),
    endpoints: z.unknown().optional(),
    availableEndpoints: z.array(z.string()).optional(),
    isChatVariant: z.boolean().optional(),
    runtimePrefix: z.string().optional(),
    routePath: z.string().optional(),
    isLoading: z.boolean().optional(),
    error: z.string().optional(),
})

/**
 * Create an empty schema state
 */
export function createEmptySchemaState(): RevisionSchemaState {
    return {
        openApiSchema: null,
        agConfigSchema: null,
        promptSchema: null,
        customPropertiesSchema: null,
        endpoints: {
            test: null,
            run: null,
            generate: null,
            generateDeployed: null,
        },
        availableEndpoints: [],
        isChatVariant: false,
        isLoading: false,
        error: undefined,
    }
}
