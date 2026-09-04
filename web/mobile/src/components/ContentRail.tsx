import type {ReactNode} from "react"

import {CHAT_COLUMN} from "@agenta/chat/assets"

import {cn} from "@/lib/utils"

/**
 * The responsive content column — the breakpoint story for an app that now serves every
 * viewport, not just phones. Full-bleed chrome (borders, backgrounds, the scroller) stays on
 * the screen edge; the CONTENT inside it rides this centered, width-capped rail. On a phone
 * the cap never bites (`w-full`), so the phone layout is untouched by construction; on tablet
 * and desktop the reading surfaces stop stretching edge-to-edge.
 *
 * Default cap is the shared `CHAT_COLUMN` (880px), the same reading width the desktop chat uses
 * — a local literal drifted a step narrower. Screens with a wider composition (Home's two-column
 * grid) pass their own cap via className.
 */
export const ContentRail = ({className, children}: {className?: string; children: ReactNode}) => (
    <div className={cn(CHAT_COLUMN, className)}>{children}</div>
)
