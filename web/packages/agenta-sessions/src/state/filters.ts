import {atom} from "jotai"

/**
 * Every filter here maps to a server predicate — see `useSessionList`. Nothing narrows a fetched
 * page client-side, because that would filter the window rather than the set.
 */
export type SessionStatusFilter = "all" | "live" | "waiting"

export const sessionSearchAtom = atom("")
/** Agent workflow id, matched against the turns' references. */
export const sessionAgentFilterAtom = atom<string | null>(null)
export const sessionStatusFilterAtom = atom<SessionStatusFilter>("all")
export const sessionShowArchivedAtom = atom(false)
/** Automation runs are sessions too, so without this they sit in the list indistinguishable from
 * your own work. Hidden by default; the chip opts back in. */
export const sessionShowTriggeredAtom = atom(false)

/** Everything the agent-scoped page can still narrow by — its agent comes from the route. */
export const sessionFiltersActiveExceptAgentAtom = atom(
    (get) =>
        Boolean(get(sessionSearchAtom).trim()) ||
        get(sessionStatusFilterAtom) !== "all" ||
        get(sessionShowArchivedAtom) ||
        get(sessionShowTriggeredAtom),
)

export const sessionFiltersActiveAtom = atom(
    (get) => get(sessionFiltersActiveExceptAgentAtom) || Boolean(get(sessionAgentFilterAtom)),
)

export const resetSessionFiltersAtom = atom(null, (_get, set) => {
    set(sessionSearchAtom, "")
    set(sessionAgentFilterAtom, null)
    set(sessionStatusFilterAtom, "all")
    set(sessionShowArchivedAtom, false)
    set(sessionShowTriggeredAtom, false)
})

export interface SessionScope {
    agentId?: string | null
    /** The card's origin restriction — "trigger" for the automations list. */
    origin?: string | null
    status?: SessionStatusFilter
}

/**
 * Point the sessions page at the same set a card was showing.
 *
 * Without this, "View all" under *Automation runs* landed on a list that hides automations by
 * default — the one thing you were looking at. Filters are reset first so a scope never inherits
 * whatever was left over from the last visit.
 */
export const applySessionScopeAtom = atom(null, (_get, set, scope: SessionScope) => {
    set(resetSessionFiltersAtom)
    if (scope.agentId) set(sessionAgentFilterAtom, scope.agentId)
    if (scope.origin === "trigger") set(sessionShowTriggeredAtom, true)
    if (scope.status) set(sessionStatusFilterAtom, scope.status)
})

export const sessionRouteModes = {automation: "automation"} as const

export type SessionRouteMode = (typeof sessionRouteModes)[keyof typeof sessionRouteModes]

export type SessionRouteQuery = Record<string, string | string[] | undefined>

/**
 * Maps the public sessions route query to the in-memory scope above.
 *
 * The URL names a user-facing mode rather than the internal request policy, so the route stays
 * independent from how this package implements its server-side predicates.
 */
export const sessionScopeFromRouteQuery = (query: SessionRouteQuery): SessionScope | undefined =>
    query.mode === sessionRouteModes.automation ? {origin: "trigger"} : undefined
