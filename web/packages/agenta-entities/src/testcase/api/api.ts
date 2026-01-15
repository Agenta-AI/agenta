/**
 * Testcase API Functions
 *
 * HTTP functions for fetching testcase data.
 */

import {axios, getAgentaApiUrl} from "@agenta/shared"

import {safeParseWithLogging} from "../../shared"
import {
    testcasesResponseSchema,
    flattenTestcase,
    type Testcase,
    type FlattenedTestcase,
    type TestcasesResponse,
} from "../core"
import type {
    TestcaseDetailParams,
    TestcaseListParams,
    TestcaseBatchParams,
    TestcasesPage,
} from "../core"

// ============================================================================
// SINGLE TESTCASE FETCH
// ============================================================================

/**
 * Fetch a single testcase by ID
 *
 * @example
 * ```typescript
 * const testcase = await fetchTestcase({
 *   projectId: 'proj-123',
 *   testcaseId: 'tc-456'
 * })
 * ```
 */
export async function fetchTestcase(params: TestcaseDetailParams): Promise<Testcase | null> {
    const {projectId, testcaseId} = params

    try {
        const response = await axios.post(
            `${getAgentaApiUrl()}/preview/testcases/query`,
            {testcase_ids: [testcaseId]},
            {params: {project_id: projectId}},
        )

        const validatedResponse = safeParseWithLogging(
            testcasesResponseSchema,
            response.data,
            "[fetchTestcase]",
        )
        if (!validatedResponse) return null

        return validatedResponse.testcases[0] || null
    } catch (error) {
        console.error("[fetchTestcase] Failed to fetch testcase:", error)
        return null
    }
}

/**
 * Fetch a single testcase and flatten for table display
 */
export async function fetchFlattenedTestcase(
    params: TestcaseDetailParams,
): Promise<FlattenedTestcase | null> {
    const testcase = await fetchTestcase(params)
    return testcase ? flattenTestcase(testcase) : null
}

// ============================================================================
// BATCH TESTCASE FETCH
// ============================================================================

/**
 * Fetch multiple testcases by IDs
 *
 * @example
 * ```typescript
 * const testcases = await fetchTestcasesBatch({
 *   projectId: 'proj-123',
 *   testcaseIds: ['tc-1', 'tc-2', 'tc-3']
 * })
 * ```
 */
export async function fetchTestcasesBatch(
    params: TestcaseBatchParams,
): Promise<Map<string, Testcase>> {
    const {projectId, testcaseIds} = params
    const results = new Map<string, Testcase>()

    if (!projectId || testcaseIds.length === 0) {
        return results
    }

    try {
        const response = await axios.post(
            `${getAgentaApiUrl()}/preview/testcases/query`,
            {testcase_ids: testcaseIds},
            {params: {project_id: projectId}},
        )

        const validatedResponse = safeParseWithLogging(
            testcasesResponseSchema,
            response.data,
            "[fetchTestcasesBatch]",
        )
        if (validatedResponse) {
            for (const testcase of validatedResponse.testcases) {
                results.set(testcase.id, testcase)
            }
        }
    } catch (error) {
        console.error("[fetchTestcasesBatch] Failed to fetch testcases:", error)
    }

    return results
}

/**
 * Fetch multiple testcases and flatten for table display
 */
export async function fetchFlattenedTestcasesBatch(
    params: TestcaseBatchParams,
): Promise<Map<string, FlattenedTestcase>> {
    const testcases = await fetchTestcasesBatch(params)
    const results = new Map<string, FlattenedTestcase>()

    for (const [id, testcase] of testcases) {
        results.set(id, flattenTestcase(testcase))
    }

    return results
}

// ============================================================================
// PAGINATED TESTCASE FETCH
// ============================================================================

/**
 * Default page size for pagination
 */
export const PAGE_SIZE = 50

/**
 * Fetch a page of testcases for a revision
 *
 * @example
 * ```typescript
 * const page = await fetchTestcasesPage({
 *   projectId: 'proj-123',
 *   revisionId: 'rev-456',
 *   cursor: null,
 *   limit: 50
 * })
 * ```
 */
export async function fetchTestcasesPage(params: TestcaseListParams): Promise<TestcasesPage> {
    const {projectId, revisionId, cursor = null, limit = PAGE_SIZE} = params

    if (!projectId || !revisionId) {
        return {
            testcases: [],
            count: 0,
            nextCursor: null,
            hasMore: false,
        }
    }

    try {
        const response = await axios.post(
            `${getAgentaApiUrl()}/preview/testcases/query`,
            {
                testset_revision_id: revisionId,
                windowing: {
                    limit,
                    ...(cursor && {next: cursor}),
                },
            },
            {params: {project_id: projectId}},
        )

        const validated = safeParseWithLogging(
            testcasesResponseSchema,
            response.data,
            "[fetchTestcasesPage]",
        )
        if (!validated) {
            return {
                testcases: [],
                count: 0,
                nextCursor: null,
                hasMore: false,
            }
        }

        const flattenedTestcases = validated.testcases.map(flattenTestcase)

        return {
            testcases: flattenedTestcases,
            count: validated.count,
            nextCursor: validated.windowing?.next || null,
            hasMore: Boolean(validated.windowing?.next),
        }
    } catch (error) {
        console.error("[fetchTestcasesPage] Failed to fetch testcases page:", error)
        return {
            testcases: [],
            count: 0,
            nextCursor: null,
            hasMore: false,
        }
    }
}

// ============================================================================
// RAW API RESPONSE FETCH
// ============================================================================

/**
 * Fetch raw testcases response (for advanced use cases)
 */
export async function fetchTestcasesRaw(
    projectId: string,
    query: {
        testcase_ids?: string[]
        testset_id?: string
        testset_revision_id?: string
        windowing?: {
            newest?: string
            oldest?: string
            next?: string
            limit?: number
            order?: "ascending" | "descending"
        }
    },
): Promise<TestcasesResponse | null> {
    try {
        const response = await axios.post(`${getAgentaApiUrl()}/preview/testcases/query`, query, {
            params: {project_id: projectId},
        })

        return safeParseWithLogging(testcasesResponseSchema, response.data, "[fetchTestcasesRaw]")
    } catch (error) {
        console.error("[fetchTestcasesRaw] Failed to fetch testcases:", error)
        return null
    }
}
