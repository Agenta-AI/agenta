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
    appId: string | null
    pinned: boolean
    alive: boolean
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
        name: row.name?.trim() || "Untitled session",
        appId: target.appId,
        pinned: pinned.has(row.session_id),
        alive: Boolean(row.flags?.is_alive),
    }
}

/**
 * Pinned sessions first, then the rest by activity.
 *
 * Pins are pulled to the top rather than left in place because a pinned conversation is one you
 * return to over days — exactly what a recency-ordered list buries. The group headings the
 * registry renders depend on this ordering.
 */
const sidebarSessionRefsAtom = atom<SessionSidebarRef[]>((get) => {
    const pinned = new Set(get(pinnedSessionIdsAtom))
    const pinnedRows = get(sidebarPinnedSessionsQueryAtom).data ?? []
    // Pins come from their own by-id query; the recent window drops them so nothing shows twice.
    const recentRows = (get(sidebarSessionsQueryAtom).data ?? []).filter(
        (row) => !pinned.has(row.session_id),
    )

    const isRef = (ref: SessionSidebarRef | null): ref is SessionSidebarRef => ref !== null
    return [
        ...pinnedRows.map((row) => toSidebarRef(row, pinned)).filter(isRef),
        ...recentRows.map((row) => toSidebarRef(row, pinned)).filter(isRef),
    ]
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
