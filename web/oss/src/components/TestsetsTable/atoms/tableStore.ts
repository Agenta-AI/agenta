import {atom} from "jotai"
import {atomWithStorage} from "jotai/vanilla/utils"

import {
    createSimpleTableStore,
    type BaseTableMeta,
    type InfiniteTableRowBase,
} from "@/oss/components/InfiniteVirtualTable"
import {projectIdAtom} from "@/oss/state/project"

import {fetchTestsetsWindow} from "./fetchTestsets"
import {
    testsetsDateCreatedFilterAtom,
    testsetsDateModifiedFilterAtom,
    type TestsetDateRange,
} from "./filters"

/**
 * API response row from /preview/simple/testsets/query
 */
export interface TestsetApiRow {
    id: string
    slug?: string
    name: string
    description?: string
    created_at: string
    updated_at: string
    created_by_id?: string
    updated_by_id?: string
    tags?: string[]
    meta?: Record<string, unknown>
}

/**
 * Table row with key and skeleton flag
 */
export interface TestsetTableRow extends TestsetApiRow, InfiniteTableRowBase {}

/**
 * Metadata for the testsets table - drives fetching and filtering
 */
export interface TestsetTableMeta extends BaseTableMeta {
    searchTerm: string
    dateCreatedFilter: TestsetDateRange | null
    dateModifiedFilter: TestsetDateRange | null
}

// Atom for search term (persisted in session storage)
export const testsetsSearchTermAtom = atomWithStorage<string>("testsets-search-term", "")

// Atom to trigger a refresh of the testsets table
export const testsetsRefreshTriggerAtom = atom(0)

// Atom for full testsets metadata (read-only derived)
export const testsetsTableMetaAtom = atom<TestsetTableMeta>((get) => {
    const projectId = get(projectIdAtom)
    const searchTerm = get(testsetsSearchTermAtom)
    const dateCreatedFilter = get(testsetsDateCreatedFilterAtom)
    const dateModifiedFilter = get(testsetsDateModifiedFilterAtom)
    const _refreshTrigger = get(testsetsRefreshTriggerAtom)

    return {
        projectId,
        searchTerm,
        dateCreatedFilter,
        dateModifiedFilter,
        _refreshTrigger,
    }
})

// Create the dataset store using the simplified factory
const {datasetStore} = createSimpleTableStore<TestsetTableRow, TestsetApiRow, TestsetTableMeta>({
    key: "testsets-table",
    metaAtom: testsetsTableMetaAtom,
    rowHelpers: {
        entityName: "testset",
        skeletonDefaults: {
            id: "",
            name: "",
            created_at: "",
            updated_at: "",
        } as Omit<TestsetTableRow, "key" | "__isSkeleton">,
        getRowId: (row) => row.id,
    },
    fetchData: async ({meta, limit, offset, cursor}) => {
        // Build date range from filters
        let dateRange: {from?: string | null; to?: string | null} | null = null
        if (meta.dateCreatedFilter || meta.dateModifiedFilter) {
            const createdFrom = meta.dateCreatedFilter?.from
            const createdTo = meta.dateCreatedFilter?.to
            const modifiedFrom = meta.dateModifiedFilter?.from
            const modifiedTo = meta.dateModifiedFilter?.to

            dateRange = {
                from: createdFrom || modifiedFrom || null,
                to: createdTo || modifiedTo || null,
            }
        }

        return fetchTestsetsWindow({
            projectId: meta.projectId!,
            limit,
            offset,
            cursor,
            searchQuery: meta.searchTerm || null,
            dateRange,
        })
    },
})

export const testsetsDatasetStore = datasetStore
