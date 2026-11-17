import {Alert, Button} from "@agenta/ui/ui"

import {ChartSkeleton} from "../../states/ChartSkeleton"
import {OverviewEmpty} from "../../states/OverviewEmpty"

import {CompareMetricCard} from "./CompareMetricCard"
import type {CompareRunOverview} from "./useCompareOverview"

const GRID = "grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3"

/**
 * One card per evaluator metric that any compared run reports, in the order the base run lists
 * them, then the metrics only the other runs have.
 */
export const CompareMetricCards = ({
    runs,
    onRetry,
}: {
    runs: readonly CompareRunOverview[]
    onRetry: () => void
}) => {
    const ids = [
        ...new Set(
            runs.flatMap((run) =>
                run.metrics.filter((metric) => metric.kind === "evaluator").map((m) => m.id),
            ),
        ),
    ]
    const failed = runs.some((run) => run.metricsError)

    if (ids.length === 0 && runs.some((run) => run.metricsPending)) {
        return (
            <div aria-busy className={GRID}>
                {[0, 1, 2].map((index) => (
                    <ChartSkeleton key={index} label="Preparing evaluator metrics" height={220} />
                ))}
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-4">
            {failed ? (
                <Alert
                    type="error"
                    showIcon
                    message="Unable to load evaluator metrics"
                    action={
                        <Button size="sm" onClick={onRetry}>
                            Try again
                        </Button>
                    }
                />
            ) : null}
            {ids.length === 0 && !failed ? (
                <OverviewEmpty
                    title="No metric values generated"
                    description="The evaluator metrics defined for these runs did not emit any values."
                />
            ) : (
                <div className={GRID}>
                    {ids.map((id) => (
                        <CompareMetricCard
                            key={id}
                            runs={runs.map((run) => ({
                                runId: run.runId,
                                slot: run.slot,
                                name: run.header?.name ?? run.runId,
                                metric: run.metrics.find((metric) => metric.id === id) ?? null,
                            }))}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}
