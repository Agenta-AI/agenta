import {useEffect, useMemo} from "react"

import {
    buildCompareEvaluatorRows,
    buildCompareSummaryRows,
    compareRoles,
    runLevelMetricsQueryAtomFamily,
    runScenarioMetricsQueryAtomFamily,
} from "@agenta/entities/evaluationRun"
import {Alert, Button} from "@agenta/ui/ui"
import {useStore} from "jotai"

import {runOverviewModel} from "../../overview/runOverviewModel"
import {EvaluatorTableSkeleton} from "../../states/EvaluatorTableSkeleton"
import {OverviewEmpty} from "../../states/OverviewEmpty"

import {CompareEvaluatorTable} from "./CompareEvaluatorTable"
import {CompareSummaryTable, type CompareColumn} from "./CompareSummaryTable"
import {useCompareOverview} from "./useCompareOverview"

/**
 * The Overview tab while runs are compared, in the shape of one run: the summary with one column
 * per run and the change of the newest run against the run before it, then one row per evaluator
 * with one line per run for each metric.
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
    const store = useStore()

    const {columns, summary, rows} = useMemo(() => {
        const models = runs.map((run) =>
            run.header
                ? runOverviewModel({
                      header: run.header,
                      references: run.references,
                      metrics: run.metrics,
                      metricsPending: run.metricsPending,
                      names: run.names,
                      scenarioMetrics: run.scenarioMetrics,
                  })
                : null,
        )
        const roles = compareRoles(runs.map((run) => run.header?.createdAt))
        return {
            columns: runs.map(
                (run, index): CompareColumn => ({
                    runId: run.runId,
                    slot: run.slot,
                    name: run.header?.name ?? "…",
                    role:
                        index === roles?.newest
                            ? "newest"
                            : index === roles?.before
                              ? "before"
                              : null,
                }),
            ),
            summary: buildCompareSummaryRows(
                models.map((model) => model?.tiles ?? null),
                roles,
            ),
            rows: buildCompareEvaluatorRows(
                models.map((model) => model?.rows ?? []),
                roles,
            ),
        }
    }, [runs])

    // One text for all failed per-test-case reads, so each failure is logged once.
    const scenarioErrors = runs
        .flatMap((run) => (run.scenarioError ? [`${run.runId}: ${run.scenarioError.message}`] : []))
        .join("\n")
    useEffect(() => {
        if (scenarioErrors) {
            console.error("[CompareOverview] per-test-case metrics failed to load", scenarioErrors)
        }
    }, [scenarioErrors])

    // From the rows, which leave text metrics out, so text-only results show the empty state.
    const hasMetrics = rows.some((row) => row.metrics.length > 0)
    const failed = runs.some((run) => run.metricsError || run.scenarioError)
    const retry = () => {
        for (const run of runs) {
            if (run.metricsError)
                void store.get(runLevelMetricsQueryAtomFamily(run.runId)).refetch()
            if (run.scenarioError)
                void store.get(runScenarioMetricsQueryAtomFamily(run.runId)).refetch()
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <CompareSummaryTable columns={columns} rows={summary} />
            {failed ? (
                <Alert
                    type="error"
                    showIcon
                    message="Unable to load evaluator metrics"
                    action={
                        <Button size="sm" onClick={retry}>
                            Try again
                        </Button>
                    }
                />
            ) : null}
            {hasMetrics ? (
                <CompareEvaluatorTable rows={rows} columns={columns} />
            ) : runs.some((run) => run.metricsPending) ? (
                <EvaluatorTableSkeleton label="Preparing evaluator metrics" />
            ) : failed ? null : (
                <OverviewEmpty
                    title="No metric values generated"
                    description="The evaluator metrics defined for these runs did not emit any values."
                />
            )}
        </div>
    )
}
