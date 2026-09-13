import {Funnel, MagnifyingGlass} from "@phosphor-icons/react"

import {Button} from "@/components/ui/button"

/**
 * The project has agents, but none the reader asked for.
 *
 * Distinct from `AgentsEmpty`: a project whose agents a filter has hidden must not be told it
 * has none, and the way out is the control that narrowed it — so this carries the action rather
 * than leaving the reader to work out which of three rows is set.
 */
export const AgentsNoMatch = ({
    term,
    onClear,
}: {
    /** The search that matched nothing. Absent ⇒ the filters are what narrowed it. */
    term?: string
    onClear?: () => void
}) => (
    <div className="flex flex-col items-center justify-center gap-2.5 px-8 py-14 text-center">
        <span className="inline-flex size-10 items-center justify-center rounded-[10px] bg-muted text-muted-foreground">
            {term ? <MagnifyingGlass size={19} aria-hidden /> : <Funnel size={19} aria-hidden />}
        </span>
        <p className="m-0 text-[14px] font-medium text-foreground">
            {term ? `Nothing matches “${term}”` : "No agents match these filters"}
        </p>
        <p className="m-0 max-w-[42ch] text-[13px] leading-snug text-muted-foreground">
            {term
                ? "Try a shorter search, or check the filters — they narrow this list too."
                : "Try widening the filters, or including archived agents."}
        </p>
        {onClear ? (
            <Button
                size="sm"
                variant="outline"
                className="mt-1 text-xs font-normal"
                onClick={onClear}
            >
                {term ? "Clear search" : "Clear filters"}
            </Button>
        ) : null}
    </div>
)
