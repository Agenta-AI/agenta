import {sessionStatusAtomFamily} from "@agenta/chat/state"
import {localSessionRefsAtom, type SessionSidebarRef} from "@agenta/navigation"
import {pinnedSessionIdsAtom} from "@agenta/sessions/state"
import {atom} from "jotai"

import {
    activeSessionIdAtomFamily,
    defaultScopeKeyAtom,
    sessionsListAtomFamily,
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
    return (sessions.find((session) => session.id === rawActiveId) ?? sessions[0])?.id ?? null
})

export const localPlaygroundSessionRefsAtom = atom<SessionSidebarRef[]>((get) => {
    const scope = get(defaultScopeKeyAtom)
    // The scope key doubles as the app id for the row's link, so it must be a real one.
    if (!isValidUUID(scope)) return []
    const sessions = get(sessionsListAtomFamily(scope))
    const activeId = get(activePlaygroundSessionIdAtom)
    const active = sessions.find((session) => session.id === activeId) ?? null
    const pinned = get(pinnedSessionIdsAtom)
    const isLive = (id: string) => {
        const status = get(sessionStatusAtomFamily(id))
        return status === "running" || status === "awaiting"
    }
    return sessions
        .filter((session) => session.id === active?.id || isLive(session.id))
        .map((session) => ({
            id: session.id,
            sessionId: session.id,
            name: session.title?.trim() || null,
            appId: scope,
            agentId: scope,
            pinned: pinned.includes(session.id),
            alive: false,
            // A client-created session has no server row yet, so it cannot be archived.
            archived: false,
            running: isLive(session.id),
        }))
})

/** Mirrors the derived refs into the package's writable seam. */
export const syncLocalSessionRefsAtom = atom(null, (get, set) => {
    set(localSessionRefsAtom, get(localPlaygroundSessionRefsAtom))
})
