import {createContext, useContext} from "react"

import {atom} from "jotai"

/**
 * Every filter here maps to a server predicate — see `useSessionList`. Nothing narrows a fetched
 * page client-side, because that would filter the window rather than the set.
 */
/**
 * Each of these is a predicate the SERVER applies, not a pass over a fetched page.
 *
 * The backend's liveness flags nest — `is_alive ⊇ is_running` — so the three live options are
 * genuinely different questions: `live` is "the sandbox is up", `running` is "a turn is going",
 * and `idle` is the complement of `live`. `waiting` is the odd one out: it narrows to the gated
 * session ids from the actionable-interactions poll rather than to a flag.
 */
export type SessionStatusFilter = "all" | "live" | "running" | "waiting" | "idle"

/**
 * One set of session list filters. The sessions pages share one set (the exports below). A page
 * that must not change them, such as the Sessions page locked to one agent, makes its own set
 * with `createSessionFilterAtoms` and provides it with `SessionFilterAtomsContext`.
 */
export const createSessionFilterAtoms = () => {
    const search = atom("")
    /** Agent workflow id, matched against the turns' references. */
    const agent = atom<string | null>(null)
    const status = atom<SessionStatusFilter>("all")
    const showArchived = atom(false)
    /**
     * The archive INSTEAD of the list, where `showArchived` shows it alongside.
     *
     * Two atoms rather than a tri-state, because the two surfaces ask different questions: the
     * desktop toolbar has a switch that widens the set, and the mobile list has a Type choice
     * that replaces it. Server-side `archived_only` wins over `include_archived`, so setting both
     * is not ambiguous.
     */
    const archivedOnly = atom(false)
    /** Automation runs are sessions too, so without this they sit in the list indistinguishable
     * from your own work. Hidden by default; the chip opts back in. */
    const showTriggered = atom(false)

    /** Everything the agent-scoped page can still narrow by — its agent comes from the route. */
    const activeExceptAgent = atom(
        (get) =>
            Boolean(get(search).trim()) ||
            get(status) !== "all" ||
            get(showArchived) ||
            get(archivedOnly) ||
            get(showTriggered),
    )
    const active = atom((get) => get(activeExceptAgent) || Boolean(get(agent)))

    const reset = atom(null, (_get, set) => {
        set(search, "")
        set(agent, null)
        set(status, "all")
        set(showArchived, false)
        set(archivedOnly, false)
        set(showTriggered, false)
    })

    return {
        search,
        agent,
        status,
        showArchived,
        archivedOnly,
        showTriggered,
        activeExceptAgent,
        active,
        reset,
    }
}

export type SessionFilterAtoms = ReturnType<typeof createSessionFilterAtoms>

/** The filters every all-sessions page shares. */
export const sharedSessionFilterAtoms: SessionFilterAtoms = createSessionFilterAtoms()

/** The set the hooks below a provider read; the shared set when there is no provider. */
export const SessionFilterAtomsContext = createContext<SessionFilterAtoms>(sharedSessionFilterAtoms)

export const useSessionFilterAtoms = (): SessionFilterAtoms => useContext(SessionFilterAtomsContext)

export const sessionSearchAtom = sharedSessionFilterAtoms.search
export const sessionAgentFilterAtom = sharedSessionFilterAtoms.agent
export const sessionStatusFilterAtom = sharedSessionFilterAtoms.status
export const sessionShowArchivedAtom = sharedSessionFilterAtoms.showArchived
export const sessionArchivedOnlyAtom = sharedSessionFilterAtoms.archivedOnly
export const sessionShowTriggeredAtom = sharedSessionFilterAtoms.showTriggered
export const sessionFiltersActiveExceptAgentAtom = sharedSessionFilterAtoms.activeExceptAgent
export const sessionFiltersActiveAtom = sharedSessionFilterAtoms.active
export const resetSessionFiltersAtom = sharedSessionFilterAtoms.reset

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
