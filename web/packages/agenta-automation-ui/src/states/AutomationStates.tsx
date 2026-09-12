import {Button, SkeletonBlock} from "@agenta/ui/ui"
import {Funnel, Lightning, MagnifyingGlass} from "@phosphor-icons/react"
import {RefreshCw, TriangleAlert} from "lucide-react"

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
 * Distinct from {@link AutomationListEmpty}: a project with automations that a filter has hidden
 * must not be told it has none, and the way out is the control that narrowed it — so the state
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

/**
 * No automations at all.
 *
 * The one screen where the reader has to be told what an automation IS before "New automation"
 * means anything, so the line under the heading answers that rather than describing the button.
 *
 * Three example cards used to sit here. They were the only thing that ever set `?template=`, and
 * an example nobody picked is a screen asking the reader to choose before they know what they
 * are choosing between — the emptiest screen in the product is the wrong place for a decision.
 *
 * No button of its own either: "New automation" already sits in the page header, a few hundred
 * pixels above, and the same action twice on one screen reads as two different ones.
 */
export const AutomationListEmpty = () => (
    // Inside the table, under the header row, like {@link AutomationListNoMatch}: the columns
    // are still true, and a project with no automations is a table with no rows rather than a
    // different screen. The header above it is the frame, so this carries no card of its own.
    <div className="flex flex-col items-center justify-center gap-2.5 px-8 py-16 text-center">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-muted">
            <Lightning aria-hidden size={19} className="text-muted-foreground" />
        </span>
        <p className="m-0 text-[14px] font-medium text-foreground">No automations yet</p>
        <p className="m-0 max-w-[42ch] text-[13px] leading-snug text-muted-foreground">
            An automation runs one of your agents without you asking — on a schedule, or when
            something happens in an app you have connected.
        </p>
    </div>
)

export const AutomationListError = ({
    message = "Could not load automations.",
    onRetry,
}: {
    message?: string
    onRetry?: () => void
}) => (
    <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-solid border-border p-10 text-center">
        <TriangleAlert className="size-6 text-destructive" />
        <p className="m-0 text-[14px] font-medium text-foreground">{message}</p>
        {onRetry ? (
            <Button variant="outline" size="sm" className="text-xs font-normal" onClick={onRetry}>
                <RefreshCw className="size-3" />
                Try again
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
