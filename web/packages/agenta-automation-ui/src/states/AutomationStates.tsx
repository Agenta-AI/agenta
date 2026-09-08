import {Button, Skeleton} from "@agenta/ui/ui"
import {Lightning, MagnifyingGlass, Funnel} from "@phosphor-icons/react"
import {RefreshCw, TriangleAlert} from "lucide-react"

import {AutomationTemplateCard} from "../AutomationTemplateCard"
import {AUTOMATION_TEMPLATES, type AutomationTemplate} from "../templates"

/**
 * Designed states for the automations screens.
 *
 * The list skeleton mirrors the real table — the same shell, the same four-column grid, the same
 * 13/14 row padding — so the rows do not shift when the two trigger queries land.
 *
 * None of these carries a top margin: each stands where the table would, so the search bar sits
 * the same distance above whatever is showing.
 */

const GRID =
    "grid gap-3 [grid-template-columns:minmax(120px,1.7fr)_118px_minmax(120px,1.5fr)_minmax(80px,1fr)]"

export const AutomationListSkeleton = ({rows = 5}: {rows?: number}) => (
    <div className="overflow-hidden rounded-md border border-solid border-border" aria-hidden>
        <div className="overflow-x-auto">
            <div className="min-w-[544px]">
                <div
                    className={`${GRID} border-0 border-b border-solid border-border bg-muted/40 px-3.5 py-[9px]`}
                >
                    {Array.from({length: 4}, (_, i) => (
                        <Skeleton key={i} className="h-3 w-16" />
                    ))}
                </div>
                {Array.from({length: rows}, (_, i) => (
                    <div
                        key={i}
                        className={`${GRID} items-center border-0 border-b border-solid border-border px-3.5 py-[13px] last:border-b-0`}
                    >
                        <Skeleton className="h-3.5 w-4/5" />
                        <Skeleton className="h-3.5 w-16" />
                        <Skeleton className="h-3.5 w-3/5" />
                        <Skeleton className="h-3.5 w-2/3" />
                    </div>
                ))}
            </div>
        </div>
    </div>
)

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
            {term ? (
                <MagnifyingGlass size={19} aria-hidden />
            ) : (
                <Funnel size={19} aria-hidden />
            )}
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
 * No automations at all — the one screen where the reader has to be told what an automation IS
 * before a "New automation" button means anything. The three examples do that work: each names
 * a job rather than a trigger type, and picking one seeds the draft (W5).
 */
export const AutomationListEmpty = ({
    onSelectTemplate,
}: {
    onSelectTemplate: (template: AutomationTemplate) => void
}) => (
    <div className="rounded-md border border-solid border-border bg-card p-10 text-center">
        <span className="mb-3.5 inline-flex size-11 items-center justify-center rounded-[11px] bg-primary/10 text-primary">
            <Lightning size={22} weight="fill" aria-hidden />
        </span>
        <h2 className="m-0 mb-1.5 text-[17px] font-semibold text-foreground">No automations yet</h2>
        <p className="mx-auto mb-[22px] mt-0 max-w-[46ch] text-[14px] text-muted-foreground">
            An automation runs one of your agents without you asking. Start from an example, or
            build your own.
        </p>
        <div className="grid gap-3 text-left [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
            {AUTOMATION_TEMPLATES.map((template) => (
                <AutomationTemplateCard
                    key={template.id}
                    template={template}
                    onSelect={onSelectTemplate}
                />
            ))}
        </div>
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
        <Skeleton className="h-[30px] w-1/2" />
        <Skeleton className="mt-1.5 h-4 w-2/3" />
        {/* The toggle / agent / edited facts row. */}
        <div className="mb-1 mt-4 flex items-center gap-3.5">
            <Skeleton className="h-5 w-9 rounded-full" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-28" />
        </div>
        {/* The three fields below them. */}
        <div className="mt-[26px] flex flex-col gap-[22px]">
            {Array.from({length: 3}, (_, i) => (
                <div key={i} className="flex flex-col gap-[7px]">
                    <Skeleton className="h-3.5 w-20" />
                    <Skeleton className="h-[38px] w-full rounded-[9px]" />
                    <Skeleton className="h-3 w-2/5" />
                </div>
            ))}
        </div>
    </div>
)
