import type {ReactNode} from "react"

export interface MetricDetailsPopoverProps {
    metricKey: string
    primaryLabel?: string
    primaryValue?: number | string
    extraDimensions: Record<string, any>
    /** Value to highlight (bin/bar will be inferred from this value) */
    highlightValue?: number | string
    /** Hide primitives key‒value table; useful for lightweight popovers */
    hidePrimitiveTable?: boolean
    /** Force using edge-axis (for debugging) */
    hasEdge?: boolean
    className?: string
    children: ReactNode
}

// helper to transform objects to chart data
export interface ChartDatum {
    name: string | number
    value: number
    edge?: number
}

export interface MetricFormatter {
    /** String to prepend before the numeric value, e.g. "$" */
    prefix?: string
    /** String to append after the numeric value, e.g. "%" */
    suffix?: string
    /** Number of decimal places to round to. If undefined, value is not rounded */
    decimals?: number
    /** Multiplier to apply before formatting */
    multiplier?: number
    /** Optional custom formatter receives numeric value and returns formatted string */
    format?: (value: number | string) => string
}
