import type {ReactNode} from "react"

import {cn} from "@/lib/utils"

/**
 * The responsive content column — the breakpoint story for an app that now serves every
 * viewport, not just phones. Full-bleed chrome (borders, backgrounds, the scroller) stays on
 * the screen edge; the CONTENT inside it rides this centered, width-capped rail. On a phone
 * the cap never bites (`w-full`), so the phone layout is untouched by construction; on tablet
 * and desktop the reading surfaces stop stretching edge-to-edge.
 *
 * Default cap is the reading width (`max-w-3xl` — transcripts, lists). Screens with a wider
 * composition (Home's two-column grid) pass their own cap via className.
 */
export const ContentRail = ({className, children}: {className?: string; children: ReactNode}) => (
    <div className={cn("mx-auto w-full max-w-3xl", className)}>{children}</div>
)
