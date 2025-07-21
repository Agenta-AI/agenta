import {type FC, memo, useState} from "react"

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
}

/**
 * ResponsiveFrequencyChart renders a vertical bar chart for categorical/frequency data.
 * Bars to highlight are inferred automatically from highlightValues (if provided).
 */
const ResponsiveFrequencyChart: FC<ResponsiveFrequencyChartProps> = memo(
    ({data, highlightValues = [], labelWidth}) => {
        const xMax = Math.max(...data.map((d) => d.count), 1)
        const yCount = data.length
        const xTicks = getYTicks(xMax)
        const yLabels = data.map((d) => d.label)

        // Tooltip state
        const [hoveredBar, setHoveredBar] = useState<number | null>(null)
        const [mousePos, setMousePos] = useState<{x: number; y: number} | null>(null)

        // Dynamically calculate left margin for long y-labels
        const longestLabelLength = yLabels.reduce(
            (max: number, label) => Math.max(max, String(label).length),
            0,
        )
        // Estimate width: 7px per character + 16px buffer
        const dynamicLeftMargin = Math.max(40, Math.min(120, longestLabelLength * 7 + 16))
        // Use local default margin as base
        const defaultMargin = {top: 16, right: 16, bottom: 32, left: 40}
        const dynamicMargin = {...defaultMargin, left: dynamicLeftMargin}

        // Calculate maxCount and maxCountOccurrences once
        const countMap = data.map((d) => d.count)
        const maxCount = Math.max(...countMap)
        const maxCountOccurrences = countMap.filter((count) => count === maxCount).length
        // Store maxCount for later use in rendering
        const uniqueMaxCount = maxCountOccurrences === 1 ? maxCount : null

        // Compute highlighted bar indices from highlightValues
        const computedHighlightBarIndices =
            highlightValues.length > 0
                ? data
                      .map((d, i) =>
                          highlightValues.some((hv) => String(hv) === String(d.label)) ? i : -1,
                      )
                      .filter((i) => i !== -1)
                : []

        return (
            <ChartFrame margin={dynamicMargin}>
                {({svgWidth, svgHeight, plotWidth, plotHeight, margin}) => {
                    // Scales for vertical bar chart
                    const yLabelScale = (idx: number) => (idx + 0.5) * (plotHeight / yCount)
                    const barHeight = plotHeight / yCount - 6
                    const xScale = (count: number) => (count / xMax) * plotWidth
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
                                {/* Bar gradient */}
                                <defs>
                                    {/* Gradient for true state */}
                                    <linearGradient
                                        id="barGradientGreen"
                                        x1="0%"
                                        y1="100%"
                                        x2="100%"
                                        y2="0%"
                                    >
                                        <stop offset="0%" stopColor="#D9F7BE" />
                                        <stop offset="100%" stopColor="#95DE64" />
                                    </linearGradient>

                                    {/* Gradient for false state */}
                                    <linearGradient
                                        id="barGradientGray"
                                        x1="0%"
                                        y1="100%"
                                        x2="100%"
                                        y2="0%"
                                    >
                                        <stop offset="0%" stopColor="#D6DEE6" />
                                        <stop offset="100%" stopColor="#97A4B0" />
                                    </linearGradient>
                                    {/* Gradient for most count state */}
                                    <linearGradient
                                        id="barGradientBlue"
                                        x1="0%"
                                        y1="100%"
                                        x2="100%"
                                        y2="0%"
                                    >
                                        <stop offset="0%" stopColor="#BAE0FF" />
                                        <stop offset="100%" stopColor="#69B1FF" />
                                    </linearGradient>
                                </defs>
                                {/* X Grid lines */}
                                <g>
                                    {xTicks.map((tick) => (
                                        <line
                                            key={tick}
                                            x1={margin.left + xScale(tick)}
                                            y1={margin.top}
                                            x2={margin.left + xScale(tick)}
                                            y2={margin.top + plotHeight}
                                            stroke="#f0f0f0"
                                            strokeWidth={1}
                                        />
                                    ))}
                                </g>
                                {/* Highlighted value lines */}
                                <g>
                                    {highlightValues.map((val, i) => {
                                        // Find closest bar index for value (if label is numeric)
                                        const idx = data.findIndex(
                                            (d) => typeof d.label === "number" && d.label === val,
                                        )
                                        if (idx === -1) return null
                                        return (
                                            <line
                                                key={"highlight-value-" + val + "-" + i}
                                                x1={margin.left + xScale(val as number)}
                                                y1={margin.top}
                                                x2={margin.left + xScale(val as number)}
                                                y2={margin.top + plotHeight}
                                                stroke="#faad14"
                                                strokeWidth={2}
                                                strokeDasharray="4 2"
                                            />
                                        )
                                    })}
                                </g>
                                {/* Bars */}
                                <g>
                                    {data.map((d, idx) => {
                                        const isHighlighted =
                                            computedHighlightBarIndices.includes(idx)
                                        const isMaxUnique =
                                            uniqueMaxCount !== null && d.count === uniqueMaxCount

                                        return (
                                            <rect
                                                key={idx}
                                                x={margin.left}
                                                y={margin.top + yLabelScale(idx) - barHeight / 2}
                                                width={xScale(d.count)}
                                                height={barHeight}
                                                fill={
                                                    isHighlighted
                                                        ? "#95DE64"
                                                        : d.label === "true"
                                                          ? "url(#barGradientGreen)"
                                                          : isMaxUnique
                                                            ? "url(#barGradientBlue)"
                                                            : "url(#barGradientGray)"
                                                }
                                                strokeWidth={0}
                                                className="frequency-bar cursor-pointer [clip-path:inset(0_0_0_-4px_round_0_4px_4px_0)]"
                                                onMouseEnter={(e) => {
                                                    setHoveredBar(idx)
                                                    const svgRect = (
                                                        e.target as SVGRectElement
                                                    ).ownerSVGElement?.getBoundingClientRect()
                                                    setMousePos({
                                                        x: e.clientX - (svgRect?.left ?? 0),
                                                        y: e.clientY - (svgRect?.top ?? 0),
                                                    })
                                                }}
                                                onMouseMove={(e) => {
                                                    const svgRect = (
                                                        e.target as SVGRectElement
                                                    ).ownerSVGElement?.getBoundingClientRect()
                                                    setMousePos({
                                                        x: e.clientX - (svgRect?.left ?? 0),
                                                        y: e.clientY - (svgRect?.top ?? 0),
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
                                <ChartAxis
                                    svgWidth={svgWidth}
                                    svgHeight={svgHeight}
                                    plotWidth={plotWidth}
                                    plotHeight={plotHeight}
                                    margin={margin}
                                    xLabels={xTicks}
                                    yLabels={yLabels}
                                    yLabelScale={yLabelScale}
                                    xScale={(_idx) => xScale(xTicks[_idx])}
                                    yScale={() => 0} // not used for categorical y
                                />
                            </svg>
                            {/* Tooltip rendered outside SVG, absolutely positioned */}
                            {hoveredBar !== null && data[hoveredBar] && mousePos && (
                                <div
                                    className="pointer-events-none z-50 absolute px-3 py-2 rounded border border-gray-300 bg-white/95 shadow-lg text-xs text-gray-900 animate-fadein"
                                    style={{
                                        left: mousePos.x + 16,
                                        top: mousePos.y - 32,
                                        minWidth: 120,
                                        maxWidth: 220,
                                        whiteSpace: "nowrap",
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
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="font-semibold">Label:</span>
                                        <span>{String(data[hoveredBar].label)}</span>
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
        )
    },
)

export default ResponsiveFrequencyChart
