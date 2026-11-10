export interface ChartSeries {
    /** Data key in each datum, axis or point. */
    key: string
    /** Legend and tooltip name. */
    name: string
    /** CSS color. Default: `var(--ag-chart-series-{index % 5})`. */
    color?: string
}

export interface ChartBaseProps {
    /** Accessible name of the chart. It is not drawn; the caller draws its own heading. */
    title: string
    /** Height of the plot in px. The chart fills the width of its parent. */
    height: number
    series: readonly ChartSeries[]
    /** Default: 3 significant digits. */
    formatValue?: (value: number) => string
    className?: string
}

export interface BarChartDatum {
    /** X label, also the row key. */
    category: string
    /** By series key. `null` draws no bar. */
    values: Readonly<Record<string, number | null>>
}

export interface BarChartProps extends ChartBaseProps {
    data: readonly BarChartDatum[]
    /** Fixed upper bound, for example 100 for percentages. Default: a nice max of the data. */
    yMax?: number
}

export interface RadarAxis {
    name: string
    /** Shown in the tooltip as "raw / max". */
    max: number
    /** By series key; `normalized` is 0..1. `null` leaves the vertex out. */
    values: Readonly<Record<string, {normalized: number; raw: number} | null>>
}

export interface RadarChartProps extends ChartBaseProps {
    /** Fewer than 3 axes renders nothing. */
    axes: readonly RadarAxis[]
    formatAxisValue?: (raw: number, axis: RadarAxis) => string
}

export interface LinePoint {
    /** Time in ms since the epoch. */
    x: number
    /** By series key. `null` breaks the line. */
    values: Readonly<Record<string, number | null>>
}

export interface LineChartProps extends ChartBaseProps {
    /** Sorted by x ascending; the chart sorts a copy when they are not. */
    points: readonly LinePoint[]
    formatX?: (x: number) => string
    yDomain?: readonly [number, number]
}
