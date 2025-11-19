import type {MetricColumnDefinition} from "../atoms/table/types"

// Centralized column widths for easy reuse
export const COLUMN_WIDTHS = {
    input: 200,
    groundTruth: 200,
    response: 400,
    action: 140,
    metric: 100,
    padding: 100,
} as const

// Table layout constants
export const TABLE_LAYOUT = {
    rowHeight: 54, // approximate height of one table row (px)
} as const

export const SKELETON_ROW_COUNT = 5

export const GeneralAutoEvalMetricColumns: MetricColumnDefinition[] = [
    {
        name: "Cost (Total)",
        kind: "metric",
        path: "attributes.ag.metrics.costs.cumulative.total",
        stepKey: "metric",
        metricType: "number",
    },
    {
        name: "Duration (Total)",
        kind: "metric",
        path: "attributes.ag.metrics.duration.cumulative",
        stepKey: "metric",
        metricType: "number",
    },
    {
        name: "Tokens (Total)",
        kind: "metric",
        path: "attributes.ag.metrics.tokens.cumulative.total",
        stepKey: "metric",
        metricType: "number",
    },
    {
        name: "Errors",
        kind: "metric",
        path: "attributes.ag.metrics.errors.cumulative",
        stepKey: "metric",
        metricType: "number",
    },
]

// Human evaluations now share the same metric output shape as auto evaluations.
export const GeneralHumanEvalMetricColumns = GeneralAutoEvalMetricColumns
