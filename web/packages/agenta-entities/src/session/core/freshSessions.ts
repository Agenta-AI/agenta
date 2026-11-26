/**
 * Sessions created brand-new in this browser and not yet run.
 *
 * A never-run local session has no backend records, so an open-with-empty-cache hydration would be
 * a guaranteed-empty server query. Marked on create, cleared on the first send. In-memory only
 * (`markSessionFresh` also writes the separate created-here record below): after a reload the
 * marker is gone, so a never-run session opened post-reload legitimately falls
 * back to hydrating (we can no longer tell "never ran" from "ran, cache cleared" without asking the
 * server — which is the point of hydration).
 *
 * Lives in the SESSION layer, not the chat one: the drive and the config panel need the same
 * predicate to decide whether a session has anything to fetch, and @agenta/chat already depends on
 * @agenta/entity-ui (so the reverse import would be a cycle).
 */
export const freshSessionIds = new Set<string>()

// Sessions this tab created, kept in `sessionStorage` so the record survives a reload. Narrower
// than the fresh marker: it only answers "this empty chat is ours". The chat's access check uses
// it, because after a reload an empty chat of our own has no row, and so does another person's
// private chat. The check forgets the id once the session has a row. Hydration does not use it.
const CREATED_HERE_KEY = "agenta:sessions-created-here"
const CREATED_HERE_LIMIT = 50

const readCreatedHere = (): string[] => {
    try {
        const parsed: unknown = JSON.parse(sessionStorage.getItem(CREATED_HERE_KEY) ?? "[]")
        return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []
    } catch {
        return []
    }
}

export const markSessionFresh = (sessionId: string) => {
    freshSessionIds.add(sessionId)
    try {
        const ids = readCreatedHere().filter((id) => id !== sessionId)
        ids.push(sessionId)
        sessionStorage.setItem(CREATED_HERE_KEY, JSON.stringify(ids.slice(-CREATED_HERE_LIMIT)))
    } catch {
        // No storage (server render, private mode): the in-memory marker still holds until reload.
    }
}
export const isSessionFresh = (sessionId: string) => freshSessionIds.has(sessionId)
/** Drop the record: the session was deleted, or it has a row and the row decides now. */
export const forgetSessionCreatedHere = (sessionId: string) => {
    try {
        const ids = readCreatedHere()
        if (!ids.includes(sessionId)) return
        sessionStorage.setItem(
            CREATED_HERE_KEY,
            JSON.stringify(ids.filter((id) => id !== sessionId)),
        )
    } catch {
        // No storage: nothing was recorded.
    }
}
/** Whether this tab created the session, also after a reload. */
export const isSessionCreatedHere = (sessionId: string) =>
    freshSessionIds.has(sessionId) || readCreatedHere().includes(sessionId)
export const clearSessionFresh = (sessionId: string) => freshSessionIds.delete(sessionId)
