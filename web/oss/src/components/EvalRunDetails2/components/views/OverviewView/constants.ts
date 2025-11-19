export const INVOCATION_METRIC_KEYS = [
    "attributes.ag.metrics.costs.cumulative.total",
    "attributes.ag.metrics.duration.cumulative",
    "attributes.ag.metrics.tokens.cumulative.total",
    "attributes.ag.metrics.errors.cumulative",
] as const

export const INVOCATION_METRIC_LABELS: Record<(typeof INVOCATION_METRIC_KEYS)[number], string> = {
    "attributes.ag.metrics.costs.cumulative.total": "Invocation cost",
    "attributes.ag.metrics.duration.cumulative": "Invocation duration",
    "attributes.ag.metrics.tokens.cumulative.total": "Invocation tokens",
    "attributes.ag.metrics.errors.cumulative": "Invocation errors",
}

export const DEFAULT_SPIDER_SERIES_COLOR = "#3B82F6"
export const SPIDER_SERIES_COLORS = ["#3B82F6", "#2563EB", "#DC2626", "#7C3AED", "#16A34A"]
