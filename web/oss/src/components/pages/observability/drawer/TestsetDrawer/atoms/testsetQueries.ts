import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {
    fetchTestsetRevisions,
    TestsetRevision,
} from "@/oss/components/TestsetsTable/atoms/fetchTestsetRevisions"
import {fetchTestsetsWindow} from "@/oss/components/TestsetsTable/atoms/fetchTestsets"
import {projectIdAtom} from "@/oss/state/project"

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
// REVISIONS QUERY (ATOM FAMILY)
// ============================================================================

/**
 * Atom family for fetching revisions by testset ID
 *
 * Usage:
 * const revisionsQuery = useAtomValue(testsetRevisionsQueryFamily(testsetId))
 * const revisions = revisionsQuery.data
 * const isLoading = revisionsQuery.isPending
 */
export const testsetRevisionsQueryFamily = atomFamily((testsetId: string | null) =>
    atomWithQuery<TestsetRevision[]>((get) => {
        // We need projectId for the API call (it's used inside fetchTestsetRevisions)
        const projectId = get(projectIdAtom)

        return {
            queryKey: ["drawer-testset-revisions", testsetId, projectId],
            queryFn: async () => {
                if (!testsetId || testsetId === "create") return []

                const revisions = await fetchTestsetRevisions({testsetId})
                // Filter out v0 revisions (handled in fetchTestsetRevisions, but double-check)
                return revisions.filter((rev) => rev.version !== "0" && String(rev.version) !== "0")
            },
            staleTime: 30_000, // 30 seconds
            refetchOnWindowFocus: false,
            enabled: !!testsetId && testsetId !== "create" && !!projectId,
        }
    }),
)

// ============================================================================
// SELECTED TESTSET STATE
// ============================================================================

/**
 * Currently selected testset ID in the drawer
 */
export const selectedTestsetIdAtom = atom<string | null>(null)

/**
 * Currently selected testset info (id + name)
 */
export const selectedTestsetAtom = atom<{id: string; name: string} | null>(null)

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

/**
 * Derived: Is the current selection a new testset?
 */
export const isNewTestsetAtom = atom((get) => {
    const testsetId = get(selectedTestsetIdAtom)
    return testsetId === "create"
})

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
