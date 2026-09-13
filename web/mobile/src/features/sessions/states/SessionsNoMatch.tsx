import {Funnel, MagnifyingGlass} from "@phosphor-icons/react"

import {Button} from "@/components/ui/button"

/**
 * The list has sessions, but none the reader asked for.
 *
 * Distinct from `SessionsEmpty`: a project with sessions that a filter has hidden must not be
 * told it has none, and the way out is the control that narrowed it — so this carries the action
 * rather than leaving the reader to work out which of four rows is set.
 */
export const SessionsNoMatch = ({
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
            {term ? `Nothing matches “${term}”` : "No session matches these filters"}
        </p>
        <p className="m-0 max-w-[42ch] text-[13px] leading-snug text-muted-foreground">
            {term
                ? "Try a shorter search, or check the filters — they narrow this list too."
                : "Every session is hidden by the filters on this list."}
        </p>
        {onClear ? (
            <Button
                size="sm"
                variant="outline"
                className="mt-1 text-xs font-normal"
                onClick={onClear}
            >
                {term ? "Clear search" : "Reset filters"}
            </Button>
        ) : null}
    </div>
)
