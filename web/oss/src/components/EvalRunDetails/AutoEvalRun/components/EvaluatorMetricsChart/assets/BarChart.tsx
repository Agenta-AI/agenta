import {memo, useMemo} from "react"

import {
    Bar,
    CartesianGrid,
    Cell,
    BarChart as RechartsBarChart,
    ResponsiveContainer,
    Tooltip,
    TooltipProps,
    XAxis,
    YAxis,
} from "recharts"

type ChartDatum = Record<string, string | number | boolean | undefined>

interface BarChartProps {
    data: readonly ChartDatum[]
    xKey: string
    yKey: string
    /** optional key in data row that carries the color (e.g. 'color') */
    colorKey?: string

    /** Axis / chart tuning */
    yDomain?: [number | "auto" | "dataMin", number | "auto" | "dataMax"]
    xAxisProps?: Partial<React.ComponentProps<typeof XAxis>>
    yAxisProps?: Partial<React.ComponentProps<typeof YAxis>>
    cartesianGridProps?: Partial<React.ComponentProps<typeof CartesianGrid>>
    chartProps?: Partial<React.ComponentProps<typeof RechartsBarChart>>
    containerProps?: Partial<React.ComponentProps<typeof ResponsiveContainer>>

    /** Bar sizing & spacing */
    barSize?: number // if omitted, width is auto-calculated from gaps
    barGap?: number | string // e.g. 16 or '30%'
    barCategoryGap?: number | string // e.g. 24 or '30%'

    /** Tooltip label for Y value. Pass falsy to hide Tooltip. */
    tooltipLabel?: string
    tooltipFormatter?: (value: number, row: ChartDatum) => string

    /** Per-bar <Cell/> overrides */
    getCellProps?: (row: ChartDatum, index: number) => Partial<React.ComponentProps<typeof Cell>>

    /** Direct pass-through to <Bar/> */
    barProps?: Partial<React.ComponentProps<typeof Bar>>

    className?: string
}

