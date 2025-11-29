import type {ConcreteEvaluationRunKind, EvaluationRunKind} from "./types"
import type {RunMetricDescriptor} from "./types/runMetrics"

export const STATUS_OPTIONS: {label: string; value: string}[] = [
    {label: "Pending", value: "pending"},
    {label: "Queued", value: "queued"},
    {label: "Running", value: "running"},
    {label: "Success", value: "success"},
    {label: "Failure", value: "failure"},
    {label: "Errors", value: "errors"},
    {label: "Cancelled", value: "cancelled"},
]

export type FlagKey =
    | "is_live"
    | "is_active"
    | "is_closed"
    | "has_queries"
    | "has_testsets"
    | "has_evaluators"
    | "has_custom"
    | "has_human"
    | "has_auto"

export const FLAG_LABELS: Record<FlagKey, string> = {
    is_live: "Live",
    is_active: "Active",
    is_closed: "Closed",
    has_queries: "Has queries",
    has_testsets: "Has testsets",
    has_evaluators: "Has evaluators",
    has_custom: "Custom evaluators",
    has_human: "Human evaluators",
    has_auto: "Auto evaluators",
}

export const EVALUATION_KIND_LABELS: Record<ConcreteEvaluationRunKind, string> = {
    auto: "Automatic",
    human: "Human",
    online: "Online",
    custom: "SDK",
}

export const EVALUATION_KIND_FILTER_OPTIONS: {
    label: string
    value: ConcreteEvaluationRunKind
}[] = Object.entries(EVALUATION_KIND_LABELS).map(([value, label]) => ({
    value: value as ConcreteEvaluationRunKind,
    label,
}))

const AUTO_METRICS: RunMetricDescriptor[] = [
    {
        id: "metric-score",
        label: "Score",
        metricKey: "score",
        metricPath: "score",
        kind: "generic",
        width: 140,
    },
    {
        id: "metric-cost",
        label: "Cost (Total)",
        metricKey: "attributes.ag.metrics.costs.cumulative.total",
        metricPath: "attributes.ag.metrics.costs.cumulative.total",
        kind: "generic",
        width: 160,
    },
    {
        id: "metric-duration",
        label: "Duration (Total)",
        metricKey: "attributes.ag.metrics.duration.cumulative",
        metricPath: "attributes.ag.metrics.duration.cumulative",
        kind: "generic",
        width: 160,
    },
]

const HUMAN_METRICS: RunMetricDescriptor[] = [
    {
        id: "metric-score",
        label: "Score",
        metricKey: "score",
        metricPath: "score",
        kind: "generic",
        width: 140,
    },
    {
        id: "metric-votes",
        label: "Votes",
        metricKey: "votes",
        metricPath: "votes",
        kind: "generic",
        width: 140,
    },
]

const ONLINE_METRICS: RunMetricDescriptor[] = [
    {
        id: "metric-conversion",
        label: "Conversion",
        metricKey: "conversion",
        metricPath: "conversion",
        kind: "generic",
        width: 140,
    },
    {
        id: "metric-weighted-score",
        label: "Score",
        metricKey: "score",
        metricPath: "score",
        kind: "generic",
        width: 140,
    },
]

const CUSTOM_METRICS: RunMetricDescriptor[] = [
    {
        id: "metric-score",
        label: "Score",
        metricKey: "score",
        metricPath: "score",
        kind: "generic",
        width: 140,
    },
]

const mergeUniqueMetrics = (...groups: RunMetricDescriptor[][]): RunMetricDescriptor[] => {
    const registry = new Map<string, RunMetricDescriptor>()
    groups.forEach((group) => {
        group.forEach((descriptor) => {
            if (!registry.has(descriptor.id)) {
                registry.set(descriptor.id, descriptor)
            }
        })
    })
    return Array.from(registry.values())
}

const ALL_METRICS = mergeUniqueMetrics(AUTO_METRICS, HUMAN_METRICS, ONLINE_METRICS, CUSTOM_METRICS)

export const METRIC_COLUMN_CONFIG: Record<EvaluationRunKind, RunMetricDescriptor[]> = {
    auto: AUTO_METRICS,
    human: HUMAN_METRICS,
    online: ONLINE_METRICS,
    custom: CUSTOM_METRICS,
    all: ALL_METRICS,
}
