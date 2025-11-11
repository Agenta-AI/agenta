import {type FC, memo, useCallback, useState} from "react"

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

// Resolve fills based on props (keep defaults when not provided)
const DEFAULTS = {
    greenSolid: "#95DE64",
    blueSolid: "#69B1FF",
    graySolid: "#97A4B0",
}

const CUSTOM_GRADIENT_ID = "barGradientCustom"

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
                    // Scales for both orientations
                    const yLabelScaleHorizontal = (idx: number) =>
                        (idx + 0.5) * (plotHeight / yCount)
                    const barHeightHorizontal = plotHeight / yCount - 6
                    const xScaleHorizontal = (count: number) => (count / xMax) * plotWidth

                    const xLabelScaleVertical = (idx: number) => (idx + 0.5) * (plotWidth / yCount)
                    const barWidthVertical = plotWidth / yCount - 6
                    const yScaleVertical = (value: number) => ((xMax - value) / xMax) * plotHeight

                    const getFill = useCallback(
                        (isHighlighted: boolean, d: FrequencyDatum): string => {
                            // If user supplies barColor, it overrides category colors:
                            if (barColor) {
                                // highlighted also uses barColor (solid), mirroring prior component behavior
                                if (isHighlighted) return barColor
                                return disableGradient ? barColor : `url(#${CUSTOM_GRADIENT_ID})`
                            }
                            // Default behavior (no barColor override)
                            if (isHighlighted) return DEFAULTS.greenSolid
                            if (disableGradient) {
                                // Solid fallbacks
                                if (d.label === "true") return DEFAULTS.greenSolid
                                if (uniqueMaxCount !== null && d.count === uniqueMaxCount)
                                    return DEFAULTS.blueSolid
                                return DEFAULTS.graySolid
                            }
                            // Gradient fallbacks
                            if (d.label === "true") return "url(#barGradientGreen)"
                            if (uniqueMaxCount !== null && d.count === uniqueMaxCount)
                                return "url(#barGradientBlue)"
                            return "url(#barGradientGray)"
                        },
                        [barColor],
                    )

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
                                    {/* If a custom barColor is provided and gradient is enabled, use a single custom gradient */}
                                    {!disableGradient && barColor && (
                                        <linearGradient
                                            id={CUSTOM_GRADIENT_ID}
                                            x1="0%"
                                            y1="100%"
                                            x2="100%"
                                            y2="0%"
                                        >
                                            <stop offset="0%" stopColor={barColor} />
                                            <stop offset="100%" stopColor={barColor} />
                                        </linearGradient>
                                    )}

                                    {/* Otherwise keep the existing three gradients (when gradient is enabled) */}
                                    {!disableGradient && !barColor && (
                                        <>
                                            {/* Gradient for "true" state */}
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

                                            {/* Gradient for default/false state */}
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

                                            {/* Gradient for most-count (unique max) */}
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
                                        </>
                                    )}
                                </defs>

                                {/* Grid and highlight lines */}
                                {isVertical ? (
                                    <g>
                                        {xTicks.map((tick) => (
                                            <line
                                                key={tick}
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
                                                    typeof d.label === "number" && d.label === val,
                                            )
                                            if (idx === -1) return null
                                            return (
                                                <line
                                                    key={"highlight-value-" + val + "-" + i}
                                                    x1={margin.left}
                                                    y1={margin.top + yScaleVertical(val as number)}
                                                    x2={margin.left + plotWidth}
                                                    y2={margin.top + yScaleVertical(val as number)}
                                                    stroke="#faad14"
                                                    strokeWidth={2}
                                                    strokeDasharray="4 2"
                                                />
                                            )
                                        })}
                                    </g>
                                ) : (
                                    <g>
                                        {xTicks.map((tick) => (
                                            <line
                                                key={tick}
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
                                                    typeof d.label === "number" && d.label === val,
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
                                        const isMaxUnique =
                                            uniqueMaxCount !== null && d.count === uniqueMaxCount

                                        if (isVertical) {
                                            const barX =
                                                margin.left +
                                                xLabelScaleVertical(idx) -
                                                barWidthVertical / 2
                                            const barHeight = plotHeight - yScaleVertical(d.count)
                                            return (
                                                <rect
                                                    key={idx}
                                                    x={barX}
                                                    y={margin.top + yScaleVertical(d.count)}
                                                    width={barWidthVertical}
                                                    height={barHeight}
                                                    fill={getFill(isHighlighted, d)}
                                                    strokeWidth={0}
                                                    className={clsx(
                                                        "frequency-bar cursor-pointer",
                                                        "[clip-path:inset(-4px_0_0_0_round_4px_4px_0_0)]",
                                                    )}
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
                                                fill={getFill(isHighlighted, d)}
                                                strokeWidth={0}
                                                className={clsx(
                                                    "frequency-bar cursor-pointer",
                                                    "[clip-path:inset(0_0_0_-4px_round_0_4px_4px_0)]",
                                                )}
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
