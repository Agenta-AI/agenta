import {useAppRevisions} from "./useAppRevisions"

/**
 * Whether the app has just one revision above version 0. It reads the unfiltered list, so a
 * search on the page cannot make a long history look like one revision.
 */
export const useIsOnlyRevision = ({projectId, appId}: {projectId: string; appId: string}) => {
    const {rows, hasMore, isPending, isError} = useAppRevisions({projectId, appId, search: ""})
    return {pending: isPending, only: !isPending && !isError && !hasMore && rows.length === 1}
}
