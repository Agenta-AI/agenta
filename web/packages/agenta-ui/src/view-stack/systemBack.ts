import {useEffect, useId, useRef} from "react"

/**
 * The browser and system back on a phone. While any level is open (a full screen panel, a
 * section screen, a view), the page has one extra history entry on the same URL: the barrier.
 * A back onto the page under it is undone at once (the barrier comes back), and the top level
 * runs its own back, which may ask first. When the last level closes, the barrier goes with one
 * `history.back()`. So a back closes one level, a second back while the first one asks does
 * nothing, and the router never sees these moves.
 *
 * The barrier copies the page's history state, so the Next router still knows the URL if the
 * person comes back to an old barrier after a navigation; a stamp marks it so the module can
 * step over it. The module takes the pop in the capture phase and stops it, so the router does
 * not run a route change for it.
 */

/**
 * Which level a back closes first: a view, then the section screen it opened from, then the
 * panel around them. Among equals, the level that opened last.
 */
export type SystemBackRank = "panel" | "section" | "view"

interface Owner {
    rank: SystemBackRank
    /** Closes the level as its back arrow does; it may ask first. Waited for, result unused. */
    onBack: () => unknown
    levels: () => number
    openedAt: number
}

interface Stamp {
    key?: unknown
    agSystemBackRun?: string
}

const RANK: Record<SystemBackRank, number> = {panel: 0, section: 1, view: 2}
const owners = new Map<string, Owner>()
/** The open barrier: the page it was pushed on (the router's history key) and its stamp. */
let barrier: {page: unknown; run: string} | null = null
/** Pops this module caused itself (the barrier leaving), which it must let pass. */
let ownPops = 0
/** A level's back is running (its question may be open): further backs are only undone. */
let pending = false
let opened = 0
let scheduled = false
let installed = false
// Not crypto.randomUUID: it is missing on a plain-HTTP origin.
const LOAD = Math.random().toString(36).slice(2)
let runs = 0

const pageOf = (state: unknown) => (state as Stamp | null)?.key ?? null

const pushBarrier = (run: string) =>
    window.history.pushState({...window.history.state, agSystemBackRun: run}, "")

const anyOpen = () => [...owners.values()].some((owner) => owner.levels() > 0)

/** Match the barrier to the open levels, once per task (a panel and its view close together). */
const apply = () => {
    scheduled = false
    const open = anyOpen()
    if (open && !barrier) {
        barrier = {page: pageOf(window.history.state), run: `${LOAD}:${++runs}`}
        pushBarrier(barrier.run)
    } else if (!open && barrier) {
        // A barrier of a page the person navigated away from stays: going back over it would
        // undo the navigation.
        const onPage = barrier.page === pageOf(window.history.state)
        barrier = null
        if (onPage) {
            ownPops += 1
            window.history.back()
        }
    }
}

const update = () => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(apply)
}

const topOwner = () => {
    let top: Owner | null = null
    for (const owner of owners.values()) {
        if (owner.levels() === 0) continue
        if (
            !top ||
            RANK[owner.rank] > RANK[top.rank] ||
            (owner.rank === top.rank && owner.openedAt > top.openedAt)
        )
            top = owner
    }
    return top
}

const onPopState = (event: PopStateEvent) => {
    if (ownPops > 0) {
        ownPops -= 1
        event.stopImmediatePropagation()
        return
    }
    const stamp = (event.state as Stamp | null)?.agSystemBackRun
    if (!barrier) {
        // The barrier of levels that closed (an old page, a closed panel) shows nothing of its
        // own. Step over it: a back reaches the page under it in one press, and a forward
        // returns to where it came from.
        if (stamp) {
            event.stopImmediatePropagation()
            window.history.back()
        }
        return
    }
    // Still on the barrier (a forward cannot pass it): nothing to do.
    if (stamp === barrier.run) {
        event.stopImmediatePropagation()
        return
    }
    // A jump to another page's entry (the history menu): the router takes it.
    if (pageOf(event.state) !== barrier.page) {
        barrier = null
        return
    }
    // A back onto the page under the levels: undo it, then close the top level its own way.
    event.stopImmediatePropagation()
    pushBarrier(barrier.run)
    if (pending) return
    const owner = topOwner()
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
 * Call after a navigation to a new page (not a shallow change): the barrier belongs to the old
 * page, so open levels get a new one on the new page. Only a level that stays open across a
 * navigation needs it (the agent panel, which stays open when the session changes); a level
 * that unmounts leaves the old page's barrier where it is by itself.
 */
export const restartSystemBack = () => {
    barrier = null
    update()
}

/**
 * Give `levels` open levels to the browser back. Pass 0 on a desktop. `onBack` closes the top
 * level the way its back arrow does; when it asks and the person stays, `levels` does not drop.
 */
export const useSystemBack = (levels: number, rank: SystemBackRank, onBack: () => unknown) => {
    const id = useId()
    const onBackRef = useRef(onBack)
    onBackRef.current = onBack
    const levelsRef = useRef(levels)
    levelsRef.current = levels
    const previousRef = useRef(0)

    useEffect(() => {
        install()
        owners.set(id, {
            rank,
            onBack: () => onBackRef.current(),
            levels: () => levelsRef.current,
            openedAt: 0,
        })
        return () => {
            owners.delete(id)
            update()
        }
    }, [id, rank])

    useEffect(() => {
        const owner = owners.get(id)
        if (owner && levels > previousRef.current) owner.openedAt = ++opened
        previousRef.current = levels
        update()
    }, [id, levels])
}

/** For tests: forget the barrier and every owner. */
export const resetSystemBackForTests = () => {
    barrier = null
    ownPops = 0
    pending = false
    scheduled = false
    owners.clear()
}
