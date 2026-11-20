import {useEffect, useId, useRef} from "react"

/**
 * The browser and system back on a phone. Each open level (a full screen panel, a section
 * screen, a view) holds one history entry on the same URL. A back is undone at once (the entry
 * is pushed again), then the top level runs its own back, which may ask first. When the level
 * closes, it gives its entry back with `history.go`, as when the app closes it (back arrow,
 * Cancel, Save). So the history always matches the open levels, and a second back while the
 * first one asks does nothing.
 *
 * The entries copy the page's history state, so the Next router still knows the URL when the
 * person comes back to an old one after a navigation. While a level is open this module takes
 * the pop in the capture phase and stops it, so the router does not run a route change for it.
 */

/**
 * Which level a back closes first when several hold entries: a view, then the section screen it
 * opened from, then the panel around them. React runs a child's effects before its parent's, so
 * the push order alone cannot say it.
 */
export type SystemBackRank = "panel" | "section" | "view"

interface Level {
    rank: SystemBackRank
    /** Resolves false when the person stays (kept editing, a save failed). */
    onBack: () => Promise<boolean> | boolean
    levels: () => number
}

interface Entry {
    owner: string
    /** The page the entry belongs to: the Next history key, which a navigation changes. */
    page: unknown
}

const RANK: Record<SystemBackRank, number> = {panel: 0, section: 1, view: 2}
const owners = new Map<string, Level>()
let entries: Entry[] = []
/** Pops this module caused itself (app closes), which it must let pass. */
let ownPops = 0
let toRemove = 0
/** A level's back is running (its question may be open): further backs are only undone. */
let pending = false
/**
 * The run of open levels the entries belong to, from the first open level to the last close.
 * An entry of an earlier run (an old page, a closed panel) carries another run, so its position
 * is not read as one of these levels.
 */
const LOAD = Math.random().toString(36).slice(2)
let runs = 0
let run = ""
let installed = false

const currentPage = () => (window.history.state as {key?: unknown} | null)?.key ?? null
const countOf = (id: string) => entries.filter((entry) => entry.owner === id).length

interface Stamp {
    agSystemBack?: number
    agSystemBackRun?: string
}

/** The position in this run: 0 under the levels (any entry of another run), n on the n-th level. */
const positionOf = (state: unknown) => {
    const stamp = state as Stamp | null
    return stamp?.agSystemBackRun === run ? (stamp.agSystemBack ?? 0) : 0
}

const pushState = (position: number) =>
    window.history.pushState(
        {...window.history.state, agSystemBack: position, agSystemBackRun: run},
        "",
    )

const pushEntry = (id: string) => {
    if (entries.length === 0) run = `${LOAD}:${++runs}`
    entries.push({owner: id, page: currentPage()})
    pushState(entries.length)
}

const flush = () => {
    if (toRemove === 0) return
    const n = toRemove
    toRemove = 0
    ownPops += 1
    window.history.go(-n)
}

const removeEntries = (id: string, n: number) => {
    const page = currentPage()
    for (let i = 0; i < n; i++) {
        let index = -1
        for (let j = entries.length - 1; j >= 0; j--) {
            if (entries[j].owner === id) {
                index = j
                break
            }
        }
        if (index < 0) break
        const [entry] = entries.splice(index, 1)
        // An entry of a page the person navigated away from stays in the history as it is:
        // going back over it would undo the navigation.
        if (entry.page === page) toRemove += 1
    }
    // One traversal for every level that closed in this task (a panel and its view together).
    queueMicrotask(flush)
}

const sync = (id: string) => {
    const owner = owners.get(id)
    if (!owner) return
    const want = owner.levels()
    const have = countOf(id)
    for (let i = have; i < want; i++) pushEntry(id)
    if (want < have) removeEntries(id, have - want)
}

const onPopState = (event: PopStateEvent) => {
    if (ownPops > 0) {
        ownPops -= 1
        event.stopImmediatePropagation()
        return
    }
    if (entries.length === 0) return
    // This move is a level's: the router must not treat it as a route change.
    event.stopImmediatePropagation()
    const position = positionOf(event.state)
    if (position >= entries.length) {
        // Forward onto an entry of a level that closed: go back to where the levels are.
        if (position > entries.length) {
            ownPops += 1
            window.history.go(entries.length - position)
        }
        return
    }
    // Undo the back at once; the level gives its entry back only when it really closes.
    for (let p = position + 1; p <= entries.length; p++) pushState(p)
    if (pending) return
    const rankAt = (i: number) => RANK[owners.get(entries[i].owner)?.rank ?? "panel"]
    // The highest rank wins; among equals, the latest entry.
    let index = entries.length - 1
    for (let i = entries.length - 2; i >= 0; i--) if (rankAt(i) > rankAt(index)) index = i
    const owner = owners.get(entries[index].owner)
    if (!owner) return
    pending = true
    void Promise.resolve(owner.onBack()).finally(() => {
        pending = false
    })
}

const install = () => {
    if (installed) return
    installed = true
    // Capture: at the window it runs before the router's own listener, which it can then stop.
    window.addEventListener("popstate", onPopState, {capture: true})
}

/**
 * Call after a navigation to a new page (not a shallow change): the open levels' entries belong
 * to the old page, so each open level gets a new entry on the new page. Only a level that stays
 * open across a navigation needs it (the agent panel, which stays open when the session changes);
 * a level that unmounts drops its old-page entries by itself.
 */
export const restartSystemBack = () => {
    entries = []
    toRemove = 0
    for (const id of owners.keys()) sync(id)
}

/**
 * Give `levels` open levels to the browser back. Pass 0 on a desktop. `onBack` closes the top
 * level the way its back arrow does and resolves false when the person stays.
 */
export const useSystemBack = (
    levels: number,
    rank: SystemBackRank,
    onBack: () => Promise<boolean> | boolean,
) => {
    const id = useId()
    const onBackRef = useRef(onBack)
    onBackRef.current = onBack
    const levelsRef = useRef(levels)
    levelsRef.current = levels

    useEffect(() => {
        install()
        owners.set(id, {rank, onBack: () => onBackRef.current(), levels: () => levelsRef.current})
        return () => {
            owners.delete(id)
            removeEntries(id, countOf(id))
        }
    }, [id, rank])

    useEffect(() => {
        sync(id)
    }, [id, levels])
}

/** For tests: forget every entry and owner. */
export const resetSystemBackForTests = () => {
    entries = []
    ownPops = 0
    toRemove = 0
    pending = false
    owners.clear()
}
