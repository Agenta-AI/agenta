import {useCallback, useMemo, useState} from "react"

import {
    matchCompareRows,
    runMetricCatalogAtomFamily,
    type RunHeader,
} from "@agenta/entities/evaluationRun"
import {EMPTY_SCENARIO_FILTER, type RunColumnGroup} from "@agenta/entities/evaluationRun/etl"
import {useT} from "@agenta/i18n"
import scenariosCatalog from "@agenta/i18n/catalogs/evaluations.scenarios"
import {LoadError} from "@agenta/ui/components/presentational"
import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableGroup} from "@agenta/ui/list-table"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {alignComparedRow} from "../compare/scenarios/alignComparedRow"
import {CompareRowRun} from "../compare/scenarios/CompareRowRun"
import {useComparedScenarios} from "../compare/scenarios/useComparedScenarios"
import {rowNounKey} from "../focus/scenarioNoun"

import {ScenarioAnnotateButton} from "./ScenarioAnnotateButton"
import {ScenarioCard} from "./ScenarioCard"
import type {ScenarioRow} from "./scenarioColumns"
import {ScenarioFilter} from "./ScenarioFilter"
import {ScenariosDisplayMenu} from "./ScenariosDisplayMenu"
import {ScenariosLoadMore} from "./ScenariosLoadMore"
import {ScenarioTable, type ScenarioSort, type ScenarioWidthsChange} from "./ScenarioTable"
import {
    columnKeysOf,
    evaluatorFailures,
    scenarioColumnModel,
    sortScenarioRows,
    type ScenarioColumn,
    type ScenarioEntry,
    type ScenarioFieldColumn,
} from "./scenarioTableColumns"
import {scenarioFilterAtomFamily} from "./scenarioTableState"
import {
    hiddenKeys,
    labelColumnKey,
    moveKey,
    orderedByKeys,
    setColumnsHidden,
    withDensity,
} from "./scenarioViewDefaults"
import {ScenariosEmpty} from "./states/ScenariosEmpty"
import {ScenariosLoadMoreError} from "./states/ScenariosLoadMoreError"
import {ScenariosNoMatch} from "./states/ScenariosNoMatch"
import {ScenariosRefreshError} from "./states/ScenariosRefreshError"
import {ScenariosSkeleton} from "./states/ScenariosSkeleton"
import {SCENARIOS_PAGE_SIZE, useRunScenarios} from "./useRunScenarios"
import {useScenarioFilter} from "./useScenarioFilter"
import {useScenarioGroupLabels} from "./useScenarioGroupLabels"
import {useScenarioView} from "./useScenarioView"

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
const NO_COMPARE: readonly string[] = []

const SORT_NOTE = {
    TestCase: "evaluations.scenarios.sortNoteTestCase",
    Scenario: "evaluations.scenarios.sortNoteScenario",
    Trace: "evaluations.scenarios.sortNoteTrace",
} as const
const COUNT = {
    TestCase: "evaluations.scenarios.countTestCase",
    Scenario: "evaluations.scenarios.countScenario",
    Trace: "evaluations.scenarios.countTrace",
} as const

