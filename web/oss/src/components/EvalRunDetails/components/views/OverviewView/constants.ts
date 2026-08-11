import {CHART_SERIES_LIGHT} from "@/oss/lib/helpers/chartPalette"

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

// The categorical series set (recolor spec), in fixed order. These feed recharts `fill`/`stroke`
// attributes from non-React modules, so they carry the light order in both themes; the mid steps
// (#54B5FA, #D9D92C) still read on the dark ground as fills.
export const SPIDER_SERIES_COLORS = CHART_SERIES_LIGHT
export const DEFAULT_SPIDER_SERIES_COLOR = SPIDER_SERIES_COLORS[0]
