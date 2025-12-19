import {atom, getDefaultStore} from "jotai"
import {atomWithStorage} from "jotai/vanilla/utils"

import {
    createSimpleTableStore,
    type BaseTableMeta,
    type InfiniteTableRowBase,
} from "@/oss/components/InfiniteVirtualTable"
import type {InfiniteTableFetchResult} from "@/oss/components/InfiniteVirtualTable/types"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {cleanupOnRevisionChangeAtom} from "@/oss/state/entities/testcase/atomCleanup"
import {resetColumnsAtom} from "@/oss/state/entities/testcase/columnState"
import {initializeV0DraftAtom} from "@/oss/state/entities/testcase/editSession"
import {revisionQueryAtom} from "@/oss/state/entities/testcase/queries"
import {flattenTestcase, testcasesResponseSchema} from "@/oss/state/entities/testcase/schema"
import {setTestcaseIdsAtom} from "@/oss/state/entities/testcase/testcaseEntity"
import {projectIdAtom} from "@/oss/state/project"

/**
 * API response from /preview/testsets/{testset_id}
 */
export interface TestcaseRevisionResponse {
    id: string // revision ID
    testset_id: string
    parent_testset_id?: string | null
    version?: number
    testcases: {
        id: string
        testset_id: string
        created_at: string
        data: Record<string, unknown>
    }[]
}

/**
 * Testcase row in the table
 */
export interface TestcaseTableRow extends InfiniteTableRowBase {
    id?: string
    testset_id?: string
    created_at?: string
    [key: string]: unknown
}

/**
 * Metadata for the testcases table
 */
export interface TestcaseTableMeta extends BaseTableMeta {
    /** Revision ID (testset_id from URL) */
    revisionId: string | null
    /** Search term for filtering */
    searchTerm: string
}

// Atom for search term (persisted in session storage)
export const testcasesSearchTermAtom = atomWithStorage<string>("testcases-search-term", "")

// Atom for revision ID (from URL)
export const testcasesRevisionIdAtom = atom<string | null>(null)

// Atom to trigger a refresh
export const testcasesRefreshTriggerAtom = atom(0)

// Atom for full testcases metadata (read-only derived)
export const testcasesTableMetaAtom = atom<TestcaseTableMeta>((get) => {
    const projectId = get(projectIdAtom)
    const revisionId = get(testcasesRevisionIdAtom)
    const searchTerm = get(testcasesSearchTermAtom)
    const _refreshTrigger = get(testcasesRefreshTriggerAtom)

    return {
        projectId,
        revisionId,
        searchTerm,
        _refreshTrigger,
    }
})

const PAGE_SIZE = 50

/**
 * Fetch testcases for a revision
 */
async function fetchTestcasesForTable(
    projectId: string,
    revisionId: string,
    cursor: string | null,
    limit: number,
): Promise<InfiniteTableFetchResult<TestcaseTableRow>> {
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

    // Validate response with Zod
    const validated = testcasesResponseSchema.parse(response.data)

    // Flatten testcases for table display
    const rows = validated.testcases.map((tc) => {
        const flattened = flattenTestcase(tc)
        return {
            ...flattened,
            key: flattened.id,
        } as TestcaseTableRow
    })

    return {
        rows,
        totalCount: validated.count,
        hasMore: Boolean(validated.windowing?.next),
        nextOffset: rows.length,
        nextCursor: validated.windowing?.next || null,
        nextWindowing: null,
    }
}

// Create the dataset store
const {datasetStore} = createSimpleTableStore<
    TestcaseTableRow,
    TestcaseTableRow,
    TestcaseTableMeta
>({
    key: "testcases-table",
    metaAtom: testcasesTableMetaAtom,
    rowHelpers: {
        entityName: "testcase",
        skeletonDefaults: {
            id: "",
            testset_id: "",
            created_at: "",
        } as Omit<TestcaseTableRow, "key" | "__isSkeleton">,
        getRowId: (row) => row.id || row.key.toString(),
    },
    fetchData: async ({meta, limit, cursor}) => {
        if (!meta.projectId || !meta.revisionId) {
            return {
                rows: [],
                totalCount: 0,
                hasMore: false,
                nextOffset: null,
                nextCursor: null,
                nextWindowing: null,
            }
        }

        const result = await fetchTestcasesForTable(
            meta.projectId,
            meta.revisionId,
            cursor,
            limit || PAGE_SIZE,
        )

        // Hydrate entity atoms with fetched IDs
        // This populates testcaseIdsAtom so columns can be derived
        const store = getDefaultStore()
        const ids = result.rows.map((row) => row.id).filter(Boolean) as string[]
        if (ids.length > 0) {
            store.set(setTestcaseIdsAtom, ids)
        }

        // Apply client-side search filtering if searchTerm exists
        if (meta.searchTerm) {
            const searchLower = meta.searchTerm.toLowerCase()
            const filteredRows = result.rows.filter((row) =>
                Object.values(row).some((value) =>
                    String(value || "")
                        .toLowerCase()
                        .includes(searchLower),
                ),
            )
            return {
                ...result,
                rows: filteredRows,
                totalCount: filteredRows.length,
            }
        }

        return result
    },
    isEnabled: (meta) => Boolean(meta?.projectId && meta?.revisionId),
})

export const testcasesDatasetStore = datasetStore

// ============================================================================
// REVISION CHANGE EFFECT ATOM
// Consolidates all side effects when revision changes
// ============================================================================

/**
 * Track previous revision ID for detecting changes
 */
const previousRevisionIdAtom = atom<string | null>(null)

/**
 * Effect atom that runs all side effects when revision changes
 * - Sets the revision ID (single source of truth)
 * - Cleanup old testcase atoms (memory management)
 * - Reset column state
 * - Initialize v0 draft for empty testsets
 *
 * Use with atomEffect or call from a single useEffect in the component
 */
export const revisionChangeEffectAtom = atom(null, (get, set, newRevisionId: string | null) => {
    const previousRevisionId = get(previousRevisionIdAtom)

    // Always set the revision ID (this is the entry point from URL)
    set(testcasesRevisionIdAtom, newRevisionId)

    // Skip side effects if revision hasn't changed
    if (previousRevisionId === newRevisionId) return

    // Update tracked revision
    set(previousRevisionIdAtom, newRevisionId)

    // 1. Cleanup old testcase atoms (prevents memory leaks)
    set(cleanupOnRevisionChangeAtom, newRevisionId)

    // 2. Reset column state
    set(resetColumnsAtom)

    // 3. Initialize v0 draft after revision query completes
    // This is deferred - we check if revision query is done
    const revisionQuery = get(revisionQueryAtom)
    if (!revisionQuery.isPending && newRevisionId) {
        set(initializeV0DraftAtom)
    }
})