/**
 * The Scenarios tab: every scenario of the run as a table row (cards on a narrow window), with
 * its status, a label column, the test case values and outputs, each evaluator's metrics under
 * its name, and the cost, duration, tokens and errors of the app call. The filter narrows the
 * rows, a column header sorts the loaded rows, and the Display menu sets the view, which is kept
 * per run. Opening a row sets `focusScenarioId` in the address. On a human run each row also has
 * Annotate. While runs are compared, each scenario is followed by the scenario of every compared
 * run for the same test case; the filter applies to the base run's rows.
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
    const t = useT(scenariosCatalog)
    const router = useRouter()
    const isHumanRun = header.kind === "human"
    const noun = rowNounKey(header.kind)
    const [annotatingId, setAnnotatingId] = useState<string | null>(null)
    const [sort, setSort] = useState<ScenarioSort | null>(null)
    const scenarios = useRunScenarios(runId)
    const catalog = useAtomValue(runMetricCatalogAtomFamily(runId))
    const labels = useScenarioGroupLabels(scenarios.columnGroups)
    const isTable = useMediaQuery(TABLE_QUERY)
    const {rows, columnGroups} = scenarios
    const setFilter = useSetAtom(scenarioFilterAtomFamily(runId))
    const [view, updateView] = useScenarioView(runId)
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

    const model = useMemo(
        () => scenarioColumnModel(columnGroups, rows, labels, scenarios.schema.steps),
        [columnGroups, rows, labels, scenarios.schema.steps],
    )
    const hidden = useMemo(() => hiddenKeys(model, view), [model, view])
    const labelKey = labelColumnKey(model, view)
    const label = model.fields.find((column) => column.key === labelKey) ?? null
    const fields = useMemo(
        () => orderedByKeys(model.fields, view.order).filter((column) => column.key !== labelKey),
        [model.fields, view.order, labelKey],
    )
    const evaluators = useMemo(() => {
        if (!view.orderByFailures) return orderedByKeys(model.evaluators, view.order)
        const failures = new Map(
            model.evaluators.map((group) => [group.key, evaluatorFailures(rows, group)]),
        )
        return [...model.evaluators].sort(
            (a, b) => (failures.get(b.key) ?? 0) - (failures.get(a.key) ?? 0),
        )
    }, [model.evaluators, view.order, view.orderByFailures, rows])
    const allColumns = useMemo<ScenarioColumn[]>(
        () => [
            ...model.fields,
            ...model.evaluators.flatMap((group) => group.columns),
            ...model.metrics,
        ],
        [model],
    )
    const sortColumn = sort ? allColumns.find((column) => column.key === sort.key) : undefined

    const comparing = compareIds.length > 0
    const compared = useComparedScenarios(
        compareIds,
        Math.max(1, Math.ceil(rows.length / SCENARIOS_PAGE_SIZE)),
    )
    const entries = useMemo<ScenarioEntry[]>(() => {
        // The loaded rows only: a sort over every scenario needs an order the API does not offer.
        const baseRows =
            sort && sortColumn
                ? sortScenarioRows(filter.rows, sortColumn, sort.direction)
                : filter.rows
        if (!comparing) {
            return baseRows.map((row) => ({
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
        return matchCompareRows(baseRows, compared, {
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
    }, [comparing, filter.rows, compared, columnGroups, header.name, runId, sort, sortColumn])

    // The run's test case count: the run-wide count of app calls, else every row once all loaded.
    const runWide = catalog.find((entry) => entry.id === "duration" && entry.statsAreRunWide)
    const total = runWide?.stats?.count ?? (scenarios.hasMore ? null : rows.length)
    const groups = useMemo<ListTableGroup<ScenarioEntry>[]>(
        () => [{key: "scenarios", label: null, rows: entries}],
        [entries],
    )
    const lookingForMatches =
        filter.active && filter.rows.length === 0 && filter.scanning && !scenarios.loadMoreError

    const openRow = useCallback(
        (entry: ScenarioEntry) => {
            if (!entry.row) return
            void router.replace(
                {
                    pathname: router.pathname,
                    query: {
                        ...router.query,
                        focusScenarioId: entry.row.scenario.id,
                        focusRunId: entry.runId,
                    },
                },
                undefined,
                {shallow: true},
            )
        },
        [router],
    )
    const fieldLabel = useCallback(
        (column: ScenarioFieldColumn) => column.label ?? t("evaluations.scenarios.output"),
        // `t` stays out of the list: a new language renders the table again anyway.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [],
    )
    const hideColumns = useCallback(
        (keys: string[], hide: boolean) =>
            updateView((current) => setColumnsHidden(current, model, keys, hide)),
        [model, updateView],
    )
    const onHide = useCallback((key: string) => hideColumns([key], true), [hideColumns])
    const onWidth = useCallback(
        (key: string, width: number | null) =>
            updateView((current) => {
                const widths = {...current.widths}
                if (width === null) delete widths[key]
                else widths[key] = width
                return {...current, widths}
            }),
        [updateView],
    )
    const onWidths = useCallback<ScenarioWidthsChange>(
        (change) =>
            updateView((current) => ({
                ...current,
                widths: typeof change === "function" ? change(current.widths) : change,
            })),
        [updateView],
    )
    const onAnnotate = useCallback((row: ScenarioRow) => setAnnotatingId(row.scenario.id), [])

    const annotating = rows.find((row) => row.scenario.id === annotatingId) ?? null

    if (scenarios.isError) {
        return (
            <LoadError
                framed
                title={t("evaluations.scenarios.loadError")}
                onRetry={scenarios.refetch}
            />
        )
    }
    if (scenarios.isPending) return <ScenariosSkeleton />

    const empty = filter.active ? (
        <ScenariosNoMatch onClear={() => setFilter(EMPTY_SCENARIO_FILTER)} />
    ) : (
        <ScenariosEmpty />
    )
    const columnKeys = columnKeysOf(model)
    const hiddenCount = columnKeys.filter((key) => key !== labelKey && hidden.has(key)).length

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
                {total !== null ? (
                    <span className="text-meta text-muted-foreground">
                        {t(COUNT[noun], {count: total})}
                    </span>
                ) : null}
                <span className="flex-1" />
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
                    <ScenariosDisplayMenu
                        view={view}
                        labelOptions={model.fields.filter(
                            (column) => column.section === "testcase",
                        )}
                        labelKey={labelKey}
                        hiddenCount={hiddenCount}
                        fieldLabel={fieldLabel}
                        onDensity={(density) =>
                            updateView((current) => withDensity(current, model, density))
                        }
                        onLabel={(key) => updateView((current) => ({...current, label: key}))}
                        onRowHeight={(rowHeight) =>
                            updateView((current) => ({...current, rowHeight}))
                        }
                        onResetWidths={() => updateView((current) => ({...current, widths: {}}))}
                        columns={{
                            fields,
                            evaluators,
                            metrics: model.metrics,
                            hidden,
                            orderByFailures: view.orderByFailures,
                            totalColumns: columnKeys.length,
                            onHide: hideColumns,
                            onMove: (key, before) =>
                                updateView((current) => ({
                                    ...current,
                                    // A drag sets the order by hand.
                                    orderByFailures: false,
                                    order: moveKey(
                                        [...fields, ...evaluators].map((item) => item.key),
                                        key,
                                        before,
                                    ),
                                })),
                            onOrderByFailures: (on) =>
                                updateView((current) => ({...current, orderByFailures: on})),
                            onShowAll: () => hideColumns(columnKeys, false),
                        }}
                    />
                ) : null}
            </div>
            {sort && sortColumn && scenarios.hasMore ? (
                <p className="m-0 text-meta text-muted-foreground">
                    {t(SORT_NOTE[noun], {count: rows.length})}
                </p>
            ) : null}
            {isTable ? (
                <ScenarioTable
                    entries={entries}
                    label={label}
                    fields={fields.filter((column) => !hidden.has(column.key))}
                    evaluators={evaluators
                        .map((group) => ({
                            ...group,
                            columns: group.columns.filter((column) => !hidden.has(column.key)),
                        }))
                        .filter((group) => group.columns.length > 0)}
                    metrics={model.metrics.filter((column) => !hidden.has(column.key))}
                    view={view}
                    comparing={comparing}
                    isHumanRun={isHumanRun}
                    sort={sort}
                    fieldLabel={fieldLabel}
                    emptyText={empty}
                    loading={lookingForMatches}
                    onSort={setSort}
                    onWidth={onWidth}
                    onWidths={onWidths}
                    onHide={onHide}
                    onOpen={openRow}
                    onAnnotate={onAnnotate}
                    onRetry={scenarios.retryValues}
                    onLoadMore={
                        scenarios.hasMore && !scenarios.isFetchingMore && !scenarios.loadMoreError
                            ? scenarios.loadMore
                            : undefined
                    }
                />
            ) : (
                <ListTable
                    view="grid"
                    columns={[]}
                    cardMinWidth={280}
                    loading={lookingForMatches}
                    groups={groups}
                    rowKey={(entry) => entry.key}
                    // A compared run's row opens the drawer on that run's scenario; a missing one cannot.
                    canOpenRow={(entry) => entry.row !== null}
                    onOpenRow={openRow}
                    empty={empty}
                    renderRow={() => null}
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
                                <p className="m-0 text-meta text-muted-foreground">
                                    {entry.failed
                                        ? t("evaluations.scenarios.compareLoadFailed")
                                        : entry.pending
                                          ? t("evaluations.scenarios.loading")
                                          : t("evaluations.scenarios.compareNoMatch")}
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
            )}
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
                    shown={rows.length}
                    total={total}
                    // The table loads from its own scroll; the cards load at the page's end.
                    watchScroll={!isTable}
                />
            ) : null}
        </div>
    )
}
