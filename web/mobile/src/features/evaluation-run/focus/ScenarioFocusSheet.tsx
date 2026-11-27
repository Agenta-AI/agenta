import {useEffect, useMemo, useState} from "react"

import {ValueViewProvider, type ValueViewMode} from "@agenta/chat/value-view"
import {evaluationRunQueryAtomFamily, type RunHeader} from "@agenta/entities/evaluationRun"
import type {RunColumnGroup} from "@agenta/entities/evaluationRun/etl"
import {useT} from "@agenta/i18n"
import focusCatalog from "@agenta/i18n/catalogs/evaluations.scenarioFocus"
import {LoadError} from "@agenta/ui/components/presentational"
import {cn} from "@agenta/ui/styles"
import {Sheet, SheetContent, SheetDescription, SheetTitle} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {chatProseClassName, markdownIcons} from "@/features/chat/AssistantMarkdown"

import type {ScenarioRow} from "../scenarios/scenarioColumns"
import {ScenariosLoadMoreError} from "../scenarios/states/ScenariosLoadMoreError"
import {ScenarioValuesError} from "../scenarios/states/ScenarioValuesError"
import {ScenariosRefreshError} from "../scenarios/states/ScenariosRefreshError"
import {useRunScenarios} from "../scenarios/useRunScenarios"
import {useScenarioGroupLabels} from "../scenarios/useScenarioGroupLabels"

import {ScenarioFocusBody} from "./ScenarioFocusBody"
import {ScenarioFocusHeader} from "./ScenarioFocusHeader"
import {ScenarioFocusMetadataTab} from "./ScenarioFocusMetadataTab"
import {
    evaluatorOriginsOf,
    scenarioEvaluatorResults,
    ScenarioFocusResultsTab,
    type ScenarioEvaluatorResult,
} from "./ScenarioFocusResultsTab"
import {ScenarioFocusSummaryLine} from "./ScenarioFocusSummaryLine"
import {ScenarioFocusTabs, type ScenarioFocusTab} from "./ScenarioFocusTabs"
import {ScenarioFocusTestsetLink} from "./ScenarioFocusTestsetLink"
import {scenarioNoun} from "./scenarioNoun"
import {scenarioPayload, scenarioTabPayload} from "./scenarioPayload"
import {ScenarioPayloadView} from "./ScenarioPayloadView"
import {ScenarioFocusNotFound} from "./states/ScenarioFocusNotFound"
import {ScenarioFocusSkeleton} from "./states/ScenarioFocusSkeleton"
import {useExpectedColumn} from "./useExpectedColumn"
import {useFocusScenarioParam} from "./useFocusScenarioParam"
import {useScenarioStepper} from "./useScenarioStepper"
import {useScenarioTrace} from "./useScenarioTrace"

const VALUE_VIEW = {markdownClassName: chatProseClassName, markdownIcons}

/** The open test case's tabs; a component of its own so its trace query keys on the row. */
const ScenarioFocusContent = ({
    runId,
    kind,
    row,
    groups,
    labels,
    results,
    onRetry,
    tab,
    mode,
}: {
    runId: string
    kind: RunHeader["kind"]
    row: ScenarioRow
    groups: RunColumnGroup[]
    labels: Record<string, string>
    results: ScenarioEvaluatorResult[]
    onRetry: () => void
    tab: ScenarioFocusTab
    mode: ValueViewMode
}) => {
    const t = useT(focusCatalog)
    const trace = useScenarioTrace(row)
    const expectedKey = useExpectedColumn(runId)
    if (mode === "raw") {
        const payload = scenarioTabPayload(scenarioPayload(row, groups, labels), tab, row)
        return (
            <ScenarioPayloadView
                payload={JSON.stringify(payload, null, 2)}
                label={t("evaluations.scenarioFocus.asJson")}
            />
        )
    }
    if (tab === "results") {
        return (
            <div className="flex flex-col gap-6">
                {row.valuesFailed ? <ScenarioValuesError onRetry={onRetry} /> : null}
                <ScenarioFocusResultsTab results={results} />
            </div>
        )
    }
    if (tab === "metadata") return <ScenarioFocusMetadataTab row={row} trace={trace} />
    return (
        <ScenarioFocusBody
            row={row}
            groups={groups}
            onRetry={onRetry}
            awaitingRun={kind === "human"}
            trace={trace}
            expectedKey={expectedKey}
        />
    )
}

/**
 * One scenario of the run in a drawer, read only. The address names it (`focusScenarioId`).
 * A page must load this file with `next/dynamic` and render it only once a scenario is focused.
 * The drawer reads pages until it finds the scenario; Next on the last loaded row reads one more.
 * The view (full screen, the open tab, Formatted or Raw) stays as the user moves between
 * scenarios.
 */
