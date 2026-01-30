/**
 * OssAppRevision Core Types and Schemas
 *
 * Core type definitions and Zod schemas for OSS app revision entities.
 * This module uses the legacy backend API (AppVariantRevision model).
 *
 * Backend endpoints:
 * - GET /variants/{variant_id}/revisions/{revision_number}/
 * - POST /variants/revisions/query/
 *
 * @packageDocumentation
 */

import {z} from "zod"

// Re-export from shared for convenience
export type {EntitySchema, EntitySchemaProperty} from "../shared"

// ============================================================================
// EXECUTION MODE
// ============================================================================

export const executionModeSchema = z.enum(["direct", "deployed"])
export type ExecutionMode = z.infer<typeof executionModeSchema>

// ============================================================================
// CONFIG DB (Backend Model)
// ============================================================================

/**
 * ConfigDB from backend
 * Maps to: api/oss/src/models/shared_models.py -> ConfigDB
 */
export const configDBSchema = z.object({
    config_name: z.string(),
    parameters: z.record(z.string(), z.unknown()).default({}),
})
export type ConfigDB = z.infer<typeof configDBSchema>

// ============================================================================
// APP VARIANT REVISION (Backend Model)
// ============================================================================

/**
 * AppVariantRevision from backend
 * Maps to: api/oss/src/models/api/api_models.py -> AppVariantRevision
 */
export const apiAppVariantRevisionSchema = z.object({
    id: z.string().nullable().optional(),
    variant_id: z.string().nullable().optional(),
    revision: z.number(),
    modified_by: z.string(),
    config: configDBSchema,
    created_at: z.string(),
    commit_message: z.string().nullable().optional(),
})
export type ApiAppVariantRevision = z.infer<typeof apiAppVariantRevisionSchema>

// ============================================================================
// OSS APP REVISION DATA (Frontend Model)
// ============================================================================

/**
 * OssAppRevisionData - frontend representation of legacy app revision
 *
 * This is the normalized frontend data model for legacy app revisions.
 * It's derived from the backend AppVariantRevision model.
 */
export const ossAppRevisionDataSchema = z.object({
    // Identifier fields
    id: z.string(),
    variantId: z.string().optional(),
    appId: z.string().optional(),

    /** Revision number */
    revision: z.number(),

    /** Whether this is the latest revision */
    isLatestRevision: z.boolean().optional(),

    /** Variant name */
    variantName: z.string().optional(),

    /** App name */
    appName: z.string().optional(),

    /** Config name (variant name typically) */
    configName: z.string().optional(),

    /** Raw parameters (ag_config) from backend */
    parameters: z.record(z.string(), z.unknown()).optional(),

    /** Author who modified this revision */
    modifiedBy: z.string().optional(),

    /** Author ID who modified this revision */
    modifiedById: z.string().optional(),

    /** Commit message for this revision */
    commitMessage: z.string().nullable().optional(),

    /** Creation timestamp */
    createdAt: z.string().optional(),

    /** Last update timestamp */
    updatedAt: z.string().optional(),

    // Runtime information (for schema fetching and invocation)
    /** Base URI for the service endpoint */
    uri: z.string().optional(),

    /** Extracted runtime prefix from URI */
    runtimePrefix: z.string().optional(),

    /** Extracted route path from URI */
    routePath: z.string().optional(),

    // Enhanced data for playground (schema-enriched)
    /** Enhanced prompts derived from parameters + schema */
    enhancedPrompts: z.array(z.unknown()).optional(),

    /** Enhanced custom properties derived from parameters + schema */
    enhancedCustomProperties: z.record(z.string(), z.unknown()).optional(),
})
export type OssAppRevisionData = z.infer<typeof ossAppRevisionDataSchema>

// ============================================================================
// ENDPOINT SCHEMA
// ============================================================================

/**
 * Schema extracted for a specific endpoint.
 */
export interface EndpointSchema {
    /** The endpoint path (e.g., "/test", "/run") */
    endpoint?: string
    /** The full constructed path */
    path?: string
    /** Raw request schema from OpenAPI */
    requestSchema?: unknown
    /** ag_config schema extracted from request */
    agConfigSchema?: import("../shared").EntitySchema | null
    /** inputs schema for dynamic inputs */
    inputsSchema?: import("../shared").EntitySchema | null
    /** outputs schema extracted from response */
    outputsSchema?: import("../shared").EntitySchema | null
    /** messages schema for chat variants */
    messagesSchema?: import("../shared").EntitySchemaProperty | null
    /** List of all request property names */
    requestProperties?: string[]
}

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
    agConfigSchema?: import("../shared").EntitySchema | null
    /** Prompt schema (x-parameters.prompt === true) */
    promptSchema?: import("../shared").EntitySchema | null
    /** Custom properties schema (non-prompt properties) */
    customPropertiesSchema?: import("../shared").EntitySchema | null
    /** Primary outputs schema (from /test or /run response) */
    outputsSchema?: import("../shared").EntitySchema | null
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

// ============================================================================
// SELECTION RESULT
// ============================================================================

export interface OssAppRevisionSelectionResult {
    type: "ossAppRevision"
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

export interface OssAppRevisionDetailParams {
    variantId: string
    revisionNumber: number
    projectId: string
}

export interface OssAppRevisionBatchParams {
    revisionIds: string[]
    projectId: string
}

export interface OssAppRevisionListParams {
    projectId: string
    appId?: string
    variantId?: string
}

// ============================================================================
// PARSE UTILITIES
// ============================================================================

/**
 * Parse and validate OSS app revision data
 */
export function parseOssAppRevision(data: unknown): OssAppRevisionData | null {
    const result = ossAppRevisionDataSchema.safeParse(data)
    return result.success ? result.data : null
}

/**
 * Create an empty OSS app revision
 */
export function createEmptyOssAppRevision(id: string): OssAppRevisionData {
    return {
        id,
        revision: 1,
        parameters: {},
    }
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
