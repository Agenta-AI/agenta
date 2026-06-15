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
    | "is_queue"
    | "has_queries"
    | "has_testsets"
    | "has_evaluators"
    | "has_custom"
    | "has_human"
    | "has_auto"

export const EVALUATION_KIND_LABELS: Record<ConcreteEvaluationRunKind, string> = {
    auto: "Auto",
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

const HUMAN_METRICS: RunMetricDescriptor[] = []

const ONLINE_METRICS: RunMetricDescriptor[] = []

const CUSTOM_METRICS: RunMetricDescriptor[] = []

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

/**
 * Canonical invocation-metric column keys + labels (cost / duration / tokens / errors).
 * Relocated from `@/oss/.../OverviewView/constants` (WP-4h-4) so both the run-list columns
 * and the (still-OSS) run-details overview read one source. The OSS file re-exports these.
 */
export const INVOCATION_METRIC_KEYS = [
    "attributes.ag.metrics.costs.cumulative.total",
    "attributes.ag.metrics.duration.cumulative",
    "attributes.ag.metrics.tokens.cumulative.total",
    "attributes.ag.metrics.errors.cumulative",
] as const

export const INVOCATION_METRIC_LABELS: Record<(typeof INVOCATION_METRIC_KEYS)[number], string> = {
    "attributes.ag.metrics.costs.cumulative.total": "Cost",
    "attributes.ag.metrics.duration.cumulative": "Duration",
    "attributes.ag.metrics.tokens.cumulative.total": "Tokens",
    "attributes.ag.metrics.errors.cumulative": "Errors",
}
