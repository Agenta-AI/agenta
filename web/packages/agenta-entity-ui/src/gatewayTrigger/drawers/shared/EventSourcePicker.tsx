import {useRef, useState, type ReactNode} from "react"

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {ClockCountdown, X} from "@phosphor-icons/react"

/**
 * A real event sampled from the provider — used to build the inputs mapping against
 * concrete data and to run the agent in the playground with a real payload.
 */
export interface SampledEvent {
    id: string
    /** Short title, e.g. "DM from @alex". */
    label: string
    /** One-line content preview, e.g. the message text. */
    preview?: string
    /** Relative time, e.g. "2m ago". */
    timeAgo?: string
    /** The raw event payload (what selectors resolve against). */
    payload: unknown
}

// antd Popover `placement` → Radix side/align.
const PLACEMENTS = {
    bottomRight: {side: "bottom", align: "end"},
    topRight: {side: "top", align: "end"},
    bottomLeft: {side: "bottom", align: "start"},
    topLeft: {side: "top", align: "start"},
} as const

/**
 * Shared popover for sourcing a real event: "wait for a new event" (live capture) or one
 * of the recent events. Used in two places in the subscription drawer — the mapping
 * section (pull a sample to map against) and run-in-playground (pick an event to run).
 *
 * Presentational + a clean data interface: the caller supplies `recentEvents` and the
 * `onWaitForEvent` capture function, so the backend wiring (deliveries query / test
 * subscription) is settled by the caller, not baked in here.
 */
