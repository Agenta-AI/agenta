import {type FC, memo, useMemo, useState} from "react"

import clsx from "clsx"

import {ChartAxis} from "./ChartAxis"
import ChartFrame from "./ChartFrame"
import {getYTicks} from "./chartUtils"

interface FrequencyDatum {
    label: string | number
    count: number
}

interface ResponsiveFrequencyChartProps {
    data: FrequencyDatum[]
    highlightValues?: (string | number)[]
    labelWidth?: number
    direction?: "horizontal" | "vertical"
    /** Optional: color for bars (also used for highlight when provided) */
    barColor?: string
    /** Optional: disable gradient and use solid bars */
    disableGradient?: boolean
    dynamicMargin?: Partial<{top: number; right: number; bottom: number; left: number}>
}

const FREQUENCY_SOLIDS = ["#2563EB", "#7C3AED", "#0EA5E9", "#22C55E", "#F97316", "#EC4899"]
const FREQUENCY_GRADIENTS = [
    ["#9BC9FF", "#1D4ED8"],
    ["#E6C9FF", "#7C3AED"],
    ["#9CF0E3", "#0EA5E9"],
    ["#B7F6C5", "#22C55E"],
    ["#FFD4AD", "#F97316"],
    ["#FFC2DD", "#EC4899"],
]

/**
 * ResponsiveFrequencyChart renders a vertical bar chart for categorical/frequency data.
 * Bars to highlight are inferred automatically from highlightValues (if provided).
 */
