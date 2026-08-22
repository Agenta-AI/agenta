import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"
import {atomFamily} from "jotai-family"

const SESSION_FILTERS_STORAGE_KEY = "agenta:sidebar:session-filters"
const SESSION_GROUPS_COLLAPSED_STORAGE_KEY = "agenta:sidebar:session-groups-collapsed"
const NO_PROJECT_SCOPE = "__global__"

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

/** What the headings bucket by. Pins always lead in their own heading, whichever is chosen. */
export type SidebarSessionGroupBy = "agent" | "date" | "status" | "pinned"

export interface SidebarSessionFilters {
    groupBy: SidebarSessionGroupBy
    /** Agent workflow ids, matched against the turns' references. Empty = every agent. */
    agentIds: string[]
    status: SidebarSessionStatusFilter
    activity: SidebarSessionActivityFilter
    pinnedOnly: boolean
    /** The archived VIEW: only archived sessions, never a widening of the active list. */
    archivedOnly: boolean
}

export const DEFAULT_SIDEBAR_SESSION_FILTERS: SidebarSessionFilters = {
    groupBy: "agent",
    agentIds: [],
    status: "all",
    activity: "all",
    pinnedOnly: false,
    archivedOnly: false,
}

// Persisted, not in-memory: a hot module swap re-creates every atomFamily instance, so an
// in-memory atom resets to its default (as sidebarPopupGroupsAtomFamily does). Storage-backed
// atoms re-read on the new instance's first read and come back intact — as does a full reload.
const sessionFiltersStorageAtom = atomWithStorage<Record<string, SidebarSessionFilters>>(
    SESSION_FILTERS_STORAGE_KEY,
    {},
)

const collapsedGroupsStorageAtom = atomWithStorage<Record<string, string[]>>(
    SESSION_GROUPS_COLLAPSED_STORAGE_KEY,
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
            return {
                ...DEFAULT_SIDEBAR_SESSION_FILTERS,
                ...(get(sessionFiltersStorageAtom)[scope] ?? {}),
            }
        },
        (get, set, next: Partial<SidebarSessionFilters>) => {
            const scope = storageScope(scopeId, get(projectIdAtom))
            const storage = get(sessionFiltersStorageAtom)
            const current = {...DEFAULT_SIDEBAR_SESSION_FILTERS, ...(storage[scope] ?? {})}
            set(sessionFiltersStorageAtom, {...storage, [scope]: {...current, ...next}})
        },
    ),
)

export const sidebarSessionFiltersDirtyAtomFamily = atomFamily((scopeId: string) =>
    atom((get) => {
        const filters = get(sidebarSessionFiltersAtomFamily(scopeId))
        return (
            Object.keys(DEFAULT_SIDEBAR_SESSION_FILTERS) as (keyof SidebarSessionFilters)[]
        ).some((key) => {
            const value = filters[key]
            // An array default is a fresh [] every read, so identity would report dirty forever.
            if (Array.isArray(value)) return value.length > 0
            return value !== DEFAULT_SIDEBAR_SESSION_FILTERS[key]
        })
    }),
)

export const sidebarSessionCollapsedGroupsAtomFamily = atomFamily((scopeId: string) =>
    atom(
        (get) => {
            const scope = storageScope(scopeId, get(projectIdAtom))
            return get(collapsedGroupsStorageAtom)[scope] ?? []
        },
        (get, set, groupKey: string) => {
            const scope = storageScope(scopeId, get(projectIdAtom))
            const storage = get(collapsedGroupsStorageAtom)
            const current = storage[scope] ?? []
            const next = current.includes(groupKey)
                ? current.filter((key) => key !== groupKey)
                : [...current, groupKey]
            set(collapsedGroupsStorageAtom, {...storage, [scope]: next})
        },
    ),
)
