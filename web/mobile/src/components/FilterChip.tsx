import type {ReactNode} from "react"

import {ListFilter, X} from "lucide-react"

import {cn} from "@/lib/utils"

/**
 * A toggleable filter, styled as one chip rather than a label plus a verb phrase — a separate
 * "show only these" link reads as a second control, and its demonstrative has no antecedent
 * while the filter is off and the rows are not on screen yet.
 *
 * The icon carries the affordance (funnel to apply, cross to clear) so the label can stay the
 * plain count it filters by.
 */
export const FilterChip = ({
    active,
    onToggle,
    label,
    children,
}: {
    active: boolean
    onToggle: () => void
    /** Spoken label — the visible text is only a count, which says nothing on its own. */
    label: string
    children: ReactNode
}) => (
    <button
        type="button"
        aria-pressed={active}
        aria-label={label}
        onClick={onToggle}
        className={cn(
            "inline-flex min-h-11 shrink-0 items-center gap-1.5 self-start rounded-full border px-3 text-xs font-medium",
            active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-primary/40 text-primary bg-primary/10",
        )}
    >
        {active ? (
            <X aria-hidden className="size-3.5" />
        ) : (
            <ListFilter aria-hidden className="size-3.5" />
        )}
        {children}
    </button>
)
