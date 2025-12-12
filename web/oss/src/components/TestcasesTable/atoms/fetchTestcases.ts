import type {WindowingState} from "@/oss/components/InfiniteVirtualTable/types"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"

import type {TestcaseApiRow} from "./types"

export interface QueryWindowingPayload {
    limit: number
    order?: "ascending" | "descending"
    next?: string
    newest?: string
    oldest?: string
}

export interface TestcasesWindowResult {
    rows: TestcaseApiRow[]
    totalCount: number
    hasMore: boolean
    nextOffset: number | null
    nextCursor: string | null
    nextWindowing: WindowingState | null
}

interface FetchTestcasesWindowParams {
    projectId: string
    testsetId: string
    limit: number
    offset: number
    cursor?: string | null
}

/**
 * Fetch testcases with server-side pagination via POST /preview/testcases/query
 */
export const fetchTestcasesWindow = async ({
    projectId,
    testsetId,
    limit,
    offset,
    cursor = null,
}: FetchTestcasesWindowParams): Promise<TestcasesWindowResult> => {
    if (!projectId || !testsetId) {
        return {
            rows: [],
            totalCount: 0,
            hasMore: false,
            nextOffset: null,
            nextCursor: null,
            nextWindowing: null,
        }
    }

    const windowingPayload: QueryWindowingPayload = {
        limit,
        order: "ascending", // Keep testcases in order
    }

    if (cursor) {
        windowingPayload.next = cursor
    }

    // Build query payload
    const queryPayload: Record<string, unknown> = {
        testset_id: testsetId,
        windowing: windowingPayload,
    }

    try {
        const response = await axios.post(
            `${getAgentaApiUrl()}/preview/testcases/query`,
            queryPayload,
            {
                params: {project_id: projectId},
            },
        )

        const data = response.data
        const testcases = data?.testcases ?? []
        const count = data?.count ?? testcases.length
        const responseWindowing = data?.windowing

        // Map API response to table rows
        // Testcase has: id, testset_id, created_at, data (dynamic key-value pairs)
        const rows: TestcaseApiRow[] = testcases.map((testcase: any) => ({
            id: testcase.id,
            testset_id: testcase.testset_id ?? testcase.set_id,
            created_at: testcase.created_at,
            // Flatten the data object into the row for column display
            ...testcase.data,
        }))

        // Use windowing.next from response if available, otherwise use last row ID
        const nextCursor =
            responseWindowing?.next ?? (rows.length > 0 ? rows[rows.length - 1].id : null)

        // Determine if there are more results
        // hasMore is true if we got a full page AND (count indicates more OR we have a next cursor)
        const hasMore =
            rows.length === limit && (offset + rows.length < count || Boolean(nextCursor))

        return {
            rows,
            totalCount: count,
            hasMore,
            nextOffset: hasMore ? offset + rows.length : null,
            nextCursor: hasMore ? nextCursor : null,
            nextWindowing: hasMore && nextCursor ? {next: nextCursor} : null,
        }
    } catch (error) {
        console.error("[TestcasesTable] Failed to fetch testcases:", error)
        return {
            rows: [],
            totalCount: 0,
            hasMore: false,
            nextOffset: null,
            nextCursor: null,
            nextWindowing: null,
        }
    }
}

/**
 * Fetch testset metadata (name, columns) for the testcases table header
 * Uses /preview/testsets/query to get testset name
 */
export const fetchTestsetMetadata = async ({
    projectId,
    testsetId,
}: {
    projectId: string
    testsetId: string
}): Promise<{name: string; columns: string[]} | null> => {
    if (!projectId || !testsetId) {
        return null
    }

    try {
        // Fetch testset metadata using the query endpoint
        const response = await axios.post(
            `${getAgentaApiUrl()}/preview/testsets/query`,
            {
                testset_refs: [{id: testsetId}],
                windowing: {limit: 1},
            },
            {
                params: {project_id: projectId},
            },
        )

        const testsets = response.data?.testsets ?? []
        if (testsets.length === 0) {
            return null
        }

        const testset = testsets[0]
        const columns: string[] = testset.columns ?? []

        return {
            name: testset.name ?? "",
            columns,
        }
    } catch (error) {
        console.error("[TestcasesTable] Failed to fetch testset metadata:", error)
        return null
    }
}
