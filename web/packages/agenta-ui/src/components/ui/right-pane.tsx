import * as React from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {ArrowLeftIcon, XIcon} from "@phosphor-icons/react"
import {createPortal} from "react-dom"

import {COMPACT_WINDOW_QUERY, useIsExpandedWindow, useWindowMatch} from "../../hooks/useWindowMatch"

import {Button} from "./button"
import {ResizeEdgeLine} from "./resize-edge"
import {Sheet, SheetContent, SheetTitle} from "./sheet"
import {cn} from "./utils"

/**
 * The right pane (LAYOUT-04): one slot of the layout that any page, component or package can
 * fill. The shell mounts `RightPaneHost` once; anything under it renders `<RightPane>` where it
 * lives, and the content shows in the slot. The content stays in its owner's tree (its state,
 * context and atoms keep working) and unmounts with it, so no pane outlives its page.
 *
 * One thing at a time: a pane that opens closes the one before it (its `onOpenChange(false)`).
 * Docked beside the content on an expanded window, an overlay with the scrim on a medium one, a
 * full-page drill-in with Back on a compact one. Without a host it is always the overlay. The
 * content lives in one DOM node that moves between those frames, so a window crossing the
 * breakpoint keeps it (and a draft in it) mounted.
 */

/** `panel-side` is the narrowest the pane goes. */
const MIN_WIDTH = 320
const MAX_WIDTH = 560
/** The content beside a docked pane keeps at least `content-sm`. */
const CONTENT_MIN = 560
const KEY_STEP = 16
/** A little over the longer closing slide (the sheet's 300ms; the docked pane's 200ms). */
const LINGER_MS = 340
const WIDTH_KEY = "agenta:right-pane:width"
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)"

const clamp = (width: number, max: number) => Math.min(max, Math.max(MIN_WIDTH, Math.round(width)))

const readStoredWidth = () => {
    try {
        const stored = Number(window.localStorage.getItem(WIDTH_KEY))
        return stored ? clamp(stored, MAX_WIDTH) : MIN_WIDTH
    } catch {
        return MIN_WIDTH
    }
}

const storeWidth = (width: number) => {
    try {
        window.localStorage.setItem(WIDTH_KEY, String(width))
    } catch {
        // A private window: the width lasts this visit.
    }
}

const prefersReducedMotion = () =>
    typeof window !== "undefined" && Boolean(window.matchMedia?.(REDUCED_MOTION).matches)

interface RightPaneContextValue {
    slot: HTMLElement | null
    docked: boolean
    activeId: string | null
    claim: (id: string, close: () => void) => void
    release: (id: string) => void
}

const RightPaneContext = React.createContext<RightPaneContextValue | null>(null)

/**
 * The slot. Wraps the page beside it; the slot opens to the pane's width only while a pane is
 * docked, sliding on the theme's base duration (none with reduced motion). Its left edge is a
 * resize handle: drag it, or focus it and use the arrow keys; a double click resets it. The
 * width is remembered per browser and never leaves the content under `content-sm`.
 */
