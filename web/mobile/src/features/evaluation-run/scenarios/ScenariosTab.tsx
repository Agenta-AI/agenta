import {useCallback, useMemo, useState} from "react"

import {matchCompareRows, type RunHeader} from "@agenta/entities/evaluationRun"
import {EMPTY_SCENARIO_FILTER, type RunColumnGroup} from "@agenta/entities/evaluationRun/etl"
import {LoadError} from "@agenta/ui/components/presentational"
import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableColumn, type ListTableGroup} from "@agenta/ui/list-table"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {alignComparedRow} from "../compare/scenarios/alignComparedRow"
import {CompareRowRun} from "../compare/scenarios/CompareRowRun"
import {CompareScenarioMissing} from "../compare/scenarios/CompareScenarioMissing"
import {useComparedScenarios} from "../compare/scenarios/useComparedScenarios"

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
import {SCENARIOS_PAGE_SIZE, useRunScenarios} from "./useRunScenarios"
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
const RUN_WIDTH = 140
const COLUMN_GAP = 12
const NO_COMPARE: readonly string[] = []

/**
 * One row of the table: a scenario of the base run (slot 0), or, while runs are compared, the
 * scenario of a compared run for the same test case. `row` is null when that run has none.
 */
interface ScenarioEntry {
    key: string
    slot: number
    /** The run the row belongs to: the drawer opens on it. */
    runId: string
    runName: string
    row: ScenarioRow | null
    base: ScenarioRow
    pending: boolean
    failed: boolean
}

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
 * While runs are compared, each scenario is followed by the scenario of every compared run for the
 * same test case, as in the old app; the filter applies to the base run's rows.
 */
export const ScenariosTab = ({
    runId,
    header,
    compareIds = NO_COMPARE,
}: {
    runId: string
    header: RunHeader
    compareIds?: readonly string[]
}) => {
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

    const comparing = compareIds.length > 0
    const compared = useComparedScenarios(
        compareIds,
        Math.max(1, Math.ceil(rows.length / SCENARIOS_PAGE_SIZE)),
    )
    const entries = useMemo<ScenarioEntry[]>(() => {
        if (!comparing) {
            return filter.rows.map((row) => ({
                key: row.scenario.id,
                slot: 0,
                runId,
                runName: header.name,
                row,
                base: row,
                pending: false,
                failed: false,
            }))
        }
        return matchCompareRows(filter.rows, compared, {
            testcaseOf: (row) => row.testcaseId,
            indexOf: (row) => row.index,
        }).map((entry) => {
            const run = compared[entry.slot - 1]
            const own = entry.row
            return {
                key: run ? `${run.runId}:${entry.base.scenario.id}` : entry.base.scenario.id,
                slot: entry.slot,
                runId: run?.runId ?? runId,
                runName: run?.name ?? header.name,
                row:
                    run && own
                        ? {
                              ...alignComparedRow(own, columnGroups, run.columnGroups),
                              index: entry.base.index,
                          }
                        : own,
                base: entry.base,
                pending: run?.isPending ?? false,
                failed: run?.isError ?? false,
            }
        })
    }, [comparing, filter.rows, compared, columnGroups, header.name, runId])

    const cells = useMemo(() => scenarioTableCells(columnGroups, hidden), [columnGroups, hidden])
    const columnOptions = useMemo(
        () => scenarioColumnOptions(columnGroups, labels),
        [columnGroups, labels],
    )
    const columns = useMemo<ListTableColumn[]>(
        () => [
            {key: "index", label: "#", width: "40px"},
            ...(comparing
                ? [{key: "run", label: "Evaluation", width: `minmax(${RUN_WIDTH}px,1fr)`}]
                : []),
            {key: "status", label: "Status", width: "minmax(120px,1fr)"},
            // Next to the status, so the row action shows without scrolling sideways.
            ...(isHumanRun ? [{key: "actions", label: "Actions", width: `${ACTION_WIDTH}px`}] : []),
            ...cells.map((cell) => ({
                key: cell.key,
                label: cellLabel(cell, labels),
                width: `minmax(${COLUMN_MIN_WIDTH[cell.type]}px,${cell.type === "group" ? 2 : 1}fr)`,
            })),
        ],
        [cells, labels, isHumanRun, comparing],
    )
    const minWidth =
        LEAD_WIDTH +
        (comparing ? RUN_WIDTH + COLUMN_GAP : 0) +
        (isHumanRun ? ACTION_WIDTH + COLUMN_GAP : 0) +
        cells.reduce((total, cell) => total + COLUMN_MIN_WIDTH[cell.type] + COLUMN_GAP, 0)
    const groups = useMemo<ListTableGroup<ScenarioEntry>[]>(
        () => [{key: "scenarios", label: null, rows: entries}],
        [entries],
    )
    const lookingForMatches =
        filter.active && filter.rows.length === 0 && filter.scanning && !scenarios.loadMoreError

    const openRow = useCallback(
        (row: ScenarioRow, rowRunId: string) =>
            void router.replace(
                {
                    pathname: router.pathname,
                    query: {
                        ...router.query,
                        focusScenarioId: row.scenario.id,
                        focusRunId: rowRunId,
                    },
                },
                undefined,
                {shallow: true},
            ),
        [router],
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
                rowKey={(entry) => entry.key}
                // A compared run's row opens the drawer on that run's scenario; a missing one cannot.
                canOpenRow={(entry) => entry.row !== null}
                onOpenRow={(entry) => entry.row && openRow(entry.row, entry.runId)}
                empty={
                    filter.active ? (
                        <ScenariosNoMatch onClear={() => setFilter(EMPTY_SCENARIO_FILTER)} />
                    ) : (
                        <ScenariosEmpty />
                    )
                }
                renderRow={(entry) => {
                    const run = comparing ? (
                        <CompareRowRun slot={entry.slot} name={entry.runName} />
                    ) : undefined
                    if (!entry.row) {
                        return (
                            <CompareScenarioMissing
                                index={entry.base.index}
                                run={run}
                                pending={entry.pending}
                                failed={entry.failed}
                                emptyCells={columns.length - 3}
                            />
                        )
                    }
                    const {row} = entry
                    return (
                        <ScenarioTableRow
                            row={row}
                            cells={cells}
                            run={run}
                            onRetry={scenarios.retryValues}
                            action={
                                !isHumanRun ? undefined : entry.slot === 0 ? (
                                    <ScenarioAnnotateButton
                                        onClick={() => setAnnotatingId(row.scenario.id)}
                                    />
                                ) : (
                                    <span aria-hidden />
                                )
                            }
                        />
                    )
                }}
                renderCard={(entry) => (
                    <>
                        {comparing ? (
                            <CompareRowRun slot={entry.slot} name={entry.runName} />
                        ) : null}
                        {entry.row ? (
                            <ScenarioCard
                                row={entry.row}
                                groups={columnGroups}
                                labels={labels}
                                onRetry={scenarios.retryValues}
                            />
                        ) : (
                            <p className="m-0 text-xs text-muted-foreground">
                                {entry.failed
                                    ? "Could not load"
                                    : entry.pending
                                      ? "Loading…"
                                      : "No matching scenario"}
                            </p>
                        )}
                        {isHumanRun && entry.slot === 0 ? (
                            <ScenarioAnnotateButton
                                onClick={() => setAnnotatingId(entry.base.scenario.id)}
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
