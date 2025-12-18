import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"

import {
    testcasesResponseSchema,
    flattenTestcase,
    type Testcase,
    type FlattenedTestcase,
    type TestcasesQueryRequest,
} from "./schema"
import type {FetchTestcasesParams, FetchTestcasesResponse} from "./store"

/**
 * Fetch testcases using the /preview/testcases/query endpoint
 * With runtime validation via Zod
 */
export const fetchTestcasesWindow = async ({
    projectId,
    testsetId,
    limit,
    offset,
    cursor = null,
}: FetchTestcasesParams): Promise<FetchTestcasesResponse> => {
    if (!projectId) {
        return {
            rows: [],
            totalCount: 0,
            hasMore: false,
            nextOffset: null,
            nextCursor: null,
        }
    }

    try {
        // Build query request
        const queryRequest: TestcasesQueryRequest = {
            ...(testsetId && {testset_id: testsetId}),
            windowing: {
                limit,
                ...(cursor && {next: cursor}),
            },
        }

        // Call API
        const response = await axios.post(
            `${getAgentaApiUrl()}/preview/testcases/query`,
            queryRequest,
            {
                params: {project_id: projectId},
            },
        )

        // Validate response with Zod
        const validatedResponse = testcasesResponseSchema.parse(response.data)

        // Flatten testcases for table display
        const flattenedRows = validatedResponse.testcases.map(flattenTestcase)

        // Client-side offset pagination
        // (API uses cursor-based, but we need offset for table compatibility)
        const paginatedRows = flattenedRows.slice(offset, offset + limit)
        const totalCount = flattenedRows.length
        const hasMore = offset + paginatedRows.length < totalCount

        return {
            rows: paginatedRows,
            totalCount,
            hasMore,
            nextOffset: hasMore ? offset + paginatedRows.length : null,
            nextCursor: validatedResponse.windowing?.next || null,
        }
    } catch (error) {
        console.error("[TestcaseEntity] Failed to fetch testcases:", error)
        // Log Zod validation errors for debugging
        if (error && typeof error === "object" && "issues" in error) {
            console.error("[TestcaseEntity] Zod validation errors:", error)
        }
        return {
            rows: [],
            totalCount: 0,
            hasMore: false,
            nextOffset: null,
            nextCursor: null,
        }
    }
}

/**
 * Fetch a single testcase by ID
 */
export const fetchTestcase = async (params: {
    projectId: string
    testcaseId: string
}): Promise<Testcase | null> => {
    const {projectId, testcaseId} = params

    try {
        const response = await axios.post(
            `${getAgentaApiUrl()}/preview/testcases/query`,
            {testcase_ids: [testcaseId]},
            {params: {project_id: projectId}},
        )

        const validatedResponse = testcasesResponseSchema.parse(response.data)
        return validatedResponse.testcases[0] || null
    } catch (error) {
        console.error("[TestcaseEntity] Failed to fetch testcase:", error)
        return null
    }
}

/**
 * Create a new testcase
 */
export const createTestcase = async (params: {
    projectId: string
    revisionId: string
    testcase: Partial<Testcase>
}): Promise<Testcase> => {
    // TODO: Implement create endpoint when available
    throw new Error("Not implemented")
}

/**
 * Update an existing testcase
 */
export const updateTestcase = async (params: {
    projectId: string
    revisionId: string
    testcaseId: string
    updates: Partial<Testcase>
}): Promise<Testcase> => {
    // TODO: Implement update endpoint when available
    throw new Error("Not implemented")
}

/**
 * Delete a testcase
 */
export const deleteTestcase = async (params: {
    projectId: string
    revisionId: string
    testcaseId: string
}): Promise<void> => {
    // TODO: Implement delete endpoint when available
    throw new Error("Not implemented")
}
