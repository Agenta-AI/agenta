/**
 * Sessions created brand-new in this browser and not yet run.
 *
 * A never-run local session has no backend records, so an open-with-empty-cache hydration would be
 * a guaranteed-empty server query. Marked on create, cleared on the first send. In-memory only:
 * after a reload the marker is gone, so a never-run session opened post-reload legitimately falls
 * back to hydrating (we can no longer tell "never ran" from "ran, cache cleared" without asking the
 * server — which is the point of hydration).
 *
 * Lives in the SESSION layer, not the chat one: the drive and the config panel need the same
 * predicate to decide whether a session has anything to fetch, and @agenta/chat already depends on
 * @agenta/entity-ui (so the reverse import would be a cycle).
 */
export const freshSessionIds = new Set<string>()

export const markSessionFresh = (sessionId: string) => freshSessionIds.add(sessionId)
export const isSessionFresh = (sessionId: string) => freshSessionIds.has(sessionId)
export const clearSessionFresh = (sessionId: string) => freshSessionIds.delete(sessionId)
