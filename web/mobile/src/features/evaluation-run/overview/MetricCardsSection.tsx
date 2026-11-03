import {useEffect} from "react"

import {Alert} from "@agenta/ui/ui"

import {ChartSkeleton} from "../states/ChartSkeleton"
import {OverviewEmpty} from "../states/OverviewEmpty"

import {MetricCard} from "./MetricCard"
import {TemporalMetricCard} from "./TemporalMetricCard"
import type {OverviewMetric} from "./useRunOverview"

const GRID = "grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3"

/**
 * One card per evaluator metric: a distribution for a finished run, a time chart for an online
 * run. Invocation metrics stay in the summary table.
 */
export const MetricCardsSection = ({
    runId,
    runName,
    online,
    metrics,
    hasEvaluators,
    pending,
    error,
}: {
    runId: string
    runName: string
    online: boolean
    metrics: readonly OverviewMetric[]
    hasEvaluators: boolean
    pending: boolean
    error: Error | null
}) => {
    const cards = metrics.filter((metric) => metric.kind === "evaluator")

    useEffect(() => {
        if (error) console.error("[RunOverview] metrics failed to load", error)
    }, [error])

    if (cards.length === 0 && error) {
        return <Alert type="error" showIcon message="Unable to load evaluator metrics" />
    }
    if (cards.length === 0 && pending) {
        return (
            <div aria-busy className={GRID}>
                {[0, 1, 2].map((index) => (
                    <ChartSkeleton key={index} label="Preparing evaluator metrics" height={220} />
                ))}
            </div>
        )
    }
    if (cards.length === 0) {
        if (online) {
            return (
                <OverviewEmpty
                    title="Temporal evaluator metrics"
                    description="We will chart evaluator scores here as soon as this online run collects trace results for the selected evaluators."
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

    const Card = online ? TemporalMetricCard : MetricCard
    return (
        <div className={GRID}>
            {cards.map((metric) => (
                <Card key={metric.id} metric={metric} runId={runId} runName={runName} />
            ))}
        </div>
    )
}
