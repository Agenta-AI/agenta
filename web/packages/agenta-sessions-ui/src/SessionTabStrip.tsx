/**
 * THE session tab strip — the 48px bar a row of `SessionTab` chips lives in. Extracted from the
 * desktop playground's `SessionTagBar` (which now renders this), so the scroller behaviour that is
 * genuinely fiddly exists once: vertical wheel mapped to horizontal scroll (React registers
 * `onWheel` passive, so it has to be a native non-passive listener), and the per-side edge fade
 * that only appears on an edge the content is actually scrolled past.
 *
 * The chips are children, NOT a data prop: the two surfaces disagree about what a session is (the
 * desktop's local tab set vs a backend-listed session), and only the strip is the same. Chips stay
 * DIRECT children of the scroller — the desktop's enter-animation reads `chip.parentElement` as the
 * visible strip box.
 *
 * The bar's height and bottom border align its edge with the config panel's header beside it.
 */
import {useCallback, useEffect, useRef, useState, type ReactNode} from "react"

import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {PlusIcon} from "@phosphor-icons/react"
import clsx from "clsx"
import {Reorder} from "motion/react"

/** Left/right edge fade so tabs dissolve into the strip edges instead of a hard cut when they
 * overflow. Applied per-side ONLY where content is actually clipped (scrolled past) — a strip
 * that fits (e.g. a single tab) gets no fade, so its lone item isn't dimmed at the edges. The
 * lengths are the Home agents list's (26px in, 34px out), so the two scrollers read the same. */
export const EDGE_FADE_START_PX = 26
export const EDGE_FADE_END_PX = 34
const fadeMask = (left: boolean, right: boolean): string => {
    const start = left ? `transparent 0, #000 ${EDGE_FADE_START_PX}px` : "#000 0"
    const end = right ? `#000 calc(100% - ${EDGE_FADE_END_PX}px), transparent 100%` : "#000 100%"
    return `linear-gradient(to right, ${start}, ${end})`
}

/** Footprint of the inline New session (+): the 28px button; the last chip's own margin is the gap. */
const INLINE_ADD_PX = 28

/**
 * The scroller's content width from LAYOUT geometry: the chips, plus the inline (+) while it is
 * one of them. Never `scrollWidth`, for two reasons. The scroller is `flex-1`, so a strip with room
 * to spare reports `scrollWidth === clientWidth`, exactly like one filled to the millimetre. And
 * the chips are motion layout items: while one of their layout animations is in flight (the
 * strip resized, a chip came or went) they sit on a translate that `scrollWidth` counts as
 * overflow and offsets do not.
 */
const chipsWidth = (el: HTMLElement): number => {
    const first = el.firstElementChild as HTMLElement | null
    const last = el.lastElementChild as HTMLElement | null
    if (!first || !last) return 0
    const trailing = parseFloat(getComputedStyle(last).marginRight) || 0
    return last.offsetLeft + last.offsetWidth + trailing - first.offsetLeft
}

/**
 * The width the host lets the strip grow to: the first `max-width` above it. Read from CSS, not by
 * widening the scroller, which would clamp its scroll to 0.
 */
const hostRoom = (el: HTMLElement): number => {
    for (let node = el.parentElement; node; node = node.parentElement) {
        const max = parseFloat(getComputedStyle(node).maxWidth)
        if (Number.isFinite(max)) return max
    }
    return Number.POSITIVE_INFINITY
}

/** How long a scroll must rest before it counts as stopped. */
const SNAP_IDLE_MS = 140

/**
 * Where the scroller should rest: the tab start closest to `scrollLeft`, `inset` in from the left
 * edge. Null at either end of the strip, where there is nothing to settle. Sticky children (the
 * edge covers, a docked tab) sit where they are pinned, not where they flow, so they are skipped.
 */
const snapTarget = (el: HTMLElement, inset: number): number | null => {
    const max = el.scrollWidth - el.clientWidth
    if (el.scrollLeft <= 1 || el.scrollLeft >= max - 1) return null
    const origin = el.getBoundingClientRect().left
    let target: number | null = null
    for (const child of Array.from(el.children) as HTMLElement[]) {
        if (getComputedStyle(child).position === "sticky") continue
        const at = el.scrollLeft + child.getBoundingClientRect().left - origin - inset
        const stop = Math.max(0, Math.min(max, at))
        if (target === null || Math.abs(stop - el.scrollLeft) < Math.abs(target - el.scrollLeft)) {
            target = stop
        }
    }
    return target
}

