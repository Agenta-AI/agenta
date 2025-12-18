import {atom} from "jotai"
import {atomWithStorage} from "jotai/vanilla/utils"

import {
    createSimpleTableStore,
    type BaseTableMeta,
    type InfiniteTableRowBase,
} from "@/oss/components/InfiniteVirtualTable"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {projectIdAtom} from "@/oss/state/project"

/**
 * API response from /preview/testsets/{testset_id}
 */
export interface TestcaseRevisionResponse {
    id: string // revision ID
    testset_id: string
    parent_testset_id?: string | null
    version?: number
    testcases: Array<{
        id: string
        testset_id: string
        created_at: string
        data: Record<string, unknown>
    }>
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

/**
 * Fetch all testcases from a revision
 * Returns all testcases at once (no pagination)
 */
async function fetchTestcasesFromRevision(revisionId: string) {
    const apiUrl = getAgentaApiUrl()
    const url = `${apiUrl}/preview/testsets/${revisionId}`

    const response = await axios.get<TestcaseRevisionResponse>(url)
    const revision = response.data

    // Flatten testcases into table rows
    const rows: TestcaseTableRow[] = revision.testcases.map((tc, index) => ({
        key: tc.id || `tc-${index}`,
        __isSkeleton: false,
        id: tc.id,
        testset_id: tc.testset_id,
        created_at: tc.created_at,
        ...tc.data,
    }))

    return {
        rows,
        revision,
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
    fetchData: async ({meta}) => {
        // Revision-based model: fetch entire revision (all testcases)
        if (!meta.revisionId) {
            return {
                rows: [],
                totalCount: 0,
                hasMore: false,
                nextOffset: null,
                nextCursor: null,
                nextWindowing: null,
            }
        }

        const {rows} = await fetchTestcasesFromRevision(meta.revisionId)

        // Apply client-side search filtering
        let filteredRows = rows
        if (meta.searchTerm) {
            const searchLower = meta.searchTerm.toLowerCase()
            filteredRows = rows.filter((row) => {
                // Search across all fields
                return Object.values(row).some((value) =>
                    String(value || "")
                        .toLowerCase()
                        .includes(searchLower),
                )
            })
        }

        return {
            rows: filteredRows,
            totalCount: filteredRows.length,
            hasMore: false, // All data loaded at once
            nextOffset: null,
            nextCursor: null,
            nextWindowing: null,
        }
    },
    isEnabled: (meta) => Boolean(meta?.projectId && meta?.revisionId),
})

export const testcasesDatasetStore = datasetStore
