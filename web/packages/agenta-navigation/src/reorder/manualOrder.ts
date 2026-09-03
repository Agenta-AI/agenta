import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomWithStorage, createJSONStorage} from "jotai/utils"
import {atomFamily} from "jotai-family"

import {mergeManualOrder, movedManualOrder} from "./applyOrder"

/**
 * The sidebar's hand-arranged order, per project.
 *
 * Local-only, same call as [pins] and [tabOrder]: the server could hold this, but reconciling one
 * user's arrangement across devices is the part worth designing rather than improvising. This
 * module is the port — nothing outside it knows where the order lives, so a server implementation
 * swaps in here without touching a caller.
 *
 * One record, several ZONES. Items reorder against the others in their zone and nowhere else, so
 * the zone is what makes a cross-heading drop impossible by construction.
 */
const STORAGE_KEY = "agenta:sidebar:manual-order"

/** Per zone. An unbounded list would grow with every session ever arranged. */
const ZONE_CAP = 200

/**
 * localStorage WITHOUT jotai's cross-tab `storage` subscription. An incoming write from another
 * browser tab would otherwise reshuffle the rail live, under the pointer.
 */
const railStorage = <T,>() => {
    const storage = createJSONStorage<T>(() => localStorage)
    delete storage.subscribe
    return storage
}

// getOnInit: without it the rail paints the default order and snaps to the saved one a frame
// later — a visible reshuffle on every load.
const orderByZoneAtom = atomWithStorage<Record<string, string[]>>(
    STORAGE_KEY,
    {},
    railStorage<Record<string, string[]>>(),
    {getOnInit: true},
)

/**
 * Project-scoped, NOT scope-scoped: the arrangement is the user's, not the rail's, so the desktop
 * rail, the collapsed rail and the mobile drawer read one list. Never persist an unscoped key —
 * the pre-`:v2` chat-slice keys survived a sign-out and were readable by whoever signed in next.
 */
const zoneKey = (projectId: string, zone: string) => `${projectId}:${zone}`

/** Agents, shared by the Agents group and the agent headings under Sessions. */
export const SIDEBAR_AGENT_ORDER_ZONE = "agents"
/** The status headings themselves. Their rows live in a `sessions:` zone each. */
export const SIDEBAR_STATUS_GROUP_ZONE = "session-groups:status"
/** One zone per heading — arranging one agent's sessions says nothing about another's. */
export const sidebarSessionZone = (groupKey: string) => `sessions:${groupKey}`

const zonesForProject = (all: Record<string, string[]>, projectId: string) =>
    Object.keys(all).filter((key) => key.startsWith(`${projectId}:`))

export const sidebarManualOrderAtomFamily = atomFamily((zone: string) =>
    atom<string[]>((get) => {
        const projectId = get(projectIdAtom)
        return projectId ? (get(orderByZoneAtom)[zoneKey(projectId, zone)] ?? []) : []
    }),
)

/**
 * Every zone at once, as a lookup.
 *
 * A reader that needs many zones (one per heading) takes ONE subscription this way; an
 * `atomFamily` read per group key inside a derived atom would mint an atom per heading and churn
 * on every regrouping.
 */
export const sidebarManualOrdersAtom = atom((get) => {
    const projectId = get(projectIdAtom)
    const all = projectId ? get(orderByZoneAtom) : {}
    return (zone: string): string[] =>
        projectId ? (all[zoneKey(projectId, zone)] ?? []) : ([] as string[])
})

/** Is anything in this project hand-arranged? Drives the filter menu's Reset. */
export const sidebarHasManualOrderAtom = atom((get) => {
    const projectId = get(projectIdAtom)
    if (!projectId) return false
    const all = get(orderByZoneAtom)
    return zonesForProject(all, projectId).some((key) => (all[key]?.length ?? 0) > 0)
})

export const setSidebarManualOrderAtom = atom(
    null,
    (get, set, {zone, ids}: {zone: string; ids: string[]}) => {
        const projectId = get(projectIdAtom)
        if (!projectId) return
        const all = get(orderByZoneAtom)
        const key = zoneKey(projectId, zone)
        const next = mergeManualOrder(all[key] ?? [], ids).slice(0, ZONE_CAP)
        set(orderByZoneAtom, {...all, [key]: next})
    },
)

/** Moves one id a slot within its zone — the keyboard and context-menu path. */
export const moveSidebarManualOrderAtom = atom(
    null,
    (
        get,
        set,
        {zone, ids, id, delta}: {zone: string; ids: string[]; id: string; delta: -1 | 1},
    ) => {
        const next = movedManualOrder(ids, id, delta)
        if (next) set(setSidebarManualOrderAtom, {zone, ids: next})
    },
)

/** Drops every arrangement in the current project — the filter menu's Reset. */
export const clearSidebarManualOrderAtom = atom(null, (get, set) => {
    const projectId = get(projectIdAtom)
    if (!projectId) return
    const all = get(orderByZoneAtom)
    const next = {...all}
    for (const key of zonesForProject(all, projectId)) delete next[key]
    set(orderByZoneAtom, next)
})

/**
 * Is a drag in flight? While true the rail holds its rendered children still, so a poll landing
 * mid-gesture cannot add, remove or reorder a row under the pointer and invalidate the drag
 * engine's cached rects. Not persisted.
 */
export const sidebarReorderActiveAtom = atom(false)
