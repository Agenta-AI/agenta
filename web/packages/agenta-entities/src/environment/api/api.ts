/**
 * Environment API Functions
 *
 * HTTP API functions for fetching environment entities.
 * These are pure functions with no Jotai dependencies.
 *
 * Uses the new SimpleEnvironment API from PR #3627.
 */

import {getAgentaApiUrl, axios} from "@agenta/shared/api"

import {safeParseWithLogging} from "../../shared"
import {
    environmentSchema,
    environmentsResponseSchema,
    environmentRevisionsResponseSchema,
    normalizeEnvironment,
    type Environment,
    type EnvironmentsResponse,
    type EnvironmentRevisionsResponse,
    type EnvironmentRevision,
} from "../core"
import type {
    EnvironmentListParams,
    EnvironmentDetailParams,
    EnvironmentRevisionListParams,
} from "../core"

// ============================================================================
// SIMPLE ENVIRONMENT API
// ============================================================================

/**
 * Fetch environments list using SimpleEnvironment API
 */
export async function fetchEnvironmentsList({
    projectId,
    includeArchived = false,
}: EnvironmentListParams): Promise<EnvironmentsResponse> {
    if (!projectId) {
        return {environments: [], count: 0}
    }

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/simple/environments/query`,
        {
            include_archived: includeArchived,
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        environmentsResponseSchema,
        response.data,
        "[fetchEnvironmentsList]",
    )
    if (!validated) {
        return {environments: [], count: 0}
    }
    return validated
}

/**
 * Fetch a single environment by ID using SimpleEnvironment API
 */
export async function fetchEnvironmentDetail({
    id,
    projectId,
}: EnvironmentDetailParams): Promise<Environment> {
    const response = await axios.get(`${getAgentaApiUrl()}/preview/simple/environments/${id}`, {
        params: {project_id: projectId},
    })

    const validated = safeParseWithLogging(
        environmentSchema,
        response.data?.environment ?? response.data,
        "[fetchEnvironmentDetail]",
    )
    if (!validated) {
        throw new Error(`[fetchEnvironmentDetail] Invalid environment response for id=${id}`)
    }
    return validated
}

// ============================================================================
// ENVIRONMENT REVISION API
// ============================================================================

/**
 * Fetch environment revisions list (revision history)
 */
export async function fetchEnvironmentRevisionsList({
    projectId,
    environmentId,
}: EnvironmentRevisionListParams): Promise<EnvironmentRevisionsResponse> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/environments/revisions/query`,
        {
            environment_refs: [{id: environmentId}],
            windowing: {limit: 100, order: "descending"},
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        environmentRevisionsResponseSchema,
        response.data,
        "[fetchEnvironmentRevisionsList]",
    )
    if (!validated) {
        return {environment_revisions: [], count: 0}
    }
    return validated
}

/**
 * Fetch the latest environment revision (optimized - limit 1)
 */
export async function fetchLatestEnvironmentRevision({
    projectId,
    environmentId,
}: EnvironmentRevisionListParams): Promise<EnvironmentRevision | null> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/environments/revisions/query`,
        {
            environment_refs: [{id: environmentId}],
            windowing: {limit: 1, order: "descending"},
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        environmentRevisionsResponseSchema,
        response.data,
        "[fetchLatestEnvironmentRevision]",
    )
    if (!validated || validated.environment_revisions.length === 0) {
        return null
    }
    return validated.environment_revisions[0]
}

/**
 * Batch fetch environments by IDs
 */
export async function fetchEnvironmentsBatch(
    projectId: string,
    environmentIds: string[],
): Promise<Map<string, Environment>> {
    const results = new Map<string, Environment>()

    if (!projectId || environmentIds.length === 0) return results

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/simple/environments/query`,
        {
            environment_refs: environmentIds.map((id) => ({id})),
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        environmentsResponseSchema,
        response.data,
        "[fetchEnvironmentsBatch]",
    )
    if (!validated) return results

    for (const raw of validated.environments) {
        try {
            const env = normalizeEnvironment(raw)
            results.set(env.id, env)
        } catch (e) {
            console.error("[fetchEnvironmentsBatch] Failed to normalize environment:", e, raw)
        }
    }

    return results
}
