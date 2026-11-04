import {useCallback, useMemo, useState} from "react"

import type {RunHeader} from "@agenta/entities/evaluationRun"
import type {RunColumnGroup} from "@agenta/entities/evaluationRun/etl"
import {LoadError} from "@agenta/ui/components/presentational"
import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableColumn, type ListTableGroup} from "@agenta/ui/list-table"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {ScenarioAnnotateButton} from "./ScenarioAnnotateButton"
import {ScenarioCard} from "./ScenarioCard"
import type {ScenarioRow} from "./scenarioColumns"
import {ScenariosLoadMore} from "./ScenariosLoadMore"
import {ScenarioTableRow} from "./ScenarioTableRow"
import {ScenariosEmpty} from "./states/ScenariosEmpty"
import {ScenariosLoadMoreError} from "./states/ScenariosLoadMoreError"
import {ScenariosRefreshError} from "./states/ScenariosRefreshError"
import {useRunScenarios} from "./useRunScenarios"
import {useScenarioGroupLabels} from "./useScenarioGroupLabels"

// The annotate sheet brings the annotation controllers: it loads when a row asks for it.
const RunAnnotateSheet = dynamic<{
    runId: string
    row: ScenarioRow
    groups: RunColumnGroup[]
    labels: Record<string, string>
    onRetry: () => void
    onClose: () => void
}>(() => import("../focus/RunAnnotateSheet").then((module) => module.RunAnnotateSheet), {
    ssr: false,
})

/** Tailwind's `lg`. Below it each scenario is a card. */
const TABLE_QUERY = "(min-width: 1024px)"
const GROUP_COLUMN_WIDTH = 220

/**
 * The Scenarios tab: every scenario of the run as a table row (cards on a phone), with its status
 * and the values of each column group. Opening a row sets `focusScenarioId` in the address. On a
 * human run each row also has Annotate, which opens the annotate sheet on that scenario.
 */
export const ScenariosTab = ({runId, header}: {runId: string; header: RunHeader}) => {
    const router = useRouter()
    const isHumanRun = header.kind === "human"
    const [annotatingId, setAnnotatingId] = useState<string | null>(null)
    const scenarios = useRunScenarios(runId)
    const labels = useScenarioGroupLabels(scenarios.columnGroups)
    const isTable = useMediaQuery(TABLE_QUERY)
    const {rows, columnGroups} = scenarios

    const columns = useMemo<ListTableColumn[]>(
        () => [
            {key: "index", label: "#", width: "40px"},
            {key: "status", label: "Status", width: "minmax(120px,1fr)"},
            ...columnGroups.map(({group}) => ({
                key: group.key,
                label: labels[group.key] ?? group.label,
                width: `minmax(${GROUP_COLUMN_WIDTH}px,2fr)`,
            })),
            ...(isHumanRun ? [{key: "actions", label: "", width: "110px"}] : []),
        ],
        [columnGroups, labels, isHumanRun],
    )
    const groups = useMemo<ListTableGroup<ScenarioRow>[]>(
        () => [{key: "scenarios", label: null, rows}],
        [rows],
    )

    const openRow = useCallback(
        (row: ScenarioRow) =>
            void router.replace(
                {
                    pathname: router.pathname,
                    query: {
                        ...router.query,
                        focusScenarioId: row.scenario.id,
                        focusRunId: runId,
                    },
                },
                undefined,
                {shallow: true},
            ),
        [router, runId],
    )

    const annotating = rows.find((row) => row.scenario.id === annotatingId) ?? null

    if (scenarios.isError) {
        return <LoadError framed title="Could not load scenarios" onRetry={scenarios.refetch} />
    }

    return (
        <div>
            <ListTable
                view={isTable ? "list" : "grid"}
                columns={columns}
                minWidth={160 + columnGroups.length * GROUP_COLUMN_WIDTH}
                cardMinWidth={280}
                density="compact"
                loading={scenarios.isPending}
                groups={groups}
                rowKey={(row) => row.scenario.id}
                onOpenRow={openRow}
                empty={<ScenariosEmpty />}
                renderRow={(row) => (
                    <>
                        <ScenarioTableRow
                            row={row}
                            groups={columnGroups}
                            onRetry={scenarios.retryValues}
                        />
                        {isHumanRun ? (
                            <ScenarioAnnotateButton
                                onClick={() => setAnnotatingId(row.scenario.id)}
                            />
                        ) : null}
                    </>
                )}
                renderCard={(row) => (
                    <>
                        <ScenarioCard
                            row={row}
                            groups={columnGroups}
                            labels={labels}
                            onRetry={scenarios.retryValues}
                        />
                        {isHumanRun ? (
                            <ScenarioAnnotateButton
                                onClick={() => setAnnotatingId(row.scenario.id)}
                            />
                        ) : null}
                    </>
                )}
            />
            {annotating ? (
                <RunAnnotateSheet
                    runId={runId}
                    row={annotating}
                    groups={columnGroups}
                    labels={labels}
                    onRetry={scenarios.retryValues}
                    onClose={() => setAnnotatingId(null)}
                />
            ) : null}
            {scenarios.refreshFailed ? (
                <ScenariosRefreshError onRetry={scenarios.retryRefresh} />
            ) : null}
            {scenarios.loadMoreError ? (
                <ScenariosLoadMoreError onRetry={scenarios.loadMore} />
            ) : scenarios.hasMore ? (
                <ScenariosLoadMore
                    loading={scenarios.isFetchingMore}
                    onLoadMore={scenarios.loadMore}
                />
            ) : null}
        </div>
    )
}
