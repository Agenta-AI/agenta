import type {ReactNode} from "react"

import {cn} from "@/lib/utils"

export type StatusTone = "running" | "live" | "attention" | "failed" | "muted"

/**
 * Distinct states, distinguishable without reading the label: the accent means "act on this",
 * success means "healthy and warm", muted means "nothing is happening here". `live` and `muted`
 * must never collapse to the same treatment — a warm session and an ended one are opposites, and
 * rendering both as the same grey pill is what made "live" read as inert.
 *
 * `failed` is the one tone that means something went wrong. It is separate from `attention`
 * because the accent asks for a look while red reports a fault, and an automation that stopped
 * failing should visibly stop being red.
 */
const TONES: Record<StatusTone, string> = {
    running: "border-primary/40 text-primary bg-primary/10",
    live: "border-success/40 text-success bg-success/10",
    attention: "border-primary/40 text-primary bg-primary/10",
    failed: "border-destructive/40 text-destructive bg-destructive/10",
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
