import {Button, SkeletonBlock} from "@agenta/ui/ui"
import {Funnel, MagnifyingGlass} from "@phosphor-icons/react"

/**
 * Designed states for the automations screens.
 *
 * The list's loading state is not here: `@agenta/ui/list-table` draws its own skeleton in the
 * real columns, so a second copy of them cannot drift from the table.
 *
 * None of these carries a top margin: each stands where the table would, so the search bar sits
 * the same distance above whatever is showing.
 */
/**
 * The table has rows, but none the reader asked for.
 *
 * Distinct from the project having no automations at all, which the host app teaches with its own
 * onboarding rather than a state here: a project with automations that a filter has hidden must
 * not be told it has none, and the way out is the control that narrowed it — so the state
 * carries that action rather than leaving the reader to find which of five rows is set.
 *
 * It sits INSIDE the table, under the header row, because the columns are still true — what is
 * missing is rows, not the table.
 */
export const AutomationListNoMatch = ({
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
            {term ? `Nothing matches \u201C${term}\u201D` : "No automation matches these filters"}
        </p>
        <p className="m-0 max-w-[42ch] text-[13px] leading-snug text-muted-foreground">
            {term
                ? "Try a shorter search, or check the filters — they narrow this list too."
                : "Every automation is hidden by the filters on this list."}
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

/** Mirrors the detail body's own rhythm — identity, meta row, field stack — at its measurements. */
export const AutomationDetailSkeleton = () => (
    <div className="mx-auto w-full max-w-[760px] px-8 pb-[70px]" aria-hidden>
        {/* Identity: name, then the description under it. */}
        <SkeletonBlock active className="h-[30px] w-1/2" />
        <SkeletonBlock active className="mt-1.5 h-4 w-2/3" />
        {/* The toggle / agent / edited facts row. */}
        <div className="mb-1 mt-4 flex items-center gap-3.5">
            <SkeletonBlock active className="h-5 w-9 rounded-full" />
            <SkeletonBlock active className="h-4 w-24" />
            <SkeletonBlock active className="h-4 w-28" />
        </div>
        {/* The three fields below them. */}
        <div className="mt-[26px] flex flex-col gap-[22px]">
            {Array.from({length: 3}, (_, i) => (
                <div key={i} className="flex flex-col gap-[7px]">
                    <SkeletonBlock active className="h-3.5 w-20" />
                    <SkeletonBlock active className="h-[38px] w-full rounded-[9px]" />
                    <SkeletonBlock active className="h-3 w-2/5" />
                </div>
            ))}
        </div>
    </div>
)
