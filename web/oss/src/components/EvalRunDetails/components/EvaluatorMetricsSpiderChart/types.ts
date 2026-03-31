export interface MetricData {
    subject: string
    value?: number
    [key: string]: any
    rawValue: number
    maxScore: number
    type?: "binary" | "numeric"
}

export interface SeriesMeta {
    key: string
    color: string
    name?: string
}

export interface EvaluatorMetricsSpiderChartProps {
    className?: string
    metrics: {
        name: string
        value?: number
        [key: string]: any
        maxScore: number
        type: "binary" | "numeric"
    }[]
    maxScore?: number
    series?: SeriesMeta[]
}
