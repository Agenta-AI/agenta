import {CaretRight} from "@phosphor-icons/react"

import {cn} from "../foundation/utils/cn"

export interface CollapseCaretProps {
    /** Points down when true. Leave undefined under a parent that rotates `[data-slot=collapse-caret]`. */
    open?: boolean
    /** Glyph size in px. */
    size?: number
    className?: string
}

/** The one collapse/expand caret: Phosphor's regular right caret, turned 90° when open. */
function CollapseCaret({open, size = 12, className}: CollapseCaretProps) {
    return (
        <CaretRight
            aria-hidden
            data-slot="collapse-caret"
            size={size}
            className={cn(
                "shrink-0 text-muted-foreground transition-transform duration-[var(--duration-fast)] ease-[var(--ease-out)] motion-reduce:transition-none",
                open && "rotate-90",
                className,
            )}
        />
    )
}

export {CollapseCaret}
