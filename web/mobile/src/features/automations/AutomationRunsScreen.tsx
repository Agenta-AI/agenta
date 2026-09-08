import {useCallback, useMemo, useState} from "react"

import {type TriggerDelivery} from "@agenta/entities/gatewayTrigger"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {useMediaQuery} from "@/lib/useMediaQuery"
import {cn} from "@/lib/utils"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {AutomationBackLink} from "./AutomationBackLink"
import {AutomationRunList} from "./AutomationRunList"
import {AutomationRunPane} from "./AutomationRunPane"
import {useAutomationRuns} from "./useAutomationRuns"
import {useAutomations} from "./useAutomations"

/**
 * What this automation actually did — the runs, and the conversation each one had.
 *
 * The automation is resolved the same way the detail screen resolves it (scan both trigger
 * lists, take the kind from whichever answered), because the route carries only an id and this
 * screen has to open cold from a pasted link.
 *
 * Two layouts, one tree: from `SPLIT` up the list narrows to a full-height column beside the
 * run, divided from it by a single rule; below it the run REPLACES the list, because a 240px
 * list plus a transcript on a phone is two unusable halves. The pane owns the way back in that
 * case — see `AutomationRunPane`.
 *
 * With nothing selected the list is the whole screen rather than a stranded column, so the
 * heading and the caption travel WITH the list instead of sitting in the page header.
 */
export const AutomationRunsScreen = ({
    workspaceId,
    projectId,
    automationId,
}: {
    workspaceId: string
    projectId: string
    automationId: string
}) => {
    // FIRST — every @agenta/* entity query gates on the shared project atoms, so without this a
    // direct load of this URL leaves the deliveries and the conversation permanently disabled.
    useBindProjectContext(projectId)
    const base = `/w/${workspaceId}/p/${projectId}`

    const {automations, isLoading: listLoading} = useAutomations()
    const automation = useMemo(
        () => automations.find((candidate) => candidate.id === automationId) ?? null,
        [automations, automationId],
    )
    const {runs, caption, isLoading, error, refetch} = useAutomationRuns(automation)

    const [selectedId, setSelectedId] = useState<string | null>(null)
    const selected = useMemo(
        () => runs.find((delivery) => delivery.id === selectedId) ?? null,
        [runs, selectedId],
    )
    const onSelect = useCallback((delivery: TriggerDelivery) => {
        setSelectedId(delivery.id ?? null)
    }, [])
    const onBack = useCallback(() => setSelectedId(null), [])

    // The split needs a 240px list, a 20px gap and roughly 360px of transcript inside the page's
    // 32px gutters — about 700px of window. Below that the two panes share nothing usefully, so
    // the tree changes rather than the widths, which is why this is read in JS and not a
    // Tailwind breakpoint (see `PickerOverlay` for the same idiom).
    const canSplit = useMediaQuery("(min-width: 700px)")
    const showPane = Boolean(selected)
    const showList = !showPane || canSplit

    return (
        <>
            <PageTitle title="Run history" context={automation?.name} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    fill
                    header={
                        <div className="w-full shrink-0 px-5 pb-2 pt-[30px]">
                            <div className="flex min-w-0 items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <AutomationBackLink
                                    href={`${base}/automations/${automationId}`}
                                    label={automation?.name || "Automation"}
                                />
                            </div>
                        </div>
                    }
                >
                    <div className="flex min-h-0 w-full min-w-0 flex-1 overflow-hidden">
                        {showList ? (
                            <div
                                className={cn(
                                    "flex min-h-0 flex-col",
                                    showPane
                                        ? "min-w-[240px] max-w-[380px] flex-[1_1_240px] border-0 border-r border-solid border-border pb-6 pl-5 pr-4"
                                        : "mx-auto w-full min-w-0 max-w-[760px] flex-1 px-5 pb-6",
                                )}
                            >
                                <div className="flex shrink-0 items-center gap-2">
                                    <h1 className="m-0 min-w-0 flex-1 text-[16px] font-semibold text-foreground">
                                        Run history
                                    </h1>
                                </div>
                                {/* Empty until the deliveries land — the hook withholds the
                                    caption rather than claiming "0 runs" off a query that has not
                                    run. The line keeps its height so the list does not jump. */}
                                <p className="m-0 mb-2.5 mt-1 min-h-[18px] text-[13px] text-muted-foreground">
                                    {caption}
                                </p>
                                <AutomationRunList
                                    runs={runs}
                                    selectedId={selectedId}
                                    isLoading={listLoading || isLoading}
                                    error={error}
                                    onSelect={onSelect}
                                    onRetry={refetch}
                                />
                            </div>
                        ) : null}
                        {selected ? (
                            <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", showList && "pl-4")}>
                                <AutomationRunPane
                                    // Per run: the pane hosts a conversation engine, and a
                                    // swapped delivery must not inherit the previous run's
                                    // transcript state.
                                    key={selected.id ?? selected.event_id}
                                    delivery={selected}
                                    projectId={projectId}
                                    workspaceId={workspaceId}
                                    agentId={automation?.agentId ?? null}
                                    onBack={canSplit ? undefined : onBack}
                                />
                            </div>
                        ) : null}
                    </div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
