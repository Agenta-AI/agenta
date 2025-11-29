export interface ChartDatum {
    name: string
    value: number
    edge?: number
}

export interface MetricFormatter {
    prefix?: string
    suffix?: string
    decimals?: number
    multiplier?: number
    format?: (value: string | number) => string
}
