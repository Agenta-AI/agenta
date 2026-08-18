import {
    nextSessionCursor,
    sessionListQueryOptions,
    type SessionListCursor,
} from "@agenta/entities/session"
import {useInfiniteQuery} from "@tanstack/react-query"

import {mobileSessionListPolicy} from "./sessionListPolicy"

export const SESSIONS_PAGE_SIZE = 30
const PAGE_SIZE = SESSIONS_PAGE_SIZE

/** Windowed session list — cursor pair = last row's `id` + its activity timestamp. */
export const useSessionsInfinite = (projectId: string, search: string) => {
    const options = sessionListQueryOptions({
        projectId,
        search,
        includeArchived: false,
        limit: PAGE_SIZE,
        ...mobileSessionListPolicy,
    })

    return useInfiniteQuery({
        queryKey: ["mobile", ...options.queryKey],
        enabled: Boolean(projectId),
        initialPageParam: null as SessionListCursor | null,
        // Rejects rather than resolving `null` on a failed page. A null page would be appended
        // to `data.pages`, and `getNextPageParam(null)` returns undefined — so `hasNextPage`
        // goes false and the retry button's `fetchNextPage()` short-circuits without issuing a
        // request. Rejecting leaves the last GOOD page as the cursor source, so the retry asks
        // for the same page again.
        queryFn: async ({pageParam, signal}) => {
            const page = await options.queryFn({pageParam, signal})
            if (page === null) throw new Error("Session page request failed")
            return page
        },
        getNextPageParam: (lastPage) => nextSessionCursor(lastPage, options.limit, options.order),
        select: (data) => ({...data, pages: data.pages.map((page) => page.sessions)}),
        staleTime: 30_000,
    })
}