export interface SessionTabStripProps {
    /** The chips — `SessionTab`s, each in its own `shrink-0` wrapper. */
    children?: ReactNode
    /**
     * Show the scrolling chips at all. Off where another control owns switching (the desktop's
     * full-screen mode hands it to the vertical session rail) — the bar then keeps only `extra`.
     */
    showTabs?: boolean
    /** New session. Omit where the surface has nothing to start one with. */
    onAdd?: () => void
    addDisabled?: boolean
    /** Overrides the New session tooltip (e.g. why it is disabled). */
    addTooltip?: React.ReactNode
    /** Right-aligned extras, pinned outside the scroller (the desktop's history menu). */
    extra?: ReactNode
    /** Leading extra, pinned before the scroller — the desktop's config-panel reveal control,
     * rendered at the spot the config panel disappeared from. */
    leadingExtra?: ReactNode
    /**
     * Changes when the tab SET changes. A ResizeObserver watches the strip's own box, not its
     * content, so adding or removing a chip needs this to re-measure the fade.
     */
    remeasureKey?: unknown
    /**
     * Drag-to-reorder. `ids` must be the chips' order as rendered, and each child must be a
     * `SessionTabDragItem` with a matching id. Omit for a fixed strip.
     */
    reorder?: {ids: string[]; onReorder: (ids: string[]) => void}
    /** Only the chips and extras, for a host bar that already draws the height and hairline. */
    bare?: boolean
    /** Settle on the nearest chip when a scroll stops, so none rests cut off at the start. */
    snap?: boolean
    /**
     * Bare only: show this many whole tabs. The strip takes their width (short names make it
     * narrow, long ones wide; the host caps it), keeps the open tab among them, and settles a
     * scroll by hand on the nearest window once it rests.
     */
    fitTabs?: number
    className?: string
}

/** The hairline the tab chips are "separated by" — see SessionTab's own note. Drawn in the gap
 *  left of a tab, so it never touches the chip's own fill. The gap is 9px and the line sits 5px
 *  in from this tab's edge, which clears 4px on each side of it. `colorBorder`, not the
 *  secondary step: on the canvas the lighter hairline all but vanished. */
export const TAB_DIVIDER =
    "relative before:absolute before:-left-[5px] before:top-1/2 before:h-4 before:w-px before:-translate-y-1/2 before:bg-colorBorder before:content-['']"

const SCROLLER_CLASS =
    "flex min-w-0 flex-1 items-center overflow-x-auto overscroll-x-contain motion-safe:scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"

/**
 * The bare strip's room at each end: the open tab's flared corners need it, and a docked tab sits
 * this far in. Cut-off tabs are never left at rest (the strip snaps), so the bare strip has no
 * edge fade: a fade would also dim the open tab while it is docked at that edge.
 */
export const BARE_INSET_PX = 12
const BARE_SCROLLER_CLASS =
    "flex h-full min-w-0 max-w-full flex-1 items-end overflow-x-auto overscroll-x-contain px-3 [justify-content:safe_center] motion-safe:scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
/** Covers the scroller's padding at each end, so tabs scrolling past never show in the gap beside
 * a docked tab. Under the open tab (z-3), over the rest. Sticky offsets count from the content
 * box, so -12px puts each cover on the padding. */
const CURTAIN = "sticky z-[2] w-3 shrink-0 self-stretch bg-[var(--ag-surface-tab-bar)]"

