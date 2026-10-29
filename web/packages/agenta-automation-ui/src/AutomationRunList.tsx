import {useMemo} from "react"

import {type TriggerDelivery} from "@agenta/entities/gatewayTrigger"

import {AutomationRunRow} from "./AutomationRunRow"
import {runGroups, type RunGrouping} from "./runListView"
import {
    AutomationRunHistoryEmpty,
    AutomationRunHistoryError,
    AutomationRunListSkeleton,
} from "./states/AutomationRunStates"

/**
 * The runs, grouped by the day they ran on, in the one column that owns their scroll.
 *
 * Day is the default grouping because a run's own row states only a time, so the heading above
 * it is what makes that time mean anything. The cut itself lives in `runGroups`, so the shape is
 * testable without rendering.
 *
 * The column is bounded by its parent and scrolls internally, so picking an old run does not
 * scroll the pane beside it out of view.
 */
export const AutomationRunList = ({
    runs,
    grouping = "day",
    filtered = false,
    selectedId,
    isLoading,
    error,
    onSelect,
    onRetry,
}: {
    runs: TriggerDelivery[]
    /** What the headings cut the list by. */
    grouping?: RunGrouping
    /** The runs were narrowed by the menu — an empty list is a filter's doing, not a new automation. */
    filtered?: boolean
    selectedId: string | null
    isLoading: boolean
    error?: unknown
    onSelect: (delivery: TriggerDelivery) => void
    onRetry?: () => void
}) => {
    const groups = useMemo(() => runGroups(runs, grouping), [grouping, runs])

    // `ag-scroll-quiet`: the bar stays invisible until the pointer is in the column. A permanent
    // one sat over the times and clipped them to "17:0".
    return (
        <div className="ag-scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {isLoading ? (
                <AutomationRunListSkeleton />
            ) : error ? (
                <AutomationRunHistoryError onRetry={onRetry} />
            ) : groups.length ? (
                groups.map((group) => (
                    <section key={group.key} className="mb-1 last:mb-0">
                        {group.label ? (
                            <h2 className="m-0 flex items-center gap-1.5 pb-1 pl-2.5 pt-3 text-[12px] font-medium capitalize text-muted-foreground">
                                {group.label}
                            </h2>
                        ) : null}
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
                <AutomationRunHistoryEmpty filtered={filtered} />
            )}
        </div>
    )
}
