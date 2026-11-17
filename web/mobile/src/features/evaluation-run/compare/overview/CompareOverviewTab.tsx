import {useMemo} from "react"

import {runLevelMetricsQueryAtomFamily} from "@agenta/entities/evaluationRun"
import {useStore} from "jotai"

import {RunRadarCard} from "../../overview/RunRadarCard"
import {useRunReferenceLinks} from "../../overview/useRunReferenceLinks"

import {CompareMetricCards} from "./CompareMetricCards"
import {buildCompareSummaryRows} from "./compareSummaryRows"
import {CompareSummaryTable} from "./CompareSummaryTable"
import {useCompareOverview} from "./useCompareOverview"

/**
 * The Overview tab while runs are compared, as in the old app: the summary with one column per
 * run, the radar with one series per run, and one card per evaluator metric with a bar per run.
 */
export const CompareOverviewTab = ({
    runId,
    compareIds,
}: {
    runId: string
    compareIds: readonly string[]
}) => {
    const runIds = useMemo(() => [runId, ...compareIds], [runId, compareIds])
    const runs = useCompareOverview(runIds)
    const links = useRunReferenceLinks()
    const store = useStore()
    const rows = useMemo(() => buildCompareSummaryRows(runs, links), [runs, links])
    const columns = useMemo(
        () =>
            runs.map((run) => ({
                runId: run.runId,
                slot: run.slot,
                name: run.header?.name ?? "…",
            })),
        [runs],
    )
    const radarRuns = useMemo(
        () =>
            runs.map((run) => ({
                id: run.runId,
                name: run.header?.name ?? run.runId,
                metrics: run.metrics,
            })),
        [runs],
    )
    const retry = () => {
        for (const run of runs) {
            if (run.metricsError)
                void store.get(runLevelMetricsQueryAtomFamily(run.runId)).refetch()
        }
    }

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
                    <CompareSummaryTable runs={columns} rows={rows} />
                    <RunRadarCard
                        runs={radarRuns}
                        pending={runs.some((run) => run.metricsPending)}
                    />
                </div>
            </section>
            <CompareMetricCards runs={runs} onRetry={retry} />
        </div>
    )
}
