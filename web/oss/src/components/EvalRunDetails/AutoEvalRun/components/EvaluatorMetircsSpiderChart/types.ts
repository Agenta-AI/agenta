export interface MetricData {
    subject: string
    // Normalized values used for plotting (0-100) per series.
    // Base series uses `value`; additional series use keys like `value-2`, `value-3`, ...
    value?: number
    [key: string]: any
    // Raw value and axis-specific max for tooltip/labels (base series)
    rawValue: number
    maxScore: number
    type?: "binary" | "numeric"
}

export interface SeriesMeta {
    key: string // e.g. "value", "value-2", ...
    color: string
    name?: string
}

export interface EvaluatorMetricsSpiderChartProps {
    className?: string
    metrics: {
        name: string
        // Base value; additional series are passed via dynamic props (e.g., value-2)
        value?: number
        [key: string]: any
        maxScore: number
        type: "binary" | "numeric"
    }[]
    maxScore?: number
    series?: SeriesMeta[]
}
