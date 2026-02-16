import {type FC, type ReactNode, RefObject, useRef} from "react"

import {useResizeObserver} from "usehooks-ts"

export interface ChartFrameProps {
    minWidth?: number
    minHeight?: number
    maxWidth?: number | string
    maxHeight?: number | string
    margin?: {top: number; right: number; bottom: number; left: number}
    children: (frame: {
        svgWidth: number
        svgHeight: number
        plotWidth: number
        plotHeight: number
        margin: {top: number; right: number; bottom: number; left: number}
    }) => ReactNode
}

const DEFAULT_MARGIN = {top: 8, right: 16, left: 40, bottom: 32}
const DEFAULT_MIN_WIDTH = 200
const DEFAULT_MIN_HEIGHT = 120

const ChartFrame: FC<ChartFrameProps> = ({
    minWidth = DEFAULT_MIN_WIDTH,
    minHeight = DEFAULT_MIN_HEIGHT,
    maxWidth,
    maxHeight,
    margin = DEFAULT_MARGIN,
    children,
}) => {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const {width: chartWidth = 280, height: chartHeight = 120} = useResizeObserver({
        ref: containerRef as RefObject<HTMLDivElement>,
        box: "border-box",
    })
    const svgWidth = Math.max(chartWidth, minWidth)
    const svgHeight = Math.max(chartHeight, minHeight)
    const plotWidth = svgWidth - margin.left - margin.right
    const plotHeight = svgHeight - margin.top - margin.bottom

    return (
        <div
            ref={containerRef}
            style={{
                width: "100%",
                height: "100%",
                ...(maxWidth !== undefined
                    ? {maxWidth: typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth}
                    : {}),
                ...(maxHeight !== undefined
                    ? {maxHeight: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight}
                    : {}),
                minWidth,
                minHeight,
                boxSizing: "border-box",
                overflow: "hidden",
            }}
        >
            {children({
                svgWidth,
                svgHeight,
                plotWidth,
                plotHeight,
                margin,
            })}
        </div>
    )
}

export default ChartFrame
