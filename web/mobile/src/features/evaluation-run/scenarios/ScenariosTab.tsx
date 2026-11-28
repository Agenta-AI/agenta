import {useCallback, useMemo, useState} from "react"

import {
    matchCompareRows,
    runMetricCatalogAtomFamily,
    type RunHeader,
} from "@agenta/entities/evaluationRun"
import {EMPTY_SCENARIO_FILTER} from "@agenta/entities/evaluationRun/etl"
import {runDefaultQueueIdQueryAtomFamily} from "@agenta/entities/simpleQueue"
import {useT} from "@agenta/i18n"
import scenariosCatalog from "@agenta/i18n/catalogs/evaluations.scenarios"
import {LoadError} from "@agenta/ui/components/presentational"
import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableGroup} from "@agenta/ui/list-table"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {queueHref} from "../../annotations/queueHref"
import {alignComparedRow} from "../compare/scenarios/alignComparedRow"
import {CompareRowRun} from "../compare/scenarios/CompareRowRun"
import {useComparedScenarios} from "../compare/scenarios/useComparedScenarios"
import {rowNounKey} from "../focus/scenarioNoun"
import {useFocusScenarioParam} from "../focus/useFocusScenarioParam"
import {useRunReviews} from "../focus/useRunReviews"

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
    ROW_HEIGHT,
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
import {useTableBodyHeight} from "./useTableBodyHeight"

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
    const [, focusScenario] = useFocusScenarioParam(runId)
    const queueId = useAtomValue(runDefaultQueueIdQueryAtomFamily(isHumanRun ? runId : "")).data
    const [sort, setSort] = useState<ScenarioSort | null>(null)
    const scenarios = useRunScenarios(runId)
    const catalog = useAtomValue(runMetricCatalogAtomFamily(runId))
    const labels = useScenarioGroupLabels(scenarios.columnGroups)
    const isTable = useMediaQuery(TABLE_QUERY)
    const {rows, columnGroups} = scenarios
    const setFilter = useSetAtom(scenarioFilterAtomFamily(runId))
    const [view, updateView] = useScenarioView(runId)
    const {reviews} = useRunReviews(runId)
    const reviewCounts = useMemo(() => {
        if (reviews.length === 0) return null
        const counts = new Map<string, number>()
        for (const {scenarioId} of reviews)
            counts.set(scenarioId, (counts.get(scenarioId) ?? 0) + 1)
        return counts
    }, [reviews])
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

    const freshModel = useMemo(
        () => scenarioColumnModel(columnGroups, rows, labels, scenarios.schema.steps),
        [columnGroups, rows, labels, scenarios.schema.steps],
    )
    // A polling tick gives new rows but almost never new columns: keep the same model then, so
    // the table keeps its column list and does not draw every header and cell again.
    const modelText = JSON.stringify(freshModel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const model = useMemo(() => freshModel, [modelText])
    const {density, hide, show} = view
    // Not on the whole view: a width drag must not rebuild the column list.
    const hidden = useMemo(
        () => hiddenKeys(model, {density, hide, show}),
        [model, density, hide, show],
    )
    const labelKey = labelColumnKey(model, view)
    const label = model.fields.find((column) => column.key === labelKey) ?? null
    const fields = useMemo(
        () => orderedByKeys(model.fields, view.order).filter((column) => column.key !== labelKey),
        [model.fields, view.order, labelKey],
    )
    // By failures: the order changes only when the counts reorder the evaluators, not on each tick.
    const failureOrder = useMemo(() => {
        if (!view.orderByFailures) return null
        const failures = new Map(
            model.evaluators.map((group) => [group.key, evaluatorFailures(rows, group)]),
        )
        return [...model.evaluators]
            .sort((a, b) => (failures.get(b.key) ?? 0) - (failures.get(a.key) ?? 0))
            .map((group) => group.key)
            .join("\n")
    }, [model.evaluators, view.orderByFailures, rows])
    const evaluators = useMemo(
        () =>
            orderedByKeys(
                model.evaluators,
                failureOrder === null ? view.order : failureOrder.split("\n"),
            ),
        [model.evaluators, view.order, failureOrder],
    )
    const allColumns = useMemo<ScenarioColumn[]>(
        () => [
            ...model.fields,
            ...model.evaluators.flatMap((group) => group.columns),
            ...model.metrics,
        ],
        [model],
    )
    const sortColumn = sort ? allColumns.find((column) => column.key === sort.key) : undefined
    const visible = useMemo(
        () => ({
            fields: fields.filter((column) => !hidden.has(column.key)),
            evaluators: evaluators
                .map((group) => ({
                    ...group,
                    columns: group.columns.filter((column) => !hidden.has(column.key)),
                }))
                .filter((group) => group.columns.length > 0),
            metrics: model.metrics.filter((column) => !hidden.has(column.key)),
        }),
        [fields, evaluators, model.metrics, hidden],
    )

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

    const runWide = catalog.find((entry) => entry.id === "duration" && entry.statsAreRunWide)
    // Every row once all loaded. Before that, the run-wide count of app calls, which can miss a
    // scenario with no duration, so never fewer than the loaded rows.
    const runWideCount = runWide?.stats?.count
    const total = !scenarios.hasMore
        ? rows.length
        : runWideCount !== undefined
          ? Math.max(runWideCount, rows.length)
          : null
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
        [t],
    )
    const hideColumns = useCallback(
        (keys: string[], hide: boolean) =>
            updateView((current) => setColumnsHidden(current, model, keys, hide)),
        [model, updateView],
    )
    // Hiding the label column leaves the table with no label column.
    const onHide = useCallback(
        (key: string) =>
            updateView((current) => {
                const next = setColumnsHidden(current, model, [key], true)
                return key === labelColumnKey(model, current) ? {...next, label: null} : next
            }),
        [model, updateView],
    )
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
    // Annotate opens the run's queue at the scenario; a run with no queue opens the drawer.
    const annotate = useCallback(
        (scenarioId: string) => {
            const {workspace_id: workspaceId, project_id: projectId} = router.query
            if (queueId && typeof workspaceId === "string" && typeof projectId === "string") {
                void router.push(
                    queueHref(`/w/${workspaceId}/p/${projectId}`, queueId, {scenarioId}),
                )
                return
            }
            focusScenario(scenarioId)
        },
        [router, queueId, focusScenario],
    )
    const onAnnotate = useCallback((row: ScenarioRow) => annotate(row.scenario.id), [annotate])

    // A bounded body keeps the header in place while the rows scroll.
    const {boxRef, height: bodyHeight} = useTableBodyHeight(
        entries.length * (ROW_HEIGHT[view.rowHeight] + 1),
    )

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
                                    // The label column keeps its place for when it is not the label.
                                    order: moveKey(
                                        [
                                            ...orderedByKeys(model.fields, current.order),
                                            ...evaluators,
                                        ].map((item) => item.key),
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
                <div ref={boxRef}>
                    <ScenarioTable
                        entries={entries}
                        label={label}
                        fields={visible.fields}
                        evaluators={visible.evaluators}
                        metrics={visible.metrics}
                        view={view}
                        comparing={comparing}
                        isHumanRun={isHumanRun}
                        sort={sort}
                        fieldLabel={fieldLabel}
                        emptyText={empty}
                        loading={lookingForMatches}
                        height={bodyHeight}
                        onSort={setSort}
                        onWidth={onWidth}
                        onWidths={onWidths}
                        onHide={onHide}
                        onOpen={openRow}
                        onAnnotate={onAnnotate}
                        onRetry={scenarios.retryValues}
                        reviewCounts={reviewCounts}
                        onLoadMore={
                            scenarios.hasMore &&
                            !scenarios.isFetchingMore &&
                            !scenarios.loadMoreError
                                ? scenarios.loadMore
                                : undefined
                        }
                    />
                </div>
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
                                    onClick={() => annotate(entry.base.scenario.id)}
                                />
                            ) : null}
                        </>
                    )}
                />
            )}
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
                    // A table with its own scroll loads from it; cards, and a table whose rows
                    // fit, load when the footer comes into view.
                    watchScroll={!isTable || bodyHeight === undefined}
                />
            ) : null}
        </div>
    )
}
