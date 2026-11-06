import {useCallback, useMemo, useState} from "react"

import type {RunHeader} from "@agenta/entities/evaluationRun"
import {EMPTY_SCENARIO_FILTER, type RunColumnGroup} from "@agenta/entities/evaluationRun/etl"
import {LoadError} from "@agenta/ui/components/presentational"
import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableColumn, type ListTableGroup} from "@agenta/ui/list-table"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {ScenarioAnnotateButton} from "./ScenarioAnnotateButton"
import {ScenarioCard} from "./ScenarioCard"
import type {ScenarioRow} from "./scenarioColumns"
import {ScenarioColumnSettings} from "./ScenarioColumnSettings"
import {ScenarioFilter} from "./ScenarioFilter"
import {ScenariosLoadMore} from "./ScenariosLoadMore"
import {
    COLUMN_MIN_WIDTH,
    scenarioColumnOptions,
    scenarioTableCells,
    type ScenarioTableCell,
} from "./scenarioTableColumns"
import {ScenarioTableRow} from "./ScenarioTableRow"
import {hiddenScenarioColumnsAtomFamily, scenarioFilterAtomFamily} from "./scenarioTableState"
import {ScenariosEmpty} from "./states/ScenariosEmpty"
import {ScenariosLoadMoreError} from "./states/ScenariosLoadMoreError"
import {ScenariosNoMatch} from "./states/ScenariosNoMatch"
import {ScenariosRefreshError} from "./states/ScenariosRefreshError"
import {useRunScenarios} from "./useRunScenarios"
import {useScenarioFilter} from "./useScenarioFilter"
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
/** The number, status and action columns, in px, with the 12px gap after each. */
const LEAD_WIDTH = 40 + 12 + 120 + 12
const ACTION_WIDTH = 110
const COLUMN_GAP = 12

/** The header of a value column: an evaluator's metric names its evaluator too. */
function cellLabel(cell: ScenarioTableCell, labels: Record<string, string>): string {
    if (cell.type === "metric") return cell.label
    const {group} = cell.group
    const groupLabel = labels[group.key] ?? group.label
    return cell.type === "evaluator" ? `${groupLabel} · ${cell.name}` : groupLabel
}

/**
 * The Scenarios tab: every scenario of the run as a table row (cards on a phone), with its status,
 * the values of each test set and app, one column per evaluator metric, and the cost, duration,
 * tokens and errors of the app call. A filter narrows the rows and the column settings hide
 * columns, as in the old app. Opening a row sets `focusScenarioId` in the address. On a human run
 * each row also has Annotate, next to its status, which opens the annotate sheet on that scenario.
 */
export const ScenariosTab = ({runId, header}: {runId: string; header: RunHeader}) => {
    const router = useRouter()
    const isHumanRun = header.kind === "human"
    const [annotatingId, setAnnotatingId] = useState<string | null>(null)
    const scenarios = useRunScenarios(runId)
    const labels = useScenarioGroupLabels(scenarios.columnGroups)
    const isTable = useMediaQuery(TABLE_QUERY)
    const {rows, columnGroups} = scenarios
    const hidden = useAtomValue(hiddenScenarioColumnsAtomFamily(runId))
    const setFilter = useSetAtom(scenarioFilterAtomFamily(runId))
    const filter = useScenarioFilter({
        runId,
        schema: scenarios.schema,
        rows,
        columnGroups,
        labels,
        hasMore: scenarios.hasMore,
        busy: scenarios.isPending || scenarios.isFetchingMore || Boolean(scenarios.loadMoreError),
        loadMore: scenarios.loadMore,
    })

    const cells = useMemo(() => scenarioTableCells(columnGroups, hidden), [columnGroups, hidden])
    const columnOptions = useMemo(
        () => scenarioColumnOptions(columnGroups, labels),
        [columnGroups, labels],
    )
    const columns = useMemo<ListTableColumn[]>(
        () => [
            {key: "index", label: "#", width: "40px"},
            {key: "status", label: "Status", width: "minmax(120px,1fr)"},
            // Next to the status, so the row action shows without scrolling sideways.
            ...(isHumanRun ? [{key: "actions", label: "Actions", width: `${ACTION_WIDTH}px`}] : []),
            ...cells.map((cell) => ({
                key: cell.key,
                label: cellLabel(cell, labels),
                width: `minmax(${COLUMN_MIN_WIDTH[cell.type]}px,${cell.type === "group" ? 2 : 1}fr)`,
            })),
        ],
        [cells, labels, isHumanRun],
    )
    const minWidth =
        LEAD_WIDTH +
        (isHumanRun ? ACTION_WIDTH + COLUMN_GAP : 0) +
        cells.reduce((total, cell) => total + COLUMN_MIN_WIDTH[cell.type] + COLUMN_GAP, 0)
    const groups = useMemo<ListTableGroup<ScenarioRow>[]>(
        () => [{key: "scenarios", label: null, rows: filter.rows}],
        [filter.rows],
    )
    const lookingForMatches =
        filter.active && filter.rows.length === 0 && filter.scanning && !scenarios.loadMoreError

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
            {scenarios.isPending ? null : (
                <div className="mb-3 flex items-center justify-end gap-2">
                    {filter.fields.length > 0 ? (
                        <ScenarioFilter
                            runId={runId}
                            applied={filter.applied}
                            fields={filter.fields}
                            matchCount={filter.rows.length}
                            scanning={filter.scanning}
                        />
                    ) : null}
                    {isTable ? (
                        <ScenarioColumnSettings runId={runId} options={columnOptions} />
                    ) : null}
                </div>
            )}
            <ListTable
                view={isTable ? "list" : "grid"}
                columns={columns}
                minWidth={minWidth}
                cardMinWidth={280}
                density="compact"
                loading={scenarios.isPending || lookingForMatches}
                groups={groups}
                rowKey={(row) => row.scenario.id}
                onOpenRow={openRow}
                empty={
                    filter.active ? (
                        <ScenariosNoMatch onClear={() => setFilter(EMPTY_SCENARIO_FILTER)} />
                    ) : (
                        <ScenariosEmpty />
                    )
                }
                renderRow={(row) => (
                    <ScenarioTableRow
                        row={row}
                        cells={cells}
                        onRetry={scenarios.retryValues}
                        action={
                            isHumanRun ? (
                                <ScenarioAnnotateButton
                                    onClick={() => setAnnotatingId(row.scenario.id)}
                                />
                            ) : undefined
                        }
                    />
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
