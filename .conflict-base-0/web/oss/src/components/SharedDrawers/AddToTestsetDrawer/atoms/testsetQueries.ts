import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchTestsetsWindow} from "@/oss/components/TestsetsTable/atoms/fetchTestsets"
import {revisionsListQueryAtomFamily} from "@/oss/state/entities/testset"
import {projectIdAtom} from "@/oss/state/project"
import {
    selectedTestsetIdAtom as sharedSelectedTestsetIdAtom,
    selectedTestsetInfoAtom as sharedSelectedTestsetInfoAtom,
} from "@/oss/state/testsetSelection"

/**
 * Testset Queries - Clean atom-based data fetching
 *
 * Uses atomWithQuery for caching and automatic refetching.
 * Uses atomFamily for parameterized queries (revisions by testset ID).
 */

// ============================================================================
// TESTSETS LIST QUERY
// ============================================================================

export interface TestsetListItem {
    id: string
    name: string
}

/**
 * Query atom for fetching testsets list
 */
export const testsetsListQueryAtom = atomWithQuery<TestsetListItem[]>((get) => {
    const projectId = get(projectIdAtom)

    return {
        queryKey: ["drawer-testsets-list", projectId],
        queryFn: async () => {
            if (!projectId) return []

            const result = await fetchTestsetsWindow({
                projectId,
                limit: 100,
                offset: 0,
                cursor: null,
                searchQuery: null,
                dateRange: null,
            })

            return result.rows.map((row) => ({
                id: row.id,
                name: row.name,
            }))
        },
        staleTime: 60_000, // 1 minute
        refetchOnWindowFocus: false,
        enabled: !!projectId,
    }
})

// ============================================================================
// REVISIONS QUERY (RE-EXPORT FROM ENTITY STORE)
// ============================================================================

/**
 * Re-export centralized revision list query from entity store
 * This eliminates duplicate fetch logic and uses the shared entity cache
 *
 * Usage:
 * const revisionsQuery = useAtomValue(testsetRevisionsQueryFamily(testsetId))
 * const revisions = revisionsQuery.data
 * const isLoading = revisionsQuery.isPending
 */
export const testsetRevisionsQueryFamily = revisionsListQueryAtomFamily

// ============================================================================
// SELECTED TESTSET STATE (RE-EXPORT FROM SHARED MODULE)
// ============================================================================

/**
 * Re-export: Currently selected testset ID in the drawer
 */
export const selectedTestsetIdAtom = sharedSelectedTestsetIdAtom

/**
 * Re-export: Currently selected testset info (id + name)
 */
export const selectedTestsetAtom = sharedSelectedTestsetInfoAtom

// ============================================================================
// DERIVED ATOMS
// ============================================================================

/**
 * Derived: Revisions for the currently selected testset
 * Automatically fetches when selectedTestsetIdAtom changes
 */
export const selectedTestsetRevisionsAtom = atom((get) => {
    const testsetId = get(selectedTestsetIdAtom)
    if (!testsetId || testsetId === "create") return null

    // Get the query atom for this testset
    const queryAtom = testsetRevisionsQueryFamily(testsetId)
    return get(queryAtom)
})

/**
 * Derived: Latest revision for the selected testset
 */
export const latestRevisionAtom = atom((get) => {
    const revisionsQuery = get(selectedTestsetRevisionsAtom)
    if (!revisionsQuery?.data?.length) return null

    // Revisions are already sorted descending by the API
    return revisionsQuery.data[0]
})

// Note: isNewTestsetAtom is exported from cascaderState.ts (re-exported from shared module)

// ============================================================================
// CASCADER OPTIONS BUILDER
// ============================================================================

/**
 * Derived: Cascader options built from testsets list
 */
export const cascaderOptionsAtom = atom((get) => {
    const testsetsQuery = get(testsetsListQueryAtom)
    const testsets = testsetsQuery.data ?? []

    return [
        {
            value: "create",
            label: "Create New",
            isLeaf: true,
        },
        ...testsets.map((ts) => ({
            value: ts.id,
            label: ts.name,
            isLeaf: false, // Has children (revisions)
        })),
    ]
})
