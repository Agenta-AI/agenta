import {useMemo} from "react"

import {fetchLatestRevisionsBatch} from "@agenta/entities/testset"
import {useQueries} from "@tanstack/react-query"

import {visibleCommitMessage} from "./commitMessage"
import {TESTSETS_PAGE_SIZE} from "./useTestsetsList"

const toMessageMap = (
    results: readonly {data: readonly (readonly [string, string | null])[] | undefined}[],
): ReadonlyMap<string, string | null> => new Map(results.flatMap((result) => result.data ?? []))

/**
 * The latest commit message of each listed testset, as a map from testset id.
 *
 * One request per page of rows, sent after the rows are already on screen: a slow answer leaves
 * the column empty, it never holds the list back. Pages keep their own cache entry, so loading
 * the next page asks only about the new rows.
 */
export function useTestsetCommitMessages({
    projectId,
    testsetIds,
}: {
    projectId: string
    testsetIds: readonly string[]
}): ReadonlyMap<string, string | null> {
    const chunks = useMemo(() => {
        const result: string[][] = []
        for (let start = 0; start < testsetIds.length; start += TESTSETS_PAGE_SIZE) {
            result.push(testsetIds.slice(start, start + TESTSETS_PAGE_SIZE))
        }
        return result
    }, [testsetIds])

    return useQueries({
        queries: chunks.map((ids) => ({
            queryKey: ["testsets", "commit-messages", projectId, ids] as const,
            queryFn: async () => {
                const revisions = await fetchLatestRevisionsBatch(projectId, ids)
                return ids.map(
                    (id) => [id, visibleCommitMessage(revisions.get(id)?.message)] as const,
                )
            },
            enabled: Boolean(projectId),
            // A message is a nicety. A failed request leaves the cells blank, it never errors the list.
            retry: false,
            staleTime: 30_000,
        })),
        combine: toMessageMap,
    })
}
