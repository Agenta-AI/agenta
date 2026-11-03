import {
    useEffect,
    useId,
    useRef,
    useState,
    type KeyboardEvent,
    type MouseEvent,
    type ReactNode,
    type RefObject,
} from "react"

import {cn} from "../../../utils/styles"

import {seriesColor, truncate} from "./scale"
import type {ChartSeries} from "./types"

/** Chart chrome tokens, shared by every chart. */
export const CHART_GRID = "var(--ag-chart-grid)"
export const CHART_AXIS_LINE = "var(--ag-chart-axis-line)"
export const CHART_AXIS_TEXT = "var(--ag-chart-axis-text)"
export const CHART_FONT_SIZE = 11

const LEGEND_NAME_MAX = 20

/** Width of the element, kept current with a ResizeObserver. 0 until measured or while hidden. */
export function useChartWidth(ref: RefObject<HTMLElement | null>): number {
    const [width, setWidth] = useState(0)
    useEffect(() => {
        const element = ref.current
        if (!element) return
        if (typeof ResizeObserver === "undefined") {
            setWidth(element.clientWidth)
            return
        }
        const observer = new ResizeObserver(([entry]) => {
            setWidth(Math.floor(entry.contentRect.width))
        })
        observer.observe(element)
        return () => observer.disconnect()
    }, [ref])
    return width
}

/** The measured width and the focused target of a chart with `count` targets. */
export function useChartFrameState(count: number) {
    const measureRef = useRef<HTMLDivElement>(null)
    const width = useChartWidth(measureRef)
    const [active, setActive] = useState<number | null>(null)
    // A focus target that the data no longer has is no focus at all.
    const current = active !== null && active < count ? active : null
    return {measureRef, width, active: current, onActiveChange: setActive}
}

export interface ChartTooltipRow {
    key: string
    name: string
    color: string
    value: string
}

export interface ChartTooltipContent {
    /** Anchor point inside the plot, in px. */
    x: number
    y: number
    label: string
    rows: readonly ChartTooltipRow[]
}

function ChartTooltip({id, width, tip}: {id: string; width: number; tip: ChartTooltipContent}) {
    // Open towards the wider side so the tooltip never leaves the chart.
    const side = tip.x <= width / 2 ? {left: tip.x + 12} : {right: width - tip.x + 12}
    return (
        <div
            id={id}
            role="tooltip"
            className="pointer-events-none absolute z-10 max-w-[240px] rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
            style={{...side, top: Math.max(0, tip.y - 12)}}
        >
            <div className="mb-0.5 font-medium">{tip.label}</div>
            {tip.rows.map((row) => (
                <div key={row.key} className="flex items-center gap-1.5 whitespace-nowrap">
                    <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-sm"
                        style={{background: row.color}}
                    />
                    <span>
                        {row.name}: <span className="tabular-nums">{row.value}</span>
                    </span>
                </div>
            ))}
        </div>
    )
}

/** Series names with their color. Renders nothing for fewer than two series. */
export function ChartLegend({series}: {series: readonly ChartSeries[]}) {
    if (series.length < 2) return null
    return (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-colorTextSecondary">
            {series.map((item, index) => (
                <li key={item.key} className="flex min-w-0 items-center gap-1.5" title={item.name}>
                    <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-sm"
                        style={{background: seriesColor(item, index)}}
                    />
                    {truncate(item.name, LEGEND_NAME_MAX)}
                </li>
            ))}
        </ul>
    )
}

export interface ChartTable {
    columns: readonly string[]
    rows: readonly {key: string; cells: readonly string[]}[]
}

