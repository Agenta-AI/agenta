import {fetchTestsetDetail, type TestsetRevisionHeader} from "@agenta/entities/testset"
import {useQuery} from "@tanstack/react-query"

/**
 * The name and archive state of the test set a revision page shows, when the shared header has no
 * name for it.
 *
 * The shared header looks test sets up with a query that leaves archived ones out, so an archived
 * test set loads with an empty name. This asks for the one test set by id, which also returns an
 * archived one. A test set that has a name in the header is not archived and needs no request.
 *
 * Its key starts with "testsets", so a restore (which refreshes every "testsets" key) asks again
 * and the page leaves its archived state.
 */
export function useArchivedTestset({
    projectId,
    header,
    enabled,
}: {
    projectId: string
    header: TestsetRevisionHeader | null
    enabled: boolean
}): {name: string | null; isArchived: boolean} {
    const testsetId = header?.testsetId ?? ""
    const needed = enabled && Boolean(testsetId) && !header?.testsetName
    const query = useQuery({
        queryKey: ["testsets", "archived-state", projectId, testsetId],
        queryFn: () => fetchTestsetDetail({id: testsetId, projectId}),
        enabled: needed,
        retry: false,
    })
    if (!needed || !query.data) return {name: null, isArchived: false}
    return {name: query.data.name ?? null, isArchived: Boolean(query.data.deleted_at)}
}
