import type {SessionExpansion, SessionListFilters, SessionStream} from "@agenta/entities/session"

export type SessionOriginPolicy = "all" | "exclude-trigger" | "trigger-only"

export interface SessionListRequestPolicy {
    origin: SessionOriginPolicy
    expansions: readonly SessionExpansion[]
}

export const sessionListRequestFilters = (
    policy: SessionListRequestPolicy,
): Pick<SessionListFilters, "origins" | "excludeOrigins" | "expand"> => ({
    origins: policy.origin === "trigger-only" ? ["trigger"] : undefined,
    excludeOrigins: policy.origin === "exclude-trigger" ? ["trigger"] : undefined,
    expand: [...policy.expansions],
})

export const selectedSessionListPolicy = (
    automationMode: boolean,
    defaultPolicy: SessionListRequestPolicy,
    automationPolicy: SessionListRequestPolicy,
): SessionListRequestPolicy => (automationMode ? automationPolicy : defaultPolicy)

/**
 * Has this session started? The stream row exists from the runtime's first beat — before anyone
 * types — so a list of every row fills with "Untitled session / No agent yet" placeholders for
 * chats that were only opened. Started means the row carries something a person can recognise it
 * by: a turn (the server attaches the latest turn's `references`, absent until there is one), a
 * title, a message preview, or an automation identity (a trigger row IS its schedule, and the
 * automations list must never blank).
 *
 * Display-only. Callers filter what they RENDER; nothing here may narrow a cached set the sidebar
 * reconciler reads, which drops locally-known sessions the server omits.
 */
export const isStartedSession = (row: SessionStream): boolean =>
    Boolean(
        (row.references?.length ?? 0) > 0 ||
        row.name?.trim() ||
        row.last_message ||
        row.origin === "trigger" ||
        row.trigger,
    )

export const startedSessions = <T extends SessionStream>(rows: readonly T[]): T[] =>
    rows.filter(isStartedSession)

/**
 * Is the list still waiting on a top-up? A page is 30 rows and unstarted ones are the NEWEST, so a
 * burst of opened-but-unused chats can fill the whole first page — hiding them would otherwise
 * leave a "No sessions yet" over a list that has plenty, one click down.
 *
 * Stays true for the WHOLE top-up, including while the request is in flight, so the list holds its
 * loading state instead of flashing the empty one. A failed page ends the wait: `hasNextPage` is
 * still true after a failure, so without this the list would wait forever on a page that never lands.
 */
export const awaitingHiddenRows = ({
    visibleRows,
    hasNextPage,
    isError = false,
}: {
    visibleRows: number
    hasNextPage: boolean
    isError?: boolean
}): boolean => visibleRows === 0 && hasNextPage && !isError

/**
 * The narrower "fire the request now" edge: only when nothing is already in flight, and never after
 * a failure — `fetchNextPage` failing leaves `hasNextPage` true, so retrying on it would spin.
 */
export const shouldLoadMoreForHiddenRows = ({
    visibleRows,
    hasNextPage,
    isFetchingNextPage,
    isError = false,
}: {
    visibleRows: number
    hasNextPage: boolean
    isFetchingNextPage: boolean
    isError?: boolean
}): boolean => awaitingHiddenRows({visibleRows, hasNextPage, isError}) && !isFetchingNextPage

export const sessionListIdGroupLimit = (
    sessionIds: readonly string[] | undefined,
    requestedLimit: number | undefined,
): number | undefined => {
    if (sessionIds === undefined) return requestedLimit
    return Math.max(1, requestedLimit ?? 0, new Set(sessionIds).size)
}
