import {createEntityStore} from "../core/createEntityStore"
import {createUseEntityHistory} from "../core/useEntityHistory"

import {fetchTestcasesWindow} from "./api"
import {flattenedTestcaseSchema, type FlattenedTestcase} from "./schema"

/**
 * Parameters for fetching testcase list
 */
export interface FetchTestcasesParams {
    projectId: string
    testsetId?: string | null // Optional - can query all testcases or filter by testset
    limit: number
    offset: number
    cursor?: string | null
}

/**
 * Response from testcase list query
 */
export interface FetchTestcasesResponse {
    rows: FlattenedTestcase[]
    totalCount: number
    hasMore: boolean
    nextOffset: number | null
    nextCursor: string | null
}

/**
 * Testcase entity store
 * Provides normalized storage and CRUD operations for testcases
 */
export const testcaseStore = createEntityStore({
    name: "testcase",
    schema: flattenedTestcaseSchema,

    // How long to keep data fresh
    staleTime: 30_000, // 30 seconds

    // Extract entities from paginated response
    extractEntities: (response: FetchTestcasesResponse) => response.rows,

    // Fetch list of testcases
    fetchList: async (params: FetchTestcasesParams) => {
        console.log("fetchList", params)
        return fetchTestcasesWindow(params)
    },

    // No detail fetcher needed - individual testcases fetched via query endpoint
    // Individual testcases will be served from normalized cache
    fetchDetail: undefined,

    // Optional: normalize data on the way in
    normalize: (testcase) => {
        // Ensure consistent date formats
        return {
            ...testcase,
            created_at: testcase.created_at || new Date().toISOString(),
        }
    },

    // Optional: create optimistic testcase for instant UI updates
    createOptimistic: (partial) => {
        return flattenedTestcaseSchema.parse({
            id: `temp-${Date.now()}`,
            testset_id: null,
            created_at: new Date().toISOString(),
            ...partial,
        })
    },
})

/**
 * Hook for testcase history (undo/redo)
 * Provides per-entity history tracking with configurable limit
 *
 * @example
 * ```tsx
 * function TestcaseDrawer({ testcaseId }) {
 *   const history = useTestcaseHistory(testcaseId, { limit: 5 })
 *
 *   return (
 *     <>
 *       <button onClick={history.undo} disabled={!history.canUndo}>Undo</button>
 *       <button onClick={history.redo} disabled={!history.canRedo}>Redo</button>
 *     </>
 *   )
 * }
 * ```
 */
export const useTestcaseHistory = createUseEntityHistory(testcaseStore.entitiesAtom, {
    defaultLimit: 10,
    clearOnCommit: true,
})

// Export typed hooks for convenience
export {testcaseStore as default}
