/**
 * Environment Entity Schemas
 *
 * Zod schemas for validation and type safety of environment entities.
 * Based on the new git-based environments API (PR #3627).
 *
 * Uses the SimpleEnvironment API which abstracts the 3-level
 * artifact/variant/revision hierarchy into a simpler 2-level model.
 *
 * @example
 * ```typescript
 * import {
 *     environmentSchema,
 *     environmentRevisionSchema,
 *     referenceSchema,
 * } from '@agenta/entities/environment'
 *
 * const env = environmentSchema.parse(apiResponse)
 * ```
 */

import {z} from "zod"

import {timestampFieldsSchema, safeParseWithLogging} from "../../shared"

// ============================================================================
// REFERENCE SCHEMA
// ============================================================================

/**
 * Reference schema - used for identifying entities (app, variant, revision)
 * within environment revision data.
 *
 * Maps to backend `Reference` DTO:
 * ```python
 * class Reference(BaseModel):
 *     id: Optional[UUID]
 *     slug: Optional[str]
 *     version: Optional[str]
 * ```
 */
export const referenceSchema = z.object({
    id: z.string().nullable().optional(),
    slug: z.string().nullable().optional(),
    version: z.string().nullable().optional(),
})

export type Reference = z.infer<typeof referenceSchema>

// ============================================================================
// ENVIRONMENT REVISION DATA SCHEMA
// ============================================================================

/**
 * Environment revision data - per-app references for deployed revisions.
 *
 * Keys are app-scoped identifiers (e.g., "myapp.default").
 * Values are dicts of entity-type → Reference, providing full traceability:
 *
 * ```json
 * {
 *   "myapp.default": {
 *     "application": { "id": "...", "slug": "myapp" },
 *     "application_variant": { "id": "...", "slug": "default" },
 *     "application_revision": { "id": "...", "slug": "...", "version": "3" }
 *   }
 * }
 * ```
 */
export const environmentRevisionDataSchema = z.object({
    references: z.record(z.string(), z.record(z.string(), referenceSchema)).nullable().optional(),
})

export type EnvironmentRevisionData = z.infer<typeof environmentRevisionDataSchema>

// ============================================================================
// ENVIRONMENT FLAGS SCHEMA
// ============================================================================

/**
 * Environment flags - boolean flags for environment state
 */
export const environmentFlagsSchema = z.object({
    is_guarded: z.boolean().optional().default(false),
})

export type EnvironmentFlags = z.infer<typeof environmentFlagsSchema>

// ============================================================================
// SIMPLE ENVIRONMENT SCHEMA
// ============================================================================

/**
 * SimpleEnvironment schema matching backend SimpleEnvironment DTO.
 *
 * This is the primary frontend-facing model that abstracts the
 * artifact/variant/revision hierarchy.
 *
 * Endpoint: POST /environments/simple/query
 */
export const environmentSchema = z
    .object({
        id: z.string(),
        slug: z.string().nullable().optional(),

        // Header fields
        name: z.string().nullable().optional(),
        description: z.string().nullable().optional(),

        // Flags
        flags: environmentFlagsSchema.nullable().optional(),

        // Revision data (deployed app references)
        data: environmentRevisionDataSchema.nullable().optional(),

        // Internal IDs (variant and revision from the git layer)
        variant_id: z.string().nullable().optional(),
        revision_id: z.string().nullable().optional(),
    })
    .merge(timestampFieldsSchema)

export type Environment = z.infer<typeof environmentSchema>

// ============================================================================
// ENVIRONMENT REVISION SCHEMA
// ============================================================================

/**
 * Environment revision schema for revision history.
 *
 * Endpoint: POST /environments/revisions/query
 */
export const environmentRevisionSchema = z.object({
    id: z.string(),

    // Parent references
    environment_id: z.string().nullable().optional(),
    environment_variant_id: z.string().nullable().optional(),

    // Header fields
    name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    slug: z.string().nullable().optional(),

    /**
     * Version number - transformed from backend string to frontend number.
     * Backend returns version as Optional[str], we parse to number.
     */
    version: z
        .union([z.number(), z.string()])
        .transform((v) => {
            if (typeof v === "string") {
                const parsed = parseInt(v, 10)
                return isNaN(parsed) ? 0 : parsed
            }
            return v
        })
        .nullable()
        .optional(),

    // Commit fields
    author: z.string().nullable().optional(),
    message: z.string().nullable().optional(),

    // Revision data
    data: environmentRevisionDataSchema.nullable().optional(),

    // Lifecycle timestamps
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    created_by_id: z.string().nullable().optional(),
})