const BarChart = ({
    data,
    xKey,
    yKey,
    colorKey,
    yDomain = ["auto", "auto"],
    xAxisProps,
    yAxisProps,
    cartesianGridProps,
    chartProps,
    containerProps,
    // Use percentage-based gaps by default for consistent spacing across datasets
    barSize,
    barGap = "10%",
    barCategoryGap = "30%",
    tooltipLabel = "Value",
    tooltipFormatter,
    getCellProps,
    barProps,
    className,
}: BarChartProps) => {
    const chartBarSize = !barSize ? undefined : barSize
    const yAxisWidth = typeof yAxisProps?.width === "number" ? yAxisProps.width : 58
    const {
        interval: xAxisInterval,
        height: xAxisHeight,
        tickWidth: xAxisTickWidthProp,
        ...restXAxisProps
    } = xAxisProps ?? {}

    const labelBasedTickWidth = useMemo(() => {
        const longestLabelLength = data.reduce((max, row) => {
            const rawLabel = row?.[xKey]

            if (typeof rawLabel === "string" || typeof rawLabel === "number") {
                return Math.max(max, String(rawLabel).length)
            }

            return max
        }, 0)

        // Invert the relationship: longer labels get smaller width, shorter labels get more width
        const maxPossibleWidth = 100
        const minPossibleWidth = 60
        const baseWidth = Math.max(1, longestLabelLength) // Ensure we don't divide by zero
        const invertedWidth = (1 / baseWidth) * 1000 // Scale factor to get reasonable numbers

        return Math.min(maxPossibleWidth, Math.max(minPossibleWidth, invertedWidth))
    }, [data, xKey])

    const xAxisTickWidth = xAxisTickWidthProp ?? labelBasedTickWidth

    return (
        <ResponsiveContainer
            width="100%"
            height="100%"
            className="recharts-chart-container"
            {...containerProps}
        >
            <RechartsBarChart
                data={data as any}
                barSize={chartBarSize}
                barGap={barGap}
                barCategoryGap={barCategoryGap}
                {...chartProps}
            >
                <XAxis
                    dataKey={xKey}
                    tickLine={false}
                    allowDataOverflow={false}
                    interval={xAxisInterval ?? 0}
                    tick={({x, y, payload}) => (
                        <foreignObject
                            x={x - xAxisTickWidth / 2}
                            y={y - 2} // Center vertically
                            width={xAxisTickWidth}
                            height={20} // Sufficient height for one line
                        >
                            <div
                                style={{
                                    width: "100%",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    fontSize: "10px",
                                    color: "#666",
                                }}
                            >
                                {payload?.value}
                            </div>
                        </foreignObject>
                    )}
                    height={xAxisHeight ?? 24}
                    {...restXAxisProps}
                />
                <YAxis
                    domain={yDomain as any}
                    tickLine={{stroke: "#05172933"}}
                    tick={{fill: "#666"}}
                    tickMargin={8}
                    width={yAxisWidth}
                    {...yAxisProps}
                />
                <CartesianGrid
                    strokeDasharray="3 2"
                    horizontal
                    vertical={false}
                    stroke="#05172933"
                    {...cartesianGridProps}
                />

                {tooltipLabel ? (
                    <Tooltip
                        cursor={false}
                        content={({active, payload, label}: TooltipProps<number, string>) => {
                            if (!active || !payload?.length) return null

                            const rows = payload.filter((p) => p?.value != null)
                            if (!rows.length) return null

                            return (
                                <div
                                    style={{
                                        backgroundColor: "#FFFFFF",
                                        border: "1px solid #E2E8F0",
                                        borderRadius: 6,
                                        boxShadow: "0 4px 12px rgba(15, 23, 42, 0.08)",
                                        padding: "8px 12px",
                                        minWidth: 160,
                                    }}
                                >
                                    {/* <div
                                        style={{
                                            // fontWeight: 600,
                                            color: "#0F172A",
                                            marginBottom: 6,
                                        }}
                                    >
                                        {label}
                                    </div> */}
                                    {rows.map((entry, idx) => {
                                        const rawRow = entry?.payload as ChartDatum
                                        const barColor =
                                            (colorKey && typeof rawRow?.[colorKey] === "string"
                                                ? (rawRow[colorKey] as string)
                                                : undefined) ||
                                            entry?.color ||
                                            "#3B82F6"
                                        const entryLabel = (() => {
                                            const rawLabel = rawRow?.[xKey]
                                            if (
                                                typeof rawLabel === "string" ||
                                                typeof rawLabel === "number"
                                            )
                                                return String(rawLabel)

                                            return entry?.name || tooltipLabel
                                        })()
                                        const formattedValue =
                                            typeof entry?.value === "number"
                                                ? (tooltipFormatter?.(entry.value, rawRow) ??
                                                  String(entry.value))
                                                : String(entry?.value ?? "")
                                        return (
                                            <div
                                                key={idx}
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "space-between",
                                                    gap: 12,
                                                    marginBottom: idx === rows.length - 1 ? 0 : 6,
                                                    fontSize: 12,
                                                    color: "#475569",
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: 8,
                                                    }}
                                                >
                                                    <span
                                                        style={{
                                                            width: 8,
                                                            height: 8,
                                                            borderRadius: "9999px",
                                                            backgroundColor: barColor,
                                                        }}
                                                    />
                                                    <span style={{color: "#0F172A"}}>
                                                        {entryLabel}
                                                    </span>
                                                </div>
                                                <span style={{fontWeight: 600, color: "#0F172A"}}>
                                                    {formattedValue}
                                                </span>
                                            </div>
                                        )
                                    })}
                                </div>
                            )
                        }}
                    />
                ) : null}

                <Bar
                    dataKey={yKey}
                    name={tooltipLabel ?? "Value"}
                    fill="#3B82F6"
                    radius={[4, 4, 0, 0]}
                    barSize={chartBarSize}
                    maxBarSize={100}
                    fillOpacity={barProps?.fillOpacity ?? 0.6}
                    {...barProps}
                >
                    {data.map((row, i) => {
                        const fill =
                            colorKey && typeof row[colorKey] === "string"
                                ? (row[colorKey] as string)
                                : undefined
                        return (
                            <Cell
                                key={`cell-${i}`}
                                fill={fill}
                                {...(getCellProps?.(row, i) ?? {})}
                            />
                        )
                    })}
                </Bar>
            </RechartsBarChart>
        </ResponsiveContainer>
    )
}

export default memo(BarChart)
