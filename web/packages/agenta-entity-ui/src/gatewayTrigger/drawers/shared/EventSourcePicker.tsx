import {useRef, useState, type ReactNode} from "react"

import {ClockCountdown, Lightning} from "@phosphor-icons/react"
import {Empty, Popover, Spin} from "antd"

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
    waitLabel = "Wait for a new event",
    waitHint,
    autoWaitOnOpen,
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
    waitLabel?: string
    waitHint?: string
    /** Start the live capture immediately when the popover opens (single-click test). */
    autoWaitOnOpen?: boolean
}) {
    const [open, setOpen] = useState(false)
    const [waiting, setWaiting] = useState(false)
    const settledRef = useRef(false)

    const pick = (event: SampledEvent) => {
        settledRef.current = true
        setOpen(false)
        onPick(event)
    }

    const wait = async () => {
        if (!onWaitForEvent || waiting) return
        setWaiting(true)
        try {
            const event = await onWaitForEvent()
            if (event && !settledRef.current) {
                settledRef.current = true
                setOpen(false)
                onPick(event)
            }
        } catch {
            // Callers surface their own error before rejecting; swallow so the fire-and-forget
            // `void wait()` never becomes an unhandled rejection.
        } finally {
            setWaiting(false)
        }
    }

    const handleOpenChange = (next: boolean) => {
        setOpen(next)
        onOpenChange?.(next)
        if (next) {
            settledRef.current = false
            if (autoWaitOnOpen && onWaitForEvent) void wait()
        } else {
            // A wait resolving after the popover closed must not fire onPick.
            settledRef.current = true
        }
    }

    const content = (
        <div className="w-[280px]">
            {onWaitForEvent && (
                <button
                    type="button"
                    onClick={wait}
                    disabled={waiting}
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded border-0 bg-transparent px-2.5 py-2 text-left hover:bg-[var(--ag-colorFillTertiary)] disabled:cursor-default"
                >
                    {waiting ? (
                        <Spin size="small" />
                    ) : (
                        <ClockCountdown size={16} className="text-[var(--ag-colorTextSecondary)]" />
                    )}
                    <span className="min-w-0 flex-1">
                        <span className="block text-xs text-[var(--ag-colorText)]">
                            {waiting ? "Waiting for an event…" : waitLabel}
                        </span>
                        {waitHint && !waiting && (
                            <span className="block text-[11px] text-[var(--ag-colorTextTertiary)]">
                                {waitHint}
                            </span>
                        )}
                    </span>
                </button>
            )}

            <div className="mb-1 mt-1.5 px-2.5 text-[10px] uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
                Recent events
            </div>
            {recentEvents.length === 0 ? (
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                        <span className="text-[11px] text-[var(--ag-colorTextTertiary)]">
                            None captured yet
                        </span>
                    }
                    className="!my-2"
                />
            ) : (
                <div className="flex flex-col">
                    {recentEvents.map((event) => (
                        <button
                            key={event.id}
                            type="button"
                            onClick={() => pick(event)}
                            className="flex cursor-pointer items-center gap-2.5 rounded border-0 bg-transparent px-2.5 py-1.5 text-left hover:bg-[var(--ag-colorFillTertiary)]"
                        >
                            <Lightning size={15} className="text-[var(--ag-colorTextSecondary)]" />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs text-[var(--ag-colorText)]">
                                    {event.label}
                                    {event.preview ? ` · ${event.preview}` : ""}
                                </span>
                                {event.timeAgo && (
                                    <span className="block text-[11px] text-[var(--ag-colorTextTertiary)]">
                                        {event.timeAgo}
                                    </span>
                                )}
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )

    return (
        <Popover
            open={open}
            onOpenChange={handleOpenChange}
            trigger="click"
            placement={placement}
            content={content}
        >
            {trigger}
        </Popover>
    )
}
