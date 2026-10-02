import {useMemo, type ReactNode} from "react"

import {niceMax} from "@agenta/observability/usage"
import {ChartContainer, ChartTooltip, cn, type ChartConfig} from "@agenta/ui/ui"
import {Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis} from "recharts"

export interface TimeSeries {
    key: string
    label: string
    color: string
    values: (number | null)[]
    hidden?: boolean
}

export interface TimeChartProps {
    kind: "bar" | "line"
    labels: string[]
    series: TimeSeries[]
    /** Axis tick text. */
    formatTick: (value: number) => string
    /** A dashed average line and its label. */
    average?: {value: number; label: string} | null
    /** Line charts: the y-axis floor (success rate starts above 0). */
    yMin?: number
    yMax?: number
    height: number
    hovered: number | null
    onHover: (index: number | null) => void
    onSelect?: (index: number) => void
    tooltip?: (index: number) => ReactNode
    className?: string
}

type Row = Record<string, number | string | null>

const TICKS = 6

export const TimeChart = ({
    kind,
    labels,
    series,
    formatTick,
    average,
    yMin,
    yMax,
    height,
    hovered,
    onHover,
    onSelect,
    tooltip,
    className,
}: TimeChartProps) => {
    const visible = useMemo(() => series.filter((s) => !s.hidden), [series])
    const data = useMemo<Row[]>(
        () =>
            labels.map((label, i) => {
                const row: Row = {label, index: i}
                for (const s of visible) row[s.key] = s.values[i]
                return row
            }),
        [labels, visible],
    )
    const config = useMemo<ChartConfig>(
        () => Object.fromEntries(series.map((s) => [s.key, {label: s.label, color: s.color}])),
        [series],
    )

    const top = useMemo(() => {
        const totals = labels.map((_, i) =>
            kind === "bar"
                ? visible.reduce((t, s) => t + (s.values[i] ?? 0), 0)
                : Math.max(0, ...visible.map((s) => s.values[i] ?? 0)),
        )
        return niceMax(Math.max(0, ...totals, average?.value ?? 0))
    }, [labels, visible, kind, average])
    const low = yMin ?? 0
    const high = yMax ?? top
    const ticks = [low, low + (high - low) / 2, high]
    const step = Math.max(1, Math.ceil(labels.length / TICKS))

    const handleMove = (state: {activeTooltipIndex?: number} | undefined) => {
        const index = state?.activeTooltipIndex
        onHover(typeof index === "number" ? index : null)
    }
    const handleClick = (state: {activeTooltipIndex?: number} | undefined) => {
        const index = state?.activeTooltipIndex
        if (onSelect && typeof index === "number") onSelect(index)
    }

    const common = {
        data,
        margin: {top: 8, right: 4, bottom: 0, left: 0},
        onMouseMove: handleMove,
        onMouseLeave: () => onHover(null),
        onClick: handleClick,
    }
    // Recharts 2 finds axes by element type among direct children, so no fragment here.
    const axes = [
        <CartesianGrid key="grid" vertical={false} strokeDasharray="0" />,
        <XAxis
            key="x"
            dataKey="label"
            tickLine={false}
            axisLine={false}
            interval={step - 1}
            tickMargin={8}
            fontSize={11}
        />,
        <YAxis
            key="y"
            width={44}
            tickLine={false}
            axisLine={false}
            ticks={ticks}
            domain={[low, high]}
            tickFormatter={formatTick}
            fontSize={11}
            allowDataOverflow
        />,
        average ? (
            <ReferenceLine
                key="avg"
                y={average.value}
                stroke="var(--muted-foreground)"
                strokeDasharray="3 3"
                ifOverflow="extendDomain"
                label={{
                    value: average.label,
                    position: "insideBottomRight",
                    fontSize: 11,
                    fill: "var(--muted-foreground)",
                }}
            />
        ) : null,
        tooltip ? (
            <ChartTooltip
                key="tooltip"
                cursor={kind === "line" ? {strokeDasharray: "3 3"} : false}
                content={({active}) =>
                    active && hovered !== null ? <>{tooltip(hovered)}</> : null
                }
                isAnimationActive={false}
            />
        ) : null,
    ]

    return (
        <ChartContainer
            config={config}
            className={cn("aspect-auto w-full", onSelect && "cursor-pointer", className)}
            style={{height}}
        >
            {kind === "bar" ? (
                <BarChart {...common} barCategoryGap={labels.length > 24 ? "12%" : "18%"}>
                    {axes}
                    {visible.map((s, si) => (
                        <Bar
                            key={s.key}
                            dataKey={s.key}
                            stackId="stack"
                            fill={s.color}
                            fillOpacity={1}
                            radius={si === visible.length - 1 ? [3, 3, 0, 0] : 0}
                            shape={(props: unknown) => {
                                const p = props as {
                                    x: number
                                    y: number
                                    width: number
                                    height: number
                                    index: number
                                    fill: string
                                }
                                const dim = hovered !== null && hovered !== p.index
                                return (
                                    <rect
                                        x={p.x}
                                        y={p.y}
                                        width={p.width}
                                        height={Math.max(0, p.height)}
                                        fill={p.fill}
                                        opacity={dim ? 0.3 : 1}
                                        rx={si === visible.length - 1 ? 3 : 0}
                                    />
                                )
                            }}
                        />
                    ))}
                </BarChart>
            ) : (
                <LineChart {...common}>
                    {axes}
                    {visible.map((s) => (
                        <Line
                            key={s.key}
                            dataKey={s.key}
                            type="linear"
                            stroke={s.color}
                            strokeWidth={2}
                            dot={false}
                            activeDot={{r: 4, fill: "var(--background)", strokeWidth: 2}}
                            connectNulls
                            isAnimationActive={false}
                        />
                    ))}
                </LineChart>
            )}
        </ChartContainer>
    )
}
