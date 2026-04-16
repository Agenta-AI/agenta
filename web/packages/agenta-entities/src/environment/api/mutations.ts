/**
 * Environment API Mutations
 *
 * HTTP API functions for mutating environment entities.
 * Uses the new SimpleEnvironment and revision commit APIs from PR #3627.
 */

import {getAgentaApiUrl, axios} from "@agenta/shared/api"
import {v4 as uuidv4} from "uuid"

import {safeParseWithLogging} from "../../shared"
import {
    environmentResponseSchema,
    environmentRevisionResponseSchema,
    type Environment,
    type EnvironmentRevision,
} from "../core"
import type {
    CreateEnvironmentParams,
    EditEnvironmentParams,
    EnvironmentRevisionCommitParams,
    DeployToEnvironmentParams,
} from "../core"

// ============================================================================
// SIMPLE ENVIRONMENT CRUD
// ============================================================================

/**
 * Create a new simple environment
 */
export async function createEnvironment(
    params: CreateEnvironmentParams,
): Promise<Environment | null> {
    const {projectId, slug, name, description, flags, data} = params

    const response = await axios.post(
        `${getAgentaApiUrl()}/simple/environments/`,
        {
            environment: {
                slug,
                name,
                description,
                flags,
                data,
            },
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        environmentResponseSchema,
        response.data,
        "[createEnvironment]",
    )
    return validated?.environment ?? null
}

/**
 * Edit an existing simple environment
 */
export async function editEnvironment(params: EditEnvironmentParams): Promise<Environment | null> {
    const {projectId, environmentId, name, description, flags, data} = params

    const response = await axios.put(
        `${getAgentaApiUrl()}/simple/environments/${environmentId}`,
        {
            environment: {
                id: environmentId,
                name,
                description,
                flags,
                data,
            },
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        environmentResponseSchema,
        response.data,
        "[editEnvironment]",
    )
    return validated?.environment ?? null
}

/**
 * Archive a simple environment
 */
export async function archiveEnvironment(
    projectId: string,
    environmentId: string,
): Promise<Environment | null> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/simple/environments/${environmentId}/archive`,
        {},
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        environmentResponseSchema,
        response.data,
        "[archiveEnvironment]",
    )
    return validated?.environment ?? null
}

/**
 * Unarchive a simple environment
 */
export async function unarchiveEnvironment(
    projectId: string,
    environmentId: string,
): Promise<Environment | null> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/simple/environments/${environmentId}/unarchive`,
        {},
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        environmentResponseSchema,
        response.data,
        "[unarchiveEnvironment]",
    )
    return validated?.environment ?? null
}

/**
 * Guard a simple environment (set is_guarded = true)
 */
export async function guardEnvironment(
    projectId: string,
    environmentId: string,
): Promise<Environment | null> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/simple/environments/${environmentId}/guard`,
        {},
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        environmentResponseSchema,
        response.data,
        "[guardEnvironment]",
    )
    return validated?.environment ?? null
}

/**
 * Unguard a simple environment (set is_guarded = false)
 */
export async function unguardEnvironment(
    projectId: string,
    environmentId: string,
): Promise<Environment | null> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/simple/environments/${environmentId}/unguard`,
        {},
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        environmentResponseSchema,
        response.data,
        "[unguardEnvironment]",
    )
    return validated?.environment ?? null
}

// ============================================================================
// ENVIRONMENT REVISION MUTATIONS
// ============================================================================

/**
 * Commit an environment revision (deploy or update references)
 *
 * This is the core mutation for deploying app revisions to environments.
 * Supports both full data snapshots and incremental delta operations.
 */
export async function commitEnvironmentRevision(
    params: EnvironmentRevisionCommitParams,
): Promise<EnvironmentRevision | null> {
    const {projectId, environmentId, environmentVariantId, data, delta, message} = params

    const slug = uuidv4().replace(/-/g, "").slice(-12)

    const response = await axios.post(
        `${getAgentaApiUrl()}/environments/revisions/commit`,
        {
            environment_revision_commit: {
                slug,
                environment_id: environmentId,
                environment_variant_id: environmentVariantId,
                data,
                delta,
                message,
            },
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        environmentRevisionResponseSchema,
        response.data,
        "[commitEnvironmentRevision]",
    )
    return validated?.environment_revision ?? null
}

/**
 * Deploy an app revision to an environment.
 *
 * High-level helper that creates a revision commit with the appropriate
 * reference delta for a single app deployment.
 */
export async function deployToEnvironment(
    params: DeployToEnvironmentParams,
): Promise<EnvironmentRevision | null> {
    const {projectId, environmentId, environmentVariantId, appKey, references, message} = params

    return commitEnvironmentRevision({
        projectId,
        environmentId,
        environmentVariantId,
        delta: {
            set: {
                [appKey]: references,
            },
        },
        message: message ?? `Deploy ${appKey}`,
    })
}

/**
 * Remove an app deployment from an environment.
 */
export async function undeployFromEnvironment(
    projectId: string,
    environmentId: string,
    environmentVariantId: string,
    appKey: string,
    message?: string,
): Promise<EnvironmentRevision | null> {
    return commitEnvironmentRevision({
        projectId,
        environmentId,
        environmentVariantId,
        delta: {
            remove: [appKey],
        },
        message: message ?? `Undeploy ${appKey}`,
    })
}
