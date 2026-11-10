import {CaretRight} from "@phosphor-icons/react"

import {cn} from "./utils"

export interface CollapseCaretProps {
    /** Points down when true. Leave undefined under a parent that rotates `[data-slot=collapse-caret]`. */
    open?: boolean
    /** Glyph size in px. */
    size?: number
    className?: string
}

/** The one collapse/expand caret: a filled right caret that turns 90° when open. */
function CollapseCaret({open, size = 12, className}: CollapseCaretProps) {
    return (
        <CaretRight
            aria-hidden
            data-slot="collapse-caret"
            weight="fill"
            size={size}
            className={cn(
                "shrink-0 text-[var(--ag-zinc-5)] transition-transform duration-150 motion-reduce:transition-none",
                open && "rotate-90",
                className,
            )}
        />
    )
}

export {CollapseCaret}
