import {Skeleton} from "@agenta/ui/ui"

import {STATS_WINDOW_DAYS, type AutomationStats} from "./useAutomationStats"

/**
 * The three numbers above the list: how many automations there are, and how the last week's runs
 * went.
 *
 * Each card names its own window because the three do not share one — the total is every
 * automation that exists, the outcomes are seven days — and a row of bare numbers would invite
 * reading 46 and 3 as a split of 4.
 *
 * A count is a claim, so nothing is printed until the query behind it has answered: `—` while it
 * loads, and a trailing `+` when the window held more deliveries than one page, where the number
 * is a floor rather than a total.
 */
export const AutomationStatCards = ({stats}: {stats: AutomationStats}) => (
    <div className="mb-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <StatCard
            label="Total automations"
            value={stats.total}
            note={`${stats.working} working`}
            ready
        />
        <StatCard
            label={`Successful · ${STATS_WINDOW_DAYS}d`}
            value={stats.succeeded}
            ready={stats.ready}
            atLeast={stats.truncated}
        />
        <StatCard
            label={`Failed · ${STATS_WINDOW_DAYS}d`}
            value={stats.failed}
            ready={stats.ready}
            atLeast={stats.truncated}
        />
    </div>
)

const StatCard = ({
    label,
    value,
    note,
    ready,
    atLeast = false,
}: {
    label: string
    value: number
    /**
     * A second, smaller fact on the number's own line — how many of the total are on.
     * Beside the number rather than under it, so one card carrying it does not make all three
     * taller.
     */
    note?: string
    ready: boolean
    /** The real number is this or higher — the window was capped. */
    atLeast?: boolean
}) => (
    <div className="min-w-0 rounded-lg border border-solid border-border bg-card px-4 py-3">
        <p className="m-0 truncate text-[13px] text-muted-foreground">{label}</p>
        {ready ? (
            <p className="m-0 mt-1.5 flex items-baseline gap-2 text-[26px] font-medium leading-none text-foreground">
                <span>
                    {value}
                    {atLeast ? <span className="text-muted-foreground">+</span> : null}
                </span>
                {note ? (
                    <span className="truncate text-[13px] font-normal text-muted-foreground">
                        {note}
                    </span>
                ) : null}
            </p>
        ) : (
            <Skeleton className="mt-1.5 h-[26px] w-12" />
        )}
    </div>
)
