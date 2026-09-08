import {Skeleton} from "@agenta/ui/ui"

import {STATS_WINDOW_DAYS, type AutomationStats} from "./useAutomationStats"

/**
 * The three numbers the list is worth stating, on one line above it.
 *
 * They were three cards, which spent a third of the screen restating what the table underneath
 * already showed — the total is the row count, and a reader who wants it can see it. As a line
 * the same facts cost nothing, and the two that the table CANNOT show (how last week's runs went)
 * keep their place.
 *
 * Failures read as a fault only when there are any: a red 0 is a warning about nothing.
 */
export const AutomationStatsLine = ({stats}: {stats: AutomationStats}) => (
    <p className="m-0 mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
        <span className="text-foreground">
            {stats.total} {stats.total === 1 ? "automation" : "automations"}
        </span>
        <Dot />
        <span>{stats.working} working</span>
        <Dot />
        {stats.ready ? (
            <>
                <span>
                    {stats.succeeded}
                    {stats.truncated ? "+" : ""} succeeded
                </span>
                <Dot />
                <span className={stats.failed > 0 ? "text-destructive" : undefined}>
                    {stats.failed}
                    {stats.truncated ? "+" : ""} failed
                </span>
                <span className="text-muted-foreground/70">· last {STATS_WINDOW_DAYS} days</span>
            </>
        ) : (
            <Skeleton className="h-3.5 w-40" />
        )}
    </p>
)

const Dot = () => (
    <span aria-hidden className="text-muted-foreground/50">
        ·
    </span>
)
