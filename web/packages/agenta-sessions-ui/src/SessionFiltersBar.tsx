/**
 * The session filters as a BAR — the toolbar above the results, and the default browse shell on
 * every surface (#5833: a filter rail put a second sidebar inside the page). Same controls as
 * `SessionFiltersPanel`, same filter atoms; only the shell differs.
 *
 * ONE component, two densities, because the same page is viewed at both:
 * - from `lg`: every facet inline on one row — search, agent, status, and the two toggles. This is
 *   the shape #5833 shipped, and what a wide viewport has room for whichever app renders it.
 * - below `lg`: title row, search, a one-line status strip, and everything else (agent, the two
 *   toggles) behind a Filters sheet carrying a count of what is on — the rail's stacked facets
 *   would otherwise push the list itself off the viewport.
 *
 * The title, where a surface passes one, always keeps its OWN row: inline with the search field it
 * reads as a control rather than the page heading, which is not what `PageLayout` does on the
 * surfaces that have one.
 */
import {useState, type ReactNode} from "react"

import {useSessionFilters} from "@agenta/sessions/state"
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
    SheetFooter,
} from "@agenta/ui/ui"
import {FunnelIcon} from "@phosphor-icons/react"

import {
    SessionAgentControl,
    SessionArchivedControl,
    SessionModeControl,
    SessionSearchControl,
    SessionStatusChipsControl,
    SessionStatusControl,
} from "./controls/SessionFilterControls"

const SheetLabel = ({children}: {children: ReactNode}) => (
    <h2 className="m-0 text-xs font-semibold uppercase tracking-wide text-colorTextTertiary">
        {children}
    </h2>
)

export interface SessionFiltersBarProps {
    /** Before the title — the surface's nav entry (mobile's drawer trigger). */
    leading?: ReactNode
    title?: string
    waitingCount: number | undefined
    /** The agent roster for the picker. Only `hideAgentFilter` hides it — see `showAgent`. */
    agents?: {id: string; name: string}[]
    /** The agent-scoped page fixes the agent from the route, so the picker would only lie. */
    hideAgentFilter?: boolean
    className?: string
}

export const SessionFiltersBar = ({
    leading,
    title,
    waitingCount,
    agents,
    hideAgentFilter,
    className,
}: SessionFiltersBarProps) => {
    const [open, setOpen] = useState(false)
    const {agentId, mode, includeArchived, setAgentId, setMode, setIncludeArchived} =
        useSessionFilters()
    // NOT gated on the roster having arrived: hiding the picker until the agents query resolves
    // shoves the status control ~200px sideways mid-render. An empty roster still offers
    // "All agents", which is the honest state while it loads.
    const showAgent = !hideAgentFilter
    const activeCount = (showAgent && agentId ? 1 : 0) + (mode ? 1 : 0) + (includeArchived ? 1 : 0)

    return (
        // Below `lg` the bar is a pinned header over its own scroller and needs the rule under it;
        // from `lg` it sits inside the page column, where the rule spans the bar's full width and
        // overhangs the row grid's gutters by 64px a side — so it goes.
        <div
            className={`box-border flex flex-col gap-3 border-x-0 border-t-0 border-b border-solid border-colorBorderSecondary px-4 pb-3 pt-3 lg:border-b-0 ${
                className ?? ""
            }`}
        >
            {/* With neither title nor leading this row is empty from `lg` (its only other child,
                the sheet trigger, is phone-only) and would still spend a `gap-3` above search. */}
            <div
                className={`flex min-w-0 items-center gap-2 ${title || leading ? "" : "lg:hidden"}`}
            >
                {leading}
                {title ? (
                    // 24px is heading-3, the same rung `PageLayout` gives a desktop page title —
                    // this bar IS the page header on a surface that has no `PageLayout`.
                    <h1 className="m-0 min-w-0 flex-1 truncate text-[24px] font-semibold leading-[1.3333333333333333] text-colorText">
                        {title}
                    </h1>
                ) : (
                    <span className="flex-1 lg:hidden" />
                )}

                <Sheet open={open} onOpenChange={setOpen}>
                    <SheetTrigger asChild>
                        <button
                            type="button"
                            aria-label="Filters"
                            className="box-border flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-colorFillQuaternary px-2.5 text-sm text-colorTextSecondary outline-none transition-colors hover:bg-colorFillSecondary hover:text-colorText focus-visible:text-colorText focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring lg:hidden"
                        >
                            <FunnelIcon size={16} weight={activeCount ? "fill" : "regular"} />
                            Filters
                            {activeCount ? (
                                <span className="rounded bg-colorFillSecondary px-1.5 py-0.5 text-xs leading-none text-colorText">
                                    {activeCount}
                                </span>
                            ) : null}
                        </button>
                    </SheetTrigger>
                    <SheetContent side="bottom" className="h-auto max-h-[80dvh] rounded-t-2xl">
                        <SheetHeader>
                            <SheetTitle>Filters</SheetTitle>
                        </SheetHeader>
                        <div className="flex flex-col gap-6 overflow-y-auto px-6 py-5">
                            {showAgent ? (
                                <section className="flex flex-col gap-2">
                                    <SheetLabel>Agent</SheetLabel>
                                    <SessionAgentControl agents={agents ?? []} />
                                </section>
                            ) : null}

                            <section className="flex flex-col gap-3">
                                <SheetLabel>Show</SheetLabel>
                                <SessionModeControl />
                            </section>

                            <section className="flex flex-col gap-3">
                                <SheetLabel>Include</SheetLabel>
                                <SessionArchivedControl />
                            </section>
                        </div>
                        {/* Only these three live in the sheet, so clearing here must not also wipe
                            the search and status the bar still shows. */}
                        <SheetFooter className="pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
                            <button
                                type="button"
                                disabled={!activeCount}
                                onClick={() => {
                                    // Only what this sheet actually offers: on an agent-scoped
                                    // page the agent comes from the route, and clearing it would
                                    // silently widen the list past the page it belongs to.
                                    if (showAgent) setAgentId(null)
                                    setMode(false)
                                    setIncludeArchived(false)
                                }}
                                className="box-border cursor-pointer rounded-lg border-0 bg-transparent px-3 py-1.5 text-sm text-colorTextSecondary disabled:cursor-default disabled:text-colorTextQuaternary"
                            >
                                Clear
                            </button>
                        </SheetFooter>
                    </SheetContent>
                </Sheet>
            </div>

            {/* The controls are their own row so the title above stays a heading; inside it they
                still lay out inline from `lg` — #5833's shape. */}
            <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
                <SessionSearchControl className="lg:w-64" />

                {/* From `lg` the facets sit inline instead of behind the sheet — #5833's row. The
                    agent control is `w-full` by design (it fills the sheet and the rail), so bound
                    here. */}
                <div className="hidden lg:flex lg:items-center lg:gap-3">
                    {showAgent ? (
                        <div className="w-48">
                            <SessionAgentControl agents={agents ?? []} />
                        </div>
                    ) : null}
                    <SessionStatusControl waitingCount={waitingCount} />
                    {/* Two different kinds of switch: one picks WHICH sessions, the other widens
                        the set. The tooltips carry that distinction now that no group headings
                        do. */}
                    <SessionModeControl />
                    <SessionArchivedControl />
                </div>

                <SessionStatusChipsControl waitingCount={waitingCount} className="lg:hidden" />
            </div>
        </div>
    )
}
