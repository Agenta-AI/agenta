import type {WindowingState} from "@/oss/components/InfiniteVirtualTable/types"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"

import type {TestsetApiRow} from "./tableStore"

export interface QueryWindowingPayload {
    limit: number
    order?: "ascending" | "descending"
    next?: string
    newest?: string
    oldest?: string
}

export interface TestsetsWindowResult {
    rows: TestsetApiRow[]
    totalCount: number
    hasMore: boolean
    nextOffset: number | null
    nextCursor: string | null
    nextWindowing: WindowingState | null
}

interface FetchTestsetsWindowParams {
    projectId: string
    limit: number
    offset: number
    cursor?: string | null
    searchQuery?: string | null
    dateRange?: {from?: string | null; to?: string | null} | null
}

/**
 * Fetch testsets with server-side pagination via POST /preview/testsets/query
 * Uses the lighter endpoint that returns metadata only (no testcases)
 */
export const fetchTestsetsWindow = async ({
    projectId,
    limit,
    offset,
    cursor = null,
    searchQuery = null,
    dateRange = null,
}: FetchTestsetsWindowParams): Promise<TestsetsWindowResult> => {
    if (!projectId) {
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
        order: "descending",
    }

    if (cursor) {
        windowingPayload.next = cursor
    }

    if (dateRange?.to) {
        windowingPayload.newest = dateRange.to
    }
    if (dateRange?.from) {
        windowingPayload.oldest = dateRange.from
    }

    // Build query payload
    const queryPayload: Record<string, unknown> = {
        windowing: windowingPayload,
    }

    // Add search query if provided
    if (searchQuery && searchQuery.trim()) {
        queryPayload.testset = {
            name: searchQuery.trim(),
        }
    }

    try {
        // Use /preview/testsets/query - returns Testset metadata without testcases
        const response = await axios.post(
            `${getAgentaApiUrl()}/preview/testsets/query`,
            queryPayload,
            {
                params: {project_id: projectId},
            },
        )

        const data = response.data
        const testsets = data?.testsets ?? []
        const count = data?.count ?? testsets.length
        const windowing = data?.windowing

        // Map API response to table rows
        // Testset includes: id, slug, name, description, created_at, updated_at, created_by_id, etc.
        const rows: TestsetApiRow[] = testsets.map((testset: any) => ({
            id: testset.id,
            slug: testset.slug,
            name: testset.name,
            description: testset.description,
            created_at: testset.created_at,
            updated_at: testset.updated_at,
            created_by_id: testset.created_by_id,
            updated_by_id: testset.updated_by_id,
            tags: testset.tags,
            meta: testset.meta,
        }))

        // Use windowing info from API to determine pagination state
        // The backend returns windowing.next if there are more results
        const hasMore = !!windowing?.next
        const nextCursor = windowing?.next ?? null

        return {
            rows,
            totalCount: count,
            hasMore,
            nextOffset: hasMore ? offset + rows.length : null,
            nextCursor,
            nextWindowing: nextCursor ? {next: nextCursor} : null,
        }
    } catch (error) {
        console.error("[TestsetsTable] Failed to fetch testsets:", error)
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
