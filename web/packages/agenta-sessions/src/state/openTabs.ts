import {useCallback, useEffect} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {atom, useAtomValue, useSetAtom} from "jotai"
import {atomWithStorage} from "jotai/utils"
import {atomFamily} from "jotai-family"

/**
 * WHICH sessions are open as tabs, per project + scope — an explicit, local, persisted set, the
 * same idea the desktop playground's `openIdsByAppAtom` carries.
 *
 * A surface that derives its tabs straight from the server list has no way to say "close this
 * tab": every session in scope is a chip, forever. The set is what makes closing sayable, and it
 * closes NOTHING on the server — a closed session stays in history and reopens on navigation.
 *
 * Reconciliation with the server list, stated once:
 * - Unseeded scope → every listed session renders, and that first list IS the seed. No user ever
 *   meets an empty rail.
 * - Listed but not in the set → hidden (it was closed). History and the sessions page still hold it.
 * - In the set but not listed → KEPT in the set, rendered only when the list carries it again. The
 *   list is a capped, origin-filtered window; falling out of it is not a close.
 * - The active session always renders and always joins the set, so navigating anywhere reopens a tab.
 */
const openIdsByScopeAtom = atomWithStorage<Record<string, string[]>>(
    "agenta:sessions:open-tabs",
    {},
)

/** Scope key: one agent's tabs open and close independently of another's. */
const storageKey = (projectId: string, scope: string) => `${projectId}:${scope}`

/** The scope a rail keys its tabs by. Membership and hand-arranged order must agree on it. */
export const sessionTabScope = (agentId?: string | null): string => agentId ?? "__project__"

/** Ceiling on one scope's persisted set, so ids of long-deleted sessions cannot grow without end. */
export const MAX_OPEN_SESSION_TABS = 50

/** A scope's open ids, or null when nothing has seeded it yet. */
export const openSessionTabsAtomFamily = atomFamily((scope: string) =>
    atom<string[] | null>((get) => {
        const projectId = get(projectIdAtom)
        return projectId ? (get(openIdsByScopeAtom)[storageKey(projectId, scope)] ?? null) : null
    }),
)

/** Adopt the first list a rail shows as this scope's open set. Never overwrites a seeded scope. */
export const seedSessionTabsAtom = atom(
    null,
    (get, set, {scope, ids}: {scope: string; ids: readonly string[]}) => {
        const projectId = get(projectIdAtom)
        if (!projectId || ids.length === 0) return
        const all = get(openIdsByScopeAtom)
        const key = storageKey(projectId, scope)
        if (all[key]) return
        set(openIdsByScopeAtom, {...all, [key]: ids.slice(-MAX_OPEN_SESSION_TABS)})
    },
)

/** Open a tab — a created session, or one navigated to from history. */
export const openSessionTabAtom = atom(
    null,
    (get, set, {scope, id}: {scope: string; id: string}) => {
        const projectId = get(projectIdAtom)
        if (!projectId || !id) return
        const all = get(openIdsByScopeAtom)
        const key = storageKey(projectId, scope)
        const current = all[key]
        if (!current || current.includes(id)) return
        set(openIdsByScopeAtom, {...all, [key]: [...current, id].slice(-MAX_OPEN_SESSION_TABS)})
    },
)

/** Close tabs. Local only: the sessions themselves are untouched. */
export const closeSessionTabsAtom = atom(
    null,
    (get, set, {scope, ids}: {scope: string; ids: readonly string[]}) => {
        const projectId = get(projectIdAtom)
        if (!projectId) return
        const all = get(openIdsByScopeAtom)
        const key = storageKey(projectId, scope)
        const current = all[key]
        if (!current) return
        const next = closedSessionTabs(current, ids)
        if (!next) return
        set(openIdsByScopeAtom, {...all, [key]: next})
    },
)

/** Tabs the rail renders: rows the set holds, plus the active one. Unseeded renders everything. */
export const openSessionTabRows = <T extends {id: string}>(
    rows: readonly T[],
    open: readonly string[] | null,
    activeId: string,
): T[] => {
    if (!open) return [...rows]
    const openSet = new Set(open)
    return rows.filter((row) => openSet.has(row.id) || row.id === activeId)
}

