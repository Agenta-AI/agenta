import {
    autoscrollSpeed,
    insertionIndex,
    insertionOffset,
    moveSidebarManualOrderAtom,
    reorderedIds,
    setSidebarManualOrderAtom,
    sidebarReorderActiveAtom,
    type DragSlot,
    type SidebarDragItem,
} from "@agenta/navigation"
import {getDefaultStore} from "jotai"

import {createOverlay, type ReorderOverlay} from "./overlay"

/**
 * The sidebar's drag engine.
 *
 * Loaded lazily on the first press that lands on a draggable row — `NavMenu` is a static import on
 * every page, and most sessions never drag. Everything here runs OUTSIDE React: the rail does not
 * re-render at dragstart or dragend, only when the drop writes the order atom.
 *
 * Nothing in the list moves during a drag, so the peers' rects are measured once and reused. Only
 * two things move per frame: a transformed chip and a repositioned line.
 */

const DRAG_THRESHOLD_PX = 5
const TOUCH_LONG_PRESS_MS = 350
const TOUCH_CANCEL_PX = 8
/** A press on a row's own control is that control's, not a drag. */
const CONTROL_SELECTOR = "input, textarea, button, [contenteditable='true'], [role='menuitem']"

const SELECTED = "[data-drag-zone]"

interface DragState {
    pointerId: number
    item: SidebarDragItem
    scroller: HTMLElement
    scrollerRect: DOMRect
    slots: DragSlot[]
    ids: string[]
    from: number
    /** The source row, plus a heading's rows — faded in place, never removed. */
    ghosts: HTMLElement[]
    pointerX: number
    pointerY: number
    index: number
    frame: number | null
    overlay: ReorderOverlay
}

const store = getDefaultStore()

const readItem = (el: HTMLElement): SidebarDragItem | null => {
    const {dragZone, dragId, dragKind} = el.dataset
    if (!dragZone || !dragId || (dragKind !== "row" && dragKind !== "group")) return null
    return {zone: dragZone, id: dragId, kind: dragKind}
}

/** The scroll box this row lives in: its own group's, else the rail's, else the menu. */
const nearestScroller = (el: HTMLElement, root: HTMLElement): HTMLElement => {
    const owned = el.closest<HTMLElement>("[data-nav-scroll]")
    if (owned) return owned
    let node: HTMLElement | null = el.parentElement
    while (node && node !== document.body) {
        const overflow = getComputedStyle(node).overflowY
        if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight)
            return node
        node = node.parentElement
    }
    return root
}

/** A heading carries every row under it, up to the next heading. Derived from the DOM, not the
 * flat config array, so `groupedChildren` keeps its shape. */
const ghostsFor = (el: HTMLElement, item: SidebarDragItem): HTMLElement[] => {
    if (item.kind === "row") return [el]
    const block = [el]
    let node = el.nextElementSibling as HTMLElement | null
    while (node) {
        if (node.dataset.dragKind === "group") break
        block.push(node)
        node = node.nextElementSibling as HTMLElement | null
    }
    return block
}

const measure = (peers: HTMLElement[], scroller: HTMLElement, rect: DOMRect): DragSlot[] =>
    peers.map((peer) => {
        const peerRect = peer.getBoundingClientRect()
        const top = peerRect.top - rect.top + scroller.scrollTop
        const bottom = top + peerRect.height
        return {id: peer.dataset.dragId ?? "", top, mid: (top + bottom) / 2, bottom}
    })

let active: DragState | null = null
/** Set for one tick after a drop, so the click the pointerup raises never navigates. */
let suppressClick = false

/** Where the row would land right now. Cheap and side-effect free, so the drop can call it too. */
const resolveIndex = (state: DragState) => {
    const contentY = state.pointerY - state.scrollerRect.top + state.scroller.scrollTop
    state.index = insertionIndex(state.slots, contentY)
}

const paint = () => {
    if (!active) return
    active.frame = null
    const {scroller, scrollerRect, slots, overlay} = active

    const speed = autoscrollSpeed(active.pointerY, scrollerRect.top, scrollerRect.bottom)
    if (speed) scroller.scrollTop += speed

    resolveIndex(active)
    const lineY = insertionOffset(slots, active.index) - scroller.scrollTop + scrollerRect.top
    overlay.moveLine(
        scrollerRect.left,
        Math.min(Math.max(lineY, scrollerRect.top), scrollerRect.bottom),
        scrollerRect.width,
    )
    overlay.moveChip(active.pointerX, active.pointerY)

    // Keep scrolling while the pointer is parked in an edge band.
    if (speed) schedule()
}

const schedule = () => {
    if (!active || active.frame !== null) return
    active.frame = requestAnimationFrame(paint)
}

const endDrag = (commit: boolean) => {
    if (!active) return
    const state = active
    active = null
    if (state.frame !== null) cancelAnimationFrame(state.frame)
    state.overlay.destroy()
    for (const ghost of state.ghosts) delete ghost.dataset.dragGhost
    state.scroller.style.removeProperty("touch-action")
    document.body.style.removeProperty("cursor")
    document.removeEventListener("pointermove", onPointerMove)
    document.removeEventListener("pointerup", onPointerUp)
    document.removeEventListener("pointercancel", onCancel)
    document.removeEventListener("dragstart", onNativeDragStart, true)
    store.set(sidebarReorderActiveAtom, false)

    if (!commit) return
    // Resolved HERE, not left to the last frame: a drag released before any frame ran (a fast
    // flick, a throttled tab) would otherwise commit the index it started with and drop nothing.
    resolveIndex(state)
    const next = reorderedIds(state.ids, state.from, state.index)
    if (next.every((id, index) => id === state.ids[index])) return
    suppressClick = true
    store.set(setSidebarManualOrderAtom, {zone: state.item.zone, ids: next})
}

