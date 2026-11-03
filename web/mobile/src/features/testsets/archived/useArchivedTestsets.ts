import {queryTestsetsPage, type Testset} from "@agenta/entities/testset"
import {keepPreviousData, useQuery} from "@tanstack/react-query"

export const ARCHIVED_TESTSETS_PAGE_SIZE = 50

export const ARCHIVED_TESTSETS_QUERY_KEY = (projectId: string, search: string) =>
    ["testsets", "archived", projectId, search] as const

/** Stable, so a screen memoising on `testsets` does not recompute on every render without data. */
const NONE: Testset[] = []

/**
 * The API has no archived-only filter, so this asks for archived and active rows together
 * and keeps the archived ones. That means it must read every page.
 */
export const useArchivedTestsets = ({projectId, search}: {projectId: string; search: string}) => {
    const query = useQuery({
        queryKey: ARCHIVED_TESTSETS_QUERY_KEY(projectId, search),
        queryFn: async (): Promise<Testset[]> => {
            const rows: Testset[] = []
            let cursor: string | null = null
            for (;;) {
                const page = await queryTestsetsPage({
                    projectId,
                    limit: ARCHIVED_TESTSETS_PAGE_SIZE,
                    cursor,
                    name: search || undefined,
                    includeArchived: true,
                })
                rows.push(...page.testsets)
                if (!page.nextCursor || page.nextCursor === cursor) break
                cursor = page.nextCursor
            }
            // `filter` gives a copy, so the sort does not reorder the collected array.
            return rows
                .filter((testset) => testset.deleted_at)
                .sort((a, b) => (b.deleted_at ?? "").localeCompare(a.deleted_at ?? ""))
        },
        enabled: Boolean(projectId),
        // Keep the last rows on screen while a new search loads, so typing does not blank the list.
        placeholderData: keepPreviousData,
        staleTime: 30_000,
        retry: false,
    })

    return {
        testsets: query.data ?? NONE,
        isPending: query.isPending,
        isError: query.isError,
        refetch: query.refetch,
    }
}
