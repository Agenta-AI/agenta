import {useEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {niceMax} from "@agenta/observability/analytics"
import {ChartContainer, ChartTooltip, cn, type ChartConfig} from "@agenta/ui/ui"
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ComposedChart,
    Line,
    ReferenceLine,
    XAxis,
    YAxis,
} from "recharts"

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
    /** Line charts: counts drawn as low bars under the line, on their own hidden scale. */
    underlay?: {key: string; color: string; values: number[]} | null
    height: number
    hovered: number | null
    onHover: (index: number | null) => void
    onSelect?: (index: number) => void
    tooltip?: (index: number) => ReactNode
    className?: string
}

type Row = Record<string, number | string | null>

const TICKS = 6
const ENTER_MS = 450

// Read once: charts animate in, and tooltips slide, unless the system asks for less motion.
const prefersMotion = () =>
    typeof window === "undefined" || !window.matchMedia("(prefers-reduced-motion: reduce)").matches

/** The average's label: a pill in the card color, right-aligned just above the line. */
const AverageLabel = ({
    text,
    viewBox,
}: {
    text: string
    viewBox?: {x: number; y: number; width: number}
}) => {
    if (!viewBox) return null
    // 11px text runs about 6px per character; padding is 4px a side.
    const width = text.length * 6 + 8
    const right = viewBox.x + viewBox.width
    return (
        <g>
            <rect
                x={right - width}
                y={viewBox.y - 17}
                width={width}
                height={15}
                rx={4}
                fill="var(--muted)"
            />
            <text
                x={right - 4}
                y={viewBox.y - 6}
                textAnchor="end"
                fontSize={11}
                fill="var(--muted-foreground)"
            >
                {text}
            </text>
        </g>
    )
}
// Top corners only; the bottom of a stack sits on the axis.
const TOP_RADIUS: [number, number, number, number] = [3, 3, 0, 0]

export const TimeChart = ({
    kind,
    labels,
    series,
    formatTick,
    average,
    yMin,
    yMax,
    underlay,
    height,
    hovered,
    onHover,
    onSelect,
    tooltip,
    className,
}: TimeChartProps) => {
    const motion = useMemo(prefersMotion, [])
    const visible = useMemo(() => series.filter((s) => !s.hidden), [series])
    const data = useMemo<Row[]>(
        () =>
            labels.map((label, i) => {
                const row: Row = {label, index: i}
                for (const s of visible) row[s.key] = s.values[i]
                if (underlay) row[underlay.key] = underlay.values[i]
                return row
            }),
        [labels, visible, underlay],
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
    // Round only the top of each stack: the highest series with a value in that bucket.
    const topSeries = useMemo(
        () => labels.map((_, i) => visible.findLastIndex((s) => (s.values[i] ?? 0) > 0)),
        [labels, visible],
    )
    const low = yMin ?? 0
    const high = yMax ?? top
    const ticks = [low, low + (high - low) / 2, high]
    const ref = useRef<HTMLDivElement>(null)
    const [width, setWidth] = useState(0)
    useEffect(() => {
        const el = ref.current
        if (!el) return
        const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
        observer.observe(el)
        return () => observer.disconnect()
    }, [])
    // As many ticks as the longest label fits at the 11px axis font, up to TICKS.
    const longest = Math.max(1, ...labels.map((l) => l.length))
    const fit = width ? Math.max(2, Math.floor((width - 48) / (longest * 7 + 16))) : TICKS
    const step = Math.max(1, Math.ceil(labels.length / Math.min(TICKS, fit)))
    // Counted back from the latest bucket, so the axis always ends on now.
    const xTicks = useMemo(
        () => labels.map((_, i) => i).filter((i) => (labels.length - 1 - i) % step === 0),
        [labels, step],
    )
    // The tallest underlay bar reaches 38% of the plot, so it never crowds the line.
    const underlayTop = underlay ? Math.max(1, ...underlay.values) / 0.38 : 0

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
            // By index: two buckets can share a label (the same hour on two days).
            dataKey="index"
            tickFormatter={(i: number) => labels[i] ?? ""}
            tickLine={false}
            axisLine={false}
            ticks={xTicks}
            interval={0}
            tickMargin={8}
            fontSize={11}
            // Lines put points on the plot edges; padding keeps edge dots and labels whole.
            padding={kind === "line" ? {left: 16, right: 16} : undefined}
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
        />,
        tooltip ? (
            <ChartTooltip
                key="tooltip"
                cursor={
                    kind === "line"
                        ? {strokeDasharray: "3 3"}
                        : {
                              fill: "color-mix(in srgb, var(--foreground) 10%, transparent)",
                              radius: 4,
                          }
                }
                // Pinned to the top of the plot beside the cursor, so it stays in the card.
                position={{y: -8}}
                content={({active}) =>
                    active && hovered !== null ? (
                        <div className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-150">
                            {tooltip(hovered)}
                        </div>
                    ) : null
                }
                isAnimationActive={motion}
                animationDuration={180}
                animationEasing="ease-out"
            />
        ) : null,
    ]

    // Drawn after the series so its label sits over the bars.
    const averageLine = average ? (
        <ReferenceLine
            key="avg"
            y={average.value}
            stroke="var(--muted-foreground)"
            strokeDasharray="3 3"
            ifOverflow="extendDomain"
            label={<AverageLabel text={average.label} />}
        />
    ) : null

    return (
        <ChartContainer
            ref={ref}
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
                            activeBar={{style: {filter: "brightness(0.8)"}}}
                            isAnimationActive={motion}
                            animationDuration={ENTER_MS}
                            animationEasing="ease-out"
                        >
                            {labels.map((_, i) => (
                                <Cell
                                    key={i}
                                    // Cell types radius as a number; the bar's Rectangle takes a tuple.
                                    radius={
                                        (topSeries[i] === si ? TOP_RADIUS : 0) as unknown as number
                                    }
                                />
                            ))}
                        </Bar>
                    ))}
                    {averageLine}
                </BarChart>
            ) : (
                <ComposedChart {...common} barCategoryGap={labels.length > 24 ? "12%" : "18%"}>
                    {axes}
                    {underlay
                        ? [
                              <YAxis
                                  key="underlay-y"
                                  yAxisId="underlay"
                                  hide
                                  domain={[0, underlayTop]}
                              />,
                              <Bar
                                  key={underlay.key}
                                  yAxisId="underlay"
                                  dataKey={underlay.key}
                                  fill={underlay.color}
                                  radius={[3, 3, 0, 0]}
                                  activeBar={{style: {filter: "brightness(0.9)"}}}
                                  isAnimationActive={motion}
                                  animationDuration={ENTER_MS}
                                  animationEasing="ease-out"
                              />,
                          ]
                        : null}
                    {visible.map((s) => (
                        <Line
                            key={s.key}
                            dataKey={s.key}
                            type="linear"
                            stroke={s.color}
                            strokeWidth={2}
                            // A series with one point draws no line, so it gets a dot.
                            dot={
                                s.values.filter((v) => v !== null).length === 1
                                    ? {r: 3, fill: s.color, strokeWidth: 0}
                                    : false
                            }
                            activeDot={{r: 4, fill: "var(--background)", strokeWidth: 2}}
                            connectNulls
                            isAnimationActive={motion}
                            animationDuration={ENTER_MS}
                            animationEasing="ease-out"
                        />
                    ))}
                    {averageLine}
                </ComposedChart>
            )}
        </ChartContainer>
    )
}