/** The set after closing `ids`, or null when the close would change nothing. */
export const closedSessionTabs = (
    open: readonly string[],
    ids: readonly string[],
): string[] | null => {
    const closing = new Set(ids)
    if (closing.size === 0) return null
    const next = open.filter((id) => !closing.has(id))
    return next.length === open.length ? null : next
}

/**
 * The tab that takes over when the active one closes: the first survivor at or after its slot,
 * else the closest one before it, else nothing. The desktop's rule, on the RENDERED order.
 */
export const nearestSurvivingTab = (
    ordered: readonly string[],
    closing: ReadonlySet<string>,
    activeId: string,
): string => {
    const index = ordered.indexOf(activeId)
    if (index === -1) return ""
    const after = ordered.slice(index).find((id) => !closing.has(id))
    if (after) return after
    return [...ordered.slice(0, index)].reverse().find((id) => !closing.has(id)) ?? ""
}

export interface SessionTabCloseTargets {
    /** Every other tab, pinned ones excluded — Chrome's "close others". */
    others: string[]
    /** Everything after this tab, pinned ones excluded. */
    toRight: string[]
    /** Closing the last tab would leave the surface with nothing to show. */
    closable: boolean
}

/**
 * Chrome's bulk-close targets for the tab at `id`, over the RENDERED order.
 *
 * Pinned tabs survive both bulk closes, as they do in a browser — and since pins lead the strip
 * they are never "to the right" of anything anyway.
 */
export const sessionTabCloseTargets = (
    tabs: readonly {id: string; pinned: boolean}[],
    id: string,
): SessionTabCloseTargets => {
    const index = tabs.findIndex((tab) => tab.id === id)
    const unpinned = (list: readonly {id: string; pinned: boolean}[]) =>
        list.filter((tab) => !tab.pinned).map((tab) => tab.id)
    return {
        others: unpinned(tabs.filter((tab) => tab.id !== id)),
        toRight: index === -1 ? [] : unpinned(tabs.slice(index + 1)),
        closable: tabs.length > 1,
    }
}

/** What a rail is rendering right now, in rendered order — so a keyboard surface outside the rail
 * can address "the Nth tab" without re-deriving the list. */
export const renderedSessionTabsAtomFamily = atomFamily((scope: string) => atom<string[]>([]))

export const setRenderedSessionTabsAtom = atom(
    null,
    (get, set, {scope, ids}: {scope: string; ids: string[]}) => {
        const current = get(renderedSessionTabsAtomFamily(scope))
        if (current.length === ids.length && current.every((id, index) => id === ids[index])) return
        set(renderedSessionTabsAtomFamily(scope), ids)
    },
)

/**
 * A scope's open set, seeded from the first list the caller observes and joined by the active
 * session. Returns null only while nothing has been listed yet.
 */
export const useOpenSessionTabs = (
    scope: string,
    listedIds: readonly string[],
    activeId: string,
): string[] | null => {
    const open = useAtomValue(openSessionTabsAtomFamily(scope))
    const seed = useSetAtom(seedSessionTabsAtom)
    const openTab = useSetAtom(openSessionTabAtom)
    useEffect(() => {
        if (open === null) seed({scope, ids: listedIds})
        else if (activeId && !open.includes(activeId)) openTab({scope, id: activeId})
    }, [open, listedIds, activeId, scope, seed, openTab])
    return open
}

/** Publishes the rendered order for `renderedSessionTabsAtomFamily`. */
export const usePublishRenderedSessionTabs = (scope: string, ids: string[]) => {
    const publish = useSetAtom(setRenderedSessionTabsAtom)
    useEffect(() => {
        publish({scope, ids})
    }, [publish, scope, ids])
}

/** Close tabs in one scope. */
export const useCloseSessionTabs = (scope: string) => {
    const close = useSetAtom(closeSessionTabsAtom)
    return useCallback((ids: readonly string[]) => close({scope, ids}), [close, scope])
}
