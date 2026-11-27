import {useMemo} from "react"

import type {RunHeader, RunReferences} from "@agenta/entities/evaluationRun"

import {EvaluatorResultsSection} from "./EvaluatorResultsSection"
import {RunFailuresAlert} from "./RunFailuresAlert"
import {RunMetaTiles} from "./RunMetaTiles"
import {runOverviewModel} from "./runOverviewModel"
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

    const {rows, failures, tiles} = useMemo(
        () =>
            runOverviewModel({header, references, metrics, metricsPending, names, scenarioMetrics}),
        [header, references, metrics, metricsPending, names, scenarioMetrics],
    )

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
