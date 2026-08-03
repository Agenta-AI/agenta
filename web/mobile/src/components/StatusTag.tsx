import type {ReactNode} from "react"

import {cn} from "@/lib/utils"

export type StatusTone = "running" | "live" | "attention" | "muted"

const TONES: Record<StatusTone, string> = {
    // A turn is executing right now — the only tone that earns the accent colour.
    running: "border-primary/40 text-primary bg-primary/10",
    // The session is warm but idle: real state, not something to act on.
    live: "border-border text-muted-foreground bg-muted/40",
    attention: "border-primary/40 text-primary bg-primary/10",
    muted: "border-border text-muted-foreground bg-muted/40",
}

/**
 * The one status tag across mobile. Statuses used to render as bare coloured words next to a
 * title, which read as part of the sentence rather than as state — a pill with its own border
 * and background separates them.
 *
 * `dot` is reserved for the two tones that mean "something is happening", so the tag carries the
 * distinction without relying on colour alone.
 */
export const StatusTag = ({
    tone,
    dot = false,
    children,
    className,
}: {
    tone: StatusTone
    dot?: boolean
    children: ReactNode
    className?: string
}) => (
    <span
        className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs leading-none font-medium",
            TONES[tone],
            className,
        )}
    >
        {dot ? <span aria-hidden className="size-1.5 rounded-full bg-current" /> : null}
        {children}
    </span>
)
