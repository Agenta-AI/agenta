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
