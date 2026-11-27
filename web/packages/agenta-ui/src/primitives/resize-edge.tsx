import * as React from "react"

import {cn} from "../foundation/utils/cn"

/**
 * The line of a resizable edge (a pane, the sidebar, the file tree), drawn the same everywhere.
 *
 * At rest the edge keeps its 1px `border-border-muted` line (the host draws it). This 2px line sits
 * over that border inside the host's grab strip and shows on hover, on keyboard focus and while
 * dragging, so the edge reads as thicker when it can be moved.
 *
 * The host strip needs the `group` class, `absolute`, `w-2` (8px) and `cursor-col-resize`, centred
 * on the border. Pass `className` for a host-specific drag state (for example a group variant).
 */
export function ResizeEdgeLine({active, className}: {active?: boolean; className?: string}) {
    return (
        <span
            aria-hidden
            className={cn(
                "absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-transparent transition-colors group-hover:bg-border-strong group-focus-visible:bg-ring",
                active && "bg-border-strong",
                className,
            )}
        />
    )
}
