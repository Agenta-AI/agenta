import {useMemo} from "react"

import type {RunHeader, RunQueryConfig, RunReferences} from "@agenta/entities/evaluationRun"

import {MetricCardsSection} from "./MetricCardsSection"
import {RunRadarCard, showsRadar, useRunRadar} from "./RunRadarCard"
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
    links?: RunReferenceLinks
    /** A live run's query; undefined while it loads. */
    query?: RunQueryConfig | null
    onRetryMetrics?: () => void
}

/** The Overview tab: the run summary (with a radar when there are three metrics or more), then one card per evaluator metric. */
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
            buildRunSummaryRows({header, references, metrics, metricsPending, names, links, query}),
        [header, references, metrics, metricsPending, names, links, query],
    )

    const radarRuns = useMemo(
        () => [{id: runId, name: header.name, metrics}],
        [runId, header.name, metrics],
    )
    const radar = useRunRadar(radarRuns)
    const withRadar = showsRadar(radar.axes.length, metricsPending)

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
                        Run summary
                    </h2>
                    <p className="m-0 text-sm text-muted-foreground">
                        What this run tested and its average results
                    </p>
                </header>
                <div className={`grid grid-cols-1 gap-6 ${withRadar ? "lg:grid-cols-2" : ""}`}>
                    <RunSummaryTable rows={rows} />
                    {withRadar ? <RunRadarCard runs={radarRuns} radar={radar} /> : null}
                </div>
            </section>
            <MetricCardsSection
                runId={runId}
                runName={header.name}
                online={header.kind === "online"}
                human={header.kind === "human"}
                metrics={metrics}
                hasEvaluators={(references?.evaluators.length ?? 0) > 0}
                pending={metricsPending}
                error={metricsError}
                onRetry={onRetryMetrics}
            />
        </div>
    )
}
