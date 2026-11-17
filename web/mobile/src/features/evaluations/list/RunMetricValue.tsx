import {runMetricCellView, type MetricStats} from "@agenta/entities/evaluationRun"
import {EvaluatorMetricBar} from "@agenta/ui/cell-renderers"
import {SkeletonBlock} from "@agenta/ui/ui"

/**
 * One metric of one run, as the old list draws it: a true/false bar with the share of true, the
 * most frequent value of a category metric, else the value as text ("$0.0012", "522ms", "0.85").
 */
export const RunMetricValue = ({
    kind,
    state,
    stats,
    text,
}: {
    kind: "evaluator" | "invocation"
    state: "loading" | "error" | "ready"
    stats: MetricStats | null
    text: string
}) => {
    if (state === "loading") return <SkeletonBlock active className="h-4 w-1/2 rounded" />
    if (state === "error") return <span className="text-[13px] text-muted-foreground">—</span>
    const view = runMetricCellView(kind, stats, text)
    if (view.kind === "bar") {
        return (
            <span className="block min-w-0">
                <EvaluatorMetricBar segments={view.segments} width={140} />
            </span>
        )
    }
    return <span className="block truncate text-[13px] text-foreground">{view.text}</span>
}
