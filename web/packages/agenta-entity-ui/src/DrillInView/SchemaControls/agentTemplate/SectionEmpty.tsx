import type {ReactNode} from "react"

import {cn} from "@agenta/ui/styles"

/**
 * The one empty state of an Agent tab section (STATE-01): a compact dashed box, one row tall,
 * with one quiet line. The section header's "+" is the way to add.
 */
export const SectionEmpty = ({children, className}: {children: ReactNode; className?: string}) => (
    <div
        className={cn(
            "box-border flex min-h-row-single items-center justify-center rounded-md px-3 py-1.5",
            "border border-dashed border-border-muted text-center text-meta text-muted-foreground",
            className,
        )}
    >
        {children}
    </div>
)
