import {useAppRevisions} from "./useAppRevisions"

/**
 * Whether the app has just one revision. It reads the unfiltered list, so a search on the page
 * cannot make a long history look like one revision. `failed` means the answer is not known:
 * the caller must not offer a delete then.
 */
export const useIsOnlyRevision = ({projectId, appId}: {projectId: string; appId: string}) => {
    const {rows, hasMore, isPending, isError, refetch} = useAppRevisions({
        projectId,
        appId,
        search: "",
    })
    return {
        pending: isPending,
        failed: isError,
        only: !isPending && !isError && !hasMore && rows.length === 1,
        retry: refetch,
    }
}
