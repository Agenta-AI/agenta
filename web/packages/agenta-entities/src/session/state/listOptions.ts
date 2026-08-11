import {querySessionsPage} from "../api/api"
import type {
    SessionExpansion,
    SessionOrigin,
    SessionStream,
    SessionsQueryResponse,
} from "../core/schema"

export const SESSIONS_PAGE_SIZE = 30

/** Cursor pair for the activity-ordered window: the last row's id + its activity timestamp. */
export interface SessionListCursor {
    next: string
    newest?: string
    oldest?: string
    order?: "ascending" | "descending"
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
    /** Origins to include. Omission keeps the entity request neutral. */
    origins?: SessionOrigin[]
    /** Hide these origins. Sessions with no stamp still show. */
    excludeOrigins?: SessionOrigin[]
    expand?: SessionExpansion[]
    includeTotal?: boolean
    lowPriority?: boolean
    order?: "ascending" | "descending"
    limit?: number
}

const stableValues = <T extends string>(values: T[] | undefined): T[] | undefined =>
    values ? [...new Set(values)].sort() : undefined

const stableIds = (values: string[] | undefined): string[] | undefined =>
    values ? [...new Set(values)].sort() : undefined

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
        origins,
        excludeOrigins,
        expand,
        includeTotal = false,
        lowPriority = false,
        order = "descending",
        limit = SESSIONS_PAGE_SIZE,
    } = filters
    const normalizedSearch = search.trim()
    const normalizedOrigins = stableValues(origins)
    const normalizedExcludeOrigins = stableValues(excludeOrigins)
    const normalizedExpand = stableValues(expand)
    const normalizedSessionIds = stableIds(sessionIds)
    const normalizedExcludeSessionIds = stableIds(excludeSessionIds)
    const normalizedFlags = flags
        ? {
              is_alive: flags.is_alive,
              is_running: flags.is_running,
              is_attached: flags.is_attached,
          }
        : undefined

    return {
        queryKey: [
            "session-list",
            projectId,
            normalizedSearch,
            agentId,
            includeArchived,
            includeEnded,
            normalizedFlags ?? null,
            normalizedSessionIds ?? null,
            normalizedExcludeSessionIds ?? null,
            normalizedOrigins ?? null,
            normalizedExcludeOrigins ?? null,
            normalizedExpand ?? null,
            includeTotal,
            order,
            limit,
        ] as const,
        queryFn: ({
            pageParam,
            signal,
        }: {
            pageParam?: SessionListCursor | null
            signal?: AbortSignal
        }) =>
            querySessionsPage({
                projectId,
                session: {
                    search: normalizedSearch || undefined,
                    liveness: normalizedFlags,
                    origins: normalizedOrigins,
                },
                turnReferences: agentId ? [{id: agentId}] : undefined,
                includeArchived,
                includeEnded,
                includeTotal,
                expand: normalizedExpand,
                sessionIds: normalizedSessionIds,
                exclude:
                    normalizedExcludeSessionIds?.length || normalizedExcludeOrigins?.length
                        ? {
                              sessionIds: normalizedExcludeSessionIds,
                              origins: normalizedExcludeOrigins,
                          }
                        : undefined,
                windowing: {
                    limit,
                    next: pageParam?.next,
                    newest: pageParam?.newest,
                    oldest: pageParam?.oldest,
                    order,
                },
                abortSignal: signal,
                ...(lowPriority ? {lowPriority: true} : {}),
            }),
        limit,
        order,
    }
}

/** The cursor for the page after `page`, or `undefined` when it was the last one. */
export const nextSessionCursor = (
    page: SessionsQueryResponse | null,
    limit = SESSIONS_PAGE_SIZE,
    order: "ascending" | "descending" = "descending",
): SessionListCursor | undefined => {
    if (!page) return undefined
    if (page.windowing !== undefined) {
        if (!page.windowing) return undefined
        const effectiveOrder = page.windowing.order ?? order
        const boundary =
            effectiveOrder === "ascending" ? page.windowing.oldest : page.windowing.newest
        if (!page.windowing.next || !boundary) return undefined
        return {
            next: page.windowing.next,
            newest: page.windowing.newest ?? undefined,
            oldest: page.windowing.oldest ?? undefined,
            order: effectiveOrder,
        }
    }

    if (page.sessions.length < limit) return undefined
    const last = page.sessions[page.sessions.length - 1]
    const activity = last.updated_at ?? last.created_at
    if (!last.id || !activity) return undefined
    return order === "ascending"
        ? {next: last.id, oldest: activity, order}
        : {next: last.id, newest: activity, order}
}

/** Flatten loaded pages, dropping failed ones. */
export const sessionRowsFromPages = (
    pages: (SessionsQueryResponse | null)[] | undefined,
): SessionStream[] => (pages ?? []).flatMap((page) => page?.sessions ?? [])