const ResponsiveFrequencyChart: FC<ResponsiveFrequencyChartProps> = memo(
    ({
        data,
        highlightValues = [],
        labelWidth,
        direction = "horizontal",
        barColor,
        disableGradient = false,
        dynamicMargin: dynamicPropsMargin,
    }) => {
        const isVertical = direction === "vertical"
        const xMax = Math.max(...data.map((d) => d.count), 1)
        const yCount = data.length
        const xTicks = getYTicks(xMax)
        const yLabels = data.map((d) => d.label)

        // Tooltip state
        const [hoveredBar, setHoveredBar] = useState<number | null>(null)
        const [mousePos, setMousePos] = useState<{x: number; y: number} | null>(null)

        // Dynamically calculate margins based on orientation
        const defaultMargin = {top: 16, right: 16, bottom: 32, left: 40}
        let dynamicMargin = defaultMargin
        if (isVertical) {
            const longestBottomLabel = yLabels.reduce(
                (max: number, label) => Math.max(max, String(label).length),
                0,
            )
            const bottomMargin = Math.max(32, Math.min(120, longestBottomLabel * 7 + 16))
            const longestCountLabel = xTicks.reduce(
                (max: number, tick) => Math.max(max, String(tick).length),
                0,
            )
            const leftMargin = Math.max(40, Math.min(120, longestCountLabel * 7 + 16))
            dynamicMargin = {
                ...defaultMargin,
                left: leftMargin,
                bottom: bottomMargin,
                ...dynamicPropsMargin,
            }
        } else {
            const longestLabelLength = yLabels.reduce(
                (max: number, label) => Math.max(max, String(label).length),
                0,
            )
            const dynamicLeftMargin = Math.max(40, Math.min(120, longestLabelLength * 7 + 16))
            dynamicMargin = {...defaultMargin, left: dynamicLeftMargin, ...dynamicPropsMargin}
        }

        // Compute highlighted bar indices from highlightValues
        const computedHighlightBarIndices =
            highlightValues.length > 0
                ? data
                      .map((d, i) =>
                          highlightValues.some((hv) => String(hv) === String(d.label)) ? i : -1,
                      )
                      .filter((i) => i !== -1)
                : []

        const gradientBaseId = useMemo(() => `freq-${Math.random().toString(36).slice(2, 10)}`, [])
        const customGradientId = `${gradientBaseId}-custom`
        const highlightGradientId = `${gradientBaseId}-highlight`
        const resolveBarGradientId = (index: number) =>
            `${gradientBaseId}-bar-${index % FREQUENCY_GRADIENTS.length}`
        const clamp = (value: number, min: number, max: number) =>
            Math.min(Math.max(value, min), max)
        const TOOLTIP_WIDTH = 160
        const TOOLTIP_HEIGHT = 52

        return (
            <div style={{position: "relative", width: "100%", height: "100%"}}>
                <ChartFrame margin={dynamicMargin}>
                    {({svgWidth, svgHeight, plotWidth, plotHeight, margin}) => {
                        // Scales for both orientations
                        const yLabelScaleHorizontal = (idx: number) =>
                            (idx + 0.5) * (plotHeight / yCount)
                        const barHeightHorizontal = plotHeight / yCount - 6
                        const xScaleHorizontal = (count: number) => (count / xMax) * plotWidth

                        const xLabelScaleVertical = (idx: number) =>
                            (idx + 0.5) * (plotWidth / yCount)
                        const barWidthVertical = plotWidth / yCount - 6
                        const yScaleVertical = (value: number) =>
                            ((xMax - value) / xMax) * plotHeight

                        const resolveFill = (index: number, isHighlighted: boolean): string => {
                            if (isHighlighted) {
                                if (disableGradient) return "#0EA5E9"
                                return `url(#${highlightGradientId})`
                            }
                            if (barColor) {
                                return disableGradient ? barColor : `url(#${customGradientId})`
                            }
                            if (disableGradient) {
                                return FREQUENCY_SOLIDS[index % FREQUENCY_SOLIDS.length]
                            }
                            return `url(#${resolveBarGradientId(index)})`
                        }

                        return (
                            <>
                                <svg
                                    width={svgWidth}
                                    height={svgHeight}
                                    style={{
                                        position: "relative",
                                        zIndex: 1,
                                        margin: 0,
                                        padding: 0,
                                        display: "block",
                                    }}
                                >
                                    {/* Bar gradient defs */}
                                    <defs>
                                        {!disableGradient && (
                                            <>
                                                {barColor ? (
                                                    <linearGradient
                                                        id={customGradientId}
                                                        x1="0%"
                                                        y1="100%"
                                                        x2="100%"
                                                        y2="0%"
                                                    >
                                                        <stop offset="0%" stopColor={barColor} />
                                                        <stop offset="100%" stopColor={barColor} />
                                                    </linearGradient>
                                                ) : (
                                                    FREQUENCY_GRADIENTS.map(([from, to], idx) => (
                                                        <linearGradient
                                                            key={`${gradientBaseId}-bar-${idx}`}
                                                            id={`${gradientBaseId}-bar-${idx}`}
                                                            x1="0%"
                                                            y1="100%"
                                                            x2="100%"
                                                            y2="0%"
                                                        >
                                                            <stop offset="0%" stopColor={from} />
                                                            <stop offset="100%" stopColor={to} />
                                                        </linearGradient>
                                                    ))
                                                )}
                                                <linearGradient
                                                    id={highlightGradientId}
                                                    x1="0%"
                                                    y1="100%"
                                                    x2="100%"
                                                    y2="0%"
                                                >
                                                    <stop offset="0%" stopColor="#CFFAFE" />
                                                    <stop offset="100%" stopColor="#06B6D4" />
                                                </linearGradient>
                                            </>
                                        )}
                                    </defs>

                                    {/* Grid and highlight lines */}
                                    {isVertical ? (
                                        <g>
                                            {xTicks.map((tick, idx) => (
                                                <line
                                                    key={`grid-vertical-${idx}`}
                                                    x1={margin.left}
                                                    y1={margin.top + yScaleVertical(tick)}
                                                    x2={margin.left + plotWidth}
                                                    y2={margin.top + yScaleVertical(tick)}
                                                    stroke="#f0f0f0"
                                                    strokeWidth={1}
                                                />
                                            ))}
                                            {highlightValues.map((val, i) => {
                                                const idx = data.findIndex(
                                                    (d) =>
                                                        typeof d.label === "number" &&
                                                        d.label === val,
                                                )
                                                if (idx === -1) return null
                                                return (
                                                    <line
                                                        key={"highlight-value-" + val + "-" + i}
                                                        x1={margin.left}
                                                        y1={
                                                            margin.top +
                                                            yScaleVertical(val as number)
                                                        }
                                                        x2={margin.left + plotWidth}
                                                        y2={
                                                            margin.top +
                                                            yScaleVertical(val as number)
                                                        }
                                                        stroke="#faad14"
                                                        strokeWidth={2}
                                                        strokeDasharray="4 2"
                                                    />
                                                )
                                            })}
                                        </g>
                                    ) : (
                                        <g>
                                            {xTicks.map((tick, idx) => (
                                                <line
                                                    key={`grid-horizontal-${idx}`}
                                                    x1={margin.left + xScaleHorizontal(tick)}
                                                    y1={margin.top}
                                                    x2={margin.left + xScaleHorizontal(tick)}
                                                    y2={margin.top + plotHeight}
                                                    stroke="#f0f0f0"
                                                    strokeWidth={1}
                                                />
                                            ))}
                                            {highlightValues.map((val, i) => {
                                                const idx = data.findIndex(
                                                    (d) =>
                                                        typeof d.label === "number" &&
                                                        d.label === val,
                                                )
                                                if (idx === -1) return null
                                                return (
                                                    <line
                                                        key={"highlight-value-" + val + "-" + i}
                                                        x1={
                                                            margin.left +
                                                            xScaleHorizontal(val as number)
                                                        }
                                                        y1={margin.top}
                                                        x2={
                                                            margin.left +
                                                            xScaleHorizontal(val as number)
                                                        }
                                                        y2={margin.top + plotHeight}
                                                        stroke="#faad14"
                                                        strokeWidth={2}
                                                        strokeDasharray="4 2"
                                                    />
                                                )
                                            })}
                                        </g>
                                    )}

                                    {/* Bars */}
                                    <g>
                                        {data.map((d, idx) => {
                                            const isHighlighted =
                                                computedHighlightBarIndices.includes(idx)
                                            if (isVertical) {
                                                const barX =
                                                    margin.left +
                                                    xLabelScaleVertical(idx) -
                                                    barWidthVertical / 2
                                                const barHeight =
                                                    plotHeight - yScaleVertical(d.count)
                                                return (
                                                    <rect
                                                        key={idx}
                                                        x={barX}
                                                        y={margin.top + yScaleVertical(d.count)}
                                                        width={barWidthVertical}
                                                        height={barHeight}
                                                        fill={resolveFill(idx, isHighlighted)}
                                                        strokeWidth={0}
                                                        className={clsx(
                                                            "frequency-bar cursor-pointer",
                                                            "[clip-path:inset(-4px_0_0_0_round_4px_4px_0_0)]",
                                                        )}
                                                        onMouseEnter={() => {
                                                            setHoveredBar(idx)
                                                            setMousePos({
                                                                x:
                                                                    margin.left +
                                                                    xLabelScaleVertical(idx),
                                                                y:
                                                                    margin.top +
                                                                    yScaleVertical(d.count),
                                                            })
                                                        }}
                                                        onMouseMove={() => {
                                                            setMousePos({
                                                                x:
                                                                    margin.left +
                                                                    xLabelScaleVertical(idx),
                                                                y:
                                                                    margin.top +
                                                                    yScaleVertical(d.count),
                                                            })
                                                        }}
                                                        onMouseLeave={() => {
                                                            setHoveredBar(null)
                                                            setMousePos(null)
                                                        }}
                                                    />
                                                )
                                            }

                                            return (
                                                <rect
                                                    key={idx}
                                                    x={margin.left}
                                                    y={
                                                        margin.top +
                                                        yLabelScaleHorizontal(idx) -
                                                        barHeightHorizontal / 2
                                                    }
                                                    width={xScaleHorizontal(d.count)}
                                                    height={barHeightHorizontal}
                                                    fill={resolveFill(idx, isHighlighted)}
                                                    strokeWidth={0}
                                                    className={clsx(
                                                        "frequency-bar cursor-pointer",
                                                        "[clip-path:inset(0_0_0_-4px_round_0_4px_4px_0)]",
                                                    )}
                                                    onMouseEnter={() => {
                                                        setHoveredBar(idx)
                                                        setMousePos({
                                                            x:
                                                                margin.left +
                                                                xScaleHorizontal(d.count),
                                                            y:
                                                                margin.top +
                                                                yLabelScaleHorizontal(idx),
                                                        })
                                                    }}
                                                    onMouseMove={() => {
                                                        setMousePos({
                                                            x:
                                                                margin.left +
                                                                xScaleHorizontal(d.count),
                                                            y:
                                                                margin.top +
                                                                yLabelScaleHorizontal(idx),
                                                        })
                                                    }}
                                                    onMouseLeave={() => {
                                                        setHoveredBar(null)
                                                        setMousePos(null)
                                                    }}
                                                />
                                            )
                                        })}
                                    </g>

                                    {/* Axes */}
                                    {isVertical ? (
                                        <ChartAxis
                                            svgWidth={svgWidth}
                                            svgHeight={svgHeight}
                                            plotWidth={plotWidth}
                                            plotHeight={plotHeight}
                                            margin={margin}
                                            xLabels={yLabels}
                                            yTicks={xTicks}
                                            xScale={(idx) => xLabelScaleVertical(idx)}
                                            yScale={yScaleVertical}
                                        />
                                    ) : (
                                        <ChartAxis
                                            svgWidth={svgWidth}
                                            svgHeight={svgHeight}
                                            plotWidth={plotWidth}
                                            plotHeight={plotHeight}
                                            margin={margin}
                                            xLabels={xTicks}
                                            yLabels={yLabels}
                                            yLabelScale={yLabelScaleHorizontal}
                                            xScale={(idx) => xScaleHorizontal(xTicks[idx])}
                                            yScale={() => 0}
                                        />
                                    )}
                                </svg>

                                {/* Tooltip rendered outside SVG, absolutely positioned */}
                                {hoveredBar !== null && data[hoveredBar] && mousePos && (
                                    <div
                                        className="pointer-events-none z-50 absolute rounded-xl border border-[#d0d7e3]/80 bg-white/90 px-3 py-2 text-xs text-gray-900 shadow-[0_6px_18px_rgba(15,23,42,0.12)] backdrop-blur-sm"
                                        style={{
                                            left: clamp(
                                                mousePos.x + 10,
                                                margin.left,
                                                margin.left + plotWidth - TOOLTIP_WIDTH,
                                            ),
                                            top: clamp(
                                                mousePos.y - TOOLTIP_HEIGHT / 2,
                                                margin.top - 8,
                                                margin.top + plotHeight - TOOLTIP_HEIGHT - 8,
                                            ),
                                            width: TOOLTIP_WIDTH,
                                        }}
                                        role="tooltip"
                                        aria-live="polite"
                                    >
                                        {/* Caret */}
                                        <div
                                            style={{
                                                position: "absolute",
                                                left: 4,
                                                top: "100%",
                                                width: 0,
                                                height: 0,
                                                borderLeft: "7px solid transparent",
                                                borderRight: "7px solid transparent",
                                                borderTop: "7px solid #d1d5db",
                                            }}
                                        />
                                        <div className="mb-1">
                                            <span className="text-[10px] uppercase tracking-wide text-gray-400">
                                                Label
                                            </span>
                                            <span className="ml-2 inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                                                {String(data[hoveredBar].label)}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold">Count:</span>
                                            <span>{data[hoveredBar].count}</span>
                                        </div>
                                    </div>
                                )}
                            </>
                        )
                    }}
                </ChartFrame>
            </div>
        )
    },
)

export default ResponsiveFrequencyChart
