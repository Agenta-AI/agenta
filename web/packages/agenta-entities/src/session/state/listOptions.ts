import {querySessions} from "../api/api"
import type {SessionStream} from "../core/schema"

export const SESSIONS_PAGE_SIZE = 30

/** Cursor pair for the activity-ordered window: the last row's id + its activity timestamp. */
export interface SessionListCursor {
    next: string
    newest: string
}

export interface SessionListFilters {
    projectId: string
    search?: string
    /** Agent workflow id — matched against the turns' references. */
    agentId?: string | null
    includeArchived?: boolean
    includeEnded?: boolean
    /** Liveness, matched against the row's mirrored flags. */
    flags?: {is_alive?: boolean; is_running?: boolean; is_attached?: boolean}
    /** Restrict to an explicit id set — the pushdown for predicates that live outside the stream
     * row (client-held pins, sessions named by a pending-interaction lookup). */
    sessionIds?: string[]
    /** Its complement, so a separately-rendered group (pins) is not listed twice. */
    excludeSessionIds?: string[]
    limit?: number
}

/**
 * Query key and fetcher for one page of the project's session list.
 *
 * An options factory, not a mounted query: query-client policy (stale times, refetch cadence,
 * suspense) belongs to the app that mounts it, and desktop and mobile do not agree on it. What
 * they must agree on is the key and the request, which is what lives here.
 *
 * Every filter is a server predicate on purpose. Narrowing a fetched page in the browser filters
 * the window rather than the set, which gets counts and empty states wrong.
 */
export const sessionListQueryOptions = (filters: SessionListFilters) => {
    const {
        projectId,
        search = "",
        agentId = null,
        includeArchived = false,
        includeEnded = true,
        flags,
        sessionIds,
        excludeSessionIds,
        limit = SESSIONS_PAGE_SIZE,
    } = filters

    return {
        queryKey: [
            "session-list",
            projectId,
            search,
            agentId,
            includeArchived,
            includeEnded,
            flags ?? null,
            sessionIds ?? null,
            excludeSessionIds ?? null,
            limit,
        ] as const,
        queryFn: ({
            pageParam,
            signal,
        }: {
            pageParam?: SessionListCursor | null
            signal?: AbortSignal
        }) =>
            querySessions({
                projectId,
                search: search.trim() || undefined,
                references: agentId ? [{id: agentId}] : undefined,
                includeArchived,
                includeEnded,
                flags,
                sessionIds,
                excludeSessionIds: excludeSessionIds?.length ? excludeSessionIds : undefined,
                limit,
                next: pageParam?.next,
                newest: pageParam?.newest,
                abortSignal: signal,
            }),
        limit,
    }
}

/** The cursor for the page after `page`, or `undefined` when it was the last one. */
export const nextSessionCursor = (
    page: SessionStream[] | null,
    limit = SESSIONS_PAGE_SIZE,
): SessionListCursor | undefined => {
    if (!page || page.length < limit) return undefined
    const last = page[page.length - 1]
    const newest = last.updated_at ?? last.created_at
    return last.id && newest ? {next: last.id, newest} : undefined
}

/** Flatten loaded pages, dropping failed ones — `querySessions` resolves null on failure. */
export const sessionRowsFromPages = (
    pages: (SessionStream[] | null)[] | undefined,
): SessionStream[] => (pages ?? []).filter(Boolean).flat() as SessionStream[]