export function EventSourcePicker({
    trigger,
    recentEvents,
    onPick,
    onWaitForEvent,
    onOpenChange,
    placement = "bottomRight",
    waitHint,
    captureMode,
    defaultOpen,
    container,
}: {
    /** The element that opens the popover (a button). */
    trigger: ReactNode
    recentEvents: SampledEvent[]
    onPick: (event: SampledEvent) => void
    /** Live-capture the next event; resolves to it, or null if none/cancelled. */
    onWaitForEvent?: () => Promise<SampledEvent | null>
    /** Fired when the popover opens/closes — use to lazy-load `recentEvents` on open. */
    onOpenChange?: (open: boolean) => void
    placement?: "bottomRight" | "topRight" | "bottomLeft" | "topLeft"
    waitHint?: string
    /** Data-capture wait (picks apply data, not actions): survives popover close, and a resolved event keeps the popover open. */
    captureMode?: boolean
    /** Start open (forced-open parity stories / initial-open UX). */
    defaultOpen?: boolean
    /** Portal target for the popover; defaults to document.body. */
    container?: HTMLElement | null
}) {
    const [open, setOpen] = useState(defaultOpen ?? false)
    const [waiting, setWaiting] = useState(false)
    const settledRef = useRef(false)
    // Identifies the current wait so cancelling can disown it. A ref, not `settledRef`:
    // cancelling must not also block a wait the user starts again straight after.
    const waitIdRef = useRef(0)

    const pick = (event: SampledEvent) => {
        settledRef.current = true
        setOpen(false)
        onPick(event)
    }

    const wait = async () => {
        if (!onWaitForEvent || waiting) return
        const id = ++waitIdRef.current
        setWaiting(true)
        try {
            const event = await onWaitForEvent()
            if (event && !settledRef.current && waitIdRef.current === id) {
                settledRef.current = true
                // Capture mode keeps the popover open — the event lands in recentEvents.
                if (!captureMode) setOpen(false)
                onPick(event)
            }
        } catch {
            // Callers surface their own error before rejecting; swallow so the fire-and-forget
            // `void wait()` never becomes an unhandled rejection.
        } finally {
            if (waitIdRef.current === id) setWaiting(false)
        }
    }

    // Stop waiting. The provider poll it started can't be aborted from here, so the wait is
    // disowned instead: whatever it returns is discarded rather than landing minutes later.
    const cancelWait = () => {
        waitIdRef.current += 1
        setWaiting(false)
    }

    const handleOpenChange = (next: boolean) => {
        setOpen(next)
        onOpenChange?.(next)
        if (next) {
            settledRef.current = false
        } else if (!captureMode) {
            // A wait resolving after the popover closed must not fire onPick — unless it's
            // a data capture (that flow sends users away from the popover).
            settledRef.current = true
        }
    }

    const {side, align} = PLACEMENTS[placement]
    return (
        <DropdownMenu open={open} onOpenChange={handleOpenChange}>
            <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
            <DropdownMenuContent
                side={side}
                align={align}
                aria-label="Select event source"
                className="w-[280px]"
                container={container}
            >
                {onWaitForEvent && (
                    <DropdownMenuItem
                        // The wait resolves minutes later; closing the menu on click would
                        // leave no sign that it is still running.
                        onSelect={(e) => {
                            e.preventDefault()
                            void wait()
                        }}
                        className="items-start"
                    >
                        {waiting ? (
                            // Same "this is live" language as the connection dots, and honest
                            // about a wait measured in minutes rather than a spinner's seconds.
                            <span className="relative mt-1 flex size-2 shrink-0 items-center justify-center">
                                <span className="absolute inline-flex size-full rounded-full bg-colorInfo opacity-60 motion-safe:animate-ping" />
                                <span className="relative inline-flex size-1.5 rounded-full bg-colorInfo" />
                            </span>
                        ) : (
                            <ClockCountdown
                                size={14}
                                className="mt-0.5 text-[var(--ag-colorTextSecondary)]"
                            />
                        )}
                        <span className="min-w-0 flex-1">
                            <span className="block text-xs">
                                {waiting ? "Waiting for an event…" : "Wait for a new event"}
                            </span>
                            {waitHint && !waiting && (
                                <span className="block text-xs text-[var(--ag-colorTextTertiary)]">
                                    {waitHint}
                                </span>
                            )}
                        </span>
                    </DropdownMenuItem>
                )}

                {/* Its own item, not a nested button: Radix owns roving focus inside a menu and
                    intercepts Tab, so anything tabbable within an item is unreachable. */}
                {waiting && (
                    <DropdownMenuItem
                        onSelect={(e) => {
                            e.preventDefault()
                            cancelWait()
                        }}
                    >
                        <X size={12} className="text-[var(--ag-colorTextTertiary)]" />
                        <span className="text-xs">Stop waiting</span>
                    </DropdownMenuItem>
                )}

                <DropdownMenuLabel className="mt-1 text-xs font-medium text-[var(--ag-colorTextDescription)]">
                    Recent events
                </DropdownMenuLabel>

                {recentEvents.length === 0 ? (
                    // The same dashed one-liner EventFieldList uses for "nothing sampled yet",
                    // rather than a second empty-state language a few pixels away.
                    <div className="mx-1 mb-1 rounded-md border border-dashed border-[var(--ag-colorBorder)] px-2 py-3 text-center text-xs leading-snug text-[var(--ag-colorTextTertiary)]">
                        Events you capture appear here.
                    </div>
                ) : (
                    recentEvents.map((event) => (
                        <DropdownMenuItem key={event.id} onSelect={() => pick(event)}>
                            {/* Content leads, timestamp is metadata on the right — the row
                                grammar the revision list already uses. */}
                            <span className="min-w-0 flex-1 truncate text-xs">
                                {event.label}
                                {event.preview ? (
                                    <span className="text-[var(--ag-colorTextTertiary)]">
                                        {` · ${event.preview}`}
                                    </span>
                                ) : null}
                            </span>
                            {event.timeAgo && (
                                <span className="shrink-0 text-xs text-[var(--ag-colorTextDescription)]">
                                    {event.timeAgo}
                                </span>
                            )}
                        </DropdownMenuItem>
                    ))
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
