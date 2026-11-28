import {
    buildEvaluatorRows,
    passedTestCases,
    runFailures,
    runTiles,
    type EvaluationMetric,
    type EvaluatorRow,
    type FailedStep,
    type PassedState,
    type RunFailures,
    type RunHeader,
    type RunReferences,
    type RunTile,
} from "@agenta/entities/evaluationRun"

import type {OverviewMetric, OverviewNames, ScenarioMetricsState} from "./useRunOverview"

/** The per-test-case query as the overview reads it: ready, loading, or not available. */
export function scenarioMetricsStateOf(query: {
    isSuccess: boolean
    data: {rows: EvaluationMetric[]; failedSteps: FailedStep[]} | undefined
    fetchStatus: string
}): ScenarioMetricsState {
    if (query.isSuccess) {
        return {
            status: "ready",
            rows: query.data?.rows ?? [],
            failedSteps: query.data?.failedSteps ?? [],
        }
    }
    return query.fetchStatus === "fetching" ? {status: "pending"} : {status: "unavailable"}
}

/**
 * The Overview of one run as data: one row per evaluator step, the failed test cases and the meta
 * tiles. The single run and every compared run read it the same way.
 */
export function runOverviewModel({
    header,
    references,
    metrics,
    metricsPending,
    names,
    scenarioMetrics,
}: {
    header: RunHeader
    references: RunReferences | null
    metrics: readonly OverviewMetric[]
    metricsPending: boolean
    names: Pick<OverviewNames, "evaluators">
    scenarioMetrics: ScenarioMetricsState
}): {rows: EvaluatorRow[]; failures: RunFailures | null; tiles: RunTile[]} {
    const online = header.kind === "online"
    const rows = buildEvaluatorRows(
        (references?.evaluators ?? []).map((evaluator) => ({
            stepKey: evaluator.stepKey,
            evaluatorId: evaluator.evaluatorId,
            name: names.evaluators[evaluator.evaluatorId] ?? evaluator.slug,
        })),
        metrics,
        {runWideOnly: online},
    )

    const failures: RunFailures | null =
        scenarioMetrics.status === "ready"
            ? runFailures(
                  scenarioMetrics.rows,
                  scenarioMetrics.failedSteps,
                  (references?.evaluators ?? []).map((evaluator) => evaluator.stepKey),
              )
            : null

    const binary = rows.flatMap((row) => row.metrics.filter((m) => m.kind === "binary"))
    const counted =
        scenarioMetrics.status === "ready"
            ? passedTestCases(scenarioMetrics.rows, binary, failures?.notRunIds ?? new Set())
            : null
    const passed: PassedState =
        scenarioMetrics.status === "ready"
            ? counted
                ? {status: "ready", ...counted}
                : {status: "unavailable"}
            : scenarioMetrics
    const tiles = runTiles({
        status: header.status,
        online,
        invocation: metrics.filter((metric) => metric.kind === "invocation"),
        binaryStats: binary.map((metric) => metric.stats),
        passed,
        metricsPending,
        failures,
    })
    return {rows, failures, tiles}
}
