/**
 * Testset API Functions
 *
 * HTTP API functions for fetching testset entities.
 * These are pure functions with no Jotai dependencies.
 */

import {getAgentaApiUrl, axios} from "@agenta/shared/api"

import {safeParseWithLogging} from "../../shared"
import {
    revisionSchema,
    revisionsResponseSchema,
    testsetSchema,
    testsetsResponseSchema,
    variantSchema,
    normalizeRevision,
    type Revision,
    type RevisionsResponse,
    type Testset,
    type TestsetsResponse,
    type Variant,
} from "../core"
import type {
    RevisionDetailParams,
    RevisionListParams,
    TestsetListParams,
    TestsetDetailParams,
    VariantDetailParams,
} from "../core"

// ============================================================================
// REVISION API
// ============================================================================

/**
 * Fetch a single revision by ID
 */
export async function fetchRevision({id, projectId}: RevisionDetailParams): Promise<Revision> {
    const response = await axios.get(`${getAgentaApiUrl()}/preview/testsets/revisions/${id}`, {
        params: {project_id: projectId, include_testcases: false},
    })
    const validated = safeParseWithLogging(
        revisionSchema,
        response.data?.testset_revision ?? response.data,
        "[fetchRevision]",
    )
    if (!validated) {
        throw new Error(`[fetchRevision] Invalid revision response for id=${id}`)
    }
    return validated
}

/**
 * Fetch a single revision by ID with testcases included
 */
export async function fetchRevisionWithTestcases({
    id,
    projectId,
}: RevisionDetailParams): Promise<Revision | null> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/testsets/revisions/query`,
        {
            testset_revision_refs: [{id}],
            windowing: {limit: 1},
        },
        {params: {project_id: projectId, include_testcases: true}},
    )

    const revisions = response.data?.testset_revisions ?? []
    if (revisions.length === 0) return null

    return normalizeRevision(revisions[0])
}

/**
 * Fetch revisions list for a testset
 */
export async function fetchRevisionsList({
    projectId,
    testsetId,
}: RevisionListParams): Promise<RevisionsResponse> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/testsets/revisions/query`,
        {
            testset_refs: [{id: testsetId}],
            windowing: {limit: 100, order: "descending"},
            include_testcases: false,
        },
        {params: {project_id: projectId}},
    )
    const validated = safeParseWithLogging(
        revisionsResponseSchema,
        response.data,
        "[fetchRevisionsList]",
    )
    if (!validated) {
        return {testset_revisions: [], count: 0}
    }
    return validated
}

/**
 * Fetch the latest revision for a testset (optimized - fetches only 1 revision)
 */
export async function fetchLatestRevision({
    projectId,
    testsetId,
}: RevisionListParams): Promise<Revision | null> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/testsets/revisions/query`,
        {
            testset_refs: [{id: testsetId}],
            windowing: {limit: 1, order: "descending"},
            include_testcases: false,
        },
        {params: {project_id: projectId}},
    )
    const validated = safeParseWithLogging(
        revisionsResponseSchema,
        response.data,
        "[fetchLatestRevision]",
    )
    if (!validated || validated.testset_revisions.length === 0) {
        return null
    }
    return normalizeRevision(validated.testset_revisions[0])
}

/**
 * Batch fetch latest revisions for multiple testsets
 * Returns a Map of testsetId -> latest Revision
 *
 * Uses per-ref limit feature (ReferenceWithLimit) to get exactly 1 revision per testset.
 * The API uses SQL window functions to partition by testset and return top N per partition.
 */
export async function fetchLatestRevisionsBatch(
    projectId: string,
    testsetIds: string[],
): Promise<Map<string, Revision>> {
    const results = new Map<string, Revision>()

    if (!projectId || testsetIds.length === 0) return results

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/testsets/revisions/query`,
        {
            // Use per-ref limit to get exactly 1 revision per testset
            testset_refs: testsetIds.map((id) => ({id, limit: 1})),
            include_testcases: false,
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        revisionsResponseSchema,
        response.data,
        "[fetchLatestRevisionsBatch]",
    )
    if (!validated) return results

    // Map revisions by testset_id
    for (const raw of validated.testset_revisions) {
        try {
            const revision = normalizeRevision(raw)
            results.set(revision.testset_id, revision)
        } catch (e) {
            console.error("[fetchLatestRevisionsBatch] Failed to normalize revision:", e, raw)
        }
    }

    return results
}

/**
 * Batch fetch revisions by IDs
 */
export async function fetchRevisionsBatch(
    projectId: string,
    revisionIds: string[],
): Promise<Map<string, Revision>> {
    const results = new Map<string, Revision>()

    if (!projectId || revisionIds.length === 0) return results

    const requestBody = {
        testset_revision_refs: revisionIds.map((id) => ({id})),
        windowing: {limit: revisionIds.length},
    }

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/testsets/revisions/query`,
        requestBody,
        {params: {project_id: projectId, include_testcases: false}},
    )

    const revisions = response.data?.testset_revisions ?? []
    revisions.forEach((raw: unknown) => {
        try {
            const revision = normalizeRevision(raw)
            results.set(revision.id, revision)
        } catch (e) {
            console.error("[fetchRevisionsBatch] Failed to normalize revision:", e, raw)
        }
    })

    return results
}

// ============================================================================
// TESTSET API
// ============================================================================

/**
 * Fetch testsets list (metadata only)
 */
export async function fetchTestsetsList({
    projectId,
    searchQuery = null,
}: TestsetListParams): Promise<TestsetsResponse> {
    if (!projectId) {
        return {testsets: [], count: 0}
    }

    const queryPayload: Record<string, unknown> = {
        windowing: {limit: 100, order: "descending"},
    }

    if (searchQuery && searchQuery.trim()) {
        queryPayload.testset = {
            name: searchQuery.trim(),
        }
    }

    const response = await axios.post(`${getAgentaApiUrl()}/preview/testsets/query`, queryPayload, {
        params: {project_id: projectId},
    })

    const validated = safeParseWithLogging(
        testsetsResponseSchema,
        response.data,
        "[fetchTestsetsList]",
    )
    if (!validated) {
        return {testsets: [], count: 0}
    }
    return validated
}

/**
 * Fetch a single testset by ID (metadata only)
 */
export async function fetchTestsetDetail({id, projectId}: TestsetDetailParams): Promise<Testset> {
    const response = await axios.get(`${getAgentaApiUrl()}/preview/testsets/${id}`, {
        params: {project_id: projectId},
    })
    const validated = safeParseWithLogging(
        testsetSchema,
        response.data?.testset ?? response.data,
        "[fetchTestsetDetail]",
    )
    if (!validated) {
        throw new Error(`[fetchTestsetDetail] Invalid testset response for id=${id}`)
    }
    return validated
}

// ============================================================================
// VARIANT API
// ============================================================================

/**
 * Fetch a single variant by ID (contains name and description)
 */
export async function fetchVariantDetail({id, projectId}: VariantDetailParams): Promise<Variant> {
    const response = await axios.get(`${getAgentaApiUrl()}/preview/testsets/variants/${id}`, {
        params: {project_id: projectId},
    })
    const validated = safeParseWithLogging(
        variantSchema,
        response.data?.testset_variant ?? response.data,
        "[fetchVariantDetail]",
    )
    if (!validated) {
        throw new Error(`[fetchVariantDetail] Invalid variant response for id=${id}`)
    }
    return validated
}
