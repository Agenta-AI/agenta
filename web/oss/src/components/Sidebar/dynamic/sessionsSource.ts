import {type SessionStream} from "@agenta/entities/session"
import {workflowMolecule} from "@agenta/entities/workflow"
import {isStartedSession, pinnedSessionIdsAtom} from "@agenta/sessions/state"
import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {sessionOpenTarget} from "@/oss/components/AgentChatSlice/assets/sessionOpenTarget"
import {sessionListPolicies} from "@/oss/lib/sessionListPolicies"
import {projectIdAtom} from "@/oss/state/project"

import {sidebarSessionOptions} from "./sessionOptions"
import type {SidebarEntityRef} from "./types"

/** A session row as the sidebar needs it: enough to label it, dot it, and open it. */
export interface SessionSidebarRef extends SidebarEntityRef {
    sessionId: string
    appId: string | null
    pinned: boolean
    alive: boolean
    /** Owning agent's display name, for the row's hover tooltip. Null until the artifact resolves. */
    agentName: string | null
}

/** Deliberately small — the sidebar shows the top of the list, and the sessions page owns
 * search, filters and paging. Gated by the group's open state like every other entity, so a
 * collapsed Sessions group costs nothing. Pins are fetched by id in their own query: a pinned
 * session older than this window must still appear. */
const sidebarSessionsQueryAtom = atomWithQuery<SessionStream[] | null>((get) => {
    const projectId = get(projectIdAtom)
    const pinnedIds = get(pinnedSessionIdsAtom)
    const options = sidebarSessionOptions({
        projectId: projectId ?? "",
        excludeSessionIds: pinnedIds,
    })
    return {
        queryKey: ["sidebar", ...options.queryKey],
        queryFn: ({signal}) =>
            options.queryFn({pageParam: null, signal}).then((page) => page?.sessions ?? null),
        enabled: Boolean(projectId),
        staleTime: 30_000,
        refetchOnWindowFocus: true,
    }
})

const sidebarPinnedSessionsQueryAtom = atomWithQuery<SessionStream[] | null>((get) => {
    const projectId = get(projectIdAtom)
    const pinnedIds = get(pinnedSessionIdsAtom)
    // A pin overrides the sidebar's origin filter — a pinned automation session must still show
    // (P2-8).
    const options = sidebarSessionOptions({
        projectId: projectId ?? "",
        sessionIds: pinnedIds,
        policy: sessionListPolicies.sidebarPinned,
    })
    return {
        queryKey: ["sidebar", "pinned", ...options.queryKey],
        queryFn: ({signal}) =>
            options.queryFn({pageParam: null, signal}).then((page) => page?.sessions ?? null),
        enabled: Boolean(projectId) && pinnedIds.length > 0,
        staleTime: 30_000,
        refetchOnWindowFocus: true,
    }
})

/** Null when the row has no open target yet (no turns) — the sidebar drops it rather than
 * rendering a link to `/apps/null`. */
const toSidebarRef = (
    row: SessionStream,
    pinned: Set<string>,
    agentName: string | null,
): SessionSidebarRef | null => {
    const target = sessionOpenTarget(row)
    if (!target) return null
    return {
        id: row.session_id,
        sessionId: row.session_id,
        name: row.name?.trim() || "Untitled session",
        appId: target.appId,
        pinned: pinned.has(row.session_id),
        alive: Boolean(row.flags?.is_alive),
        agentName,
    }
}

/**
 * Pinned sessions first, then the rest by activity.
 *
 * Pins are pulled to the top rather than left in place because a pinned conversation is one you
 * return to over days — exactly what a recency-ordered list buries.
 */
const sidebarSessionRefsAtom = atom<SessionSidebarRef[]>((get) => {
    const pinned = new Set(get(pinnedSessionIdsAtom))
    // The owning agent's name for the row tooltip, read off the workflow ARTIFACT (a revision's
    // own `name` is the variant's, never the entity's). Only the handful of apps these rows point
    // at are resolved, and the group is gated, so a closed Sessions group asks for nothing.
    const agentNameOf = (appId: string | null) =>
        appId ? get(workflowMolecule.selectors.artifactName(appId)) : null
    const pinnedRows = get(sidebarPinnedSessionsQueryAtom).data ?? []
    // The server excludes pins before paging; this remains a defensive dedupe. Chats that were
    // opened but never used are dropped here (the shared list rule) so the group's few slots hold
    // real sessions — the window above is sized to have real ones left after this.
    const recentRows = (get(sidebarSessionsQueryAtom).data ?? []).filter(
        (row) => !pinned.has(row.session_id) && isStartedSession(row),
    )

    const isRef = (ref: SessionSidebarRef | null): ref is SessionSidebarRef => ref !== null
    const toRef = (row: SessionStream) =>
        toSidebarRef(row, pinned, agentNameOf(sessionOpenTarget(row)?.appId ?? null))
    return [...pinnedRows.map(toRef).filter(isRef), ...recentRows.map(toRef).filter(isRef)]
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
