import {
    CHART_AXIS_TEXT,
    CHART_FONT_SIZE,
    CHART_GRID,
    ChartFrame,
    useChartFrameState,
    type ChartTooltipContent,
} from "./ChartParts"
import {
    CHAR_WIDTH,
    formatChartValue,
    nearestRadarAxis,
    radarPoint,
    seriesColor,
    wrapLabel,
} from "./scale"
import type {RadarAxis, RadarChartProps} from "./types"

const MIN_AXES = 3
const RINGS = [0.25, 0.5, 0.75, 1]
const LABEL_GAP = 10
const LINE_HEIGHT = 13
const MIN_RADIUS = 24

/**
 * One axis per metric with values already normalized to 0..1, one filled polygon per series.
 * A missing value leaves its vertex out. Renders nothing with fewer than three axes.
 */
export function RadarChart({
    title,
    height,
    series,
    axes,
    formatValue = formatChartValue,
    formatAxisValue,
    className,
}: RadarChartProps) {
    const frame = useChartFrameState(axes.length)
    if (axes.length < MIN_AXES || series.length === 0) return null

    const formatRaw = (raw: number, axis: RadarAxis) =>
        formatAxisValue ? formatAxisValue(raw, axis) : formatValue(raw)
    const count = axes.length
    const labels = axes.map((axis) => wrapLabel(axis.name))
    const labelWidth = Math.max(...labels.flat().map((line) => line.length)) * CHAR_WIDTH
    const cx = frame.width / 2
    const cy = height / 2
    const radius = Math.max(
        MIN_RADIUS,
        Math.min(
            height / 2 - LABEL_GAP - LINE_HEIGHT * 2,
            frame.width / 2 - LABEL_GAP - labelWidth - 4,
        ),
    )
    const at = (index: number, fraction: number) =>
        radarPoint(cx, cy, radius, index, count, fraction)
    const points = (list: readonly [number, number][]) => list.map((p) => p.join(",")).join(" ")

    const active = frame.active === null ? null : axes[frame.active]
    let tooltip: ChartTooltipContent | null = null
    if (frame.active !== null && active) {
        const [x, y] = at(frame.active, 1)
        tooltip = {
            x,
            y,
            label: active.name,
            rows: series.flatMap((s, index) => {
                const value = active.values[s.key]
                if (!value) return []
                return [
                    {
                        key: s.key,
                        name: s.name,
                        color: seriesColor(s, index),
                        value: `${formatRaw(value.raw, active)} / ${formatRaw(active.max, active)}`,
                    },
                ]
            }),
        }
    }

    return (
        <ChartFrame
            {...frame}
            title={title}
            height={height}
            series={series}
            className={className}
            count={count}
            indexAt={(x, y) => nearestRadarAxis(x - cx, y - cy, count)}
            tooltip={tooltip}
            table={{
                columns: ["", ...series.map((s) => s.name)],
                rows: axes.map((axis) => ({
                    key: axis.name,
                    cells: [
                        axis.name,
                        ...series.map((s) => {
                            const value = axis.values[s.key]
                            return value
                                ? `${formatRaw(value.raw, axis)} / ${formatRaw(axis.max, axis)}`
                                : ""
                        }),
                    ],
                })),
            }}
        >
            {RINGS.map((ring) => (
                <polygon
                    key={ring}
                    points={points(axes.map((_, index) => at(index, ring)))}
                    fill="none"
                    stroke={CHART_GRID}
                />
            ))}
            {axes.map((axis, index) => {
                const [x, y] = at(index, 1)
                return (
                    <line
                        key={axis.name}
                        x1={cx}
                        y1={cy}
                        x2={x}
                        y2={y}
                        stroke={CHART_GRID}
                        strokeWidth={frame.active === index ? 2 : 1}
                    />
                )
            })}
            {series.map((s, seriesIndex) => {
                const color = seriesColor(s, seriesIndex)
                const vertices = axes.flatMap((axis, index) => {
                    const value = axis.values[s.key]
                    return value ? [at(index, value.normalized)] : []
                })
                return (
                    <g key={s.key} data-series={s.key}>
                        {vertices.length >= 2 ? (
                            <polygon
                                points={points(vertices)}
                                fill={color}
                                fillOpacity={vertices.length >= 3 ? 0.2 : 0}
                                stroke={color}
                                strokeWidth={2}
                                strokeLinejoin="round"
                            />
                        ) : null}
                        {vertices.map(([x, y], index) => (
                            <circle key={index} cx={x} cy={y} r={3} fill={color} />
                        ))}
                    </g>
                )
            })}
            {axes.map((axis, index) => {
                const [x, y] = at(index, 1)
                const dx = x - cx
                const dy = y - cy
                const anchor = dx > radius * 0.2 ? "start" : dx < -radius * 0.2 ? "end" : "middle"
                const lines = labels[index]
                // Above the center the block grows upwards, below it grows downwards.
                const blockShift =
                    dy < -radius * 0.2
                        ? -(lines.length - 1) * LINE_HEIGHT
                        : dy > radius * 0.2
                          ? LINE_HEIGHT * 0.7
                          : (-(lines.length - 1) * LINE_HEIGHT) / 2
                const offset = LABEL_GAP / radius + 1
                const lx = cx + dx * offset
                const ly = cy + dy * offset + blockShift
                return (
                    <text
                        key={axis.name}
                        x={lx}
                        y={ly}
                        dy="0.32em"
                        textAnchor={anchor}
                        fontSize={CHART_FONT_SIZE}
                        fill={CHART_AXIS_TEXT}
                        fontWeight={frame.active === index ? 600 : undefined}
                    >
                        {lines.map((line, lineIndex) => (
                            <tspan key={lineIndex} x={lx} dy={lineIndex === 0 ? 0 : LINE_HEIGHT}>
                                {line}
                            </tspan>
                        ))}
                    </text>
                )
            })}
        </ChartFrame>
    )
}