export type EnvironmentRevision = z.infer<typeof environmentRevisionSchema>

/**
 * Revision list item - lighter version for lists/history
 */
export const environmentRevisionListItemSchema = z.object({
    id: z.string(),
    version: z
        .union([z.number(), z.string()])
        .transform((v) => {
            if (typeof v === "string") {
                const parsed = parseInt(v, 10)
                return isNaN(parsed) ? 0 : parsed
            }
            return v
        })
        .nullable()
        .optional(),
    created_at: z.string().nullable().optional(),
    message: z.string().nullable().optional(),
    author: z.string().nullable().optional(),
    created_by_id: z.string().nullable().optional(),
})

export type EnvironmentRevisionListItem = z.infer<typeof environmentRevisionListItemSchema>

// ============================================================================
// RESPONSE SCHEMAS
// ============================================================================

/**
 * Query response for simple environments list
 */
export const environmentsResponseSchema = z.object({
    environments: z.array(environmentSchema),
    count: z.number().optional(),
})

export type EnvironmentsResponse = z.infer<typeof environmentsResponseSchema>

/**
 * Single environment response
 */
export const environmentResponseSchema = z.object({
    environment: environmentSchema.nullable().optional(),
    count: z.number().optional(),
})

export type EnvironmentResponse = z.infer<typeof environmentResponseSchema>

/**
 * Query response for environment revisions
 */
export const environmentRevisionsResponseSchema = z.object({
    environment_revisions: z.array(environmentRevisionSchema),
    count: z.number().optional(),
})

export type EnvironmentRevisionsResponse = z.infer<typeof environmentRevisionsResponseSchema>

/**
 * Single environment revision response
 */
export const environmentRevisionResponseSchema = z.object({
    environment_revision: environmentRevisionSchema.nullable().optional(),
    count: z.number().optional(),
})

export type EnvironmentRevisionResponse = z.infer<typeof environmentRevisionResponseSchema>

// ============================================================================
// NORMALIZATION UTILITIES
// ============================================================================

/**
 * Normalize environment from API response
 */
export function normalizeEnvironment(raw: unknown): Environment {
    const parsed = safeParseWithLogging(environmentSchema, raw, "[normalizeEnvironment]")
    if (!parsed) {
        throw new Error("[normalizeEnvironment] Invalid environment data")
    }
    return parsed
}

/**
 * Normalize environment revision from API response
 */
export function normalizeEnvironmentRevision(raw: unknown): EnvironmentRevision {
    const parsed = safeParseWithLogging(
        environmentRevisionSchema,
        raw,
        "[normalizeEnvironmentRevision]",
    )
    if (!parsed) {
        throw new Error("[normalizeEnvironmentRevision] Invalid environment revision data")
    }

    // Normalize author field
    if (!parsed.author && parsed.created_by_id) {
        parsed.author = parsed.created_by_id
    }

    return parsed
}

// ============================================================================
// HELPER UTILITIES
// ============================================================================

/**
 * Extract deployed app revision ID from environment revision data for a given app key.
 *
 * @param data - Environment revision data
 * @param appKey - App-scoped key (e.g., "myapp.default")
 * @returns The application_revision reference ID, or null
 */
export function getDeployedRevisionId(
    data: EnvironmentRevisionData | null | undefined,
    appKey: string,
): string | null {
    if (!data?.references) return null
    const appRefs = data.references[appKey]
    if (!appRefs) return null
    return appRefs.application_revision?.id ?? null
}

/**
 * Get all app keys from environment revision data
 */
export function getDeployedAppKeys(data: EnvironmentRevisionData | null | undefined): string[] {
    if (!data?.references) return []
    return Object.keys(data.references)
}

/**
 * Check if an environment is guarded
 */
export function isGuardedEnvironment(env: Environment): boolean {
    return env.flags?.is_guarded === true
}
