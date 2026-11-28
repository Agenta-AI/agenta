import {useEffect, useMemo, useRef, useState} from "react"

import {ValueViewProvider, type ValueViewMode} from "@agenta/chat/value-view"
import {
    evaluationRunQueryAtomFamily,
    runReferencesAtomFamily,
    splitByOrigin,
    type RunHeader,
} from "@agenta/entities/evaluationRun"
import type {RunColumnGroup} from "@agenta/entities/evaluationRun/etl"
import {useT} from "@agenta/i18n"
import focusCatalog from "@agenta/i18n/catalogs/evaluations.scenarioFocus"
import {isDrawerOpenAtom} from "@agenta/observability/traceDrawer"
import {projectIdAtom} from "@agenta/shared/state"
import {LoadError} from "@agenta/ui/components/presentational"
import {cn} from "@agenta/ui/styles"
import {Sheet, SheetContent, SheetDescription, SheetTitle} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {chatProseClassName, markdownIcons} from "@/features/chat/AssistantMarkdown"
import {useProjectPermission} from "@/features/context/useProjectPermission"

import type {ScenarioRow} from "../scenarios/scenarioColumns"
import {ScenariosLoadMoreError} from "../scenarios/states/ScenariosLoadMoreError"
import {ScenariosRefreshError} from "../scenarios/states/ScenariosRefreshError"
import {ScenarioValuesError} from "../scenarios/states/ScenarioValuesError"
import {useRunScenarios} from "../scenarios/useRunScenarios"
import {useScenarioGroupLabels} from "../scenarios/useScenarioGroupLabels"

