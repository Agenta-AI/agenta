import type {PendingSendEcho} from "../assets/pendingSendEchoes"

/**
 * Echo rows per session, owned outside React. A send's echo has to outlive the mount that made it:
 * switching sessions remounts the conversation, and the saved user row only lands once the runner
 * starts the turn, so an echo held in component state left the returning view with no message at
 * all while the run warmed up. Same module-scope-`Map` lifetime as `sessionEphemera`.
 */

type Echoes = readonly PendingSendEcho[]

const EMPTY: Echoes = []
const echoesBySession = new Map<string, Echoes>()
const listenersBySession = new Map<string, Set<() => void>>()

export const readPendingSendEchoes = (sessionId: string): Echoes =>
    echoesBySession.get(sessionId) ?? EMPTY

/** Apply a pure update. Callbacks from a send that outlived its mount still land here. */
export const updatePendingSendEchoes = (sessionId: string, update: (current: Echoes) => Echoes) => {
    const current = readPendingSendEchoes(sessionId)
    const next = update(current)
    if (next === current) return
    if (next.length === 0) echoesBySession.delete(sessionId)
    else echoesBySession.set(sessionId, next)
    listenersBySession.get(sessionId)?.forEach((listener) => listener())
}

export const subscribePendingSendEchoes = (sessionId: string, listener: () => void) => {
    const listeners = listenersBySession.get(sessionId) ?? new Set<() => void>()
    listeners.add(listener)
    listenersBySession.set(sessionId, listeners)
    return () => {
        listeners.delete(listener)
        if (listeners.size === 0) listenersBySession.delete(sessionId)
    }
}

export const clearPendingSendEchoes = (sessionId: string) => {
    updatePendingSendEchoes(sessionId, () => EMPTY)
}
