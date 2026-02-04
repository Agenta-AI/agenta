/**
 * AppRevision Core Types and Schemas
 *
 * Core type definitions and Zod schemas for app revision entities.
 * This module provides the foundation for data validation and typing.
 *
 * @packageDocumentation
 */

import {z} from "zod"

// Re-export from shared for convenience (using correct type names)
export type {EntitySchema, EntitySchemaProperty} from "../shared"

// Import for internal use
import type {EntitySchema, EntitySchemaProperty as SchemaProperty} from "../shared"

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
// EXECUTION MODE
// ============================================================================

export const executionModeSchema = z.enum(["direct", "deployed"])
export type ExecutionMode = z.infer<typeof executionModeSchema>

// ============================================================================
// TOOL CALL CONFIG
// ============================================================================

export const toolCallConfigSchema = z.object({
    id: z.string().optional(),
    type: z.literal("function").optional(),
    function: z
        .object({
            name: z.string(),
            arguments: z.string(),
        })
        .optional(),
})
export type ToolCallConfig = z.infer<typeof toolCallConfigSchema>

// ============================================================================
// MESSAGE CONFIG
// ============================================================================

export const messageConfigSchema = z.object({
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: z.string(),
    name: z.string().optional(),
    tool_call_id: z.string().optional(),
    tool_calls: z.array(toolCallConfigSchema).optional(),
})
export type MessageConfig = z.infer<typeof messageConfigSchema>

// ============================================================================
// TOOL CONFIG
// ============================================================================

export const toolConfigSchema = z.object({
    type: z.literal("function").optional(),
    function: z
        .object({
            name: z.string(),
            description: z.string().optional(),
            parameters: z.record(z.string(), z.unknown()).optional(),
        })
        .optional(),
})
export type ToolConfig = z.infer<typeof toolConfigSchema>

// ============================================================================
// RESPONSE FORMAT CONFIG
// ============================================================================

export const responseFormatConfigSchema = z.object({
    type: z.enum(["text", "json_object", "json_schema"]).optional(),
    json_schema: z
        .object({
            name: z.string(),
            schema: z.record(z.string(), z.unknown()).optional(),
            strict: z.boolean().optional(),
        })
        .optional(),
})
export type ResponseFormatConfig = z.infer<typeof responseFormatConfigSchema>

// ============================================================================
// PROMPT CONFIG
// ============================================================================

export const promptConfigSchema = z.object({
    name: z.string(),
    messages: z.array(messageConfigSchema),
    temperature: z.number().optional(),
    model: z.string().optional(),
    max_tokens: z.number().optional(),
    top_p: z.number().optional(),
    frequency_penalty: z.number().optional(),
    presence_penalty: z.number().optional(),
    inputKeys: z.array(z.string()).optional(),
    tools: z.array(toolConfigSchema).optional(),
    response_format: responseFormatConfigSchema.optional(),
})
export type PromptConfig = z.infer<typeof promptConfigSchema>

// ============================================================================
// RAW AG CONFIG (schema-driven approach)
// ============================================================================

export type RawAgConfig = Record<string, unknown>

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
    messagesSchema?: SchemaProperty | null
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
// ENTITY SCHEMA (for backward compatibility)
// ============================================================================

