import {
    querySessions,
    queryInteractions,
    type SessionInteraction,
    type SessionStream,
} from "@agenta/entities/session"
import {useInfiniteQuery, useQuery} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

import {projectIdAtom} from "@/oss/state/project"

import {type SessionStatusFilter} from "./filters"

export const SESSIONS_PAGE_SIZE = 30

type SessionsCursor = {next: string; newest: string} | null

/**
 * Every session in the project with a pending human gate, in one unpaginated call. Two jobs: the
 * per-row "waiting" badge, and the id set the "Waiting" filter pushes down to the server.
 *
 * Cadence mirrors mobile: 15s while anything is pending (a running turn is what mints new gates),
 * stopped when idle, re-checked on focus.
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

/** `session_id → pending count`; `undefined` until the poll resolves. */
export const pendingCountBySession = (
    interactions: SessionInteraction[] | null | undefined,
): Map<string, number> | undefined => {
    if (!interactions) return undefined
    const counts = new Map<string, number>()
    for (const interaction of interactions) {
        counts.set(interaction.session_id, (counts.get(interaction.session_id) ?? 0) + 1)
    }
    return counts
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
    /** Ids of sessions with a pending gate — the pushdown behind the "Waiting" filter. */
    waitingSessionIds?: string[]
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
 * Lives in the app layer for now; it belongs in `@agenta/entities/session` and moves there once the
 * mobile session PRs stop touching that package.
 */
export const useSessionList = ({
    excludeSessionIds,
    sessionIds,
    status = "all",
    search = "",
    agentId = null,
    includeArchived = false,
    waitingSessionIds,
    enabled = true,
}: SessionListOptions = {}) => {
    const projectId = useAtomValue(projectIdAtom) ?? ""

    // "Waiting" narrows to the gated ids; combined with an explicit set, the server intersects.
    const restrictIds =
        status === "waiting" ? intersectIds(sessionIds, waitingSessionIds ?? []) : sessionIds
    // A waiting filter whose poll hasn't resolved must not query — an absent id set would read as
    // "no restriction" and show every session under a "Waiting" chip.
    const waitingUnresolved = status === "waiting" && waitingSessionIds === undefined

    return useInfiniteQuery({
        queryKey: [
            "sessions-page",
            "list",
            projectId,
            search,
            agentId,
            status,
            includeArchived,
            restrictIds,
            excludeSessionIds,
        ],
        enabled: Boolean(projectId) && enabled && !waitingUnresolved,
        initialPageParam: null as SessionsCursor,
        queryFn: ({pageParam, signal}) =>
            querySessions({
                projectId,
                search: search.trim() || undefined,
                references: agentId ? [{id: agentId}] : undefined,
                includeArchived,
                flags: status === "live" ? {is_alive: true} : undefined,
                sessionIds: restrictIds,
                excludeSessionIds: excludeSessionIds?.length ? excludeSessionIds : undefined,
                limit: SESSIONS_PAGE_SIZE,
                next: pageParam?.next,
                newest: pageParam?.newest,
                abortSignal: signal,
            }),
        getNextPageParam: (lastPage): SessionsCursor | undefined => {
            if (!lastPage || lastPage.length < SESSIONS_PAGE_SIZE) return undefined
            const last = lastPage[lastPage.length - 1]
            const newest = last.updated_at ?? last.created_at
            return last.id && newest ? {next: last.id, newest} : undefined
        },
        staleTime: 30_000,
    })
}

/** Flatten loaded pages, dropping failed ones (`querySessions` resolves null on failure). */
export const rowsFromPages = (pages: (SessionStream[] | null)[] | undefined): SessionStream[] =>
    (pages ?? []).filter(Boolean).flat() as SessionStream[]

const intersectIds = (a: string[] | undefined, b: string[]): string[] => {
    if (!a) return b
    const other = new Set(b)
    return a.filter((id) => other.has(id))
}
