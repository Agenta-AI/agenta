import {useEffect} from "react"

import {isAggregatableMetric, metricKind, type EvaluatorRow} from "@agenta/entities/evaluationRun"
import {useT} from "@agenta/i18n"
import runOverviewCatalog from "@agenta/i18n/catalogs/evaluations.runOverview"
import evaluationScreensCatalog from "@agenta/i18n/catalogs/evaluations.screens"
import annotateCatalog from "@agenta/i18n/catalogs/observability.annotate"
import {Alert, Button} from "@agenta/ui/ui"

import {EvaluatorTableSkeleton} from "../states/EvaluatorTableSkeleton"
import {OverviewEmpty} from "../states/OverviewEmpty"

import {EvaluatorTable} from "./EvaluatorTable"
import {TemporalMetricCard} from "./TemporalMetricCard"
import type {OverviewMetric} from "./useRunOverview"

const GRID = "grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3"

/**
 * The evaluator results: one table row per evaluator step, and for an online run its charts over
 * time under "Over time". Also the loading, empty and error states of the metrics.
 */
export const EvaluatorResultsSection = ({
    runId,
    runName,
    online,
    human = false,
    rows,
    noResultByStep,
    metrics,
    hasEvaluators,
    pending,
    error,
    onRetry,
}: {
    runId: string
    runName: string
    online: boolean
    /** A human run's scores come from annotations, so its empty state asks for them. */
    human?: boolean
    rows: readonly EvaluatorRow[]
    /** By step key: the test cases that ran where the evaluator failed. */
    noResultByStep?: Readonly<Record<string, number>>
    metrics: readonly OverviewMetric[]
    hasEvaluators: boolean
    pending: boolean
    error: Error | null
    onRetry?: () => void
}) => {
    const t = useT(evaluationScreensCatalog, annotateCatalog, runOverviewCatalog)
    // Text metrics have no row, so a run with only text metrics gets the empty state.
    const evaluatorMetrics = metrics.filter(
        (metric) => metric.kind === "evaluator" && metricKind(metric.stats) !== "text",
    )

    useEffect(() => {
        if (error) console.error("[RunOverview] metrics failed to load", error)
    }, [error])

    if (evaluatorMetrics.length === 0 && error) {
        return (
            <Alert
                type="error"
                showIcon
                message="Unable to load evaluator metrics"
                action={
                    onRetry ? (
                        <Button size="sm" onClick={onRetry}>
                            Try again
                        </Button>
                    ) : undefined
                }
            />
        )
    }
    if (evaluatorMetrics.length === 0 && pending) {
        return <EvaluatorTableSkeleton label={t("evaluations.runOverview.preparingMetrics")} />
    }
    if (evaluatorMetrics.length === 0) {
        if (online) {
            return (
                <OverviewEmpty
                    title="Temporal evaluator metrics"
                    description="We will chart evaluator scores here as soon as this online run collects trace results for the selected evaluators."
                />
            )
        }
        if (human && hasEvaluators) {
            return (
                <OverviewEmpty
                    title={t("observability.annotate.noAnnotations")}
                    description={t("evaluations.screens.annotateToSeeScores")}
                />
            )
        }
        return hasEvaluators ? (
            <OverviewEmpty
                title="No metric values generated"
                description="The evaluator metrics defined for this run did not emit any values. Check evaluator configurations or rerun with evaluation outputs enabled."
            />
        ) : (
            <OverviewEmpty
                title="No evaluator metrics available"
                description="This run does not include evaluator metrics yet. Trigger a run with evaluators to see charts here."
            />
        )
    }

    const overTime = online
        ? evaluatorMetrics.filter((metric) => isAggregatableMetric(metric.stats))
        : []

    return (
        <div className="flex flex-col gap-6">
            {error ? (
                <Alert
                    type="error"
                    showIcon
                    message="Unable to refresh evaluator metrics. The scores below may be out of date."
                    action={
                        onRetry ? (
                            <Button size="sm" onClick={onRetry}>
                                Try again
                            </Button>
                        ) : undefined
                    }
                />
            ) : null}
            <EvaluatorTable rows={rows} noResultByStep={noResultByStep} />
            {overTime.length > 0 ? (
                <section aria-labelledby="run-over-time" className="flex flex-col gap-3">
                    <h2 id="run-over-time" className="m-0 text-subtitle text-foreground">
                        {t("evaluations.runOverview.overTime")}
                    </h2>
                    <div className={GRID}>
                        {overTime.map((metric) => (
                            <TemporalMetricCard
                                key={metric.id}
                                metric={metric}
                                runId={runId}
                                runName={runName}
                            />
                        ))}
                    </div>
                </section>
            ) : null}
        </div>
    )
}
