/**
 * Testset API Functions
 *
 * HTTP API functions for fetching testset entities.
 * These are pure functions with no Jotai dependencies.
 */

import {getTestsetsClient} from "@agenta/sdk/resources"
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
    testcaseLimit,
}: RevisionDetailParams & {testcaseLimit?: number}): Promise<Revision | null> {
    if (testcaseLimit) {
        const response = await axios.post(
            `${getAgentaApiUrl()}/testsets/revisions/retrieve`,
            {
                testset_revision_ref: {id},
                include_testcases: true,
                windowing: {limit: testcaseLimit},
            },
            {params: {project_id: projectId}},
        )

        const revision = response.data?.testset_revision ?? response.data
        if (!revision) return null

        return normalizeRevision(revision)
    }

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
 * The column names of a revision: the top-level keys of every row, in first-seen order.
 *
 * It reads every row, because a table reads its columns from the first rows only and a name
 * used only by a later row would be missed. It throws when the revision does not return all its
 * rows, since a missing row could hold a name the caller is checking.
 */
export async function fetchRevisionColumnKeys({
    projectId,
    revisionId,
}: {
    projectId: string
    revisionId: string
}): Promise<{keys: string[]; hasRows: boolean}> {
    const revision = await fetchRevisionWithTestcases({id: revisionId, projectId})
    if (!revision) throw new Error("The revision was not found")
    const ids = revision.data?.testcase_ids
    const testcases = revision.data?.testcases
    if (!ids?.length && !testcases?.length) return {keys: [], hasRows: false}
    if (!Array.isArray(testcases) || (ids && ids.length !== testcases.length)) {
        throw new Error("The revision did not return all its testcases")
    }
    const keys = new Set<string>()
    for (const testcase of testcases) {
        const data = (testcase as {data?: Record<string, unknown> | null}).data
        for (const [key, value] of Object.entries(data ?? {})) {
            if (value !== undefined) keys.add(key)
        }
    }
    return {keys: [...keys], hasRows: true}
}

/**
 * Fetch the latest revision for a testset with testcases included.
 * Supports limiting embedded testcases when callers only need a column sample.
 */
export async function fetchLatestRevisionWithTestcases({
    projectId,
    testsetId,
    testcaseLimit,
}: RevisionListParams & {testcaseLimit?: number}): Promise<Revision | null> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/testsets/revisions/retrieve`,
        {
            testset_ref: {id: testsetId},
            include_testcases: true,
            ...(testcaseLimit ? {windowing: {limit: testcaseLimit}} : {}),
        },
        {params: {project_id: projectId}},
    )

    const revision = response.data?.testset_revision ?? response.data
    if (!revision) return null

    return normalizeRevision(revision)
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

    const data = await getTestsetsClient().queryTestsets(
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
 * Fetch one page of testsets, newest first.
 * The name filter goes in the request body. Errors throw (no silent empty page).
 */
export async function queryTestsetsPage(params: {
    projectId: string
    limit: number
    cursor?: string | null
    name?: string
    includeArchived?: boolean
}): Promise<{testsets: Testset[]; nextCursor: string | null}> {
    const {projectId, limit, cursor, name, includeArchived = false} = params
    const trimmedName = name?.trim()

    const data = await getTestsetsClient().queryTestsets(
        {
            windowing: {limit, order: "descending", ...(cursor ? {next: cursor} : {})},
            include_archived: includeArchived,
            ...(trimmedName ? {testset: {name: trimmedName}} : {}),
        },
        {queryParams: {project_id: projectId}},
    )

    const validated = testsetsResponseSchema.parse(data)
    return {testsets: validated.testsets, nextCursor: validated.windowing?.next ?? null}
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