const onPointerMove = (event: PointerEvent) => {
    if (!active || event.pointerId !== active.pointerId) return
    event.preventDefault()
    active.pointerX = event.clientX
    active.pointerY = event.clientY
    schedule()
}

const onPointerUp = (event: PointerEvent) => {
    if (!active || event.pointerId !== active.pointerId) return
    endDrag(true)
}

const onCancel = () => endDrag(false)

/** Rows are anchors, and browsers drag those natively — without this the link ghost rides along. */
const onNativeDragStart = (event: Event) => event.preventDefault()

const startDrag = (
    el: HTMLElement,
    item: SidebarDragItem,
    root: HTMLElement,
    event: PointerEvent,
): boolean => {
    const scroller = nearestScroller(el, root)
    const peers = Array.from(
        scroller.querySelectorAll<HTMLElement>(
            `[data-drag-zone="${CSS.escape(item.zone)}"][data-drag-kind="${item.kind}"]`,
        ),
    )
    if (peers.length < 2) return false
    const ids = peers.map((peer) => peer.dataset.dragId ?? "")
    const from = ids.indexOf(item.id)
    if (from < 0) return false

    const scrollerRect = scroller.getBoundingClientRect()
    const ghosts = ghostsFor(el, item)
    for (const ghost of ghosts) ghost.dataset.dragGhost = "true"
    scroller.style.touchAction = "none"
    document.body.style.cursor = "grabbing"

    active = {
        pointerId: event.pointerId,
        item,
        scroller,
        scrollerRect,
        slots: measure(peers, scroller, scrollerRect),
        ids,
        from,
        ghosts,
        pointerX: event.clientX,
        pointerY: event.clientY,
        index: from,
        frame: null,
        overlay: createOverlay(el.textContent?.trim() ?? ""),
    }
    store.set(sidebarReorderActiveAtom, true)
    document.addEventListener("pointermove", onPointerMove, {passive: false})
    document.addEventListener("pointerup", onPointerUp)
    document.addEventListener("pointercancel", onCancel)
    document.addEventListener("dragstart", onNativeDragStart, true)
    schedule()
    return true
}

/**
 * Arms one delegated listener on the menu root. Returns the teardown.
 *
 * Delegation, not per-row handlers: the rail re-renders on every poll, and a handler per row would
 * mint a closure per row each time.
 */
export const attachReorder = (root: HTMLElement): (() => void) => {
    let pending: {
        el: HTMLElement
        item: SidebarDragItem
        x: number
        y: number
        pointerId: number
        touch: boolean
    } | null = null
    let longPress: ReturnType<typeof setTimeout> | null = null

    const clearPending = () => {
        if (longPress) clearTimeout(longPress)
        longPress = null
        pending = null
    }

    const onDown = (event: PointerEvent) => {
        if (active || event.button !== 0) return
        const target = event.target as HTMLElement | null
        if (!target || target.closest(CONTROL_SELECTOR)) return
        const el = target.closest<HTMLElement>(SELECTED)
        if (!el || !root.contains(el)) return
        const item = readItem(el)
        if (!item) return

        const touch = event.pointerType === "touch"
        pending = {el, item, x: event.clientX, y: event.clientY, pointerId: event.pointerId, touch}
        if (!touch) return
        longPress = setTimeout(() => {
            if (pending && startDrag(pending.el, pending.item, root, event)) clearPending()
        }, TOUCH_LONG_PRESS_MS)
    }

    const onMove = (event: PointerEvent) => {
        if (!pending || event.pointerId !== pending.pointerId) return
        const moved = Math.hypot(event.clientX - pending.x, event.clientY - pending.y)
        if (pending.touch) {
            // A swipe is a scroll, not a drag: let the group scroll and drop the press.
            if (moved > TOUCH_CANCEL_PX) clearPending()
            return
        }
        if (moved < DRAG_THRESHOLD_PX) return
        const {el, item} = pending
        clearPending()
        startDrag(el, item, root, event)
    }

    // Capture: the drop's click must die before the row's anchor or its menu sees it.
    const onClick = (event: MouseEvent) => {
        if (!suppressClick) return
        suppressClick = false
        event.preventDefault()
        event.stopPropagation()
    }

    root.addEventListener("pointerdown", onDown)
    document.addEventListener("pointermove", onMove)
    document.addEventListener("pointerup", clearPending)
    document.addEventListener("pointercancel", clearPending)
    document.addEventListener("click", onClick, true)

    return () => {
        clearPending()
        endDrag(false)
        root.removeEventListener("pointerdown", onDown)
        document.removeEventListener("pointermove", onMove)
        document.removeEventListener("pointerup", clearPending)
        document.removeEventListener("pointercancel", clearPending)
        document.removeEventListener("click", onClick, true)
    }
}

/** The keyboard path: moves the focused row a slot without a pointer. */
export const moveByKeyboard = (el: HTMLElement, delta: -1 | 1): string | null => {
    const item = readItem(el)
    if (!item) return null
    const scroller = el.closest<HTMLElement>("[data-nav-scroll]") ?? document.body
    const peers = Array.from(
        scroller.querySelectorAll<HTMLElement>(
            `[data-drag-zone="${CSS.escape(item.zone)}"][data-drag-kind="${item.kind}"]`,
        ),
    )
    const ids = peers.map((peer) => peer.dataset.dragId ?? "")
    const at = ids.indexOf(item.id)
    if (at < 0 || at + delta < 0 || at + delta >= ids.length) return null
    store.set(moveSidebarManualOrderAtom, {zone: item.zone, ids, id: item.id, delta})
    return `${el.textContent?.trim() ?? "Item"} moved to position ${at + delta + 1} of ${ids.length}`
}
