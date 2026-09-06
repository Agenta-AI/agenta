/**
 * The session filters as a BAR — the toolbar above the results, and the default browse shell on
 * every surface (#5833: a filter rail put a second sidebar inside the page). Same controls as
 * `SessionFiltersPanel`, same filter atoms; only the shell differs.
 *
 * ONE component, two densities, because the same page is viewed at both:
 * - from `lg`: every facet inline on one row — search, agent, status, and the two toggles. This is
 *   the shape #5833 shipped, and what a wide viewport has room for whichever app renders it.
 * - below `lg`: title row, search, a one-line status strip, and everything else (agent, the two
 *   toggles) behind a Filters popover carrying a count of what is on — the rail's stacked facets
 *   would otherwise push the list itself off the viewport.
 *
 * The title, where a surface passes one, always keeps its OWN row: inline with the search field it
 * reads as a control rather than the page heading, which is not what `PageLayout` does on the
 * surfaces that have one.
 */
import {useState, type ReactNode} from "react"

import {useSessionFilters} from "@agenta/sessions/state"
import {Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {FunnelIcon} from "@phosphor-icons/react"

import {
    SessionAgentControl,
    SessionArchivedControl,
    SessionModeControl,
    SessionSearchControl,
    SessionStatusChipsControl,
    SessionStatusControl,
} from "./controls/SessionFilterControls"

const FilterLabel = ({children}: {children: ReactNode}) => (
    <h2 className="m-0 text-xs font-medium text-colorTextTertiary">{children}</h2>
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
    const {agentId, mode, includeArchived} = useSessionFilters()
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
                the filters trigger, is phone-only) and would still spend a `gap-3` above search. */}
            <div
                className={`flex min-w-0 items-center gap-2 ${title || leading ? "" : "lg:hidden"}`}
            >
                {leading}
                {title ? (
                    // From `sm`, 24px is heading-3 — the rung `PageLayout` gives a desktop page
                    // title, and this bar IS the page header where there is no `PageLayout`. On a
                    // phone that rung eats the row, so the title drops to the 14px body ramp.
                    <h1 className="m-0 min-w-0 flex-1 truncate text-[14px] font-semibold leading-[1.5714285714285714] text-colorText sm:text-[24px] sm:leading-[1.3333333333333333]">
                        {title}
                    </h1>
                ) : (
                    <span className="flex-1 lg:hidden" />
                )}

                <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            aria-label="Filters"
                            className="box-border flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md border-0 bg-colorFillQuaternary px-2 text-xs text-colorTextSecondary outline-none transition-colors hover:bg-colorFillSecondary hover:text-colorText focus-visible:text-colorText focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring lg:hidden"
                        >
                            <FunnelIcon size={14} weight={activeCount ? "fill" : "regular"} />
                            Filters
                            {activeCount ? (
                                <span className="rounded bg-colorFillSecondary px-1 py-0.5 text-[11px] leading-none text-colorText">
                                    {activeCount}
                                </span>
                            ) : null}
                        </button>
                    </PopoverTrigger>
                    {/* Anchored to the trigger rather than a bottom sheet: the three facets in
                        here are short, and a sheet costs a full-height overlay plus its own
                        header to close what one tap outside already closes. */}
                    <PopoverContent
                        align="end"
                        sideOffset={6}
                        className="flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-4 p-4"
                    >
                        {showAgent ? (
                            <section className="flex flex-col gap-2">
                                <FilterLabel>Agent</FilterLabel>
                                <SessionAgentControl agents={agents ?? []} />
                            </section>
                        ) : null}

                        <section className="flex flex-col gap-2">
                            <FilterLabel>Show</FilterLabel>
                            <SessionModeControl size="sm" />
                        </section>

                        <section className="flex flex-col gap-2">
                            <FilterLabel>Include</FilterLabel>
                            <SessionArchivedControl size="sm" />
                        </section>
                    </PopoverContent>
                </Popover>
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
