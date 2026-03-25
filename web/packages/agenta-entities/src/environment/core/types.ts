/**
 * Environment Entity Types
 *
 * TypeScript interfaces for API parameters and internal types.
 */

// ============================================================================
// API PARAMETER TYPES
// ============================================================================

/**
 * List params for fetching environments
 */
export interface EnvironmentListParams {
    projectId: string
    includeArchived?: boolean
}

/**
 * Detail params for fetching a single environment
 */
export interface EnvironmentDetailParams {
    id: string
    projectId: string
}

/**
 * Params for fetching environment revisions
 */
export interface EnvironmentRevisionListParams {
    projectId: string
    environmentId: string
    /** Filter by application ID - only return revisions that contain this app */
    applicationId?: string
}

/**
 * Params for fetching a single environment revision
 */
export interface EnvironmentRevisionDetailParams {
    id: string
    projectId: string
}

// ============================================================================
// MUTATION TYPES
// ============================================================================

/**
 * Delta operations for environment revision commit.
 *
 * - `set`: references to add or update (key → dict of entity → Reference)
 * - `remove`: reference keys to remove
 *
 * Maps to backend `EnvironmentRevisionDelta` DTO.
 */
export interface EnvironmentRevisionDelta {
    set?: Record<string, Record<string, {id?: string; slug?: string; version?: string}>>
    remove?: string[]
}

/**
 * Params for committing an environment revision
 */
export interface EnvironmentRevisionCommitParams {
    projectId: string
    environmentId: string
    environmentVariantId: string
    /** Full data snapshot (replaces all references) */
    data?: {
        references?: Record<string, Record<string, {id?: string; slug?: string; version?: string}>>
    }
    /** Delta operations (incremental changes) */
    delta?: EnvironmentRevisionDelta
    message?: string
}

/**
 * Params for creating a simple environment
 */
export interface CreateEnvironmentParams {
    projectId: string
    slug: string
    name: string
    description?: string
    flags?: {is_guarded?: boolean}
    data?: {
        references?: Record<string, Record<string, {id?: string; slug?: string; version?: string}>>
    }
}

/**
 * Params for editing a simple environment
 */
export interface EditEnvironmentParams {
    projectId: string
    environmentId: string
    name?: string
    description?: string
    flags?: {is_guarded?: boolean}
    data?: {
        references?: Record<string, Record<string, {id?: string; slug?: string; version?: string}>>
    }
}

// ============================================================================
// DEPLOY TYPES
// ============================================================================

/**
 * Params for deploying an app revision to an environment.
 * This is a high-level operation that creates a revision commit
 * with the appropriate reference delta.
 */
export interface DeployToEnvironmentParams {
    projectId: string
    environmentId: string
    environmentVariantId: string
    /** App-scoped key (e.g., "myapp.default") */
    appKey: string
    /** References to deploy */
    references: {
        application: {id: string; slug?: string}
        application_variant: {id: string; slug?: string}
        application_revision: {id: string; slug?: string; version?: string}
    }
    message?: string
}
