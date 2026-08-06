import {
    nextSessionCursor,
    queryInteractions,
    sessionListQueryOptions,
    sessionRowsFromPages,
    SESSIONS_PAGE_SIZE,
    type SessionInteraction,
    type SessionListCursor,
} from "@agenta/entities/session"
import {projectIdAtom} from "@agenta/shared/state"
import {keepPreviousData, useInfiniteQuery, useQuery} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

import {type SessionStatusFilter} from "./filters"

export {SESSIONS_PAGE_SIZE}

/**
 * Every session in the project with a pending human gate, in one unpaginated call. Two jobs: the
 * per-row "waiting" badge, and the id set the "Waiting" filter pushes down to the server.
 *
 * Cadence mirrors mobile: 15s while anything is pending (a running turn is what mints new gates),
 * 30s when idle, re-checked on focus.
 */
export const useActionableInteractions = (projectId: string) =>
    useQuery<SessionInteraction[] | null>({
        queryKey: ["sessions-page", "actionable-interactions", projectId],
        queryFn: ({signal}) =>
            queryInteractions({projectId, actionableOnly: true, abortSignal: signal}),
        enabled: Boolean(projectId),
        staleTime: 10_000,
        refetchInterval: (query) => ((query.state.data?.length ?? 0) > 0 ? 15_000 : 30_000),
        refetchOnWindowFocus: true,
    })

export interface SessionPending {
    count: number
    /** Distinct gate kinds still open. Carries what the session is asking for, not just that it
     * asks — "approve" and "needs input" are different calls to action. */
    kinds: string[]
}

/** `session_id → pending gates`; `undefined` until the poll resolves. */
export const pendingBySessionId = (
    interactions: SessionInteraction[] | null | undefined,
): Map<string, SessionPending> | undefined => {
    if (!interactions) return undefined
    const bySession = new Map<string, SessionPending>()
    for (const interaction of interactions) {
        const entry = bySession.get(interaction.session_id) ?? {count: 0, kinds: []}
        entry.count += 1
        if (interaction.kind && !entry.kinds.includes(interaction.kind))
            entry.kinds.push(interaction.kind)
        bySession.set(interaction.session_id, entry)
    }
    return bySession
}

interface SessionListOptions {
    /** Ids rendered as their own group (pins) — excluded so nothing appears twice. */
    excludeSessionIds?: string[]
    /** Restrict to these ids; used by the pinned group to fetch exactly its own rows. */
    sessionIds?: string[]
    status?: SessionStatusFilter
    search?: string
    agentId?: string | null
    includeArchived?: boolean
    /** Include automation-started sessions in the default list. Off by default. */
    showTriggered?: boolean
    /** Restrict to ONE origin — the automations list. Distinct from `showTriggered`, which only
     * widens the default list rather than narrowing it. */
    origin?: string
    /** Ids of sessions with a pending gate — the pushdown behind the "Waiting" filter. */
    waitingSessionIds?: string[]
    /** Page size. Drop it for callers that want one row (a roster's "last active") rather than
     * a list — a full page per row is a lot of list to throw away. */
    limit?: number
    enabled?: boolean
}

/**
 * The project-wide session list, windowed on the server's activity ordering.
 *
 * Every filter is a server predicate: `search`, `references` (agent), `include_archived`, `flags`
 * (live), and a `session_ids` pushdown for the predicates that live outside the stream row
 * (waiting-on-you, pins). Narrowing a fetched page in the browser would filter the window rather
 * than the set — wrong counts, and an empty first page while later pages hold matches.
 *
 * The key and the request come from `@agenta/entities/session`; the query-client policy (stale
 * time, refetch cadence) stays here, because desktop and mobile don't agree on it. Mobile adopts
 * the same factory once its session PRs stop moving.
 */
export const useSessionList = ({
    excludeSessionIds,
    sessionIds,
    status = "all",
    search = "",
    agentId = null,
    includeArchived = false,
    showTriggered = false,
    origin,
    waitingSessionIds,
    limit,
    enabled = true,
}: SessionListOptions = {}) => {
    const projectId = useAtomValue(projectIdAtom) ?? ""

    // "Waiting" narrows to the gated ids; combined with an explicit set, the server intersects.
    const restrictIds =
        status === "waiting" ? intersectIds(sessionIds, waitingSessionIds ?? []) : sessionIds
    // A waiting filter whose poll hasn't resolved must not query — an absent id set would read as
    // "no restriction" and show every session under a "Waiting" chip.
    const waitingUnresolved = status === "waiting" && waitingSessionIds === undefined

    const options = sessionListQueryOptions({
        projectId,
        search,
        agentId,
        includeArchived,
        origin,
        // Exclude rather than match: a session written before origins were stamped has no tag,
        // and must still appear in the default list. Skipped when asking for one origin outright.
        excludeOrigin: origin || showTriggered ? undefined : "trigger",
        flags: status === "live" ? {is_alive: true} : undefined,
        sessionIds: restrictIds,
        excludeSessionIds,
        limit,
    })

    return useInfiniteQuery({
        queryKey: options.queryKey,
        // A waiting filter whose poll hasn't resolved must not query: an absent id set reads as
        // "no restriction", which would show every session under a "Waiting" chip.
        enabled: Boolean(projectId) && enabled && !waitingUnresolved,
        initialPageParam: null as SessionListCursor | null,
        queryFn: ({pageParam, signal}) => options.queryFn({pageParam, signal}),
        getNextPageParam: (lastPage) => nextSessionCursor(lastPage, options.limit),
        // Pins and filters are part of the key, so every toggle mints a new query. Without this
        // the list would fall back to `pending` and flash its skeleton — the rows are still valid,
        // only their membership is being rechecked.
        placeholderData: keepPreviousData,
        staleTime: 30_000,
    })
}

/** Flatten loaded pages, dropping failed ones (`querySessions` resolves null on failure). */
export const rowsFromPages = sessionRowsFromPages

const intersectIds = (a: string[] | undefined, b: string[]): string[] => {
    if (!a) return b
    const other = new Set(b)
    return a.filter((id) => other.has(id))
}
