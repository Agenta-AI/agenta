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
    // The edge covers are sticky and report where they are pinned, so they never bound the row.
    const chips = (Array.from(el.children) as HTMLElement[]).filter((c) => !c.dataset.curtain)
    const first = chips[0]
    const last = chips[chips.length - 1]
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
        // A host that fills its row marks itself: its own width is the room, within its cap.
        if (node.dataset.stripRoom === "fill") {
            return Math.min(node.clientWidth, Number.isFinite(max) ? max : Infinity)
        }
        if (Number.isFinite(max)) return max
    }
    return Number.POSITIVE_INFINITY
}

/** The host's own cap on the strip: the first `max-width` above it, whatever room it has now. */
const hostCap = (el: HTMLElement): number => {
    for (let node = el.parentElement; node; node = node.parentElement) {
        const max = parseFloat(getComputedStyle(node).maxWidth)
        if (Number.isFinite(max)) return max
    }
    return Number.POSITIVE_INFINITY
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
    /** Only the chips and extras, for a host bar that already draws the height and hairline. */
    bare?: boolean
    /**
     * Bare only: show this many tabs. The strip takes the width of the widest run of that many
     * (the host caps it), so switching tabs never resizes it, and scrolls the open tab into view;
     * a scroll by hand stays where it is left.
     */
    fitTabs?: number
    /** Fit mode: the width the strip takes with room to spare (its host's cap included), so the
     * host can make room before the strip has to shrink. */
    onNaturalWidth?: (width: number) => void
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
 * The bare strip's room at each end: the open tab's flared corners need it. A scroll by hand can
 * rest with a tab cut at an edge, so that edge fades; an edge with whole tabs stays crisp, so the
 * open tab is never dimmed.
 */
export const BARE_INSET_PX = 12
const BARE_SCROLLER_CLASS =
    "flex h-full min-w-0 max-w-full flex-1 items-end overflow-x-auto overscroll-x-contain px-3 [justify-content:safe_center] motion-safe:scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
/** Covers the scroller's padding at each end, so a tab scrolling past stops at the same 12px inset
 * the open tab's flared corners need. Sticky offsets count from the content box, so -12px puts
 * each cover on the padding. It stops 4px short of the bottom, where those corners are drawn, or
 * the first and last tabs lose their curves. */
const CURTAIN = "sticky z-[2] mb-1 w-3 shrink-0 self-stretch bg-[var(--ag-surface-tab-bar)]"

export const SessionTabStrip = ({
    children,
    showTabs = true,
    onAdd,
    addDisabled = false,
    addTooltip,
    extra,
    leadingExtra,
    remeasureKey,
    bare = false,
    fitTabs,
    onNaturalWidth,
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
    // Fit mode: ONE function owns the strip's width and scroll. A separate snap, fit and reveal
    // each moved the strip on their own timers and fought over it.
    const naturalRef = useRef(0)
    const onNaturalWidthRef = useRef(onNaturalWidth)
    onNaturalWidthRef.current = onNaturalWidth
    const tabCountRef = useRef(0)
    // The open tab is pulled into view only when it CHANGES. Re-running that on every resize
    // undid a scroll by hand: the window's own width change fired the next refit.
    const shownActiveRef = useRef<Element | null>(null)
    // Whether the strip still owns its scroll. A wheel or a press on the strip hands it to the user,
    // and a scroll by hand then stays where it is left; a new open tab or tab set takes it back.
    const ownsScrollRef = useRef(true)
    const fitWindow = useCallback(() => {
        const el = stripElRef.current
        if (!el || !fitTabs) return
        // Tab slots only: the edge covers sit in the padding and take no room in the row.
        const slots = (Array.from(el.children) as HTMLElement[]).filter(
            (child) => !child.dataset.curtain,
        )
        if (slots.length === 0) return
        const margins = slots.map((slot) => parseFloat(getComputedStyle(slot).marginRight) || 0)
        // Exact widths: tabs size to their names, and rounded `offsetWidth`s drift by a pixel
        // per tab.
        const sizes = slots.map((slot, i) => slot.getBoundingClientRect().width + margins[i])
        // Flow positions from the sizes, so a tab mid-glide does not skew them.
        const starts = sizes.map((_, i) => sizes.slice(0, i).reduce((sum, size) => sum + size, 0))
        const room = hostRoom(el)
        // A tab may never be wider than the strip can show, or a one-tab strip clips it.
        if (Number.isFinite(room)) {
            el.style.setProperty("--strip-tab-max", `${Math.floor(room) - 2 * BARE_INSET_PX}px`)
        }
        // The widest run of `fitTabs` tabs sets the width, whichever tab is open: a width that
        // followed the open tab resized the centred strip and slid every tab on each switch.
        const count = Math.min(fitTabs, slots.length)
        let widest = 0
        for (let first = 0; first + count <= slots.length; first++) {
            const last = first + count - 1
            widest = Math.max(widest, starts[last] + sizes[last] - margins[last] - starts[first])
        }
        // Within the host's cap: the host decides centre or start from this width, and a width
        // the strip never takes made it start a strip that fits centred.
        const natural = Math.min(Math.round(widest + 2 * BARE_INSET_PX), hostCap(el))
        if (natural !== naturalRef.current) {
            naturalRef.current = natural
            onNaturalWidthRef.current?.(natural)
        }
        el.style.width = `${Math.min(natural, Math.floor(room))}px`
        el.style.flex = "none"
        const active = slots.findIndex((slot) => slot.querySelector('[aria-selected="true"]'))
        const activeSlot = active >= 0 ? slots[active] : null
        const moved = activeSlot !== shownActiveRef.current || slots.length !== tabCountRef.current
        shownActiveRef.current = activeSlot
        tabCountRef.current = slots.length
        // A new open tab or a changed tab set brings the open tab into view. Otherwise a refit
        // (titles landing, a resize) keeps it in view only while the user has not scrolled.
        if (moved) ownsScrollRef.current = true
        if (!ownsScrollRef.current || active < 0) return
        // The least scroll that shows the whole open tab, from where the strip is now, so a tab
        // already in view never moves under the pointer that opened it.
        const view = el.clientWidth - 2 * BARE_INSET_PX
        const from = starts[active]
        const to = from + sizes[active] - margins[active]
        const left = el.scrollLeft
        const target = from < left ? from : to > left + view ? to - view : left
        // No `behavior`: the strip's CSS smooth scroll applies, and it honours reduced motion.
        if (Math.abs(target - left) > 1) el.scrollTo({left: Math.max(0, target)})
    }, [fitTabs])
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
        let left = overflow && el.scrollLeft > 1
        let right = overflow && el.scrollLeft < content - el.clientWidth - 1
        if (bare) {
            // Fade only an edge a tab is cut at, so whole tabs (the open tab among them) stay crisp.
            const box = el.getBoundingClientRect()
            const lo = box.left + BARE_INSET_PX
            const hi = box.right - BARE_INSET_PX
            const tabs = (Array.from(el.children) as HTMLElement[])
                .filter((child) => !child.dataset.curtain)
                .map((child) => child.getBoundingClientRect())
            left = left && tabs.some((tab) => tab.left < lo - 1 && tab.right > lo + 1)
            right = right && tabs.some((tab) => tab.left < hi - 1 && tab.right > hi + 1)
        }
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
    }, [bare])
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
                // A hand scroll: it stays where it is left.
                ownsScrollRef.current = false
                const prev = el.style.scrollBehavior
                el.style.scrollBehavior = "auto"
                el.scrollLeft += delta
                el.style.scrollBehavior = prev
            }
            // A touch pan or a press on a tab: the user takes the scroll. A tab switch hands it back.
            const onPointerDown = () => {
                ownsScrollRef.current = false
            }
            el.addEventListener("wheel", onWheel, {passive: false})
            el.addEventListener("pointerdown", onPointerDown)
            el.addEventListener("scroll", measureFade, {passive: true})
            const ro = new ResizeObserver(() => {
                measureFade()
                fitWindow()
            })
            ro.observe(el)
            // The host may fill its row (`data-strip-room="fill"`) and resize with the bar.
            const roomHost = el.closest<HTMLElement>("[data-strip-host]")
            if (roomHost) ro.observe(roomHost)
            // Watch the chips too: they animate their width, and a removed chip never resizes the box.
            const observeChildren = () => {
                for (const child of Array.from(el.children)) ro.observe(child)
            }
            observeChildren()
            const mo = new MutationObserver(() => {
                observeChildren()
                measureFade()
                fitWindow()
            })
            // `aria-selected` too: switching tabs moves the window to the open one.
            mo.observe(el, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ["aria-selected"],
            })
            measureFade()
            fitWindow()
            stripCleanupRef.current = () => {
                el.removeEventListener("wheel", onWheel)
                el.removeEventListener("pointerdown", onPointerDown)
                el.removeEventListener("scroll", measureFade)
                mo.disconnect()
                ro.disconnect()
            }
        },
        [measureFade, fitWindow],
    )

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
    // Scroller's last child, so it trails the last chip.
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
                <div ref={scrollStripRef} className={scrollerClass} style={maskStyle}>
                    {startCurtain}
                    {children}
                    {inlineAdd}
                    {endCurtain}
                </div>
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