export function RightPaneHost({children}: {children: React.ReactNode}) {
    const docked = useIsExpandedWindow()
    const t = useT(commonCatalog)
    const [slot, setSlot] = React.useState<HTMLDivElement | null>(null)
    const [active, setActive] = React.useState<{id: string; close: () => void} | null>(null)
    const [width, setWidth] = React.useState(MIN_WIDTH)
    const [resizing, setResizing] = React.useState(false)
    const [rowWidth, setRowWidth] = React.useState(0)
    const row = React.useRef<HTMLDivElement>(null)
    // Written in `claim`/`release` themselves: two of them can run in one commit.
    const activeRef = React.useRef(active)

    React.useEffect(() => setWidth(readStoredWidth()), [])
    React.useEffect(() => {
        const el = row.current
        if (!el || typeof ResizeObserver === "undefined") return
        const observer = new ResizeObserver(([entry]) => setRowWidth(entry.contentRect.width))
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    const claim = React.useCallback((id: string, close: () => void) => {
        const previous = activeRef.current
        activeRef.current = {id, close}
        if (previous && previous.id !== id) previous.close()
        setActive(activeRef.current)
    }, [])
    const release = React.useCallback((id: string) => {
        if (activeRef.current?.id !== id) return
        activeRef.current = null
        setActive(null)
    }, [])
    const activeId = active?.id ?? null
    const value = React.useMemo(
        () => ({slot, docked, activeId, claim, release}),
        [slot, docked, activeId, claim, release],
    )

    // The widest the pane may go here: the content keeps `content-sm`.
    const maxWidth = rowWidth
        ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, rowWidth - CONTENT_MIN))
        : MAX_WIDTH
    const shownWidth = Math.min(width, maxWidth)
    const resizeTo = (next: number) => {
        const clamped = clamp(next, maxWidth)
        setWidth(clamped)
        storeWidth(clamped)
    }

    const drag = React.useRef<{x: number; width: number; frame: number} | null>(null)
    const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = {x: event.clientX, width: shownWidth, frame: 0}
        setResizing(true)
    }
    const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const current = drag.current
        if (!current) return
        const x = event.clientX
        // One width per frame: a pointer reports faster than the page can lay out.
        cancelAnimationFrame(current.frame)
        current.frame = requestAnimationFrame(() =>
            // The handle is on the left edge: moving left widens the pane.
            setWidth(clamp(current.width + current.x - x, maxWidth)),
        )
    }
    const onPointerUp = () => {
        const current = drag.current
        if (!current) return
        cancelAnimationFrame(current.frame)
        drag.current = null
        setResizing(false)
        setWidth((latest) => {
            storeWidth(latest)
            return latest
        })
    }
    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "ArrowLeft") resizeTo(shownWidth + KEY_STEP)
        else if (event.key === "ArrowRight") resizeTo(shownWidth - KEY_STEP)
        else if (event.key === "Home") resizeTo(MIN_WIDTH)
        else if (event.key === "End") resizeTo(maxWidth)
        else return
        event.preventDefault()
    }

    const shown = docked && Boolean(activeId)

    return (
        <RightPaneContext.Provider value={value}>
            <div ref={row} className="flex h-full min-w-0">
                <div className="min-w-0 flex-1">{children}</div>
                {/* Width 0 when shut, so the content beside it gives the room back as it slides.
                    Not clipped itself, so the resize handle can straddle the edge. */}
                <div
                    style={{width: shown ? shownWidth : 0}}
                    className={cn(
                        "relative h-full shrink-0",
                        docked ? "block" : "hidden",
                        !resizing &&
                            "transition-[width] duration-[var(--duration-base)] ease-[var(--ease-out)] motion-reduce:transition-none",
                    )}
                >
                    <div className="h-full w-full overflow-hidden">
                        <div
                            ref={setSlot}
                            data-slot="right-pane-slot"
                            style={{width: shownWidth}}
                            className="flex h-full flex-col border-0 border-l border-solid border-border-muted bg-muted"
                        />
                    </div>
                    {shown ? (
                        <div
                            role="separator"
                            aria-orientation="vertical"
                            aria-label={t("common.resizePane")}
                            aria-valuenow={shownWidth}
                            aria-valuemin={MIN_WIDTH}
                            aria-valuemax={maxWidth}
                            tabIndex={0}
                            onPointerDown={onPointerDown}
                            onPointerMove={onPointerMove}
                            onPointerUp={onPointerUp}
                            onPointerCancel={onPointerUp}
                            onKeyDown={onKeyDown}
                            onDoubleClick={() => resizeTo(MIN_WIDTH)}
                            className="group absolute inset-y-0 left-0 z-sticky w-2 -translate-x-1/2 cursor-col-resize touch-none outline-none"
                        >
                            {/* A 2px line on hover, focus and drag; the 8px strip is the target. */}
                            <ResizeEdgeLine active={resizing} />
                        </div>
                    ) : null}
                </div>
            </div>
        </RightPaneContext.Provider>
    )
}

/** The pane's header: Back on a compact window (a drill-in), Close elsewhere. */
function RightPaneHeader({
    titleId,
    title,
    back,
    onClose,
    overlay = false,
    actions,
}: {
    titleId: string
    title: React.ReactNode
    actions?: React.ReactNode
    back: boolean
    onClose: () => void
    /** In the overlay the dialog's own title names it, so the visible one stays out of the tree. */
    overlay?: boolean
}) {
    const t = useT(commonCatalog)
    return (
        <div className="flex h-header shrink-0 items-center gap-2 px-4 sm:px-6">
            {back ? (
                <Button
                    variant="ghost"
                    size="icon-compact"
                    className="-ml-1.5"
                    aria-label={t("common.back")}
                    onClick={onClose}
                >
                    <ArrowLeftIcon />
                </Button>
            ) : null}
            <span
                id={titleId}
                aria-hidden={overlay || undefined}
                className="min-w-0 flex-1 truncate text-label text-foreground"
            >
                {title}
            </span>
            {actions}
            {back ? null : (
                <Button
                    variant="ghost"
                    size="icon-compact"
                    className="-mr-1.5"
                    aria-label={t("common.close")}
                    onClick={onClose}
                >
                    <XIcon />
                </Button>
            )}
        </div>
    )
}

