import {fetchLatestRevisionsBatch, type Revision} from "@agenta/entities/testset"
import {useQuery} from "@tanstack/react-query"

const NONE: ReadonlyMap<string, Revision> = new Map()

/** The latest revision of each listed test set, by test set id: what a pick takes. */
export const testsetLatestRevisionsKey = (projectId: string, testsetIds: readonly string[]) =>
    ["testsets", "latest-revisions", projectId, [...testsetIds]] as const

/**
 * The latest revision of each listed test set, as a map from test set id. Its commit message
 * fills the table's Commit message column, and a pick takes its id and version. One request for
 * the listed rows, sent after they show.
 */
export const useTestsetLatestRevisions = ({
    projectId,
    testsetIds,
}: {
    projectId: string
    testsetIds: readonly string[]
}): ReadonlyMap<string, Revision> => {
    const query = useQuery({
        queryKey: testsetLatestRevisionsKey(projectId, testsetIds),
        queryFn: () => fetchLatestRevisionsBatch(projectId, [...testsetIds]),
        enabled: Boolean(projectId) && testsetIds.length > 0,
        staleTime: 30_000,
    })
    return query.data ?? NONE
}
