import {useMemo} from "react"

import {
    buildEvaluatorRows,
    passedTestCases,
    runFailures,
    runTiles,
    type PassedState,
    type RunHeader,
    type RunReferences,
} from "@agenta/entities/evaluationRun"

import {EvaluatorResultsSection} from "./EvaluatorResultsSection"
import {RunFailuresAlert} from "./RunFailuresAlert"
import {RunMetaTiles} from "./RunMetaTiles"
import type {OverviewMetric, OverviewNames, ScenarioMetricsState} from "./useRunOverview"

export interface RunOverviewViewProps {
    runId: string
    header: RunHeader
    references: RunReferences | null
    metrics: readonly OverviewMetric[]
    metricsPending: boolean
    metricsError: Error | null
    names: OverviewNames
    scenarioMetrics: ScenarioMetricsState
    onRetryMetrics?: () => void
}

/** The Overview tab: the meta tiles, then one table row per evaluator (and charts over time online). */
export const RunOverviewView = ({
    runId,
    header,
    references,
    metrics,
    metricsPending,
    metricsError,
    names,
    scenarioMetrics,
    onRetryMetrics,
}: RunOverviewViewProps) => {
    const online = header.kind === "online"

    const rows = useMemo(
        () =>
            buildEvaluatorRows(
                (references?.evaluators ?? []).map((evaluator) => ({
                    stepKey: evaluator.stepKey,
                    evaluatorId: evaluator.evaluatorId,
                    name: names.evaluators[evaluator.evaluatorId] ?? evaluator.slug,
                })),
                metrics,
                {runWideOnly: online},
            ),
        [references, names.evaluators, metrics, online],
    )

    const failures = useMemo(() => {
        if (scenarioMetrics.status !== "ready") return null
        return runFailures(
            scenarioMetrics.rows,
            scenarioMetrics.failedSteps,
            (references?.evaluators ?? []).map((evaluator) => evaluator.stepKey),
        )
    }, [scenarioMetrics, references])

    const tiles = useMemo(() => {
        const binary = rows.flatMap((row) => row.metrics.filter((m) => m.kind === "binary"))
        // Without the complete failed steps, a test case that did not run could count as passed.
        const counted =
            scenarioMetrics.status === "ready" && failures
                ? passedTestCases(scenarioMetrics.rows, binary, failures.notRunIds)
                : null
        const passed: PassedState =
            scenarioMetrics.status === "ready"
                ? counted
                    ? {status: "ready", ...counted}
                    : {status: "unavailable"}
                : scenarioMetrics
        return runTiles({
            status: header.status,
            online,
            invocation: metrics.filter((metric) => metric.kind === "invocation"),
            binaryStats: binary.map((metric) => metric.stats),
            passed,
            metricsPending,
            failures,
        })
    }, [rows, scenarioMetrics, header.status, online, metrics, metricsPending, failures])

    const failed = failures && failures.notRun + failures.evaluatorFailed > 0

    return (
        <div className="flex flex-col gap-6">
            {failed ? <RunFailuresAlert failures={failures} /> : null}
            <RunMetaTiles tiles={tiles} online={online} />
            <EvaluatorResultsSection
                runId={runId}
                runName={header.name}
                online={online}
                human={header.kind === "human"}
                rows={rows}
                noResultByStep={failures?.byStep}
                metrics={metrics}
                hasEvaluators={(references?.evaluators.length ?? 0) > 0}
                pending={metricsPending}
                error={metricsError}
                onRetry={onRetryMetrics}
            />
        </div>
    )
}
