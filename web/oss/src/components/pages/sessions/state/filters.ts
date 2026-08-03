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

export const sessionFiltersActiveAtom = atom(
    (get) =>
        Boolean(get(sessionSearchAtom).trim()) ||
        Boolean(get(sessionAgentFilterAtom)) ||
        get(sessionStatusFilterAtom) !== "all" ||
        get(sessionShowArchivedAtom),
)

export const resetSessionFiltersAtom = atom(null, (_get, set) => {
    set(sessionSearchAtom, "")
    set(sessionAgentFilterAtom, null)
    set(sessionStatusFilterAtom, "all")
    set(sessionShowArchivedAtom, false)
})
