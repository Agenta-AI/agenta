import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {createSimpleTableStore, type BaseTableMeta} from "@/oss/components/InfiniteVirtualTable"
import {projectIdAtom} from "@/oss/state/project"

import {fetchTestcasesWindow, fetchTestsetMetadata} from "./fetchTestcases"
import type {TestcaseApiRow, TestcaseTableRow} from "./types"

export type {TestcaseApiRow, TestcaseTableRow}

/**
 * Metadata for the testcases table - drives fetching and filtering
 */
export interface TestcaseTableMeta extends BaseTableMeta {
    testsetId: string | null
}

// Atom for testset ID (set from URL params)
export const testcasesTestsetIdAtom = atom<string | null>(null)

// Atom to trigger a refresh of the testcases table
export const testcasesRefreshTriggerAtom = atom(0)

// Atom for full testcases metadata (read-only derived)
export const testcasesTableMetaAtom = atom<TestcaseTableMeta>((get) => {
    const projectId = get(projectIdAtom)
    const testsetId = get(testcasesTestsetIdAtom)
    const _refreshTrigger = get(testcasesRefreshTriggerAtom)

    return {
        projectId,
        testsetId,
        _refreshTrigger,
    }
})

// Create the dataset store using the simplified factory
const {datasetStore} = createSimpleTableStore<TestcaseTableRow, TestcaseApiRow, TestcaseTableMeta>({
    key: "testcases-table",
    metaAtom: testcasesTableMetaAtom,
    rowHelpers: {
        entityName: "testcase",
        skeletonDefaults: {
            id: "",
            testset_id: "",
            created_at: "",
        } as Omit<TestcaseTableRow, "key" | "__isSkeleton">,
        getRowId: (row) => row.id,
    },
    // Only enable when both projectId and testsetId are available
    isEnabled: (meta) => Boolean(meta?.projectId && meta?.testsetId),
    fetchData: async ({meta, limit, offset, cursor}) => {
        if (!meta.testsetId) {
            return {
                rows: [],
                totalCount: 0,
                hasMore: false,
                nextOffset: null,
                nextCursor: null,
                nextWindowing: null,
            }
        }

        return fetchTestcasesWindow({
            projectId: meta.projectId!,
            testsetId: meta.testsetId,
            limit,
            offset,
            cursor,
        })
    },
})

export const testcasesDatasetStore = datasetStore

/**
 * Query atom for testset metadata (name, columns)
 * Uses jotai-tanstack-query for automatic caching and refetching
 */
export const testsetMetadataQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)
    const testsetId = get(testcasesTestsetIdAtom)

    return {
        queryKey: ["testset-metadata", projectId, testsetId],
        queryFn: async () => {
            if (!projectId || !testsetId) {
                return null
            }
            return fetchTestsetMetadata({projectId, testsetId})
        },
        enabled: Boolean(projectId && testsetId),
        staleTime: 30_000,
    }
})