/** Puts the pane's one content node into whichever frame shows it, without remounting it. */
function ContentMount({node}: {node: HTMLElement}) {
    const attach = React.useCallback(
        (el: HTMLDivElement | null) => {
            if (el && node.parentNode !== el) el.appendChild(node)
        },
        [node],
    )
    return <div ref={attach} className="flex min-h-0 flex-1 flex-col" />
}

export interface RightPaneProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Names what the pane shows ("Ask about automations", the item's name). */
    title: React.ReactNode
    /** Controls at the end of the header, before Close: the pane's own actions ("Add"). */
    actions?: React.ReactNode
    /** Mounted while open and through the closing slide; the body has no padding, so set your own. */
    children: React.ReactNode
    /**
     * Docked, move focus into the pane when it opens (default). `false` for a pane that opens
     * with its page, so the page's own first field keeps the focus.
     */
    focusOnOpen?: boolean
}

/** Fills the right pane from anywhere under the host. Renders nothing while closed. */
export function RightPane({
    open,
    onOpenChange,
    title,
    actions,
    children,
    focusOnOpen = true,
}: RightPaneProps) {
    const host = React.useContext(RightPaneContext)
    const id = React.useId()
    const titleId = React.useId()
    const compact = useWindowMatch(COMPACT_WINDOW_QUERY)
    const onOpenChangeRef = React.useRef(onOpenChange)
    onOpenChangeRef.current = onOpenChange
    const claim = host?.claim
    const release = host?.release
    // One node for the content, created on the client: it moves between the docked and overlay
    // frames, so the content is never remounted when the window crosses the breakpoint.
    const [node] = React.useState(() => {
        if (typeof document === "undefined") return null
        const el = document.createElement("div")
        el.className = "flex min-h-0 flex-1 flex-col"
        return el
    })

    React.useEffect(() => {
        if (!open || !claim || !release) return
        claim(id, () => onOpenChangeRef.current(false))
        return () => release(id)
    }, [open, claim, release, id])

    // The closing pane keeps its content through the slide, then lets it go.
    const [lingering, setLingering] = React.useState(false)
    const wasOpen = React.useRef(open)
    React.useEffect(() => {
        const closed = wasOpen.current && !open
        wasOpen.current = open
        if (!closed || prefersReducedMotion()) {
            setLingering(false)
            return
        }
        setLingering(true)
        const timer = window.setTimeout(() => setLingering(false), LINGER_MS)
        return () => window.clearTimeout(timer)
    }, [open])

    const docked = Boolean(host?.docked && host.slot)
    const isActive = !host || host.activeId === id
    const dockedShown = docked && (isActive || (lingering && host?.activeId === null))

    // Docked, focus moves into the pane when it opens and back to where it was when it closes.
    const asideRef = React.useRef<HTMLElement>(null)
    const returnFocus = React.useRef<HTMLElement | null>(null)
    const dockedOpen = open && dockedShown
    const focusOnOpenRef = React.useRef(focusOnOpen)
    focusOnOpenRef.current = focusOnOpen
    React.useEffect(() => {
        if (dockedOpen) {
            if (!focusOnOpenRef.current) return
            returnFocus.current = document.activeElement as HTMLElement | null
            asideRef.current?.focus({preventScroll: true})
            return
        }
        if (node?.contains(document.activeElement)) {
            returnFocus.current?.focus({preventScroll: true})
        }
        returnFocus.current = null
    }, [dockedOpen, node])

    if (!node || (!open && !lingering)) return null
    const close = () => onOpenChange(false)
    const content = createPortal(
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>,
        node,
    )

    if (docked) {
        if (!dockedShown || !host?.slot) return content
        return (
            <>
                {content}
                {createPortal(
                    <aside
                        ref={asideRef}
                        tabIndex={-1}
                        aria-labelledby={titleId}
                        className="flex min-h-0 flex-1 flex-col outline-none"
                    >
                        <RightPaneHeader
                            titleId={titleId}
                            title={title}
                            actions={actions}
                            back={false}
                            onClose={close}
                        />
                        <ContentMount node={node} />
                    </aside>,
                    host.slot,
                )}
            </>
        )
    }

    // Under a host, only the active pane shows; the Sheet stays mounted to play its closing slide.
    return (
        <>
            {content}
            <Sheet open={open && isActive} onOpenChange={onOpenChange}>
                <SheetContent
                    side="right"
                    aria-describedby={undefined}
                    className={
                        compact
                            ? "inset-0 w-full max-w-none rounded-none"
                            : "w-panel-side max-w-none bg-muted"
                    }
                >
                    <SheetTitle className="sr-only">{title}</SheetTitle>
                    <RightPaneHeader
                        titleId={titleId}
                        title={title}
                        actions={actions}
                        back={compact}
                        onClose={close}
                        overlay
                    />
                    <ContentMount node={node} />
                </SheetContent>
            </Sheet>
        </>
    )
}
