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
    colorKey?: string
    yDomain?: [number | "auto" | "dataMin", number | "auto" | "dataMax"]
    xAxisProps?: Partial<React.ComponentProps<typeof XAxis>>
    yAxisProps?: Partial<React.ComponentProps<typeof YAxis>>
    cartesianGridProps?: Partial<React.ComponentProps<typeof CartesianGrid>>
    chartProps?: Partial<React.ComponentProps<typeof RechartsBarChart>>
    containerProps?: Partial<React.ComponentProps<typeof ResponsiveContainer>>
    barSize?: number
    barGap?: number | string
    barCategoryGap?: number | string
    tooltipLabel?: string
    tooltipFormatter?: (value: number, row: ChartDatum) => string
    getCellProps?: (row: ChartDatum, index: number) => Partial<React.ComponentProps<typeof Cell>>
    barProps?: Partial<React.ComponentProps<typeof Bar>>
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
    barSize,
    barGap = "10%",
    barCategoryGap = "30%",
    tooltipLabel = "Value",
    tooltipFormatter,
    getCellProps,
    barProps,
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

        const maxPossibleWidth = 100
        const minPossibleWidth = 60
        const baseWidth = Math.max(1, longestLabelLength)
        const invertedWidth = (1 / baseWidth) * 1000

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
                            y={y - 2}
                            width={xAxisTickWidth}
                            height={20}
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
                                    <div
                                        style={{
                                            color: "#0F172A",
                                            marginBottom: 6,
                                            fontWeight: 500,
                                        }}
                                    >
                                        {label}
                                    </div>
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
                                            ) {
                                                return rawLabel
                                            }
                                            return `Series ${idx + 1}`
                                        })()
                                        const rawValue = Number(entry?.value ?? 0)
                                        const formattedValue = tooltipFormatter
                                            ? tooltipFormatter(rawValue, rawRow)
                                            : rawValue.toLocaleString()

                                        return (
                                            <div
                                                key={entryLabel}
                                                style={{
                                                    display: "flex",
                                                    justifyContent: "space-between",
                                                    alignItems: "center",
                                                    gap: 16,
                                                    marginBottom: 4,
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        display: "inline-block",
                                                        width: 8,
                                                        height: 8,
                                                        backgroundColor: barColor,
                                                        borderRadius: "9999px",
                                                        marginRight: 8,
                                                    }}
                                                />
                                                <span
                                                    style={{
                                                        flex: 1,
                                                        fontSize: 12,
                                                        color: "#475467",
                                                    }}
                                                >
                                                    {entryLabel}
                                                </span>
                                                <span style={{fontSize: 12, fontWeight: 500}}>
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
                    radius={[8, 8, 0, 0]}
                    barSize={chartBarSize}
                    maxBarSize={100}
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
