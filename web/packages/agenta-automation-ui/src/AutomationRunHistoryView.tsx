import {useCallback, useMemo, useState, type ReactNode} from "react"

import {type TriggerDelivery} from "@agenta/entities/gatewayTrigger"
import {useT} from "@agenta/i18n"
import automationsEditorCatalog from "@agenta/i18n/catalogs/automations.editor"
import automationsRunHistoryCatalog from "@agenta/i18n/catalogs/automations.runHistory"
import {useFilterMenuView} from "@agenta/ui/filter-menu"
import {ArrowSquareOut} from "@phosphor-icons/react"

import {type Automation} from "./automationModel"
import {AutomationRunFilterMenu} from "./AutomationRunFilterMenu"
import {AutomationRunList} from "./AutomationRunList"
import {AutomationRunPane} from "./AutomationRunPane"
import {ICON_LINK} from "./lib/interactive"
import {useElementWidth} from "./lib/useElementWidth"
import {cn} from "./lib/utils"
import {
    DEFAULT_RUN_LIST_VIEW,
    deriveRunList,
    isRunListFiltered,
    type RunListView,
} from "./runListView"
import {useAutomationRunPages, useAutomationRuns} from "./useAutomationRuns"

/** From this width of the VIEW (not the window) the list and the open run sit side by side. */
export const RUN_HISTORY_SPLIT_WIDTH = 700

/**
 * What this automation actually did — the runs, and the conversation each one had.
 *
 * A full-screen VIEW of the automation, not a page of its own: the runs belong to the automation
 * you are already looking at, so the URL stays put and `header` carries the way back. A route
 * would make "did it work?" a place you navigate to and lose your edits getting to.
 *
 * Two layouts, one tree: from `RUN_HISTORY_SPLIT_WIDTH` of the view's own width up (a widened
 * panel, a page; never the window, which a 440px panel shares) the list narrows to a full-height column beside the run,
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
    frame = "page",
    runHistoryHref,
    sessionHref,
    runNow,
    initialRunId,
}: {
    automation: Automation | null
    /** The way back to the automation — rendered above the list, on its own grid. */
    header?: ReactNode
    /** The run's transcript, given its session — the host's chat surface. */
    renderConversation: (sessionId: string) => ReactNode
    /**
     * Where it sits. A page centres the single-column list on the page's 760px line; a drawer
     * already is the column, so the list fills it edge to edge on the drawer's own gutters. The
     * panel is a column too, and it has no filter menu: the full page keeps the filters.
     */
    frame?: "page" | "drawer" | "panel"
    /** The full run history page. Given, the panel shows an icon that opens it in a new tab. */
    runHistoryHref?: string
    /** A run's session page. Given, an open run shows an icon that opens it in a new tab. */
    sessionHref?: (sessionId: string) => string
    /** The "Run now" control of the empty history; the host owns how a run starts. */
    runNow?: ReactNode
    /** Open this run first (the automation view's "Last run"). */
    initialRunId?: string | null
}) => {
    const t = useT(automationsEditorCatalog, automationsRunHistoryCatalog)
    // The count line reads the capped recent query (shared with the card); the list pages.
    const {caption} = useAutomationRuns(automation)
    const {
        runs: allRuns,
        isLoading,
        error,
        refetch,
        hasMore,
        loadingMore,
        loadMore,
    } = useAutomationRunPages(automation)
    const filters = frame !== "panel"

    // Same split as the automations list: how the runs are cut is remembered, what they are
    // narrowed to is not.
    const [view, setView] = useFilterMenuView<RunListView>({
        key: "agenta:automation-runs:view",
        fallback: DEFAULT_RUN_LIST_VIEW,
        persist: ["group"],
    })
    const listView = filters ? view : DEFAULT_RUN_LIST_VIEW
    const runs = useMemo(() => deriveRunList(allRuns, listView), [allRuns, listView])
    const filtered = isRunListFiltered(listView)

    const [selectedId, setSelectedId] = useState<string | null>(initialRunId ?? null)
    // The newest run answers "did it work?", which is the question that opened this, so the view
    // opens on that run rather than on a list waiting to be clicked. A pick the user has made
    // wins; only an unresolved selection falls through to the newest.
    const [rootRef, width] = useElementWidth<HTMLDivElement>()
    const canSplit = width >= RUN_HISTORY_SPLIT_WIDTH
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
            ref={rootRef}
            data-layout={canSplit ? "split" : "single"}
            className={cn(
                "flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden",
                // With no run open the view is a single column, so it sits on the page's centre
                // line like every other screen — and the back link centres with it, on the same
                // 30px as the heading below. The split layout stays full-bleed: its rule divides
                // the window, not a column.
                frame === "page" && !showPane && "mx-auto max-w-[760px]",
                frame !== "page" && "pt-3",
            )}
        >
            {header}
            <div className="flex min-h-0 w-full min-w-0 flex-1 overflow-hidden">
                {showList ? (
                    <div
                        className={cn(
                            "flex min-h-0 flex-col",
                            showPane
                                ? "min-w-[240px] max-w-[380px] flex-[1_1_240px] border-0 border-r border-solid border-border pb-6 pr-4"
                                : "w-full min-w-0 flex-1 pb-6 pr-5",
                            // The heading's own 10px inset makes up the rest: 30px on a page's
                            // grid, the drawer header's 16px in a drawer.
                            frame === "page" ? "pl-5" : "pl-1.5",
                            frame === "page" && !showPane && "max-w-[760px]",
                        )}
                    >
                        <div className="flex shrink-0 items-center gap-2 pl-2.5">
                            <h1 className="m-0 min-w-0 flex-1 truncate text-[16px] font-semibold text-foreground">
                                {t("automations.editor.runHistory")}
                            </h1>
                            {filters ? (
                                <AutomationRunFilterMenu view={view} onChange={setView} />
                            ) : runHistoryHref ? (
                                <a
                                    href={runHistoryHref}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={t("automations.runHistory.openInNewTab")}
                                    title={t("automations.runHistory.openInNewTab")}
                                    className={cn(
                                        "flex shrink-0 items-center justify-center p-1 text-muted-foreground",
                                        ICON_LINK,
                                    )}
                                >
                                    <ArrowSquareOut aria-hidden size={15} />
                                </a>
                            ) : null}
                        </div>
                        {/* Empty until the deliveries land — the hook withholds the caption
                            rather than claiming "0 runs" off a query that has not run. The line
                            keeps its height so the list does not jump. */}
                        <p className="m-0 mb-2.5 mt-1 min-h-[18px] pl-2.5 text-[13px] text-muted-foreground">
                            {caption}
                        </p>
                        <AutomationRunList
                            runs={runs}
                            grouping={listView.group}
                            filtered={filtered}
                            selectedId={selected?.id ?? null}
                            isLoading={isLoading}
                            error={error}
                            onSelect={onSelect}
                            onRetry={refetch}
                            hasMore={hasMore}
                            loadingMore={loadingMore}
                            onEndReached={loadMore}
                            emptyAction={runNow}
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
                            sessionHref={sessionHref}
                            onBack={canSplit ? undefined : onBack}
                        />
                    </div>
                ) : null}
            </div>
        </div>
    )
}
