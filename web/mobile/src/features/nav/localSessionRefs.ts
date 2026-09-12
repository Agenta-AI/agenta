import {useEffect} from "react"

import {sessionStatusAtomFamily} from "@agenta/chat/state"
import {forgetLocalSessionsAtom, localSessionsAtom} from "@agenta/entities/session"
import {
    localSessionRefsAtom,
    sidebarServerSessionIdsAtomFamily,
    type SessionSidebarRef,
} from "@agenta/navigation"
import {pinnedSessionIdsAtom} from "@agenta/sessions/state"
import {atom, useAtomValue, useSetAtom} from "jotai"

/**
 * Mobile's binding for `@agenta/navigation`'s local-session seam — the desktop feeds it from its
 * playground tab cache; mobile has no tab cache, so it feeds it from the sessions this client
 * created and sent into (`localSessionsAtom`, written by the chat screen on a fresh session's
 * first send).
 *
 * The server lists a session only once its first turn is admitted, which on a cold runner takes
 * seconds. Until then this is the row's only way into the rail (#6776). `withLocalSessions` lets
 * the server row win the moment it exists.
 */
export const localMobileSessionRefsAtom = atom<SessionSidebarRef[]>((get) => {
    const pinned = get(pinnedSessionIdsAtom)
    return Object.values(get(localSessionsAtom)).map((session) => {
        const status = get(sessionStatusAtomFamily(session.sessionId))
        return {
            id: session.sessionId,
            sessionId: session.sessionId,
            name: session.name,
            // Mobile rows link by session id alone; `appId` is the open target the server resolves.
            appId: null,
            agentId: session.agentId,
            pinned: pinned.includes(session.sessionId),
            alive: false,
            activityAt: new Date(session.createdAt).toISOString(),
            archived: false,
            // A chat you typed into is never a trigger run.
            isAutomation: false,
            running: status === "running",
            waiting: status === "awaiting",
        }
    })
})

/**
 * Mirror the derived rows into the package's writable seam, and retire local copies the server
 * has caught up with. Mounted with the rail: a rail that is not rendered has nothing to reconcile.
 */
export const useSyncLocalSessionRefs = (scopeId: string) => {
    const refs = useAtomValue(localMobileSessionRefsAtom)
    const setLocalRefs = useSetAtom(localSessionRefsAtom)
    useEffect(() => {
        setLocalRefs(refs)
    }, [refs, setLocalRefs])

    const serverIds = useAtomValue(sidebarServerSessionIdsAtomFamily(scopeId))
    const forget = useSetAtom(forgetLocalSessionsAtom)
    useEffect(() => {
        const known = refs.filter((ref) => serverIds.has(ref.sessionId)).map((ref) => ref.sessionId)
        if (known.length) forget(known)
    }, [refs, serverIds, forget])
}
