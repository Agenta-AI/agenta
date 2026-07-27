import {querySessions} from "@agenta/entities/session"
import {useInfiniteQuery} from "@tanstack/react-query"

const PAGE_SIZE = 30

type SessionsCursor = {next: string; newest: string} | null

/** Windowed session list — cursor pair = last row's `id` + its activity timestamp. */
export const useSessionsInfinite = (projectId: string, search: string) =>
    useInfiniteQuery({
        queryKey: ["mobile", "sessions", projectId, search],
        enabled: Boolean(projectId),
        initialPageParam: null as SessionsCursor,
        queryFn: ({pageParam, signal}) =>
            querySessions({
                projectId,
                search: search || undefined,
                limit: PAGE_SIZE,
                next: pageParam?.next,
                newest: pageParam?.newest,
                abortSignal: signal,
            }),
        getNextPageParam: (lastPage): SessionsCursor | undefined => {
            if (!lastPage || lastPage.length < PAGE_SIZE) return undefined
            const last = lastPage[lastPage.length - 1]
            const newest = last.updated_at ?? last.created_at
            return last.id && newest ? {next: last.id, newest} : undefined
        },
        staleTime: 30_000,
    })
