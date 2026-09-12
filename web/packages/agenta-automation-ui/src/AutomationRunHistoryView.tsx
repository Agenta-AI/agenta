import {useCallback, useMemo, useState, type ReactNode} from "react"

import {type TriggerDelivery} from "@agenta/entities/gatewayTrigger"
import {useFilterMenuView} from "@agenta/ui/filter-menu"

import {type Automation} from "./automationModel"
import {AutomationRunFilterMenu} from "./AutomationRunFilterMenu"
import {AutomationRunList} from "./AutomationRunList"
import {AutomationRunPane} from "./AutomationRunPane"
import {useMediaQuery} from "./lib/useMediaQuery"
import {cn} from "./lib/utils"
import {
    DEFAULT_RUN_LIST_VIEW,
    deriveRunList,
    isRunListFiltered,
    type RunListView,
} from "./runListView"
import {useAutomationRuns} from "./useAutomationRuns"

/**
 * What this automation actually did — the runs, and the conversation each one had.
 *
 * A full-screen VIEW of the automation, not a page of its own: the runs belong to the automation
 * you are already looking at, so the URL stays put and `header` carries the way back. A route
 * would make "did it work?" a place you navigate to and lose your edits getting to.
 *
 * Two layouts, one tree: from `SPLIT` up the list narrows to a full-height column beside the run,
 * divided from it by a single rule; below it the run REPLACES the list, because a 240px list plus
 * a transcript on a phone is two unusable halves. The pane owns the way back in that case.
 *
 * With nothing selected the list is the whole view rather than a stranded column, so the heading
 * and the caption travel WITH the list.
 */
export const AutomationRunHistoryView = ({
    automation,
    header,
    renderConversation,
}: {
    automation: Automation | null
    /** The way back to the automation — rendered above the list, on its own grid. */
    header?: ReactNode
    /** The run's transcript, given its session — the host's chat surface. */
    renderConversation: (sessionId: string) => ReactNode
}) => {
    const {runs: allRuns, caption, isLoading, error, refetch} = useAutomationRuns(automation)

    // Same split as the automations list: how the runs are cut is remembered, what they are
    // narrowed to is not.
    const [view, setView] = useFilterMenuView<RunListView>({
        key: "agenta:automation-runs:view",
        fallback: DEFAULT_RUN_LIST_VIEW,
        persist: ["group"],
    })
    const runs = useMemo(() => deriveRunList(allRuns, view), [allRuns, view])
    const filtered = isRunListFiltered(view)

    const [selectedId, setSelectedId] = useState<string | null>(null)
    // The newest run answers "did it work?", which is the question that opened this, so the view
    // opens on that run rather than on a list waiting to be clicked. A pick the user has made
    // wins; only an unresolved selection falls through to the newest.
    const canSplit = useMediaQuery("(min-width: 700px)")
    // Narrow layout only: going back has to mean "no run", which the fallback would otherwise
    // undo on the next render by re-selecting the newest.
    const [dismissed, setDismissed] = useState(false)
    const selected = useMemo(
        () =>
            dismissed
                ? null
                : (runs.find((delivery) => delivery.id === selectedId) ??
                  (canSplit ? runs[0] : null) ??
                  null),
        [canSplit, dismissed, runs, selectedId],
    )
    const onSelect = useCallback((delivery: TriggerDelivery) => {
        setSelectedId(delivery.id ?? null)
        setDismissed(false)
    }, [])
    const onBack = useCallback(() => setDismissed(true), [])

    const showPane = Boolean(selected)
    const showList = !showPane || canSplit

    return (
        <div
            className={cn(
                "flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden",
                // With no run open the view is a single column, so it sits on the page's centre
                // line like every other screen — and the back link centres with it, on the same
                // 30px as the heading below. The split layout stays full-bleed: its rule divides
                // the window, not a column.
                !showPane && "mx-auto max-w-[760px]",
            )}
        >
            {header}
            <div className="flex min-h-0 w-full min-w-0 flex-1 overflow-hidden">
                {showList ? (
                    <div
                        className={cn(
                            "flex min-h-0 flex-col",
                            showPane
                                ? "min-w-[240px] max-w-[380px] flex-[1_1_240px] border-0 border-r border-solid border-border pb-6 pl-5 pr-4"
                                : "w-full min-w-0 max-w-[760px] flex-1 pb-6 pl-5 pr-5",
                        )}
                    >
                        <div className="flex shrink-0 items-center gap-2 pl-2.5">
                            <h1 className="m-0 min-w-0 flex-1 truncate text-[16px] font-semibold text-foreground">
                                Run history
                            </h1>
                            <AutomationRunFilterMenu view={view} onChange={setView} />
                        </div>
                        {/* Empty until the deliveries land — the hook withholds the caption
                            rather than claiming "0 runs" off a query that has not run. The line
                            keeps its height so the list does not jump. */}
                        <p className="m-0 mb-2.5 mt-1 min-h-[18px] pl-2.5 text-[13px] text-muted-foreground">
                            {caption}
                        </p>
                        <AutomationRunList
                            runs={runs}
                            grouping={view.group}
                            filtered={filtered}
                            selectedId={selected?.id ?? null}
                            isLoading={isLoading}
                            error={error}
                            onSelect={onSelect}
                            onRetry={refetch}
                        />
                    </div>
                ) : null}
                {selected ? (
                    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", showList && "pl-4")}>
                        <AutomationRunPane
                            // Per run: the pane hosts a conversation engine, and a swapped
                            // delivery must not inherit the previous run's transcript state.
                            key={selected.id ?? selected.event_id}
                            delivery={selected}
                            renderConversation={renderConversation}
                            onBack={canSplit ? undefined : onBack}
                        />
                    </div>
                ) : null}
            </div>
        </div>
    )
}
