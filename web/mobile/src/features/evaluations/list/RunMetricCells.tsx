import {useMemo} from "react"

import {
    buildRunStatsMap,
    deriveEvaluationKind,
    formatMetricValue,
    runLevelMetricsQueryAtomFamily,
    selectRunMetricStats,
    type EvaluationMetric,
    type EvaluationRun,
    type RunListColumns,
} from "@agenta/entities/evaluationRun"
import {atom, useAtomValue} from "jotai"

import {RunMetricValue} from "./RunMetricValue"

const IDLE = atom<{data: EvaluationMetric[] | undefined; isPending: boolean; isError: boolean}>({
    data: undefined,
    isPending: true,
    isError: false,
})

/**
 * The metric cells of one run, in column order: one per evaluator metric, then cost, duration,
 * tokens and errors. The run-level metrics load once the row is near the screen; the runs that
 * ask in the same frame share one request. A live run shows its latest window, as the old list
 * does.
 */
export const RunMetricCells = ({
    run,
    columns,
    inView,
}: {
    run: EvaluationRun
    columns: RunListColumns
    inView: boolean
}) => {
    const query = useAtomValue(inView ? runLevelMetricsQueryAtomFamily(run.id) : IDLE)
    const metrics = query.data
    const live = deriveEvaluationKind(run) === "online"
    const stats = useMemo(
        () => (metrics ? buildRunStatsMap(run, metrics, live ? "latest" : "static") : null),
        [run, metrics, live],
    )
    const state = stats ? "ready" : query.isError ? "error" : "loading"

    return (
        <>
            {columns.evaluators.flatMap((group) =>
                group.columns.map((column) => {
                    const stepKey = column.stepKeysByRunId[run.id]
                    // The run has no such evaluator: an empty cell, as in the old list.
                    if (!stepKey) return <span key={column.id} />
                    const value = stats
                        ? selectRunMetricStats(stats, {metricKey: column.metricKey, stepKey})
                        : null
                    return (
                        <RunMetricValue
                            key={column.id}
                            kind="evaluator"
                            state={state}
                            stats={value}
                            text={formatMetricValue(column.metricKey, value)}
                        />
                    )
                }),
            )}
            {columns.invocation.map((column) => {
                const value = stats
                    ? selectRunMetricStats(stats, {metricKey: column.metricKey})
                    : null
                return (
                    <RunMetricValue
                        key={column.id}
                        kind="invocation"
                        state={state}
                        stats={value}
                        text={formatMetricValue(column.metricKey, value)}
                    />
                )
            })}
        </>
    )
}
