import {sessionStatusAtomFamily} from "@agenta/chat/state"
import {localSessionRefsAtom, type SessionSidebarRef} from "@agenta/navigation"
import {pinnedSessionIdsAtom} from "@agenta/sessions/state"
import {atom} from "jotai"

import {
    activeSessionIdAtomFamily,
    defaultScopeKeyAtom,
    isSessionHusk,
    sessionHasMessagesAtomFamily,
    sessionScopeKeysAtom,
    sessionsListAtomFamily,
    type AgentChatSession,
} from "@/oss/components/AgentChatSlice/state/sessions"
import {isValidUUID} from "@/oss/lib/helpers/validators"

/**
 * OSS binding for `@agenta/navigation`'s local-session seam (#5974).
 *
 * A session qualifies while it is the one you are looking at, while it is running or awaiting you,
 * or while the server list cannot carry it yet. The last of those spans EVERY playground scope, so
 * a session survives navigating to another agent; husks never qualify, so a blank chat cannot.
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

/**
 * Does this session still need the local seam to be listed at all?
 *
 * `serverKnown` is the one signal that survives a tab switch. `isActive` and `isLive` both go false
 * the moment you look away — `isLive` reads a record only a MOUNTED conversation writes — so a
 * session whose first turn was still in flight vanished from the rail until the server list caught
 * up (#6494). An unconfirmed session drops out by itself on the first reconcile.
 */
export const qualifiesForLocalRail = (
    session: AgentChatSession,
    {isActive, isLive}: {isActive: boolean; isLive: boolean},
): boolean => isActive || isLive || !session.serverKnown

export const localPlaygroundSessionRefsAtom = atom<SessionSidebarRef[]>((get) => {
    const routedScope = get(defaultScopeKeyAtom)
    const activeId = get(activePlaygroundSessionIdAtom)
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
    // EVERY playground scope, not just the routed one: a session you started and then left behind
    // by opening a different agent is exactly the one the server list cannot show yet (#6494).
    // A non-UUID scope (`__global__`, `drawer:*`, `onboarding`) never reconciles, so `serverKnown`
    // is never set there and its sessions would qualify forever — those are skipped.
    const scopeById = new Map<string, string>()
    const sessions: AgentChatSession[] = []
    for (const scope of get(sessionScopeKeysAtom).filter(isValidUUID)) {
        for (const session of get(sessionsListAtomFamily(scope))) {
            scopeById.set(session.id, scope)
            sessions.push(session)
        }
    }
    // The scope key doubles as the app id for the row's link, so it must be a real one.
    const scopeOf = (id: string) => scopeById.get(id) ?? routedScope
    return sessions
        .filter((session) =>
            qualifiesForLocalRail(session, {
                isActive: scopeOf(session.id) === routedScope && session.id === activeId,
                isLive: isLive(session.id),
            }),
        )
        .filter((session) => !isHusk(session))
        .map((session) => ({
            id: session.id,
            sessionId: session.id,
            name: session.title?.trim() || null,
            appId: scopeOf(session.id),
            agentId: scopeOf(session.id),
            pinned: pinned.includes(session.id),
            alive: false,
            activityAt: activityAt(session),
            // A client-created session has no server row yet, so it cannot be archived.
            archived: false,
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
