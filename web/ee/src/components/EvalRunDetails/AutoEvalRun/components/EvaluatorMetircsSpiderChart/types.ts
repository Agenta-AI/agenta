export interface MetricData {
    subject: string
    // Normalized value used for plotting (0-100)
    value: number
    // Raw value and axis-specific max for tooltip/labels
    rawValue: number
    maxScore: number
}

export interface EvaluatorMetricsSpiderChartProps {
    className?: string
    metrics: Array<{
        name: string
        value: number
        maxScore: number
        type: "binary" | "numeric"
    }>
    maxScore?: number
}
