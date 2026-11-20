import {useEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {type TriggerDelivery} from "@agenta/entities/gatewayTrigger"
import {useT} from "@agenta/i18n"
import automationsEditorCatalog from "@agenta/i18n/catalogs/automations.editor"
import automationsModelCatalog from "@agenta/i18n/catalogs/automations.model"
import {Button} from "@agenta/ui/ui"

import {AutomationRunRow} from "./AutomationRunRow"
import {cn} from "./lib/utils"
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
    hasMore = false,
    loadingMore = false,
    onEndReached,
    emptyAction,
    phone = false,
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
    /** More runs wait on the server; the list asks for them when its end scrolls into view. */
    hasMore?: boolean
    loadingMore?: boolean
    onEndReached?: () => void
    /** The action under "No runs yet" (the host's "Run now"). Not shown for a filtered list. */
    emptyAction?: ReactNode
    /** Phone: rows and buttons are at least 44 px high. */
    phone?: boolean
}) => {
    const t = useT(automationsModelCatalog, automationsEditorCatalog)
    // The group labels are text, so the groups are cut again when the language changes.
    const groups = useMemo(() => runGroups(runs, grouping), [grouping, runs, t])
    const scrollerRef = useRef<HTMLDivElement>(null)
    // The end marker as state: it mounts again after an error and a retry, and the observer
    // follows it.
    const [end, setEnd] = useState<HTMLDivElement | null>(null)
    const endReached = useRef(onEndReached)
    endReached.current = onEndReached

    // The end of the list in view asks for the next page. The observer is made again when a page
    // finishes, so a page that adds no visible row (a filter hides it) still asks for the next.
    // Observed inside the list's own scroller, so it works the same in a panel and a page.
    useEffect(() => {
        if (!hasMore || loadingMore || !end || typeof IntersectionObserver === "undefined") return
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) endReached.current?.()
            },
            {root: scrollerRef.current, rootMargin: "200px 0px"},
        )
        observer.observe(end)
        return () => observer.disconnect()
    }, [end, hasMore, loadingMore])

    // `ag-scroll-quiet`: the bar stays invisible until the pointer is in the column. A permanent
    // one sat over the times and clipped them to "17:0".
    return (
        <div
            ref={scrollerRef}
            className="ag-scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
            {isLoading ? (
                <AutomationRunListSkeleton />
            ) : error && !groups.length ? (
                <AutomationRunHistoryError onRetry={onRetry} phone={phone} />
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
                                    phone={phone}
                                />
                            ))}
                        </div>
                    </section>
                ))
            ) : (
                <AutomationRunHistoryEmpty
                    filtered={filtered}
                    action={filtered ? undefined : emptyAction}
                />
            )}
            {/* A next page or a refresh failed: the loaded runs stay, with a retry under them. */}
            {error && groups.length ? (
                <div className="flex items-center gap-2 px-2.5 py-3 text-[13px] text-muted-foreground">
                    <span className="min-w-0 flex-1">{t("automations.editor.loadRunsFailed")}</span>
                    <Button
                        variant="outline"
                        size="sm"
                        className={cn("text-xs font-normal", phone && "h-11")}
                        onClick={onRetry}
                    >
                        {t("automations.editor.tryAgain")}
                    </Button>
                </div>
            ) : null}
            {/* Outside the rows: a filter that hides every loaded run still reads on. */}
            {hasMore && !isLoading && !error ? (
                <div ref={setEnd} data-testid="run-list-end">
                    {loadingMore ? <AutomationRunListSkeleton groups={1} rows={2} /> : null}
                </div>
            ) : null}
        </div>
    )
}
