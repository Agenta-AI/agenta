import {sessionStatusAtomFamily} from "@agenta/chat/state"
import {localSessionRefsAtom, type SessionSidebarRef} from "@agenta/navigation"
import {pinnedSessionIdsAtom} from "@agenta/sessions/state"
import {atom} from "jotai"

import {
    activeSessionIdAtomFamily,
    defaultScopeKeyAtom,
    isSessionHusk,
    sessionHasMessagesAtomFamily,
    sessionsListAtomFamily,
    type AgentChatSession,
} from "@/oss/components/AgentChatSlice/state/sessions"
import {isValidUUID} from "@/oss/lib/helpers/validators"

/**
 * OSS binding for `@agenta/navigation`'s local-session seam (#5974).
 *
 * Two playground sessions qualify, and neither is abandoned: the one you are looking at, and any
 * that is RUNNING or awaiting you. Scope is the routed app id, so rows disappear when you leave
 * that playground — a blank chat never lingers.
 *
 * `error` is settled, not live: an errored empty session is as abandoned as an untouched one.
 */
/**
 * The session the playground is actually showing, with the panel's own stale-id fallback applied.
 *
 * Both the local refs below and the rail's selected row read it: a session row's LINK is its
 * agent's playground URL (which session opens is handed over by the click, not by the route), so
 * route matching alone can never tell a session row from its agent row.
 */
export const activePlaygroundSessionIdAtom = atom<string | null>((get) => {
    const scope = get(defaultScopeKeyAtom)
    if (!isValidUUID(scope)) return null
    const sessions = get(sessionsListAtomFamily(scope))
    const rawActiveId = get(activeSessionIdAtomFamily(scope))
    // Same fallback the panel applies to a stale active id (its tab was closed).
    const active = sessions.find((session) => session.id === rawActiveId) ?? sessions[0]
    if (!active) return null
    // A husk has no row to select — see `localPlaygroundSessionRefsAtom`. Naming one here left the
    // rail pinning a selection onto a row it does not render, which then fell back to the agent.
    return isSessionHusk(active, get(sessionHasMessagesAtomFamily(active.id))) ? null : active.id
})

export const localPlaygroundSessionRefsAtom = atom<SessionSidebarRef[]>((get) => {
    const scope = get(defaultScopeKeyAtom)
    // The scope key doubles as the app id for the row's link, so it must be a real one.
    if (!isValidUUID(scope)) return []
    const sessions = get(sessionsListAtomFamily(scope))
    const activeId = get(activePlaygroundSessionIdAtom)
    const active = sessions.find((session) => session.id === activeId) ?? null
    const pinned = get(pinnedSessionIdsAtom)
    const statusOf = (id: string) => get(sessionStatusAtomFamily(id))
    const isLive = (id: string) => {
        const status = statusOf(id)
        return status === "running" || status === "awaiting"
    }
    // Husks stay off the rail — the same rule the sessions list applies with `isStartedSession`,
    // and what keeps the blank tab the panel seeds after an archive from taking the selection.
    const isHusk = (session: AgentChatSession) =>
        isSessionHusk(session, get(sessionHasMessagesAtomFamily(session.id)))
    // ms epoch -> ISO, the shape the date buckets parse. `lastMessageAt` first, `createdAt` next,
    // matching the history picker's own ordering key; without it an open session had no activity
    // date and fell into the "No activity" heading under date grouping.
    const activityAt = (session: AgentChatSession): string | null => {
        const at = session.lastMessageAt ?? session.createdAt
        return at ? new Date(at).toISOString() : null
    }
    return sessions
        .filter((session) => session.id === active?.id || isLive(session.id))
        .filter((session) => !isHusk(session))
        .map((session) => ({
            id: session.id,
            sessionId: session.id,
            name: session.title?.trim() || null,
            appId: scope,
            agentId: scope,
            pinned: pinned.includes(session.id),
            alive: false,
            activityAt: activityAt(session),
            // The server source excludes archived rows, so this ref is their only way in (#6468).
            archived: Boolean(session.archived),
            // A playground chat is never a trigger run.
            isAutomation: false,
            // Running and awaiting are DIFFERENT signals — one spins, the other goes amber — so
            // the row cannot report the "either" that decides whether it is listed at all.
            running: statusOf(session.id) === "running",
            waiting: statusOf(session.id) === "awaiting",
        }))
})

/** Mirrors the derived refs into the package's writable seam. */
export const syncLocalSessionRefsAtom = atom(null, (get, set) => {
    set(localSessionRefsAtom, get(localPlaygroundSessionRefsAtom))
})
