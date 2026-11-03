import {
    CHART_AXIS_TEXT,
    CHART_FONT_SIZE,
    CHART_GRID,
    ChartFrame,
    seriesValues,
    tooltipRows,
    useChartFrameState,
} from "./ChartParts"
import {
    finiteOrNull,
    fitRadarLabels,
    formatChartValue,
    nearestRadarAxis,
    radarDirection,
    radarLabelAlign,
    radarPoint,
    seriesColor,
} from "./scale"
import type {RadarAxis, RadarChartProps} from "./types"

const MIN_AXES = 3
const RINGS = [0.25, 0.5, 0.75, 1]
const LABEL_GAP = 10
const LINE_HEIGHT = 13
const MIN_RADIUS = 24
/** Space kept free along the edges of the chart. */
const EDGE = 4

/** The value of a series on an axis, or null when it is missing or not a finite number. */
function vertexOf(axis: RadarAxis, key: string) {
    const value = axis.values[key]
    if (!value) return null
    const normalized = finiteOrNull(value.normalized)
    const raw = finiteOrNull(value.raw)
    return normalized === null || raw === null ? null : {normalized, raw}
}

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

    const count = axes.length
    const cx = frame.width / 2
    const cy = height / 2
    const {labels, radius} = fitRadarLabels(
        frame.width - EDGE * 2,
        height - EDGE * 2,
        axes.map((axis) => axis.name),
        {gap: LABEL_GAP, lineHeight: LINE_HEIGHT, minRadius: MIN_RADIUS},
    )
    const at = (index: number, fraction: number) =>
        radarPoint(cx, cy, radius, index, count, fraction)
    const points = (list: readonly [number, number][]) => list.map((p) => p.join(",")).join(" ")

    const format = (raw: number, axis: RadarAxis) =>
        formatAxisValue ? formatAxisValue(raw, axis) : formatValue(raw)
    const valuesAt = (axis: RadarAxis) =>
        seriesValues(series, (key) => {
            const vertex = vertexOf(axis, key)
            return vertex === null
                ? null
                : `${format(vertex.raw, axis)} / ${format(axis.max, axis)}`
        })
    const activeAxis = frame.active === null ? null : axes[frame.active]
    const activeEnd = frame.active === null ? null : at(frame.active, 1)

    return (
        <ChartFrame
            {...frame}
            title={title}
            height={height}
            series={series}
            className={className}
            indexAt={(x, y) => nearestRadarAxis(x - cx, y - cy, count)}
            tooltip={
                activeAxis === null || activeEnd === null
                    ? null
                    : {
                          x: activeEnd[0],
                          y: activeEnd[1],
                          label: activeAxis.name,
                          rows: tooltipRows(valuesAt(activeAxis)),
                      }
            }
            table={{
                columns: ["", ...series.map((s) => s.name)],
                rows: axes.map((axis) => ({
                    key: axis.name,
                    cells: [axis.name, ...valuesAt(axis).map((row) => row.value ?? "")],
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
                    const vertex = vertexOf(axis, s.key)
                    return vertex ? [at(index, vertex.normalized)] : []
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
                const [cos, sin] = radarDirection(index, count)
                const {anchor, vertical} = radarLabelAlign(index, count)
                const lines = labels[index]
                // Above the axis end the block grows upwards, below it downwards.
                const blockShift =
                    vertical === "above"
                        ? -(lines.length - 0.5) * LINE_HEIGHT
                        : vertical === "below"
                          ? LINE_HEIGHT / 2
                          : (-(lines.length - 1) * LINE_HEIGHT) / 2
                const lx = cx + (radius + LABEL_GAP) * cos
                const ly = cy + (radius + LABEL_GAP) * sin + blockShift
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
