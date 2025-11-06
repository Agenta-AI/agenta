// Centralized column widths for easy reuse
export const COLUMN_WIDTHS = {
    input: 400,
    groundTruth: 460,
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

export const GeneralHumanEvalMetricColumns = [
    {
        name: "totalCost",
        kind: "metric",
        path: "totalCost",
        stepKey: "metric",
        metricType: "number",
    },
    {
        name: "Total Duration",
        kind: "metric",
        path: "duration.total",
        stepKey: "metric",
        metricType: "number",
    },
    {
        name: "totalTokens",
        kind: "metric",
        path: "totalTokens",
        stepKey: "metric",
        metricType: "number",
    },
    {
        name: "promptTokens",
        kind: "metric",
        path: "promptTokens",
        stepKey: "metric",
        metricType: "number",
    },
    {
        name: "completionTokens",
        kind: "metric",
        path: "completionTokens",
        stepKey: "metric",
        metricType: "number",
    },
    {
        name: "errors",
        kind: "metric",
        path: "errors",
        stepKey: "metric",
        metricType: "number",
    },
]

export const GeneralAutoEvalMetricColumns = [
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
