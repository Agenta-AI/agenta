import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"
import {atomFamily} from "jotai-family"

const SESSION_FILTERS_STORAGE_KEY = "agenta:sidebar:session-filters"
// EXPANDED, not collapsed: groups now start folded, so the stored set is what the user opened.
// A new key on purpose — reading the old collapsed set here would invert every saved choice.
const SESSION_GROUPS_TOGGLED_STORAGE_KEY = "agenta:sidebar:session-groups-toggled"
const NO_PROJECT_SCOPE = "__global__"

/** The pins' own heading. */
export const PINNED_GROUP_KEY = "pinned"

/** Liveness the server can answer directly — `flags.is_running` / `flags.is_alive`. */
export type SidebarSessionStatusFilter = "all" | "running" | "waiting" | "idle"

/** Last-activity floor, in hours. `null` = no bound. */
export type SidebarSessionActivityFilter = "all" | "24h" | "7d" | "30d"

export const ACTIVITY_WINDOW_HOURS: Record<SidebarSessionActivityFilter, number | null> = {
    all: null,
    "24h": 24,
    "7d": 24 * 7,
    "30d": 24 * 30,
}

/** What the headings bucket by. `none` is a flat list. Pins always lead in their own heading. */
export type SidebarSessionGroupBy = "none" | "agent" | "date" | "status"

/** Which sessions the rail lists. `chat` and `automation` swap the list; `all` mixes both. */
export type SidebarSessionTypeFilter = "all" | "chat" | "automation"

/** Everything the menu offers. A stored value outside this set is stale and falls back. */
const GROUP_BY_VALUES = new Set<string>(["none", "agent", "date", "status"])

export interface SidebarSessionFilters {
    groupBy: SidebarSessionGroupBy
    /** Agent workflow ids, matched against the turns' references. Empty = every agent. */
    agentIds: string[]
    status: SidebarSessionStatusFilter
    activity: SidebarSessionActivityFilter
    type: SidebarSessionTypeFilter
}

export const DEFAULT_SIDEBAR_SESSION_FILTERS: SidebarSessionFilters = {
    // A flat list is the behaviour the rail shipped with; headings are opt-in.
    groupBy: "none",
    agentIds: [],
    status: "all",
    // A WEEK, not everything: the rail is for what you are working on, and the sessions page owns
    // the archive. It also narrows the fetch, which no render-side cap can do.
    activity: "7d",
    // CHAT, not all: a schedule that runs hourly would bury the conversations you are having.
    type: "chat",
}

// Persisted, not in-memory: a hot module swap re-creates every atomFamily instance, so an
// in-memory atom resets to its default (as sidebarPopupGroupsAtomFamily does). Storage-backed
// atoms re-read on the new instance's first read and come back intact — as does a full reload.
const sessionFiltersStorageAtom = atomWithStorage<Record<string, SidebarSessionFilters>>(
    SESSION_FILTERS_STORAGE_KEY,
    {},
)

const toggledGroupsStorageAtom = atomWithStorage<Record<string, string[]>>(
    SESSION_GROUPS_TOGGLED_STORAGE_KEY,
    {},
)

const storageScope = (scopeId: string, projectId: string | null) =>
    `${scopeId}:${projectId || NO_PROJECT_SCOPE}`

/** Scoped per project so one project's agent filter never narrows another's list. */
export const sidebarSessionFiltersAtomFamily = atomFamily((scopeId: string) =>
    atom(
        (get) => {
            const scope = storageScope(scopeId, get(projectIdAtom))
            // MERGED, not `??`: state persisted before a field existed would otherwise come back
            // missing it, and the facet would render with no value.
            const stored = get(sessionFiltersStorageAtom)[scope] ?? {}
            const merged = {...DEFAULT_SIDEBAR_SESSION_FILTERS, ...stored}
            // "Pinned first" was retired — pins lead under every grouping, so it grouped by
            // nothing. Anyone still holding it reads as the default rather than as a value the
            // menu cannot show or the grouper understands.
            return GROUP_BY_VALUES.has(merged.groupBy)
                ? merged
                : {...merged, groupBy: DEFAULT_SIDEBAR_SESSION_FILTERS.groupBy}
        },
        (get, set, next: Partial<SidebarSessionFilters>) => {
            const scope = storageScope(scopeId, get(projectIdAtom))
            const storage = get(sessionFiltersStorageAtom)
            const current = {...DEFAULT_SIDEBAR_SESSION_FILTERS, ...(storage[scope] ?? {})}
            set(sessionFiltersStorageAtom, {...storage, [scope]: {...current, ...next}})
        },
    ),
)

/** What the dot answers: "are rows being HIDDEN?". `groupBy` only rearranges the rows you already
 * have, so it is a view preference and is deliberately absent. */
const FILTER_KEYS = (
    Object.keys(DEFAULT_SIDEBAR_SESSION_FILTERS) as (keyof SidebarSessionFilters)[]
).filter((key) => key !== "groupBy")

export const sidebarSessionFiltersDirtyAtomFamily = atomFamily((scopeId: string) =>
    atom((get) => {
        const filters = get(sidebarSessionFiltersAtomFamily(scopeId))
        return FILTER_KEYS.some((key) => {
            const value = filters[key]
            // An array default is a fresh [] every read, so identity would report dirty forever.
            if (Array.isArray(value)) return value.length > 0
            // "All" hides nothing, whichever facet it is on. Now that the activity default is a
            // week, widening it back to everything is off-DEFAULT but not a filter — and a dot
            // that lights up for showing MORE rows says the opposite of what it means.
            if (value === "all") return false
            return value !== DEFAULT_SIDEBAR_SESSION_FILTERS[key]
        })
    }),
)

/**
 * Headings the user has toggled AWAY from their default — not a list of open groups.
 *
 * An open/closed list cannot survive a regrouping: its keys are `agent:…`, so switching to dates
 * matches nothing and the whole rail reads as collapsed. An override set is grouping-agnostic,
 * because the default it flips is whatever the new grouping asks for.
 */
export const sidebarSessionToggledGroupsAtomFamily = atomFamily((scopeId: string) =>
    atom(
        (get) => {
            const scope = storageScope(scopeId, get(projectIdAtom))
            return get(toggledGroupsStorageAtom)[scope] ?? []
        },
        (get, set, groupKey: string) => {
            const scope = storageScope(scopeId, get(projectIdAtom))
            const storage = get(toggledGroupsStorageAtom)
            const current = storage[scope] ?? []
            const next = current.includes(groupKey)
                ? current.filter((key) => key !== groupKey)
                : [...current, groupKey]
            set(toggledGroupsStorageAtom, {...storage, [scope]: next})
        },
    ),
)