export const SessionTabStrip = ({
    children,
    showTabs = true,
    onAdd,
    addDisabled = false,
    addTooltip,
    extra,
    leadingExtra,
    remeasureKey,
    reorder,
    bare = false,
    snap = false,
    fitTabs,
    className,
}: SessionTabStripProps) => {
    // Edge fade is applied per side only where the strip is actually scrolled past its content, so
    // a strip that fits (single tab, no scroll) shows no fade on either edge.
    const [fade, setFade] = useState({left: false, right: false})
    // New session (+) sits inline after the last tab while they fit, pinned once they overflow.
    // Starts inline so the common case never flashes it across the bar (first measure is pre-paint).
    const [pinAdd, setPinAdd] = useState(false)
    const pinAddRef = useRef(false)
    const stripElRef = useRef<HTMLDivElement | null>(null)
    const reorderable = Boolean(reorder)
    // Fit mode keeps a window of `fitTabs` whole tabs on show. ONE function sets both the strip's
    // width and its scroll from that window: a separate snap, fit and reveal each moved the strip
    // on their own timers and fought over it.
    const windowStartRef = useRef(0)
    const pressedRef = useRef(false)
    // The open tab is pulled into view only when it CHANGES. Re-running that on every resize
    // undid a scroll by hand: the window's own width change fired the next refit.
    const shownActiveRef = useRef<Element | null>(null)
    const fitWindow = useCallback(
        (mode: "keep" | "nearest") => {
            const el = stripElRef.current
            if (!el || !fitTabs || pressedRef.current) return
            // Tab slots only: the edge covers sit in the padding and take no room in the row.
            const slots = (Array.from(el.children) as HTMLElement[]).filter(
                (child) => !child.dataset.curtain,
            )
            if (slots.length === 0) return
            const sizes = slots.map(
                (slot) => slot.offsetWidth + (parseFloat(getComputedStyle(slot).marginRight) || 0),
            )
            // Flow positions from the sizes, not offsets: a docked tab reports where it is pinned.
            const starts = sizes.map((_, i) =>
                sizes.slice(0, i).reduce((sum, size) => sum + size, 0),
            )
            const active = slots.findIndex((slot) => slot.querySelector('[aria-selected="true"]'))
            const margin = (i: number) => parseFloat(getComputedStyle(slots[i]).marginRight) || 0
            const room = hostRoom(el)
            // Where window `first` of `count` tabs puts the strip. An open tab outside the window
            // docks at that side; it gets its own room there, so it never covers a window tab.
            const layout = (first: number, count: number) => {
                const last = Math.min(first + count, slots.length) - 1
                const before = active >= 0 && active < first
                const after = active > last
                let width = sizes.slice(first, last + 1).reduce((sum, size) => sum + size, 0)
                if (before || after) width += sizes[active]
                width -= margin(after ? active : last)
                return {
                    scroll: starts[first] - (before ? sizes[active] : 0),
                    width: Math.round(width + 2 * BARE_INSET_PX),
                }
            }
            const clampFirst = (first: number, count: number) =>
                Math.max(0, Math.min(first, slots.length - count))
            const choose = (count: number) => {
                let first = windowStartRef.current
                if (mode === "nearest") {
                    // Matched against each window's own resting scroll, so a settled strip is a
                    // fixed point and the refit its own scroll fires changes nothing.
                    for (let i = 0; i <= Math.max(0, slots.length - count); i++) {
                        if (
                            Math.abs(layout(i, count).scroll - el.scrollLeft) <
                            Math.abs(layout(first, count).scroll - el.scrollLeft)
                        ) {
                            first = i
                        }
                    }
                } else if (active >= 0 && slots[active] !== shownActiveRef.current) {
                    if (active < first) first = active
                    if (active > first + count - 1) first = active - count + 1
                }
                return clampFirst(first, count)
            }
            // As many whole tabs as the room takes, up to `fitTabs`.
            let count = fitTabs
            let first = choose(count)
            while (count > 1 && layout(first, count).width > room + 1) {
                count -= 1
                first = choose(count)
            }
            shownActiveRef.current = active >= 0 ? slots[active] : null
            const {scroll, width} = layout(first, count)
            windowStartRef.current = first
            el.style.width = `${Math.min(width, Math.floor(room))}px`
            el.style.flex = "none"
            // No `behavior`: the strip's CSS smooth scroll applies, and it honours reduced motion.
            if (Math.abs(el.scrollLeft - scroll) > 1) el.scrollTo({left: Math.max(0, scroll)})
        },
        [fitTabs],
    )
    const measureFade = useCallback(() => {
        const el = stripElRef.current
        if (!el) return
        // ONE metric for every decision below. Reading overflow off `scrollWidth` and the un-pin
        // slack off offsets let the two disagree whenever a chip layout animation was mid-flight:
        // the translate made `scrollWidth` say overflow, so the (+) pinned; offsets then said
        // there was room, so it came back inline; moving it re-projected the chips and the next
        // measure — run synchronously from the effect below — flipped it again. Dozens of flips
        // inside one commit chain, and React threw "Maximum update depth exceeded" (#6742).
        const content = chipsWidth(el)
        const overflow = content - el.clientWidth > 1
        const left = overflow && el.scrollLeft > 1
        const right = overflow && el.scrollLeft < content - el.clientWidth - 1
        // Chips resize per frame while animating; bail on an unchanged mask to avoid re-rendering.
        setFade((prev) => (prev.left === left && prev.right === right ? prev : {left, right}))
        // Pin once the chips overflow; un-pin once they leave the button's footprint spare. The
        // pinned (+) sits outside the scroller, so `clientWidth` is already net of it: this is
        // wider hysteresis than it reads, and the two states cannot each satisfy the other's rule.
        const pin = pinAddRef.current ? el.clientWidth - content < INLINE_ADD_PX : overflow
        if (pin !== pinAddRef.current) {
            pinAddRef.current = pin
            setPinAdd(pin)
        }
    }, [])
    // React 19 registers onWheel as passive, so preventDefault would be a no-op. Attach a native
    // non-passive listener that maps vertical wheel delta to horizontal scroll; also track scroll +
    // resize to recompute the edge fade.
    const stripCleanupRef = useRef<(() => void) | null>(null)
    const scrollStripRef = useCallback(
        (el: HTMLDivElement | null) => {
            stripCleanupRef.current?.()
            stripCleanupRef.current = null
            stripElRef.current = el
            if (!el) return
            const onWheel = (e: WheelEvent) => {
                if (el.scrollWidth <= el.clientWidth) return
                const axis = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX
                if (axis === 0) return
                // Wheels report deltaMode=LINE (tiny integers) and the strip has scroll-smooth —
                // together they crawl. Normalize to px, scroll instantly.
                const delta =
                    e.deltaMode === 1 ? axis * 16 : e.deltaMode === 2 ? axis * el.clientWidth : axis
                e.preventDefault()
                const prev = el.style.scrollBehavior
                el.style.scrollBehavior = "auto"
                el.scrollLeft += delta
                el.style.scrollBehavior = prev
            }
            el.addEventListener("wheel", onWheel, {passive: false})
            el.addEventListener("scroll", measureFade, {passive: true})
            const ro = new ResizeObserver(() => {
                measureFade()
                fitWindow("keep")
            })
            ro.observe(el)
            // Watch the chips too: they animate their width, and a removed chip never resizes the box.
            const observeChildren = () => {
                for (const child of Array.from(el.children)) ro.observe(child)
            }
            observeChildren()
            const mo = new MutationObserver(() => {
                observeChildren()
                measureFade()
                fitWindow("keep")
            })
            // `aria-selected` too: switching tabs moves the window to the open one.
            mo.observe(el, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ["aria-selected"],
            })
            measureFade()
            fitWindow("keep")
            stripCleanupRef.current = () => {
                el.removeEventListener("wheel", onWheel)
                el.removeEventListener("scroll", measureFade)
                mo.disconnect()
                ro.disconnect()
            }
        },
        [measureFade, fitWindow],
    )
    // A scroll by hand settles on the nearest whole window once it rests. A held pointer is a
    // drag or a pan in progress, so nothing moves under it.
    useEffect(() => {
        const el = stripElRef.current
        if (!fitTabs || !el) return
        let timer: ReturnType<typeof setTimeout> | undefined
        const onScroll = () => {
            clearTimeout(timer)
            timer = setTimeout(() => fitWindow("nearest"), SNAP_IDLE_MS)
        }
        const onDown = () => {
            pressedRef.current = true
        }
        const onUp = () => {
            if (!pressedRef.current) return
            pressedRef.current = false
            onScroll()
        }
        el.addEventListener("scroll", onScroll, {passive: true})
        el.addEventListener("pointerdown", onDown)
        window.addEventListener("pointerup", onUp)
        window.addEventListener("pointercancel", onUp)
        return () => {
            clearTimeout(timer)
            el.removeEventListener("scroll", onScroll)
            el.removeEventListener("pointerdown", onDown)
            window.removeEventListener("pointerup", onUp)
            window.removeEventListener("pointercancel", onUp)
        }
    }, [fitTabs, fitWindow, reorderable, showTabs])
    // Remeasure when the tab set changes, and after the add button moves (it resizes the scroller).
    useEffect(() => {
        const el = stripElRef.current
        // Fit mode settles through its window instead.
        if (!snap || fitTabs || !el) return
        let timer: ReturnType<typeof setTimeout> | undefined
        // A held pointer is a drag in progress: the chip under it must not move.
        let pressed = false
        const settle = () => {
            if (pressed) return
            const target = snapTarget(el, bare ? BARE_INSET_PX : EDGE_FADE_START_PX)
            // No `behavior`: the strip's CSS smooth scroll applies, and it honours reduced motion.
            if (target !== null && Math.abs(target - el.scrollLeft) > 1) el.scrollTo({left: target})
        }
        const onScroll = () => {
            clearTimeout(timer)
            timer = setTimeout(settle, SNAP_IDLE_MS)
        }
        const onDown = () => {
            pressed = true
        }
        const onUp = () => {
            pressed = false
            onScroll()
        }
        el.addEventListener("scroll", onScroll, {passive: true})
        el.addEventListener("pointerdown", onDown)
        window.addEventListener("pointerup", onUp)
        // A touch pan ends in `pointercancel`, not `pointerup`.
        window.addEventListener("pointercancel", onUp)
        return () => {
            clearTimeout(timer)
            el.removeEventListener("scroll", onScroll)
            el.removeEventListener("pointerdown", onDown)
            window.removeEventListener("pointerup", onUp)
            window.removeEventListener("pointercancel", onUp)
        }
    }, [bare, fitTabs, reorderable, showTabs, snap])

    useEffect(() => {
        measureFade()
    }, [remeasureKey, pinAdd, measureFade])

    const maskStyle = bare
        ? undefined
        : {
              maskImage: fadeMask(fade.left, fade.right),
              WebkitMaskImage: fadeMask(fade.left, fade.right),
          }

    const canAdd = Boolean(showTabs && onAdd)
    const addButton = canAdd ? (
        <SimpleTooltip title={addTooltip ?? "New session"}>
            {/* Non-disabled span trigger: tooltips don't fire on a disabled button. */}
            <span className="inline-flex">
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="New session"
                    onClick={onAdd}
                    disabled={addDisabled}
                    className="h-7 w-7 shrink-0 p-0"
                >
                    <PlusIcon size={14} />
                </Button>
            </span>
        </SimpleTooltip>
    ) : null
    // Scroller's last child, so it trails the last chip. Not a reorder value, so never a drag slot.
    // It takes the same hairline the chips do, so the row ends the way every gap in it reads.
    const inlineAdd =
        canAdd && !pinAdd ? (
            <div className={clsx("flex shrink-0 items-center", TAB_DIVIDER)}>{addButton}</div>
        ) : null

    const scrollerClass = bare ? BARE_SCROLLER_CLASS : SCROLLER_CLASS
    const startCurtain = bare ? (
        <span aria-hidden data-curtain className={clsx(CURTAIN, "-left-3 -ml-3")} />
    ) : null
    const endCurtain = bare ? (
        <span aria-hidden data-curtain className={clsx(CURTAIN, "-right-3 -mr-3")} />
    ) : null

    return (
        <div
            role="tablist"
            className={clsx(
                "flex min-w-0 shrink-0 gap-2 overflow-hidden",
                bare ? "h-full items-stretch" : "w-full items-center",
                !bare &&
                    "h-[48px] border-x-0 border-t-0 border-b border-solid border-[var(--ag-surface-card-border)] bg-[var(--ag-surface-canvas)] px-3",
                className,
            )}
        >
            {leadingExtra ? (
                <div className="flex shrink-0 items-center gap-1">{leadingExtra}</div>
            ) : null}
            {showTabs ? (
                reorder ? (
                    // The scroller IS the group, so chips stay DIRECT children of the scroll box
                    // (both the fade measuring and the desktop's reveal-on-enter read that box).
                    // `layoutScroll` keeps motion's layout projection honest inside a scroller.
                    <Reorder.Group
                        as="div"
                        axis="x"
                        layoutScroll
                        values={reorder.ids}
                        onReorder={reorder.onReorder}
                        ref={scrollStripRef}
                        className={scrollerClass}
                        style={maskStyle}
                    >
                        {startCurtain}
                        {children}
                        {inlineAdd}
                        {endCurtain}
                    </Reorder.Group>
                ) : (
                    <div ref={scrollStripRef} className={scrollerClass} style={maskStyle}>
                        {startCurtain}
                        {children}
                        {inlineAdd}
                        {endCurtain}
                    </div>
                )
            ) : (
                <div className="min-w-0 flex-1" />
            )}
            {/* Fixed session-actions cluster; (+) lands here only when inline would scroll out of reach. */}
            {(canAdd && pinAdd) || extra ? (
                <div className="flex shrink-0 items-center gap-1">
                    {pinAdd ? addButton : null}
                    {extra}
                </div>
            ) : null}
        </div>
    )
}
