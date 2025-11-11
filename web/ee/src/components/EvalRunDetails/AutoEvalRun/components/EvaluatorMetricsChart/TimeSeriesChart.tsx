import {Fragment, memo, useMemo, useState, useEffect, useRef, type ReactNode} from "react"

import {Card, Typography} from "antd"
import clsx from "clsx"
import {
    Area,
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts"

import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"

import {formatMetricName} from "../../assets/utils"
import PlaceholderOverlay, {PlaceholderEvaluationType} from "../shared/PlaceholderOverlay"

import HistogramChart from "./assets/HistogramChart"

const withAlpha = (color: string, alpha: number) => {
    if (color.startsWith("#")) {
        const hex = color.slice(1)
        const normalized =
            hex.length === 3
                ? hex
                      .split("")
                      .map((ch) => ch + ch)
                      .join("")
                : hex
        const int = Number.parseInt(normalized, 16)
        if (!Number.isNaN(int)) {
            const r = (int >> 16) & 255
            const g = (int >> 8) & 255
            const b = int & 255
            return `rgba(${r}, ${g}, ${b}, ${alpha})`
        }
    }
    return color
}

const format3Sig = (n: number) => {
    if (!Number.isFinite(n)) return String(n)
    const abs = Math.abs(n)
    if (abs !== 0 && (abs < 0.001 || abs >= 1000)) return n.toExponential(2)
    const s = n.toPrecision(3)
    return String(Number(s))
}

const formatTimestamp = (value: number) => {
    if (!Number.isFinite(value)) return ""
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ""
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`
}

const PLACEHOLDER_TIME_START = Date.UTC(2025, 0, 1, 9, 0, 0)
const PLACEHOLDER_TIME_STEP = 60 * 60 * 1000
export const PLACEHOLDER_LINE_COLOR = "#9EB8FF"
export const PLACEHOLDER_FILL_COLOR = "rgba(62, 124, 247, 0.12)"
export const PLACEHOLDER_TIME_SERIES = [
    {timestamp: PLACEHOLDER_TIME_START + PLACEHOLDER_TIME_STEP * 0, value: 22},
    {timestamp: PLACEHOLDER_TIME_START + PLACEHOLDER_TIME_STEP * 1, value: 32},
    {timestamp: PLACEHOLDER_TIME_START + PLACEHOLDER_TIME_STEP * 2, value: 26},
    {timestamp: PLACEHOLDER_TIME_START + PLACEHOLDER_TIME_STEP * 3, value: 38},
    {timestamp: PLACEHOLDER_TIME_START + PLACEHOLDER_TIME_STEP * 4, value: 30},
    {timestamp: PLACEHOLDER_TIME_START + PLACEHOLDER_TIME_STEP * 5, value: 42},
    {timestamp: PLACEHOLDER_TIME_START + PLACEHOLDER_TIME_STEP * 6, value: 34},
] as const

const X_AXIS_PADDING_RATIO = 0.035
const X_AXIS_PADDING_MIN_MS = 60 * 1000 // 1 minute
const BOOLEAN_AXIS_PADDING = 2
const BOOLEAN_AXIS_TICKS = [0, 25, 50, 75, 100] as const

interface SeriesPoint {
    timestamp: number
    value: number
    scenarioCount?: number
    p25?: number
    p50?: number
    p75?: number
    histogram?: {from: number; to: number; count: number}[]
}

interface TimeSeries {
    id: string
    name: string
    color: string
    points: SeriesPoint[]
}

const EvaluatorMetricsTimeSeriesChart = ({
    className,
    name,
    metricKey,
    evaluator,
    series,
    isBoolean,
    evaluationType = "online",
    placeholderTitle,
    placeholderDescription,
}: {
    className?: string
    name: string
    metricKey?: string
    evaluator?: EvaluatorDto
    series: TimeSeries[]
    isBoolean?: boolean
    evaluationType?: PlaceholderEvaluationType
    placeholderTitle?: ReactNode
    placeholderDescription?: ReactNode
}) => {
    const hasData = series?.some((s) => s.points.length > 0)
    const evaluatorLabel = evaluator?.name || evaluator?.slug || "this evaluator"
    const overlayTitle = placeholderTitle ?? "Waiting for your traces"
    const overlayDescription =
        placeholderDescription ??
        `Generate traces with ${evaluatorLabel} to start collecting results.`

    const chartData = useMemo(() => {
        const map = new Map<number, Record<string, number | string>>()
        series.forEach((s) => {
            s.points.forEach((pt) => {
                const existing = map.get(pt.timestamp) ?? {timestamp: pt.timestamp}
                existing[s.id] = pt.value
                if (pt.scenarioCount !== undefined) {
                    existing[`${s.id}__count`] = pt.scenarioCount
                }
                if (pt.p25 !== undefined) {
                    existing[`${s.id}__p25`] = pt.p25
                }
                if (pt.p75 !== undefined) {
                    existing[`${s.id}__p75`] = pt.p75
                }
                if (pt.p50 !== undefined) {
                    existing[`${s.id}__p50`] = pt.p50
                }
                if (pt.p25 !== undefined && pt.p75 !== undefined) {
                    existing[`${s.id}__pRange`] = pt.p75 - pt.p25
                }
                if (pt.histogram && pt.histogram.length) {
                    existing[`${s.id}__hist`] = pt.histogram
                }
                map.set(pt.timestamp, existing)
            })
        })
        return Array.from(map.values()).sort(
            (a, b) => (a.timestamp as number) - (b.timestamp as number),
        )
    }, [series])

    const tsExtent = useMemo(() => {
        if (!chartData.length) return undefined as undefined | {min: number; max: number}
        const values = chartData.map((d) => Number(d.timestamp))
        const min = Math.min(...values)
        const max = Math.max(...values)
        return {min, max}
    }, [chartData])

    // Controlled x-domain for zooming
    const [xDomain, setXDomain] = useState<[number | "auto", number | "auto"]>(["auto", "auto"])

    useEffect(() => {
        // Reset on data change
        setXDomain(["auto", "auto"])
    }, [tsExtent?.min, tsExtent?.max])

    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
    const resolveRange = (): [number, number] | undefined => {
        if (!tsExtent) return undefined
        const min = xDomain[0] === "auto" ? tsExtent.min : (xDomain[0] as number)
        const max = xDomain[1] === "auto" ? tsExtent.max : (xDomain[1] as number)
        return [min, max]
    }

    const containerRef = useRef<HTMLDivElement | null>(null)
    const [isPanning, setIsPanning] = useState(false)
    const [suppressTooltip, setSuppressTooltip] = useState(false)
    const [panStartX, setPanStartX] = useState<number | null>(null)
    const [panStartDomain, setPanStartDomain] = useState<[number, number] | null>(null)
    const wheelAnchorRef = useRef<{
        center: number
        ratio: number
        timeoutId: ReturnType<typeof setTimeout> | null
    } | null>(null)
    const panRAF = useRef<number | null>(null)
    const panTargetRef = useRef<[number, number] | null>(null)
    const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const handleMouseDown: React.MouseEventHandler<HTMLDivElement> = (e) => {
        if (!tsExtent) return
        setIsPanning(true)
        setSuppressTooltip(true)
        setPanStartX(e.clientX)
        const range = resolveRange() || [tsExtent.min, tsExtent.max]
        setPanStartDomain(range)
        console.debug("[TimeSeries] mousedown", {startX: e.clientX, range})
    }
    const handleMouseMove: React.MouseEventHandler<HTMLDivElement> = (e) => {
        const rect = containerRef.current?.getBoundingClientRect()
        if (!isPanning || !tsExtent || panStartX === null || !panStartDomain) return
        e.preventDefault()
        const plotWidth = Math.max(1, (rect?.width || 0) - chartMargin.left - chartMargin.right)
        const dx = e.clientX - panStartX
        const domainWidth = Math.max(panStartDomain[1] - panStartDomain[0], 1)
        const speed = 1.6 // pan faster
        const delta = (-dx / plotWidth) * domainWidth * speed
        let nextMin = panStartDomain[0] + delta
        let nextMax = panStartDomain[1] + delta
        if (nextMin < tsExtent.min) {
            const diff = tsExtent.min - nextMin
            nextMin += diff
            nextMax += diff
        }
        if (nextMax > tsExtent.max) {
            const diff = nextMax - tsExtent.max
            nextMin -= diff
            nextMax -= diff
        }
        console.debug("[TimeSeries] mousemove", {
            dx,
            domainWidth,
            xDomainBefore: panStartDomain,
            xDomainAfter: [nextMin, nextMax],
        })
        panTargetRef.current = [nextMin, nextMax]
        if (panRAF.current == null) {
            panRAF.current = requestAnimationFrame(() => {
                panRAF.current = null
                const t = panTargetRef.current
                if (t) setXDomain(t)
            })
        }
    }
    const endPan = () => {
        setIsPanning(false)
        setPanStartX(null)
        setPanStartDomain(null)
        console.debug("[TimeSeries] pan end")
        if (panRAF.current) {
            cancelAnimationFrame(panRAF.current)
            panRAF.current = null
        }
        panTargetRef.current = null
        // release tooltip shortly after pan end
        if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current)
        tooltipTimerRef.current = setTimeout(() => setSuppressTooltip(false), 120)
    }

    // Native non-passive wheel listener to ensure preventDefault works across browsers
    useEffect(() => {
        const el = containerRef.current
        if (!el) return

        const handler = (evt: WheelEvent) => {
            if (!tsExtent || !chartData.length) return
            // Only handle wheel for chart zoom when a modifier key is held
            const withModifier = evt.shiftKey || evt.ctrlKey || evt.metaKey
            if (!withModifier) {
                // Let the event bubble to allow normal page scrolling
                return
            }
            evt.preventDefault()
            // suppress tooltip during wheel gesture
            setSuppressTooltip(true)
            if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current)

            const rect = el.getBoundingClientRect()
            const plotWidth = Math.max(1, rect.width - chartMargin.left - chartMargin.right)
            const x = Math.max(0, Math.min(plotWidth, evt.clientX - rect.left - chartMargin.left))

            const currentMin = xDomain[0] === "auto" ? tsExtent.min : (xDomain[0] as number)
            const currentMax = xDomain[1] === "auto" ? tsExtent.max : (xDomain[1] as number)

            // Determine a stable anchor (data center + pixel ratio) for the whole wheel gesture
            const ratio = Math.max(0, Math.min(1, x / plotWidth))
            let anchorCenter = wheelAnchorRef.current?.center
            let anchorRatio = wheelAnchorRef.current?.ratio
            if (anchorCenter == null || anchorRatio == null) {
                anchorCenter = currentMin + ratio * (currentMax - currentMin)
                anchorRatio = ratio
            }

            const spanTotal = Math.max(tsExtent.max - tsExtent.min, 1)
            const currentWidth = Math.max(currentMax - currentMin, 1)
            const minWidth = spanTotal / 200
            const scrollOut = evt.deltaY > 0
            // Dead-zone at extremes to avoid jumpy behavior
            const atMax = currentWidth >= spanTotal * 0.999
            const atMin = currentWidth <= minWidth * 1.001
            if ((scrollOut && atMax) || (!scrollOut && atMin)) {
                // Don't change domain; just arm the idle timer to clear anchor and restore tooltip
                if (wheelAnchorRef.current?.timeoutId)
                    clearTimeout(wheelAnchorRef.current.timeoutId)
                const timeoutId = setTimeout(() => {
                    wheelAnchorRef.current = null
                    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current)
                    tooltipTimerRef.current = setTimeout(() => setSuppressTooltip(false), 80)
                }, 120)
                wheelAnchorRef.current = {center: anchorCenter, ratio: anchorRatio, timeoutId}
                return
            }
            const rawFactor = scrollOut ? 1.25 : 0.8
            let newWidth = clamp(currentWidth * rawFactor, minWidth, spanTotal)
            // Keep the anchor at the same pixel ratio by distributing width based on stored ratio
            let nextMin = anchorCenter - anchorRatio * newWidth
            let nextMax = nextMin + newWidth
            let clamped = false
            if (nextMin < tsExtent.min) {
                nextMin = tsExtent.min
                nextMax = nextMin + newWidth
                clamped = true
            }
            if (nextMax > tsExtent.max) {
                nextMax = tsExtent.max
                nextMin = nextMax - newWidth
                clamped = true
            }
            // If we had to clamp to boundaries, recompute anchorRatio so the cursor stays stable in subsequent ticks
            if (clamped) {
                anchorRatio = (anchorCenter - nextMin) / newWidth
                // Bound [0,1] in case anchor is outside after clamp
                anchorRatio = Math.max(0, Math.min(1, anchorRatio))
            }

            console.debug("[TimeSeries] wheel(native)", {
                xDomainBefore: [currentMin, currentMax],
                xDomainAfter: [nextMin, nextMax],
                cursorRatio: ratio,
                factor: rawFactor,
                anchorCenter,
                anchorRatio,
            })
            setXDomain([nextMin, nextMax])

            // Reset anchor after idle time to start a new gesture on next wheel
            if (wheelAnchorRef.current?.timeoutId) clearTimeout(wheelAnchorRef.current.timeoutId)
            const timeoutId = setTimeout(() => {
                // Clear anchor so the next wheel gesture re-anchors under the cursor
                wheelAnchorRef.current = null
                // allow tooltip again shortly after wheel settles
                if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current)
                tooltipTimerRef.current = setTimeout(() => setSuppressTooltip(false), 80)
            }, 180)
            wheelAnchorRef.current = {center: anchorCenter, ratio: anchorRatio, timeoutId}
        }

        el.addEventListener("wheel", handler, {passive: false})
        return () => {
            el.removeEventListener("wheel", handler as any)
        }
    }, [chartData, tsExtent, xDomain])

    // Cleanup any pending animation frame on unmount
    useEffect(() => {
        return () => {
            if (panRAF.current) cancelAnimationFrame(panRAF.current)
            if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current)
        }
    }, [])

    // (Optional) Brush handler removed as the Brush component is not rendered currently

    const latestSummaries = useMemo(() => {
        return series.map((s) => {
            const latest = s.points.at(-1)
            if (!latest) {
                return {
                    name: s.name,
                    color: s.color,
                    value: "-",
                }
            }

            const formatted = isBoolean
                ? `${Number(latest.value).toFixed(0)}%`
                : format3Sig(latest.value)
            return {
                name: s.name,
                color: s.color,
                value: formatted,
            }
        })
    }, [series, isBoolean])

    // Consistent chart margins to compute plot area sizes
    const chartMargin = useMemo(() => ({top: 8, right: 12, bottom: 48, left: 56}), [])

    const domain = useMemo(() => {
        if (isBoolean) return [0 - BOOLEAN_AXIS_PADDING, 100 + BOOLEAN_AXIS_PADDING] as const
        const values = series.flatMap((s) =>
            s.points.flatMap((p) =>
                [p.value, p.p25, p.p50, p.p75].filter(
                    (val): val is number => typeof val === "number" && Number.isFinite(val),
                ),
            ),
        )
        if (!values.length) return ["auto", "auto"] as const
        const min = Math.min(...values)
        const max = Math.max(...values)
        if (min === max) {
            const offset = Math.max(Math.abs(min) * 0.1, 1)
            return [min - offset, max + offset] as const
        }
        const padding = (max - min) * 0.1
        return [min - padding, max + padding] as const
    }, [series, isBoolean])

    const xAxisDomain = useMemo(() => {
        if (!tsExtent) return undefined
        const rawMin =
            xDomain[0] === "auto" || typeof xDomain[0] !== "number" ? tsExtent.min : xDomain[0]
        const rawMax =
            xDomain[1] === "auto" || typeof xDomain[1] !== "number" ? tsExtent.max : xDomain[1]
        if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) return undefined
        const span = Math.max(rawMax - rawMin, 1)
        const padding = Math.max(span * X_AXIS_PADDING_RATIO, X_AXIS_PADDING_MIN_MS)
        const paddedMin = rawMin - padding
        const paddedMax = rawMax + padding
        return [paddedMin, paddedMax] as [number, number]
    }, [tsExtent, xDomain])

    const AxisTick = memo((props: any) => {
        const {x, y, payload} = props || {}
        const value = Number(payload?.value)
        if (!Number.isFinite(value)) return null
        const date = new Date(value)
        const dateStr = date.toLocaleDateString([], {
            year: "numeric",
            month: "short",
            day: "numeric",
        })
        const timeStr = date.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        })
        return (
            <g transform={`translate(${x},${y})`}>
                <text fill="#666" textAnchor="middle" dy={12}>
                    <tspan x={0} dy="0">
                        {dateStr}
                    </tspan>
                    <tspan x={0} dy="12">
                        {timeStr}
                    </tspan>
                </text>
            </g>
        )
    })

    const ChartLegend = memo((props: any) => {
        const items: any[] = Array.isArray(props?.payload) ? props.payload : []
        if (!items.length) return null
        return (
            <div
                style={{
                    marginTop: 16,
                    display: "flex",
                    justifyContent: "center",
                    gap: 16,
                    fontSize: 12,
                    color: "#4b5563",
                    width: "100%",
                }}
            >
                {items.map((it) => (
                    <div
                        key={String(it?.value)}
                        style={{display: "flex", alignItems: "center", gap: 6}}
                    >
                        <span
                            style={{
                                width: 8,
                                height: 8,
                                borderRadius: 999,
                                backgroundColor: String(it?.color || "#888"),
                                display: "inline-block",
                            }}
                        />
                        <span>{String(it?.value ?? "")}</span>
                    </div>
                ))}
            </div>
        )
    })

    // Augmented data: full wide dataset plus interpolated boundary rows at min/max
    const windowData = useMemo(() => {
        if (!chartData.length || !tsExtent) return chartData
        const range = resolveRange() || [tsExtent.min, tsExtent.max]
        const minNum = range[0]
        const maxNum = range[1]
        if (!Number.isFinite(minNum) || !Number.isFinite(maxNum) || maxNum <= minNum)
            return chartData

        const rowMap = new Map<number, Record<string, number | string>>()
        // only rows inside the current window
        chartData.forEach((r: any) => {
            const ts = Number(r.timestamp)
            if (!Number.isFinite(ts) || ts < minNum || ts > maxNum) return
            rowMap.set(Number(r.timestamp), {...r})
        })

        const sorted = series.map((s) => ({
            id: s.id,
            pts: [...s.points].sort((a, b) => a.timestamp - b.timestamp),
        }))

        const addEdgeRow = (boundaryTs: number, side: "min" | "max") => {
            let row = rowMap.get(boundaryTs) ?? {timestamp: boundaryTs}
            let any = false
            for (const s of sorted) {
                const pts = s.pts
                if (!pts.length) continue
                // Binary search first index with timestamp >= boundaryTs
                let lo = 0
                let hi = pts.length - 1
                let idx = pts.length
                while (lo <= hi) {
                    const mid = (lo + hi) >> 1
                    const t = pts[mid].timestamp
                    if (t >= boundaryTs) {
                        idx = mid
                        hi = mid - 1
                    } else lo = mid + 1
                }
                const next = pts[idx]
                const prev = pts[idx - 1]
                // Determine series range
                const firstTs = pts[0]?.timestamp
                const lastTs = pts[pts.length - 1]?.timestamp
                if (!Number.isFinite(firstTs) || !Number.isFinite(lastTs)) continue

                // Only render at boundary if it lies within [firstTs, lastTs]
                if (boundaryTs < firstTs || boundaryTs > lastTs) {
                    continue
                }

                // Exact hit
                if (next && next.timestamp === boundaryTs) {
                    ;(row as any)[s.id] = next.value
                    any = true
                    continue
                }
                if (prev && prev.timestamp === boundaryTs) {
                    ;(row as any)[s.id] = prev.value
                    any = true
                    continue
                }

                // Interpolate between surrounding points when inside range
                if (prev && next && next.timestamp !== prev.timestamp) {
                    if (prev.timestamp <= boundaryTs && boundaryTs <= next.timestamp) {
                        if (isBoolean) {
                            // Step-like: choose nearer neighbor within the segment
                            const pick = side === "min" ? prev : next
                            ;(row as any)[s.id] = pick.value
                            any = true
                        } else {
                            const ratio =
                                (boundaryTs - prev.timestamp) / (next.timestamp - prev.timestamp)
                            const val = prev.value + ratio * (next.value - prev.value)
                            ;(row as any)[s.id] = val
                            any = true
                        }
                    }
                }
            }
            if (any) rowMap.set(boundaryTs, row)
        }

        addEdgeRow(minNum, "min")
        addEdgeRow(maxNum, "max")

        return Array.from(rowMap.values()).sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
    }, [chartData, xDomain, tsExtent, series, isBoolean])

    return (
        <Card
            title={
                <div className="flex justify-between items-center w-full h-[64px] p-0">
                    <div className="flex flex-col gap-1">
                        <Typography.Text className="font-medium text-sm capitalize">
                            {evaluator?.name ?? formatMetricName(metricKey || name)}
                        </Typography.Text>
                        <Typography.Text className="capitalize font-normal" type="secondary">
                            {name}
                        </Typography.Text>
                    </div>
                    <div className="flex items-center gap-3 pr-2">
                        {latestSummaries.length ? (
                            <div className="hidden md:flex items-center gap-4 text-xs text-[#344054]">
                                {latestSummaries.map((item) => (
                                    <div key={item.name} className="flex items-center gap-1">
                                        <span
                                            className="inline-block w-2 h-2 rounded-full"
                                            style={{backgroundColor: item.color}}
                                        />
                                        <span className="font-medium">{item.name}:</span>
                                        <span>{item.value}</span>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </div>
                </div>
            }
            className={clsx("rounded !p-0 overflow-hidden", className)}
            classNames={{title: "!py-0 !px-4", header: "!p-0", body: "!p-0"}}
        >
            <div
                ref={containerRef}
                className={clsx(
                    "py-4 px-4 h-[280px] select-none",
                    isPanning ? "cursor-grabbing" : "cursor-grab",
                )}
                style={{touchAction: "pan-y", overscrollBehavior: "auto"}}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={endPan}
                onMouseLeave={endPan}
                onDoubleClick={() => {
                    console.debug("[TimeSeries] reset")
                    setXDomain(["auto", "auto"])
                    // Also clear any previous wheel anchor so next zoom re-anchors at cursor
                    wheelAnchorRef.current = null
                }}
            >
                <div className="relative h-full">
                    {hasData ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart
                                key={(xAxisDomain || xDomain).toString()}
                                data={windowData as any}
                                margin={chartMargin}
                            >
                                <CartesianGrid strokeDasharray="3 2" stroke="#05172933" />
                                <XAxis
                                    dataKey="timestamp"
                                    type="number"
                                    scale="time"
                                    domain={(xAxisDomain || (xDomain as any)) as any}
                                    allowDataOverflow
                                    tick={<AxisTick />}
                                    tickMargin={20}
                                    minTickGap={16}
                                    height={40}
                                />
                                <YAxis
                                    domain={domain as any}
                                    ticks={isBoolean ? [...BOOLEAN_AXIS_TICKS] : undefined}
                                    tick={{fill: "#666"}}
                                    tickMargin={8}
                                    tickFormatter={(value) =>
                                        isBoolean
                                            ? `${Number(value).toFixed(0)}%`
                                            : format3Sig(value)
                                    }
                                    padding={{top: 8, bottom: 8}}
                                    width={chartMargin.left}
                                />
                                <Tooltip
                                    content={({active, label, payload}) => {
                                        if (suppressTooltip) return null
                                        if (!active || !payload || !payload.length) return null
                                        const rows = payload as any[]
                                        return (
                                            <div className="bg-white/95 border border-[#e5e7eb] rounded p-2 text-xs text-[#111827] shadow">
                                                <div className="mb-1 font-medium">
                                                    {formatTimestamp(Number(label))}
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    {rows.map((row) => {
                                                        const name = row.name
                                                        const color = row.color
                                                        const dataKey = row.dataKey as string
                                                        const valueNum = Number(row.value)
                                                        const countRaw =
                                                            row.payload?.[`${dataKey}__count`]
                                                        const count =
                                                            typeof countRaw === "number"
                                                                ? Number.isInteger(countRaw)
                                                                    ? countRaw
                                                                    : Number(countRaw.toFixed(2))
                                                                : countRaw
                                                        const p25 = row.payload?.[`${dataKey}__p25`]
                                                        const p50 = row.payload?.[`${dataKey}__p50`]
                                                        const p75 = row.payload?.[`${dataKey}__p75`]
                                                        const formatValue = (val?: number) => {
                                                            if (val == null) return undefined
                                                            if (isBoolean) {
                                                                const normalized =
                                                                    Math.abs(val) <= 1
                                                                        ? val * 100
                                                                        : val
                                                                return `${Number(normalized).toFixed(0)}%`
                                                            }
                                                            return format3Sig(val)
                                                        }
                                                        const formattedValue = formatValue(valueNum)
                                                        const formattedP25 = formatValue(p25)
                                                        const formattedP75 = formatValue(p75)
                                                        const formattedMedian = formatValue(p50)
                                                        const formattedRange =
                                                            formattedP25 && formattedP75
                                                                ? `${formattedP25} – ${formattedP75}`
                                                                : undefined
                                                        const histogram = row.payload?.[
                                                            `${dataKey}__hist`
                                                        ] as {
                                                            from: number
                                                            to: number
                                                            count: number
                                                        }[]
                                                        const formatAxisValue = (val: number) => {
                                                            if (isBoolean) {
                                                                const normalized =
                                                                    Math.abs(val) <= 1
                                                                        ? val * 100
                                                                        : val
                                                                return `${Number(normalized).toFixed(0)}%`
                                                            }
                                                            return format3Sig(val)
                                                        }
                                                        const histogramData = Array.isArray(
                                                            histogram,
                                                        )
                                                            ? histogram
                                                                  .map((bin) => {
                                                                      const from = Number(bin?.from)
                                                                      const to = Number(bin?.to)
                                                                      const count = Number(
                                                                          bin?.count,
                                                                      )
                                                                      if (
                                                                          !Number.isFinite(from) ||
                                                                          !Number.isFinite(to) ||
                                                                          !Number.isFinite(count)
                                                                      )
                                                                          return null
                                                                      return {
                                                                          label: `${formatAxisValue(
                                                                              from,
                                                                          )} – ${formatAxisValue(to)}`,
                                                                          value: count,
                                                                      }
                                                                  })
                                                                  .filter(
                                                                      (
                                                                          item,
                                                                      ): item is {
                                                                          label: string
                                                                          value: number
                                                                      } => item !== null,
                                                                  )
                                                            : []
                                                        return (
                                                            <div key={dataKey}>
                                                                <div className="flex items-center gap-2">
                                                                    <span
                                                                        className="inline-block w-2 h-2 rounded-full"
                                                                        style={{
                                                                            backgroundColor: color,
                                                                        }}
                                                                    />
                                                                    <span className="font-medium">
                                                                        {name}:
                                                                    </span>
                                                                    <span>{formattedValue}</span>
                                                                    {count != null ? (
                                                                        <span className="text-[#4b5563]">
                                                                            • {count} scenarios
                                                                        </span>
                                                                    ) : null}
                                                                </div>
                                                                {formattedRange ? (
                                                                    <div className="pl-4 text-[#4b5563]">
                                                                        P25–P75: {formattedRange}
                                                                    </div>
                                                                ) : null}
                                                                {formattedMedian ? (
                                                                    <div className="pl-4 text-[#4b5563]">
                                                                        Median: {formattedMedian}
                                                                    </div>
                                                                ) : null}
                                                                {histogramData.length ? (
                                                                    <div className="pl-4 mt-2 w-[260px] h-[96px]">
                                                                        <HistogramChart
                                                                            data={histogramData}
                                                                            xKey="label"
                                                                            yKey="value"
                                                                            tooltipLabel="count"
                                                                            containerProps={{
                                                                                width: 260,
                                                                                height: 96,
                                                                            }}
                                                                            barProps={{fill: color}}
                                                                            xAxisProps={{
                                                                                tick: {
                                                                                    fontSize: 10,
                                                                                },
                                                                            }}
                                                                            yAxisProps={{
                                                                                tick: {
                                                                                    fontSize: 10,
                                                                                },
                                                                            }}
                                                                        />
                                                                    </div>
                                                                ) : null}
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        )
                                    }}
                                />
                                {/* <Brush
                                    dataKey="timestamp"
                                    height={20}
                                    travellerWidth={8}
                                    stroke="#CBD5E1"
                                    onChange={onBrushChange as any}
                                /> */}
                                <Legend
                                    verticalAlign="bottom"
                                    align="center"
                                    content={<ChartLegend />}
                                />
                                {series.map((s) => {
                                    const hasRange = s.points.some(
                                        (pt) =>
                                            typeof pt.p25 === "number" &&
                                            typeof pt.p75 === "number",
                                    )
                                    const hasMedian = s.points.some(
                                        (pt) => typeof pt.p50 === "number",
                                    )
                                    const rangeId = `range_${s.id}`
                                    const rangeFill = withAlpha(s.color, 0.18)
                                    const medianStroke = withAlpha(s.color, 0.6)

                                    return (
                                        <Fragment key={s.id}>
                                            {hasRange ? (
                                                <>
                                                    <Area
                                                        type="monotone"
                                                        dataKey={`${s.id}__p25`}
                                                        stackId={rangeId}
                                                        stroke="none"
                                                        fill="none"
                                                        connectNulls
                                                        isAnimationActive={false}
                                                        // @ts-expect-error hide range base from legend
                                                        legendType="none"
                                                    />
                                                    <Area
                                                        type="monotone"
                                                        dataKey={`${s.id}__pRange`}
                                                        stackId={rangeId}
                                                        stroke="none"
                                                        fill={rangeFill}
                                                        connectNulls
                                                        isAnimationActive={false}
                                                        name={`${s.name} P25–P75`}
                                                        legendType="rect"
                                                    />
                                                </>
                                            ) : null}
                                            {hasMedian ? (
                                                <Line
                                                    type="monotone"
                                                    dataKey={`${s.id}__p50`}
                                                    name={`${s.name} median`}
                                                    stroke={medianStroke}
                                                    strokeWidth={1.5}
                                                    dot={false}
                                                    activeDot={false}
                                                    strokeDasharray="4 4"
                                                    connectNulls
                                                    isAnimationActive={false}
                                                    // @ts-expect-error hide median from legend
                                                    legendType="none"
                                                />
                                            ) : null}
                                            <Line
                                                type="monotone"
                                                dataKey={s.id}
                                                name={s.name}
                                                stroke={s.color}
                                                strokeWidth={2}
                                                dot={{r: 2}}
                                                activeDot={{r: 4}}
                                                connectNulls
                                                isAnimationActive={false}
                                            />
                                        </Fragment>
                                    )
                                })}
                            </LineChart>
                        </ResponsiveContainer>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart
                                data={PLACEHOLDER_TIME_SERIES as any}
                                margin={{top: 16, right: 24, bottom: 24, left: 32}}
                            >
                                <CartesianGrid
                                    stroke={PLACEHOLDER_LINE_COLOR}
                                    strokeOpacity={0.15}
                                    strokeDasharray="5 5"
                                />
                                <XAxis
                                    dataKey="timestamp"
                                    type="number"
                                    domain={["dataMin", "dataMax"]}
                                    scale="time"
                                    tickFormatter={(value) => {
                                        const date = new Date(value)
                                        return date.toLocaleTimeString([], {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                        })
                                    }}
                                    tick={{fill: "#94A3B8", fontSize: 11}}
                                    axisLine={{stroke: "rgba(148, 163, 184, 0.35)"}}
                                    tickMargin={12}
                                />
                                <YAxis
                                    domain={[0, 50]}
                                    tick={{fill: "#94A3B8", fontSize: 11}}
                                    axisLine={{stroke: "rgba(148, 163, 184, 0.35)"}}
                                    tickMargin={12}
                                />
                                <defs>
                                    <linearGradient
                                        id="tsPlaceholderFill"
                                        x1="0"
                                        y1="0"
                                        x2="0"
                                        y2="1"
                                    >
                                        <stop
                                            offset="0%"
                                            stopColor={PLACEHOLDER_LINE_COLOR}
                                            stopOpacity={0.35}
                                        />
                                        <stop
                                            offset="55%"
                                            stopColor={PLACEHOLDER_LINE_COLOR}
                                            stopOpacity={0.12}
                                        />
                                        <stop
                                            offset="100%"
                                            stopColor={PLACEHOLDER_LINE_COLOR}
                                            stopOpacity={0.01}
                                        />
                                    </linearGradient>
                                </defs>
                                <Tooltip content={() => null} />
                                <Area
                                    type="monotone"
                                    dataKey="value"
                                    stroke="none"
                                    fill="url(#tsPlaceholderFill)"
                                    isAnimationActive={false}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="value"
                                    stroke={PLACEHOLDER_LINE_COLOR}
                                    strokeWidth={2}
                                    dot={false}
                                    isAnimationActive={false}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    )}
                    {!hasData ? (
                        <PlaceholderOverlay
                            evaluationType={evaluationType}
                            title={overlayTitle}
                            description={overlayDescription}
                        />
                    ) : null}
                </div>
            </div>
        </Card>
    )
}

export default memo(EvaluatorMetricsTimeSeriesChart)
