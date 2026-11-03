import {useEffect, useState} from "react"

import type {RunHeader} from "@agenta/entities/evaluationRun"
import {LoadError} from "@agenta/ui/components/presentational"
import {Sheet, SheetContent, SheetDescription, SheetTitle} from "@agenta/ui/ui"

import {ScenariosLoadMoreError} from "../scenarios/states/ScenariosLoadMoreError"
import {ScenariosRefreshError} from "../scenarios/states/ScenariosRefreshError"
import {useRunScenarios} from "../scenarios/useRunScenarios"
import {useScenarioGroupLabels} from "../scenarios/useScenarioGroupLabels"

import {ScenarioFocusBody} from "./ScenarioFocusBody"
import {ScenarioFocusHeader} from "./ScenarioFocusHeader"
import {scenarioNoun} from "./scenarioNoun"
import {ScenarioFocusNotFound} from "./states/ScenarioFocusNotFound"
import {ScenarioFocusSkeleton} from "./states/ScenarioFocusSkeleton"
import {useFocusScenarioParam} from "./useFocusScenarioParam"

/**
 * One scenario of the run in a drawer, read only. The address names it (`focusScenarioId`).
 * A page must load this file with `next/dynamic` and render it only once a scenario is focused.
 * The drawer reads pages until it finds the scenario; Next on the last loaded row reads one more.
 */
export const ScenarioFocusSheet = ({
    runId,
    header,
    poll,
}: {
    runId: string
    header: RunHeader
    /** False while the Scenarios tab is open: it already reads the live rows again. */
    poll: boolean
}) => {
    const [scenarioId, setScenarioId] = useFocusScenarioParam(runId)
    const scenarios = useRunScenarios(runId, {poll})
    const labels = useScenarioGroupLabels(scenarios.columnGroups)
    const {rows, hasMore, loadMore, isPending, isFetchingMore, loadMoreError} = scenarios
    const [advanceFrom, setAdvanceFrom] = useState<string | null>(null)

    const position = rows.findIndex((row) => row.scenario.id === scenarioId)
    const current = position >= 0 ? rows[position] : null

    // The scenario is on a page that is not loaded yet: read pages until it shows up.
    useEffect(() => {
        if (!scenarioId || current || !hasMore || isPending || isFetchingMore || loadMoreError)
            return
        loadMore()
    }, [scenarioId, current, hasMore, isPending, isFetchingMore, loadMoreError, loadMore])

    // Next was pressed on the last loaded row: move on once the next page has arrived.
    useEffect(() => {
        if (!advanceFrom) return
        // The user picked another row, or the next page failed: the wish to move on is void.
        if (!current || current.scenario.id !== advanceFrom || loadMoreError) {
            setAdvanceFrom(null)
            return
        }
        const next = rows[position + 1]
        if (next) {
            setAdvanceFrom(null)
            setScenarioId(next.scenario.id)
        } else if (!hasMore) {
            setAdvanceFrom(null)
        }
    }, [advanceFrom, current, rows, position, hasMore, loadMoreError, setScenarioId])

    const onNext = () => {
        if (!current) return
        const next = rows[position + 1]
        if (next) return setScenarioId(next.scenario.id)
        setAdvanceFrom(current.scenario.id)
        loadMore()
    }

    const noun = scenarioNoun(header.kind)
    const notFound = !current && !hasMore && !isPending && !isFetchingMore && !scenarios.isError

    return (
        <Sheet open={Boolean(scenarioId)} onOpenChange={(open) => !open && setScenarioId(null)}>
            <SheetContent
                side="responsive"
                aria-label={noun}
                className="max-lg:inset-0 max-lg:max-h-none max-lg:rounded-none lg:[--ag-sheet-responsive-width:720px]"
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
                        />
                        <ScenarioFocusBody
                            row={current}
                            groups={scenarios.columnGroups}
                            labels={labels}
                            onRetry={scenarios.retryValues}
                        />
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
