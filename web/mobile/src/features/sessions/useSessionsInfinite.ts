import {querySessions} from "@agenta/entities/session"
import {useInfiniteQuery} from "@tanstack/react-query"

export const SESSIONS_PAGE_SIZE = 30
const PAGE_SIZE = SESSIONS_PAGE_SIZE

type SessionsCursor = {next: string; newest: string} | null

/** Windowed session list — cursor pair = last row's `id` + its activity timestamp. */
export const useSessionsInfinite = (projectId: string, search: string) =>
    useInfiniteQuery({
        queryKey: ["mobile", "sessions", projectId, search],
        enabled: Boolean(projectId),
        initialPageParam: null as SessionsCursor,
        // Rejects rather than resolving `null` on a failed page. A null page would be appended
        // to `data.pages`, and `getNextPageParam(null)` returns undefined — so `hasNextPage`
        // goes false and the retry button's `fetchNextPage()` short-circuits without issuing a
        // request. Rejecting leaves the last GOOD page as the cursor source, so the retry asks
        // for the same page again.
        queryFn: async ({pageParam, signal}) => {
            const page = await querySessions({
                projectId,
                search: search || undefined,
                limit: PAGE_SIZE,
                next: pageParam?.next,
                newest: pageParam?.newest,
                // Server-side filter: an all-archived first page would otherwise
                // render "No sessions." while live rows sit behind the cursor.
                includeArchived: false,
                abortSignal: signal,
            })
            if (page === null) throw new Error("Session page request failed")
            return page
        },
        getNextPageParam: (lastPage): SessionsCursor | undefined => {
            if (!lastPage || lastPage.length < PAGE_SIZE) return undefined
            const last = lastPage[lastPage.length - 1]
            const newest = last.updated_at ?? last.created_at
            return last.id && newest ? {next: last.id, newest} : undefined
        },
        staleTime: 30_000,
    })