export const entitySchemaSchema = z.object({
    type: z.literal("object"),
    properties: z.record(z.string(), z.unknown()),
    required: z.array(z.string()).optional(),
    additionalProperties: z.unknown().optional(),
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
    }
    /** Available endpoint names */
    availableEndpoints?: string[]
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

// ============================================================================
// WORKFLOW SERVICE CONFIGURATION (from backend WorkflowRevisionData)
// ============================================================================

/**
 * Reference schema for secrets or hardcoded values in headers
 * Maps to backend: Union[Reference, str]
 */
export const headerValueSchema = z.union([
    z.string(),
    z.object({
        id: z.string().optional(),
        slug: z.string().optional(),
        version: z.number().optional(),
    }),
])
export type HeaderValue = z.infer<typeof headerValueSchema>

/**
 * Workflow service configuration schema
 * Maps to backend: WorkflowServiceConfiguration (workflows/dtos.py)
 *
 * This represents the full configuration available for workflow revisions,
 * including script-based workflows and runtime configuration.
 */
export const workflowServiceConfigSchema = z.object({
    /** Service version identifier */
    version: z.string().nullable().optional(),
    /** Base URI for the service */
    uri: z.string().nullable().optional(),
    /** Full URL for the service endpoint */
    url: z.string().nullable().optional(),
    /** Request headers - can be hardcoded strings or secret references */
    headers: z.record(z.string(), headerValueSchema).nullable().optional(),
    /** JSON schemas for inputs/outputs */
    schemas: z.record(z.string(), z.unknown()).nullable().optional(),
    /** Script content for custom workflows */
    script: z.record(z.string(), z.unknown()).nullable().optional(),
    /** Configuration parameters (ag_config) */
    parameters: z.record(z.string(), z.unknown()).nullable().optional(),
    /** Runtime environment: python, javascript, typescript (null = python) */
    runtime: z.string().nullable().optional(),
})
export type WorkflowServiceConfig = z.infer<typeof workflowServiceConfigSchema>

/**
 * Legacy service configuration (for backward compatibility)
 * Maps to backend: WorkflowRevisionData.service
 */
export const legacyServiceConfigSchema = z.object({
    agenta: z.boolean().optional(),
    format: z.record(z.string(), z.unknown()).optional(),
    url: z.string().optional(),
    kind: z.string().optional(),
})
export type LegacyServiceConfig = z.infer<typeof legacyServiceConfigSchema>

// ============================================================================
// APP REVISION DATA
// ============================================================================

/**
 * App revision data schema
 *
 * This is the frontend representation of ApplicationRevisionData from the backend.
 * It extends WorkflowRevisionData with application-specific transformations.
 *
 * Backend source: core/applications/dtos.py -> ApplicationRevisionData
 * Parent: core/workflows/dtos.py -> WorkflowRevisionData -> WorkflowServiceConfiguration
 *
 * Key fields from WorkflowServiceConfiguration:
 * - uri: Base URI for the service
 * - url: Full URL for the service endpoint
 * - headers: Request headers (can include secret references)
 * - schemas: JSON schemas for inputs/outputs
 * - script: Script content for custom workflows
 * - parameters: Configuration parameters (ag_config)
 * - runtime: Runtime environment (python, javascript, typescript)
 */
export const appRevisionDataSchema = z.object({
    // Identifier fields
    id: z.string(),
    variantId: z.string().optional(),
    appId: z.string().optional(),

    /**
     * Revision number
     * Note: Backend returns this as Optional[str] in Version mixin,
     * but we transform it to number for easier comparison and display.
     */
    revision: z.number(),

    // Extracted prompt configuration (frontend convenience)
    prompts: z.array(promptConfigSchema).optional(),

    // Raw ag_config from backend parameters
    agConfig: z.record(z.string(), z.unknown()).optional(),

    // Full parameters object from backend
    parameters: z.record(z.string(), z.unknown()).optional(),

    // Lifecycle timestamps
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),

    // === WorkflowServiceConfiguration fields ===

    /** Base URI for the service endpoint */
    uri: z.string().optional(),

    /** Full URL for the service endpoint (from backend url field) */
    url: z.string().optional(),

    /** Extracted runtime prefix from URI */
    runtimePrefix: z.string().optional(),

    /** Extracted route path from URI */
    routePath: z.string().optional(),

    /**
     * Request headers - can be hardcoded strings or secret references
     * Maps to backend: Dict[str, Union[Reference, str]]
     */
    headers: z.record(z.string(), headerValueSchema).optional(),

    /**
     * Script content for custom workflows
     * Maps to backend: Data (Dict[str, FullJson])
     */
    script: z.record(z.string(), z.unknown()).optional(),

    /**
     * Runtime environment: "python", "javascript", "typescript"
     * null/undefined defaults to "python"
     */
    runtime: z.string().nullable().optional(),

    /** Input/output schemas extracted from OpenAPI spec or backend schemas field */
    schemas: z
        .object({
            inputs: z.record(z.string(), z.unknown()).optional(),
            outputs: z.record(z.string(), z.unknown()).optional(),
        })
        .optional(),

    // === Legacy fields for backward compatibility ===

    /** Legacy service configuration */
    service: legacyServiceConfigSchema.optional(),

    /** Legacy configuration object */
    configuration: z.record(z.string(), z.unknown()).optional(),
})
export type AppRevisionData = z.infer<typeof appRevisionDataSchema>

/**
 * Parsed app revision data type (same as AppRevisionData for compatibility)
 */
export type AppRevisionDataParsed = AppRevisionData

/**
 * Schema-enriched app revision data (for DrillIn)
 */
export type SchemaAppRevisionData = AppRevisionData & {
    _schema?: RevisionSchemaState
}

// ============================================================================
// SELECTION RESULT
// ============================================================================

export interface AppRevisionSelectionResult {
    type: "appRevision"
    id: string
    label: string
    path: {id: string; label: string; type: string}[]
    metadata: {
        revisionId: string
        variantId: string
        appId: string
        appName?: string
        variantName?: string
        revisionNumber?: number
    }
}

// ============================================================================
// API PARAMS
// ============================================================================

export interface AppRevisionDetailParams {
    revisionId: string
    projectId: string
}

export interface AppRevisionBatchParams {
    revisionIds: string[]
    projectId: string
}

export interface AppRevisionListParams {
    projectId: string
    appId?: string
    variantId?: string
}

// ============================================================================
// PARSE UTILITIES
// ============================================================================

/**
 * Parse and validate app revision data
 */
export function parseAppRevision(data: unknown): AppRevisionData | null {
    const result = appRevisionDataSchema.safeParse(data)
    return result.success ? result.data : null
}

/**
 * Parse and validate prompt config
 */
export function parsePromptConfig(data: unknown): PromptConfig | null {
    const result = promptConfigSchema.safeParse(data)
    return result.success ? result.data : null
}

/**
 * Parse and validate message config
 */
export function parseMessageConfig(data: unknown): MessageConfig | null {
    const result = messageConfigSchema.safeParse(data)
    return result.success ? result.data : null
}

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

/**
 * Create an empty app revision
 */
export function createEmptyAppRevision(id: string): AppRevisionData {
    return {
        id,
        revision: 1,
        prompts: [],
        agConfig: {},
        parameters: {},
    }
}
