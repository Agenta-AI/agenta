import {querySessions, type SessionStream} from "@agenta/entities/session"
import {sessionOpenTarget} from "@agenta/sessions/row"
import {pinnedSessionIdsAtom} from "@agenta/sessions/state"
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import type {SidebarEntityRef} from "./types"

/** A session row as the sidebar needs it: enough to label it, dot it, and open it. */
export interface SessionSidebarRef extends SidebarEntityRef {
    sessionId: string
    /** Null until the session resolves an open target (a client-created row has none yet). */
    appId: string | null
    pinned: boolean
    alive: boolean
    agentName?: string | null
    /** A turn is in flight — the row spins. Resolved for rendered rows only. */
    running: boolean
}

/** Deliberately small — the sidebar shows the top of the list, and the sessions page owns
 * search, filters and paging. Gated by the group's open state like every other entity, so a
 * collapsed Sessions group costs nothing. Pins are fetched by id in their own query: a pinned
 * session older than this window must still appear. */
const SIDEBAR_SESSION_LIMIT = 20

const sidebarSessionsQueryAtom = atomWithQuery<SessionStream[] | null>((get) => {
    const projectId = get(projectIdAtom)
    return {
        queryKey: ["sidebar-sessions", projectId],
        queryFn: ({signal}) =>
            querySessions({
                projectId: projectId ?? "",
                includeArchived: false,
                limit: SIDEBAR_SESSION_LIMIT,
                abortSignal: signal,
                lowPriority: true,
            }),
        enabled: Boolean(projectId),
        staleTime: 30_000,
        refetchOnWindowFocus: true,
    }
})

const sidebarPinnedSessionsQueryAtom = atomWithQuery<SessionStream[] | null>((get) => {
    const projectId = get(projectIdAtom)
    const pinnedIds = get(pinnedSessionIdsAtom)
    return {
        queryKey: ["sidebar-sessions-pinned", projectId, pinnedIds],
        queryFn: ({signal}) =>
            querySessions({
                projectId: projectId ?? "",
                includeArchived: false,
                sessionIds: pinnedIds,
                abortSignal: signal,
                lowPriority: true,
            }),
        enabled: Boolean(projectId) && pinnedIds.length > 0,
        staleTime: 30_000,
        refetchOnWindowFocus: true,
    }
})

/** Null when the row has no open target yet (no turns) — the sidebar drops it rather than
 * rendering a link to `/apps/null`. */
const toSidebarRef = (row: SessionStream, pinned: Set<string>): SessionSidebarRef | null => {
    const target = sessionOpenTarget(row)
    if (!target) return null
    return {
        id: row.session_id,
        sessionId: row.session_id,
        // Raw, so the row menu's rename prefills the real name instead of the label's fallback.
        name: row.name?.trim() || null,
        appId: target.appId,
        pinned: pinned.has(row.session_id),
        alive: Boolean(row.flags?.is_alive),
        running: false,
    }
}

/**
 * Sessions the server-backed queries cannot show yet, contributed by the HOST.
 *
 * A session is created CLIENT-side; the server first hears about it when its first turn runs, and
 * even then the row carries no `references` until that turn lands — so `sessionOpenTarget` rejects
 * it and the queries above drop it. Until then the host's local store is the only place it exists.
 *
 * The host owns this because the local store is app state (chat tabs) that a package must not
 * reach into; `@agenta/navigation` only composes what it is given. Keying on "active" alone was
 * the bug behind Mahmoud's repro: switching tabs mid-first-turn dropped the RUNNING session's row
 * (and its spinner) until the turn finished and the server list could carry it.
 */
export const localSessionRefsAtom = atom<SessionSidebarRef[]>([])

/**
 * Drop sessions whose agent has been archived (#5944) — an archived agent's conversations should
 * not keep occupying the rail. A PIN is an explicit user request and is exempt, the same exemption
 * it gets from every other list rule.
 */
export const dropArchivedAgentSessions = (
    refs: readonly SessionSidebarRef[],
    // `null` = the archived-agents answer has not arrived; keep everything rather than blink rows
    // out and back in once it does.
    archivedAgentIds: ReadonlySet<string> | null,
): SessionSidebarRef[] =>
    archivedAgentIds === null
        ? [...refs]
        : refs.filter((ref) => ref.pinned || !ref.appId || !archivedAgentIds.has(ref.appId))

/**
 * Host-local rows lead the RECENT rows but never displace pins: pins are pulled to the top because
 * they are conversations you return to over days, and a session you happen to have open must not
 * push them down. A server row for the same session wins once it exists — it carries the resolved
 * open target and the liveness flags.
 */
export const withLocalSessions = (
    server: readonly SessionSidebarRef[],
    local: readonly SessionSidebarRef[],
): SessionSidebarRef[] => {
    const known = new Set(server.map((ref) => ref.sessionId))
    const fresh = local.filter((ref) => !known.has(ref.sessionId))
    const pinned = server.filter((ref) => ref.pinned)
    const rest = server.filter((ref) => !ref.pinned)
    return [...pinned, ...fresh, ...rest]
}

/**
 * Pinned sessions first, then the rest by activity.
 *
 * Pins are pulled to the top rather than left in place because a pinned conversation is one you
 * return to over days — exactly what a recency-ordered list buries. The ordering is the only
 * signal: the list renders rows, not headings.
 */
const sidebarSessionRefsAtom = atom<SessionSidebarRef[]>((get) => {
    const pinned = new Set(get(pinnedSessionIdsAtom))
    const pinnedRows = get(sidebarPinnedSessionsQueryAtom).data ?? []
    // Pins come from their own by-id query; the recent window drops them so nothing shows twice.
    const recentRows = (get(sidebarSessionsQueryAtom).data ?? []).filter(
        (row) => !pinned.has(row.session_id),
    )

    const isRef = (ref: SessionSidebarRef | null): ref is SessionSidebarRef => ref !== null
    const server = [
        ...pinnedRows.map((row) => toSidebarRef(row, pinned)).filter(isRef),
        ...recentRows.map((row) => toSidebarRef(row, pinned)).filter(isRef),
    ]
    return withLocalSessions(server, get(localSessionRefsAtom))
})

export const sidebarSessionsListAtom = atom((get) => {
    const query = get(sidebarSessionsQueryAtom)
    const pinnedQuery = get(sidebarPinnedSessionsQueryAtom)
    const hasPins = get(pinnedSessionIdsAtom).length > 0
    // A failed pin fetch must surface: the recent window excludes pinned ids, so silence here
    // would just make the pinned sessions vanish.
    const pinnedFailed = hasPins && pinnedQuery.isError
    return {
        data: get(sidebarSessionRefsAtom),
        isPending: query.isPending || (hasPins && pinnedQuery.isPending),
        isError: query.isError || pinnedFailed,
        error: query.error ?? (pinnedFailed ? pinnedQuery.error : null) ?? null,
    }
})
