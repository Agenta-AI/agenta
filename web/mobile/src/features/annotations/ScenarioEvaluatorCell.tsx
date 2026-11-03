import {annotationSessionController} from "@agenta/annotation"
import {MetricValueDisplay} from "@agenta/ui/cell-renderers"
import {useAtomValue} from "jotai"

import type {EvaluatorMetric} from "./scenarioListColumns"

const MetricLine = ({scenarioId, metric}: {scenarioId: string; metric: EvaluatorMetric}) => {
    const {value} = useAtomValue(
        annotationSessionController.selectors.scenarioMetricForEvaluator({
            scenarioId,
            ...metric.lookup,
        }),
    )
    return (
        <span className="flex min-w-0 items-center gap-1 text-[13px]">
            <span className="shrink-0 text-muted-foreground">{metric.title}:</span>
            <MetricValueDisplay value={value} className="min-w-0 truncate" />
        </span>
    )
}

/** One evaluator's metrics for an item, stacked as `metric: value`. */
export const ScenarioEvaluatorCell = ({
    scenarioId,
    metrics,
}: {
    scenarioId: string
    metrics: EvaluatorMetric[]
}) => (
    <span className="flex min-w-0 flex-col gap-0.5">
        {metrics.map((metric) => (
            <MetricLine key={metric.key} scenarioId={scenarioId} metric={metric} />
        ))}
    </span>
)