function VisuallyHiddenDataTable({caption, table}: {caption: string; table: ChartTable}) {
    return (
        <table className="sr-only">
            <caption>{caption}</caption>
            <thead>
                <tr>
                    {table.columns.map((column, index) => (
                        <th key={index} scope="col">
                            {column}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {table.rows.map((row) => (
                    <tr key={row.key}>
                        {row.cells.map((cell, index) =>
                            index === 0 ? (
                                <th key={index} scope="row">
                                    {cell}
                                </th>
                            ) : (
                                <td key={index}>{cell}</td>
                            ),
                        )}
                    </tr>
                ))}
            </tbody>
        </table>
    )
}

export interface ChartFrameProps {
    title: string
    height: number
    series: readonly ChartSeries[]
    className?: string
    measureRef: RefObject<HTMLDivElement | null>
    width: number
    /** Number of focus targets (categories, axes or points). */
    count: number
    active: number | null
    onActiveChange: (index: number | null) => void
    /** Maps a pointer position inside the svg to a focus target, or null outside the plot. */
    indexAt: (x: number, y: number) => number | null
    tooltip: ChartTooltipContent | null
    table: ChartTable
    children: ReactNode
}

/**
 * The frame every chart shares: the measured wrapper, the svg with its accessible name, pointer
 * and arrow-key focus over the targets, the tooltip, the legend and the hidden data table.
 */
export function ChartFrame({
    title,
    height,
    series,
    className,
    measureRef,
    width,
    count,
    active,
    onActiveChange,
    indexAt,
    tooltip,
    table,
    children,
}: ChartFrameProps) {
    const tooltipId = useId()

    const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
        const last = count - 1
        const current = active ?? 0
        const next: Record<string, number | null> = {
            ArrowRight: Math.min(last, current + 1),
            ArrowDown: Math.min(last, current + 1),
            ArrowLeft: Math.max(0, current - 1),
            ArrowUp: Math.max(0, current - 1),
            Home: 0,
            End: last,
            Escape: null,
        }
        if (!(event.key in next)) return
        event.preventDefault()
        onActiveChange(next[event.key])
    }

    const onMouseMove = (event: MouseEvent<SVGSVGElement>) => {
        const box = event.currentTarget.getBoundingClientRect()
        onActiveChange(indexAt(event.clientX - box.left, event.clientY - box.top))
    }

    return (
        <div className={cn("w-full", className)}>
            <div ref={measureRef} className="relative w-full" style={{height}}>
                {width > 0 ? (
                    <svg
                        width={width}
                        height={height}
                        role="img"
                        aria-label={title}
                        aria-describedby={tooltip ? tooltipId : undefined}
                        tabIndex={0}
                        className="block rounded-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                        onFocus={() => onActiveChange(active ?? 0)}
                        onBlur={() => onActiveChange(null)}
                        onKeyDown={onKeyDown}
                        onMouseMove={onMouseMove}
                        onMouseLeave={() => onActiveChange(null)}
                    >
                        {children}
                    </svg>
                ) : null}
                {tooltip && width > 0 ? (
                    <ChartTooltip id={tooltipId} width={width} tip={tooltip} />
                ) : null}
            </div>
            <ChartLegend series={series} />
            <VisuallyHiddenDataTable caption={title} table={table} />
        </div>
    )
}

/** Y tick labels and dashed grid lines for a cartesian plot. */
export function YGrid({
    ticks,
    y,
    left,
    right,
    format,
}: {
    ticks: readonly number[]
    y: (value: number) => number
    left: number
    right: number
    format: (value: number) => string
}) {
    return (
        <g>
            {ticks.map((tick) => (
                <g key={tick}>
                    <line
                        x1={left}
                        x2={right}
                        y1={y(tick)}
                        y2={y(tick)}
                        stroke={CHART_GRID}
                        strokeDasharray="3 3"
                    />
                    <text
                        x={left - 6}
                        y={y(tick)}
                        dy="0.32em"
                        textAnchor="end"
                        fontSize={CHART_FONT_SIZE}
                        fill={CHART_AXIS_TEXT}
                    >
                        {format(tick)}
                    </text>
                </g>
            ))}
        </g>
    )
}
