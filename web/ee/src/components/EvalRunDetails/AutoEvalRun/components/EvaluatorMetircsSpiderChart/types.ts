export interface MetricData {
    subject: string
    value: number
    fullMark?: number
}

export interface EvaluatorMetricsSpiderChartProps {
    className?: string
    metrics: Array<{
        name: string
        value: number
    }>
    maxScore?: number
}