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

/** Slight left/right edge fade so tabs dissolve into the strip edges instead of a hard cut when
 * they overflow. Applied per-side ONLY where content is actually clipped (scrolled past) — a strip
 * that fits (e.g. a single tab) gets no fade, so its lone item isn't dimmed at the edges. */
const EDGE_FADE_PX = 20
const fadeMask = (left: boolean, right: boolean): string => {
    const start = left ? `transparent 0, #000 ${EDGE_FADE_PX}px` : "#000 0"
    const end = right ? `#000 calc(100% - ${EDGE_FADE_PX}px), transparent 100%` : "#000 100%"
    return `linear-gradient(to right, ${start}, ${end})`
}

/** Footprint of the inline New session (+) — the 28px button plus the 4px it sits off the last
 * chip. Room the strip must have spare before the button leaves the pinned cluster and goes back
 * inline. Un-pinning also widens the scroller by roughly the same amount, so demanding the whole
 * footprint up front leaves the button comfortably inside the strip and can't flip-flop. */
const INLINE_ADD_PX = 32

/** Width the chips occupy, which `scrollWidth` cannot report while they fit: the scroller is
 * `flex-1`, so a strip with room to spare reports `scrollWidth === clientWidth` and looks exactly
 * like one filled to the millimetre. Measured off the chips themselves instead. */
const chipsWidth = (el: HTMLElement): number => {
    const first = el.firstElementChild as HTMLElement | null
    const last = el.lastElementChild as HTMLElement | null
    if (!first || !last) return 0
    const trailing = parseFloat(getComputedStyle(last).marginRight) || 0
    return last.offsetLeft + last.offsetWidth + trailing - first.offsetLeft
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
    addTooltip?: string
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
    className?: string
}

const SCROLLER_CLASS =
    "flex min-w-0 flex-1 items-center overflow-x-auto overscroll-x-contain motion-safe:scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"

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
    className,
}: SessionTabStripProps) => {
    // Edge fade is applied per side only where the strip is actually scrolled past its content, so
    // a strip that fits (single tab, no scroll) shows no fade on either edge.
    const [fade, setFade] = useState({left: false, right: false})
    // New session (+) rides inside the scroller, right after the last tab, while the tabs still fit
    // — that is where it is discoverable. It only moves out to the pinned cluster once the tabs
    // fill the strip, where inline would mean scrolling to reach it. Starts inline so the common
    // case (a strip with room) never flashes the button across the bar: the first measure runs in
    // the scroller's ref callback, before paint.
    const [pinAdd, setPinAdd] = useState(false)
    const pinAddRef = useRef(false)
    const stripElRef = useRef<HTMLDivElement | null>(null)
    const measureFade = useCallback(() => {
        const el = stripElRef.current
        if (!el) return
        const overflow = el.scrollWidth - el.clientWidth > 1
        const left = overflow && el.scrollLeft > 1
        const right = overflow && el.scrollLeft < el.scrollWidth - el.clientWidth - 1
        // Chips resize per frame while animating in and out — bail on an unchanged mask so the
        // measure doesn't re-render the strip on every one of those frames.
        setFade((prev) => (prev.left === left && prev.right === right ? prev : {left, right}))
        // Pin as soon as the chips (with the inline button among them) overflow; un-pin once the
        // chips alone leave the button's footprint spare.
        const pin = pinAddRef.current ? el.clientWidth - chipsWidth(el) < INLINE_ADD_PX : overflow
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
            const ro = new ResizeObserver(() => measureFade())
            ro.observe(el)
            // Watch the chips too, not just the scroll box: they animate their width in and out,
            // and a chip leaving the DOM never resizes the box — so content-only changes would
            // otherwise strand the fade and the add button's spot on a stale measurement.
            const observeChildren = () => {
                for (const child of Array.from(el.children)) ro.observe(child)
            }
            observeChildren()
            const mo = new MutationObserver(observeChildren)
            mo.observe(el, {childList: true})
            measureFade()
            stripCleanupRef.current = () => {
                el.removeEventListener("wheel", onWheel)
                el.removeEventListener("scroll", measureFade)
                mo.disconnect()
                ro.disconnect()
            }
        },
        [measureFade],
    )
    // A ResizeObserver watches the element box, not its content — remeasure when the tab set
    // changes, and after the add button moves (which resizes the scroller from the other side).
    useEffect(() => {
        measureFade()
    }, [remeasureKey, pinAdd, measureFade])

    const maskStyle = {
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
    // Inline it as the scroller's last child, so it trails the last chip. Kept out of the reorder
    // values, so it is never a drag slot.
    const inlineAdd =
        canAdd && !pinAdd ? (
            <div className="ml-1 flex shrink-0 items-center">{addButton}</div>
        ) : null

    return (
        <div
            role="tablist"
            className={clsx(
                "flex h-[48px] w-full min-w-0 shrink-0 items-center gap-2 overflow-hidden border-x-0 border-t-0 border-b border-solid border-[var(--ag-surface-card-border)] bg-[var(--ag-surface-canvas)] px-3",
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
                        className={SCROLLER_CLASS}
                        style={maskStyle}
                    >
                        {children}
                        {inlineAdd}
                    </Reorder.Group>
                ) : (
                    <div ref={scrollStripRef} className={SCROLLER_CLASS} style={maskStyle}>
                        {children}
                        {inlineAdd}
                    </div>
                )
            ) : (
                <div className="min-w-0 flex-1" />
            )}
            {/* Fixed session-actions cluster. New session (+) only lands here once the chips fill
                the strip — inline it would then be scrolled out of reach. */}
            {(canAdd && pinAdd) || extra ? (
                <div className="flex shrink-0 items-center gap-1">
                    {pinAdd ? addButton : null}
                    {extra}
                </div>
            ) : null}
        </div>
    )
}
