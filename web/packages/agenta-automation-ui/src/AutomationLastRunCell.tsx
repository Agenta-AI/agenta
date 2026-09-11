import {timeAgo} from "@agenta/shared/utils"
import {SkeletonBlock} from "@agenta/ui/ui"

import {type Automation} from "./automationModel"
import {runDotClass} from "./runModel"
import {useAutomationRuns} from "./useAutomationRuns"

/** When an automation last ran and how often — Status says it is on, this says it is doing anything. */
export const AutomationLastRunCell = ({automation}: {automation: Automation}) => {
    const {runs, recentCount, counted, isLoading} = useAutomationRuns(automation)
    const newest = runs[0]

    if (isLoading) {
        return (
            <span className="flex flex-col gap-1" aria-hidden>
                <SkeletonBlock active className="h-3.5 w-14" />
                <SkeletonBlock active className="h-3 w-10" />
            </span>
        )
    }

    if (!newest) {
        return <span className="text-[13px] text-muted-foreground">Never</span>
    }

    const at = Date.parse(newest.created_at ?? "")
    const when = Number.isFinite(at) ? timeAgo(at) : "—"

    return (
        <span className="flex min-w-0 flex-col">
            <span className="flex min-w-0 items-center gap-[7px]">
                {/* The newest run's colour, so a failed last run shows from the list. */}
                <span
                    aria-hidden
                    className={`size-1.5 shrink-0 rounded-full ${runDotClass(newest)}`}
                />
                <span
                    className="truncate text-[13px] text-foreground"
                    title={newest.created_at ?? undefined}
                >
                    {when}
                </span>
            </span>
            {counted ? (
                <span className="truncate text-[12px] text-muted-foreground">
                    {recentCount === 1 ? "1 run" : `${recentCount} runs`} in 30 days
                </span>
            ) : null}
        </span>
    )
}