export const ScenarioFocusSheet = ({
    runId,
    header,
    poll,
    compareSlot = null,
}: {
    runId: string
    header: RunHeader
    /** While runs are compared: the run's slot, so the drawer names the run in its color. */
    compareSlot?: number | null
    /** False while the Scenarios or Annotate tab is open: it already reads the live rows again. */
    poll: boolean
}) => {
    const [scenarioId, setScenarioId] = useFocusScenarioParam(runId)
    const scenarios = useRunScenarios(runId, {poll})
    const labels = useScenarioGroupLabels(scenarios.columnGroups)
    const {rows, hasMore, loadMore, isPending, isFetchingMore, loadMoreError} = scenarios
    const {current, onNext} = useScenarioStepper({
        rows,
        scenarioId,
        setScenarioId,
        hasMore,
        loadMore,
        loadMoreError,
    })

    // The scenario is on a page that is not loaded yet: read pages until it shows up.
    useEffect(() => {
        if (!scenarioId || current || !hasMore || isPending || isFetchingMore || loadMoreError)
            return
        loadMore()
    }, [scenarioId, current, hasMore, isPending, isFetchingMore, loadMoreError, loadMore])

    const [fullScreen, setFullScreen] = useState(false)
    const [tab, setTab] = useState<ScenarioFocusTab>("io")
    const [mode, setMode] = useState<ValueViewMode>("formatted")
    const steps = useAtomValue(evaluationRunQueryAtomFamily(runId)).data?.data?.steps
    const origins = useMemo(() => evaluatorOriginsOf(steps ?? []), [steps])
    const results = useMemo(
        () =>
            current
                ? scenarioEvaluatorResults(current, scenarios.columnGroups, labels, origins)
                : [],
        [current, scenarios.columnGroups, labels, origins],
    )
    const payload = useMemo(
        () =>
            current
                ? JSON.stringify(scenarioPayload(current, scenarios.columnGroups, labels), null, 2)
                : "",
        [current, scenarios.columnGroups, labels],
    )

    const noun = scenarioNoun(header.kind)
    const notFound = !current && !hasMore && !isPending && !isFetchingMore && !scenarios.isError

    return (
        <Sheet open={Boolean(scenarioId)} onOpenChange={(open) => !open && setScenarioId(null)}>
            <SheetContent
                side="responsive"
                aria-label={noun}
                className={cn(
                    "max-lg:inset-0 max-lg:h-dvh max-lg:max-h-none max-lg:rounded-none",
                    fullScreen
                        ? "lg:max-w-none lg:[--ag-sheet-responsive-width:calc(100vw-1rem)]"
                        : "lg:[--ag-sheet-responsive-width:720px]",
                )}
            >
                <SheetDescription className="sr-only">{`${noun} of ${header.name}`}</SheetDescription>
                {current ? null : <SheetTitle className="sr-only">{noun}</SheetTitle>}
                {scenarios.isError ? (
                    <LoadError title="Could not load scenarios" onRetry={scenarios.refetch} />
                ) : current ? (
                    <ValueViewProvider {...VALUE_VIEW}>
                        <ScenarioFocusHeader
                            kind={header.kind}
                            compareRun={
                                compareSlot === null ? null : {slot: compareSlot, name: header.name}
                            }
                            rows={rows}
                            current={current}
                            nextLoading={isFetchingMore}
                            hasNext={hasMore}
                            onSelect={setScenarioId}
                            onNext={onNext}
                            toolbar={{fullScreen, onFullScreen: setFullScreen, payload}}
                            link={
                                <ScenarioFocusTestsetLink
                                    runId={runId}
                                    kind={header.kind}
                                    row={current}
                                />
                            }
                            summary={<ScenarioFocusSummaryLine row={current} results={results} />}
                        />
                        <ScenarioFocusTabs tab={tab} onTab={setTab} mode={mode} onMode={setMode}>
                            <ScenarioFocusContent
                                runId={runId}
                                kind={header.kind}
                                row={current}
                                groups={scenarios.columnGroups}
                                labels={labels}
                                results={results}
                                onRetry={scenarios.retryValues}
                                tab={tab}
                                mode={mode}
                            />
                        </ScenarioFocusTabs>
                        {loadMoreError ? <ScenariosLoadMoreError onRetry={loadMore} /> : null}
                        {scenarios.refreshFailed ? (
                            <ScenariosRefreshError onRetry={scenarios.retryRefresh} />
                        ) : null}
                    </ValueViewProvider>
                ) : loadMoreError ? (
                    <LoadError title="Could not load more scenarios" onRetry={loadMore} />
                ) : notFound ? (
                    <ScenarioFocusNotFound onClose={() => setScenarioId(null)} />
                ) : (
                    <ScenarioFocusSkeleton />
                )}
            </SheetContent>
        </Sheet>
    )
}
