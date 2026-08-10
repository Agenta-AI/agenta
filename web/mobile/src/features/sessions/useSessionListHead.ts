import {useEffect} from "react"

import {querySessions} from "@agenta/entities/session"
import {useQuery} from "@tanstack/react-query"

import {SESSIONS_PAGE_SIZE} from "./useSessionsInfinite"

/**
 * Poll only the NEWEST page, so a session created elsewhere (desktop, another device, a cron
 * trigger) appears without a manual refresh.
 *
 * Deliberately a separate query rather than a `refetchInterval` on the infinite one: refetching
 * an infinite query refetches every page scrolled into, so its cost grows with scroll depth.
 * This is one request per tick no matter how far down the list you are.
 *
 * The interval is foreground-only (TanStack's default `refetchIntervalInBackground: false`), and
 * the visibility listener covers the return itself — the app disables `refetchOnWindowFocus`
 * globally, so without it a phone coming back from the lock screen waits out the interval.
 */
export const useSessionListHead = (projectId: string, search: string) => {
    const query = useQuery({
        queryKey: ["mobile", "sessions", "head", projectId, search],
        enabled: Boolean(projectId),
        queryFn: ({signal}) =>
            querySessions({
                projectId,
                search: search || undefined,
                limit: SESSIONS_PAGE_SIZE,
                includeArchived: false,
                abortSignal: signal,
            }),
        staleTime: 10_000,
        refetchInterval: 30_000,
    })

    const {refetch} = query
    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState === "visible") void refetch()
        }
        document.addEventListener("visibilitychange", onVisible)
        return () => document.removeEventListener("visibilitychange", onVisible)
    }, [refetch])

    return query
}
