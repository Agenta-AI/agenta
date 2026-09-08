import {useMemo} from "react"

import {type TriggerDelivery} from "@agenta/entities/gatewayTrigger"

import {AutomationRunRow} from "./AutomationRunRow"
import {runDayGroups} from "./runModel"
import {
    AutomationRunHistoryEmpty,
    AutomationRunHistoryError,
    AutomationRunListSkeleton,
} from "./states/AutomationRunStates"

/**
 * The runs, grouped by the day they ran on, in the one column that owns their scroll.
 *
 * Day grouping is the presentation, not a filter: a run's own row states only a time, so the
 * heading above it is what makes that time mean anything. Grouping lives in `runDayGroups` so
 * the shape is testable without rendering.
 *
 * The column is bounded by its parent and scrolls internally, so picking an old run does not
 * scroll the pane beside it out of view.
 */
export const AutomationRunList = ({
    runs,
    selectedId,
    isLoading,
    error,
    onSelect,
    onRetry,
}: {
    runs: TriggerDelivery[]
    selectedId: string | null
    isLoading: boolean
    error?: unknown
    onSelect: (delivery: TriggerDelivery) => void
    onRetry?: () => void
}) => {
    const groups = useMemo(() => runDayGroups(runs), [runs])

    return (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {isLoading ? (
                <AutomationRunListSkeleton />
            ) : error ? (
                <AutomationRunHistoryError onRetry={onRetry} />
            ) : groups.length ? (
                groups.map((group) => (
                    <section key={group.key} className="mb-1 last:mb-0">
                        <h2 className="m-0 flex items-center gap-1.5 pb-1 pl-2.5 pt-3 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                            {group.label}
                        </h2>
                        <div className="flex flex-col gap-0.5">
                            {group.runs.map((delivery) => (
                                <AutomationRunRow
                                    key={delivery.id ?? delivery.event_id}
                                    delivery={delivery}
                                    selected={delivery.id === selectedId}
                                    onSelect={() => onSelect(delivery)}
                                />
                            ))}
                        </div>
                    </section>
                ))
            ) : (
                <AutomationRunHistoryEmpty />
            )}
        </div>
    )
}