import {ScenarioFocusAnnotateUnsaved} from "./ScenarioFocusAnnotateUnsaved"
import {ScenarioFocusBody} from "./ScenarioFocusBody"
import {ScenarioFocusHeader} from "./ScenarioFocusHeader"
import {ScenarioFocusHumanLine} from "./ScenarioFocusHumanLine"
import {ScenarioFocusMetadataTab} from "./ScenarioFocusMetadataTab"
import {outputValue} from "./ScenarioFocusOutput"
import {
    evaluatorOriginsOf,
    scenarioEvaluatorResults,
    ScenarioFocusResultsTab,
    type ScenarioEvaluatorResult,
    type ScenarioResultReviews,
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
import {scenarioJudges, useJudgeReviews} from "./useJudgeReviews"
import {useScenarioStepper} from "./useScenarioStepper"
import {useScenarioTrace} from "./useScenarioTrace"
import {TestcaseDraftContext, useTestcaseDraft} from "./useTestcaseDraft"

// The panel brings the annotation controllers: its own chunk, loaded when a user opens it.
const ScenarioFocusAnnotatePanel = dynamic(() => import("./ScenarioFocusAnnotatePanel"), {
    ssr: false,
})

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
    reviews,
    onOpenPanel,
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
    reviews: ReadonlyMap<string, ScenarioResultReviews>
    onOpenPanel?: (resultId: string) => void
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
                <ScenarioFocusResultsTab
                    results={results}
                    hasEvaluators={groups.some(({group}) => group.kind === "evaluator")}
                    reviews={reviews}
                    onOpenPanel={onOpenPanel}
                />
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
    // A move away from a test case with changes not saved to the test set waits for the user.
    const [pendingMove, setPendingMove] = useState<(() => void) | null>(null)
    // Set below, once the draft is known; the stepper calls it on a move.
    const guardRef = useRef<(go: () => void) => void>((go) => go())
    const {current, onNext, onSelect} = useScenarioStepper({
        rows,
        scenarioId,
        setScenarioId,
        hasMore,
        loadMore,
        loadMoreError,
        beforeStep: (go) => guardRef.current(go),
    })

    // The scenario is on a page that is not loaded yet: read pages until it shows up.
    useEffect(() => {
        if (!scenarioId || current || !hasMore || isPending || isFetchingMore || loadMoreError)
            return
        loadMore()
    }, [scenarioId, current, hasMore, isPending, isFetchingMore, loadMoreError, loadMore])

    // Two modal sheets stack in the order they open. A link or a reload with both a test case and a
    // trace opens the trace first, so this drawer waits until the trace closes; it would cover the
    // trace otherwise. Opened from this drawer, the trace comes later and sits on top.
    const traceOpen = useAtomValue(isDrawerOpenAtom)
    const [traceClosedOnce, setTraceClosedOnce] = useState(!traceOpen)
    useEffect(() => {
        if (!traceOpen) setTraceClosedOnce(true)
    }, [traceOpen])

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

    // The Annotate panel and what it shares with the drawer: the judges' reviews (marks on the
    // result rows) and the test case draft (editable inputs and "Use as reference").
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const canAnnotate = useProjectPermission(projectId, "edit_annotations")
    const canEditRun = useProjectPermission(projectId, "edit_evaluation_runs")
    const canEditTestsets = useProjectPermission(projectId, "edit_testsets")
    const [panel, setPanel] = useState<{focusJudge: string | null} | null>(null)
    const {human, notHuman} = useMemo(() => splitByOrigin(results), [results])
    const judges = useMemo(
        () => (current ? scenarioJudges(current, scenarios.columnGroups, notHuman) : []),
        [current, scenarios.columnGroups, notHuman],
    )
    const judgeReviews = useJudgeReviews(judges)
    const reviews = useMemo(
        () =>
            new Map(
                judges.map((judge) => [
                    judge.id,
                    {
                        own: judgeReviews.own.get(judge.id)?.verdict ?? null,
                        all: judgeReviews.byJudge.get(judge.id) ?? [],
                    },
                ]),
            ),
        [judges, judgeReviews.own, judgeReviews.byJudge],
    )
    const references = useAtomValue(runReferencesAtomFamily(runId))
    const expectedKey = useExpectedColumn(runId)
    const testset = useMemo(() => {
        const ref = references?.testsets.find((item) => item.testsetId === current?.testsetId)
        if (!ref || header.kind === "online") return null
        const group = scenarios.columnGroups.find(
            ({group}) => group.kind === "testset" && group.refs?.testset?.id === ref.testsetId,
        )?.group
        return {...ref, name: group ? (labels[group.key] ?? group.label) : ref.testsetId}
    }, [references, current?.testsetId, header.kind, scenarios.columnGroups, labels])
    const output = useMemo(
        () =>
            current
                ? outputValue(
                      scenarios.columnGroups
                          .filter(({group}) => group.kind === "application")
                          .flatMap(({group}) => current.cells[group.key] ?? []),
                  )
                : undefined,
        [current, scenarios.columnGroups],
    )
    const draft = useTestcaseDraft({
        scenarioId: current?.scenario.id ?? "",
        testcaseId: current?.testcaseId ?? null,
        testset,
        expectedKey,
        output,
    })
    guardRef.current = (go) => (draft.dirty ? setPendingMove(() => go) : go())
    const openPanel = (focusJudge: string | null = null) => setPanel({focusJudge})
    const closePanel = () =>
        guardRef.current(() => {
            draft.discard()
            setPanel(null)
        })
    const close = () => guardRef.current(() => setScenarioId(null))

    const noun = scenarioNoun(header.kind)
    const notFound = !current && !hasMore && !isPending && !isFetchingMore && !scenarios.isError

    return (
        <Sheet
            open={Boolean(scenarioId) && traceClosedOnce}
            onOpenChange={(open) => !open && close()}
        >
            <SheetContent
                side="responsive"
                aria-label={noun}
                className={cn(
                    "max-lg:inset-0 max-lg:h-dvh max-lg:max-h-none max-lg:rounded-none",
                    fullScreen
                        ? "lg:max-w-none lg:[--ag-sheet-responsive-width:calc(100vw-1rem)]"
                        : panel
                          ? "lg:[--ag-sheet-responsive-width:1100px]"
                          : "lg:[--ag-sheet-responsive-width:720px]",
                    panel && current && "overflow-hidden lg:flex-row",
                )}
            >
                <div
                    className={cn(
                        "flex min-h-0 min-w-0 flex-1 flex-col",
                        // A phone has no room for both: the panel takes the drawer's place.
                        panel && current && "max-lg:hidden",
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
                                    compareSlot === null
                                        ? null
                                        : {slot: compareSlot, name: header.name}
                                }
                                rows={rows}
                                current={current}
                                nextLoading={isFetchingMore}
                                hasNext={hasMore}
                                onSelect={onSelect}
                                onNext={onNext}
                                annotate={
                                    canAnnotate
                                        ? {
                                              open: Boolean(panel),
                                              onToggle: () => (panel ? closePanel() : openPanel()),
                                          }
                                        : null
                                }
                                toolbar={{fullScreen, onFullScreen: setFullScreen, payload}}
                                link={
                                    <ScenarioFocusTestsetLink
                                        runId={runId}
                                        kind={header.kind}
                                        row={current}
                                    />
                                }
                                summary={
                                    <>
                                        <ScenarioFocusSummaryLine row={current} results={results} />
                                        <ScenarioFocusHumanLine human={human} />
                                    </>
                                }
                            />
                            <TestcaseDraftContext.Provider value={panel ? draft : null}>
                                <ScenarioFocusTabs
                                    tab={tab}
                                    onTab={setTab}
                                    mode={mode}
                                    onMode={setMode}
                                >
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
                                        reviews={reviews}
                                        onOpenPanel={canAnnotate ? openPanel : undefined}
                                    />
                                </ScenarioFocusTabs>
                            </TestcaseDraftContext.Provider>
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
                </div>
                {panel && current ? (
                    <ScenarioFocusAnnotatePanel
                        runId={runId}
                        header={header}
                        row={current}
                        judges={judges}
                        ownReviews={judgeReviews.own}
                        focusJudge={panel.focusJudge}
                        testset={testset}
                        draft={draft}
                        expectedKey={expectedKey}
                        canEditRun={canEditRun}
                        canEditTestsets={canEditTestsets}
                        onClose={closePanel}
                    />
                ) : null}
                <ScenarioFocusAnnotateUnsaved
                    open={Boolean(pendingMove)}
                    onKeep={() => setPendingMove(null)}
                    onDiscard={() => {
                        draft.discard()
                        pendingMove?.()
                        setPendingMove(null)
                    }}
                />
            </SheetContent>
        </Sheet>
    )
}
