import * as React from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {ArrowLeftIcon, XIcon} from "@phosphor-icons/react"
import {createPortal} from "react-dom"

import {Button} from "./button"
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
 * full-page drill-in with Back on a compact one. Without a host it is always the overlay.
 */

const EXPANDED = "(min-width: 1024px)"
const COMPACT = "(max-width: 639.98px)"

const subscribeTo = (query: string) => (onChange: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {}
    const list = window.matchMedia(query)
    list.addEventListener("change", onChange)
    return () => list.removeEventListener("change", onChange)
}

const useMatchMedia = (query: string) =>
    React.useSyncExternalStore(
        React.useMemo(() => subscribeTo(query), [query]),
        () => (typeof window !== "undefined" && window.matchMedia?.(query).matches) || false,
        () => false,
    )

interface RightPaneContextValue {
    slot: HTMLElement | null
    docked: boolean
    activeId: string | null
    /** The pane sliding closed: it keeps its content until the slot has shut. */
    exitingId: string | null
    claim: (id: string, close: () => void) => void
    release: (id: string) => void
}

const RightPaneContext = React.createContext<RightPaneContextValue | null>(null)

/** `panel-side` is the narrowest the pane goes; the widest leaves the content its room. */
const MIN_WIDTH = 320
const MAX_WIDTH = 560
const KEY_STEP = 16
const WIDTH_KEY = "agenta:right-pane:width"

const clampWidth = (width: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)))

const readStoredWidth = () => {
    try {
        const stored = Number(window.localStorage.getItem(WIDTH_KEY))
        return stored ? clampWidth(stored) : MIN_WIDTH
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

/**
 * The slot. Wraps the page beside it; the slot opens to the pane's width only while a pane is
 * docked, sliding on the theme's base duration (none with reduced motion). Its left edge is a
 * resize handle: drag it, or focus it and use the arrow keys; a double click resets it. The
 * width is remembered per browser.
 */
export function RightPaneHost({children}: {children: React.ReactNode}) {
    const docked = useMatchMedia(EXPANDED)
    const [slot, setSlot] = React.useState<HTMLDivElement | null>(null)
    const [active, setActive] = React.useState<{id: string; close: () => void} | null>(null)
    const [exitingId, setExitingId] = React.useState<string | null>(null)
    const [width, setWidth] = React.useState(MIN_WIDTH)
    const [resizing, setResizing] = React.useState(false)
    const activeRef = React.useRef(active)
    activeRef.current = active
    const dockedRef = React.useRef(docked)
    dockedRef.current = docked

    React.useEffect(() => setWidth(readStoredWidth()), [])

    const claim = React.useCallback((id: string, close: () => void) => {
        const previous = activeRef.current
        if (previous && previous.id !== id) previous.close()
        setExitingId(null)
        setActive({id, close})
    }, [])
    const release = React.useCallback((id: string) => {
        if (activeRef.current?.id !== id) return
        setActive(null)
        // Keep the content while the slot slides shut; with no slide there is nothing to wait for.
        const still =
            typeof window !== "undefined" &&
            window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        setExitingId(still || !dockedRef.current ? null : id)
    }, [])
    const activeId = active?.id ?? null
    const value = React.useMemo(
        () => ({slot, docked, activeId, exitingId, claim, release}),
        [slot, docked, activeId, exitingId, claim, release],
    )

    const resizeTo = (next: number) => {
        const clamped = clampWidth(next)
        setWidth(clamped)
        storeWidth(clamped)
    }
    const drag = React.useRef<{x: number; width: number} | null>(null)
    const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = {x: event.clientX, width}
        setResizing(true)
    }
    const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!drag.current) return
        // The handle is on the left edge: moving left widens the pane.
        setWidth(clampWidth(drag.current.width + drag.current.x - event.clientX))
    }
    const onPointerUp = () => {
        if (!drag.current) return
        drag.current = null
        setResizing(false)
        setWidth((current) => {
            storeWidth(current)
            return current
        })
    }
    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "ArrowLeft") resizeTo(width + KEY_STEP)
        else if (event.key === "ArrowRight") resizeTo(width - KEY_STEP)
        else if (event.key === "Home") resizeTo(MIN_WIDTH)
        else if (event.key === "End") resizeTo(MAX_WIDTH)
        else return
        event.preventDefault()
    }

    const shown = docked && Boolean(activeId)
    const t = useT(commonCatalog)

    return (
        <RightPaneContext.Provider value={value}>
            <div className="flex h-full min-w-0">
                <div className="min-w-0 flex-1">{children}</div>
                {/* Width 0 when shut, so the content beside it gives the room back as it slides. */}
                <div
                    style={{width: shown ? width : 0}}
                    onTransitionEnd={(event) => {
                        if (event.target === event.currentTarget && !shown) setExitingId(null)
                    }}
                    className={cn(
                        "relative h-full shrink-0 overflow-hidden",
                        docked ? "block" : "hidden",
                        !resizing &&
                            "transition-[width] duration-[var(--duration-base)] ease-[var(--ease-out)] motion-reduce:transition-none",
                    )}
                >
                    <div
                        ref={setSlot}
                        data-slot="right-pane-slot"
                        style={{width}}
                        className="flex h-full flex-col border-0 border-l border-solid border-border-muted bg-muted"
                    />
                    {shown ? (
                        <div
                            role="separator"
                            aria-orientation="vertical"
                            aria-label={t("common.resizePane")}
                            aria-valuenow={width}
                            aria-valuemin={MIN_WIDTH}
                            aria-valuemax={MAX_WIDTH}
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
                            <span
                                aria-hidden
                                className={cn(
                                    "absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-transparent transition-colors group-hover:bg-ring group-focus-visible:bg-ring",
                                    resizing && "bg-ring",
                                )}
                            />
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
}: {
    titleId: string
    title: React.ReactNode
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

export interface RightPaneProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Names what the pane shows ("Ask about automations", the item's name). */
    title: React.ReactNode
    /** Mounted only while the pane is open. */
    children: React.ReactNode
}

/** Fills the right pane from anywhere under the host. Renders nothing while closed. */
export function RightPane({open, onOpenChange, title, children}: RightPaneProps) {
    const host = React.useContext(RightPaneContext)
    const id = React.useId()
    const titleId = React.useId()
    const compact = useMatchMedia(COMPACT)
    const onOpenChangeRef = React.useRef(onOpenChange)
    onOpenChangeRef.current = onOpenChange
    const claim = host?.claim
    const release = host?.release

    React.useEffect(() => {
        if (!open || !claim || !release) return
        claim(id, () => onOpenChangeRef.current(false))
        return () => release(id)
    }, [open, claim, release, id])

    const exiting = !open && host?.docked && host.exitingId === id
    if (!open && !exiting) return null
    const close = () => onOpenChange(false)
    const body = (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6 sm:px-6">
            {children}
        </div>
    )

    if (host?.docked && host.slot) {
        if (host.activeId !== id && !exiting) return null
        return createPortal(
            <aside aria-labelledby={titleId} className="flex min-h-0 flex-1 flex-col">
                <RightPaneHeader titleId={titleId} title={title} back={false} onClose={close} />
                {body}
            </aside>,
            host.slot,
        )
    }

    // One overlay at a time too: under a host, only the active pane shows.
    if (host && host.activeId !== null && host.activeId !== id) return null
    return (
        <Sheet open onOpenChange={onOpenChange}>
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
                    back={compact}
                    onClose={close}
                    overlay
                />
                {body}
            </SheetContent>
        </Sheet>
    )
}
