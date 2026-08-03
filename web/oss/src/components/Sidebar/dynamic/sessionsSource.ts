import {querySessions, type SessionStream} from "@agenta/entities/session"
import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {sessionOpenTarget} from "@/oss/components/AgentChatSlice/assets/sessionOpenTarget"
import {pinnedSessionIdsAtom} from "@/oss/components/pages/sessions/state/pins"
import {projectIdAtom} from "@/oss/state/project"

import type {SidebarEntityRef} from "./types"

/** A session row as the sidebar needs it: enough to label it, dot it, and open it. */
export interface SessionSidebarRef extends SidebarEntityRef {
    sessionId: string
    appId: string | null
    pinned: boolean
    alive: boolean
}

/** Deliberately small and unfiltered — the sidebar shows the top of the list, and the sessions
 * page owns search, filters and paging. Gated by the group's open state like every other entity,
 * so a collapsed Sessions group costs nothing. */
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

/**
 * Pinned sessions first, then the rest by activity.
 *
 * Pins are pulled to the top rather than left in place because a pinned conversation is one you
 * return to over days — exactly what a recency-ordered list buries. The group headings the
 * registry renders depend on this ordering.
 */
const sidebarSessionRefsAtom = atom<SessionSidebarRef[]>((get) => {
    const rows = get(sidebarSessionsQueryAtom).data ?? []
    const pinned = new Set(get(pinnedSessionIdsAtom))

    const refs = rows.map((row): SessionSidebarRef => {
        const target = sessionOpenTarget(row)
        return {
            id: row.session_id,
            sessionId: row.session_id,
            name: row.name?.trim() || "Untitled session",
            appId: target?.appId ?? null,
            pinned: pinned.has(row.session_id),
            alive: Boolean(row.flags?.is_alive),
        }
    })

    return [...refs.filter((ref) => ref.pinned), ...refs.filter((ref) => !ref.pinned)]
})

export const sidebarSessionsListAtom = atom((get) => {
    const query = get(sidebarSessionsQueryAtom)
    return {
        data: get(sidebarSessionRefsAtom),
        isPending: query.isPending,
        isError: query.isError,
        error: query.error ?? null,
    }
})
