import {useMemo} from "react"

import type {RunHeader, RunQueryConfig, RunReferences} from "@agenta/entities/evaluationRun"

import {MetricCardsSection} from "./MetricCardsSection"
import {RunRadarCard} from "./RunRadarCard"
import {buildRunSummaryRows} from "./runSummaryRows"
import {RunSummaryTable} from "./RunSummaryTable"
import type {OverviewMetric, OverviewNames} from "./useRunOverview"
import type {RunReferenceLinks} from "./useRunReferenceLinks"

export interface RunOverviewViewProps {
    runId: string
    header: RunHeader
    references: RunReferences | null
    metrics: readonly OverviewMetric[]
    metricsPending: boolean
    metricsError: Error | null
    names: OverviewNames
    /** A live run's query; undefined while it loads. */
    query?: RunQueryConfig | null
    links?: RunReferenceLinks
    onRetryMetrics?: () => void
}

/** The Overview tab's layout: the run summary with its radar, then one card per evaluator metric. */
export const RunOverviewView = ({
    runId,
    header,
    references,
    metrics,
    metricsPending,
    metricsError,
    names,
    links,
    query,
    onRetryMetrics,
}: RunOverviewViewProps) => {
    const rows = useMemo(
        () =>
            buildRunSummaryRows({header, references, metrics, metricsPending, names, query, links}),
        [header, references, metrics, metricsPending, names, query, links],
    )

    return (
        <div className="flex flex-col gap-6">
            <section
                aria-labelledby="run-overview-title"
                className="box-border flex flex-col gap-4 rounded-lg border border-solid border-border bg-card p-4"
            >
                <header>
                    <h2
                        id="run-overview-title"
                        className="m-0 text-base font-semibold text-foreground"
                    >
                        Evaluator Scores Overview
                    </h2>
                    <p className="m-0 text-sm text-muted-foreground">
                        Average evaluator score across evaluations
                    </p>
                </header>
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <RunSummaryTable rows={rows} />
                    <RunRadarCard
                        runId={runId}
                        runName={header.name}
                        metrics={metrics}
                        pending={metricsPending}
                    />
                </div>
            </section>
            <MetricCardsSection
                runId={runId}
                runName={header.name}
                online={header.kind === "online"}
                metrics={metrics}
                hasEvaluators={(references?.evaluators.length ?? 0) > 0}
                pending={metricsPending}
                error={metricsError}
                onRetry={onRetryMetrics}
            />
        </div>
    )
}
