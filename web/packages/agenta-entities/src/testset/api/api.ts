/**
 * Testset API Functions
 *
 * HTTP API functions for fetching testset entities.
 * These are pure functions with no Jotai dependencies.
 */

import {getAgentaSdkClient} from "@agenta/sdk"
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
    const response = await axios.get(`${getAgentaApiUrl()}/testsets/revisions/${id}`, {
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
        `${getAgentaApiUrl()}/testsets/revisions/query`,
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
        `${getAgentaApiUrl()}/testsets/revisions/query`,
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
        `${getAgentaApiUrl()}/testsets/revisions/query`,
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
        `${getAgentaApiUrl()}/testsets/revisions/query`,
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
        `${getAgentaApiUrl()}/testsets/revisions/query`,
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
 * Fetch testsets list (metadata only).
 *
 * Migrated to consume the Fern-generated `@agentaai/api-client` via `@agenta/sdk`
 * (v3 PoC). Zod validation stays at the boundary because Fern's compile-time
 * types under-declare backend `extra="allow"` fields — drift detection still
 * has independent value.
 */
export async function fetchTestsetsList({
    projectId,
    searchQuery = null,
}: TestsetListParams): Promise<TestsetsResponse> {
    if (!projectId) {
        return {testsets: [], count: 0}
    }

    const client = getAgentaSdkClient({host: getAgentaApiUrl()})

    const data = await client.testsets.queryTestsets(
        {
            windowing: {limit: 100, order: "descending"},
            ...(searchQuery && searchQuery.trim() ? {testset: {name: searchQuery.trim()}} : {}),
        },
        {queryParams: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(testsetsResponseSchema, data, "[fetchTestsetsList]")
    if (!validated) {
        return {testsets: [], count: 0}
    }
    return validated
}

/**
 * Fetch multiple testsets by ID in a single API call (metadata only).
 * Uses POST /testsets/query with testset_refs.
 */
export async function fetchTestsetsBatch(
    projectId: string,
    testsetIds: string[],
): Promise<Map<string, Testset>> {
    const results = new Map<string, Testset>()
    if (!projectId || testsetIds.length === 0) return results

    const response = await axios.post(
        `${getAgentaApiUrl()}/testsets/query`,
        {
            testset_refs: testsetIds.map((id) => ({id})),
            windowing: {limit: testsetIds.length},
        },
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        testsetsResponseSchema,
        response.data,
        "[fetchTestsetsBatch]",
    )
    if (validated) {
        for (const testset of validated.testsets) {
            results.set(testset.id, testset)
        }
    }

    return results
}

/**
 * Fetch a single testset by ID (metadata only)
 */
export async function fetchTestsetDetail({id, projectId}: TestsetDetailParams): Promise<Testset> {
    const response = await axios.get(`${getAgentaApiUrl()}/testsets/${id}`, {
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
    const response = await axios.get(`${getAgentaApiUrl()}/testsets/variants/${id}`, {
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
