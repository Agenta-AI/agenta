import {useEffect, useMemo, useState} from "react"

import type {RunHeader} from "@agenta/entities/evaluationRun"
import {LoadError} from "@agenta/ui/components/presentational"
import {cn} from "@agenta/ui/styles"
import {Sheet, SheetContent, SheetDescription, SheetTitle} from "@agenta/ui/ui"

import {ScenariosLoadMoreError} from "../scenarios/states/ScenariosLoadMoreError"
import {ScenariosRefreshError} from "../scenarios/states/ScenariosRefreshError"
import {useRunScenarios} from "../scenarios/useRunScenarios"
import {useScenarioGroupLabels} from "../scenarios/useScenarioGroupLabels"

import {INPUTS_SECTION, OUTPUTS_SECTION, ScenarioFocusBody} from "./ScenarioFocusBody"
import {ScenarioFocusHeader} from "./ScenarioFocusHeader"
import type {ScenarioFocusFormat} from "./ScenarioFocusToolbar"
import {scenarioNoun} from "./scenarioNoun"
import {scenarioPayload} from "./scenarioPayload"
import {ScenarioPayloadView} from "./ScenarioPayloadView"
import {ScenarioFocusNotFound} from "./states/ScenarioFocusNotFound"
import {ScenarioFocusSkeleton} from "./states/ScenarioFocusSkeleton"
import {useFocusScenarioParam} from "./useFocusScenarioParam"
import {useScenarioStepper} from "./useScenarioStepper"

/**
 * One scenario of the run in a drawer, read only. The address names it (`focusScenarioId`).
 * A page must load this file with `next/dynamic` and render it only once a scenario is focused.
 * The drawer reads pages until it finds the scenario; Next on the last loaded row reads one more.
 * The view (full screen, folded sections, Form or JSON) stays as the user moves between scenarios.
 */
export const ScenarioFocusSheet = ({
    runId,
    header,
    poll,
}: {
    runId: string
    header: RunHeader
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
    const [format, setFormat] = useState<ScenarioFocusFormat>("form")
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
    const sectionKeys = useMemo(
        () => [
            INPUTS_SECTION,
            OUTPUTS_SECTION,
            ...scenarios.columnGroups
                .filter(({group}) => group.kind === "evaluator")
                .map(({group}) => group.key),
        ],
        [scenarios.columnGroups],
    )
    const payload = useMemo(
        () =>
            current
                ? JSON.stringify(scenarioPayload(current, scenarios.columnGroups, labels), null, 2)
                : "",
        [current, scenarios.columnGroups, labels],
    )
    const toggleSection = (key: string) =>
        setCollapsed((previous) => {
            const next = new Set(previous)
            if (!next.delete(key)) next.add(key)
            return next
        })

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
                    <>
                        <ScenarioFocusHeader
                            kind={header.kind}
                            rows={rows}
                            current={current}
                            nextLoading={isFetchingMore}
                            hasNext={hasMore}
                            onSelect={setScenarioId}
                            onNext={onNext}
                            toolbar={{
                                fullScreen,
                                onFullScreen: setFullScreen,
                                someCollapsed: collapsed.size > 0,
                                onCollapseAll: (collapse) =>
                                    setCollapsed(new Set(collapse ? sectionKeys : [])),
                                payload,
                                format,
                                onFormat: setFormat,
                            }}
                        />
                        {format === "json" ? (
                            <ScenarioPayloadView payload={payload} />
                        ) : (
                            <ScenarioFocusBody
                                row={current}
                                groups={scenarios.columnGroups}
                                labels={labels}
                                onRetry={scenarios.retryValues}
                                view={{collapsed, onToggle: toggleSection}}
                            />
                        )}
                        {loadMoreError ? <ScenariosLoadMoreError onRetry={loadMore} /> : null}
                        {scenarios.refreshFailed ? (
                            <ScenariosRefreshError onRetry={scenarios.retryRefresh} />
                        ) : null}
                    </>
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
