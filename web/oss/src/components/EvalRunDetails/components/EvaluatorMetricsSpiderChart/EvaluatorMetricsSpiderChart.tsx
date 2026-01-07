import {memo, useMemo} from "react"

import {Typography} from "antd"
import clsx from "clsx"
import {
    PolarAngleAxis,
    PolarGrid,
    PolarRadiusAxis,
    Radar,
    RadarChart,
    ResponsiveContainer,
    Tooltip,
} from "recharts"

import {format3Sig} from "@/oss/components/Evaluations/MetricDetailsPopover"
import {formatCurrency, formatLatency} from "@/oss/lib/helpers/formatters"

import type {EvaluatorMetricsSpiderChartProps, MetricData, SeriesMeta} from "./types"

const DEFAULT_SERIES_COLORS = ["#3B82F6", "#8B5CF6", "#F97316", "#10B981", "#F43F5E"]

const getDefaultSeries = (): SeriesMeta[] => [
    {
        key: "value",
        color: DEFAULT_SERIES_COLORS[0],
        name: "Eval 1",
    },
]

const EvaluatorMetricsSpiderChart = ({
    className,
    metrics = [],
    maxScore = 100,
    series = getDefaultSeries(),
}: EvaluatorMetricsSpiderChartProps) => {
    const chartData: MetricData[] = useMemo(() => {
        return metrics.map((m) => {
            const axisMax =
                typeof m.maxScore === "number" && isFinite(m.maxScore) && m.maxScore > 0
                    ? m.maxScore
                    : maxScore

            const baseRaw = typeof m.value === "number" && isFinite(m.value) ? m.value : 0
            const baseNorm = Math.max(0, Math.min(100, (baseRaw / axisMax) * 100))

            const obj: MetricData = {
                subject: m.name,
                value: baseNorm,
                rawValue: baseRaw,
                maxScore: axisMax,
                type: m.type,
            }

            series.forEach((s) => {
                const key = s.key
                if (key === "value") return
                const raw = typeof m[key] === "number" && isFinite(m[key]) ? m[key] : 0
                const norm = Math.max(0, Math.min(100, (raw / axisMax) * 100))
                ;(obj as any)[key] = norm
            })

            return obj
        })
    }, [metrics, maxScore, series])

    // Spider/radar charts need at least 3 data points to form a proper polygon
    if (metrics.length < 3) {
        return (
            <div className={clsx("flex items-center justify-center", className)}>
                <Typography.Text type="secondary">
                    {metrics.length === 0
                        ? "No metrics available"
                        : "At least 3 metrics required for spider chart"}
                </Typography.Text>
            </div>
        )
    }

    const LABEL_OFFSET = 10
    const NUDGE = 0
    const RAD = Math.PI / 180

    return (
        <div className={clsx("border border-solid border-[#EAEFF5] rounded p-2", className)}>
            <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="45%" data={chartData}>
                    <PolarGrid stroke="#EAEFF5" />
                    <PolarAngleAxis
                        dataKey="subject"
                        tick={(props: any) => {
                            const {cx, cy, radius, payload} = props
                            const label = (payload?.value ?? "") as string

                            const angle = Number(payload?.coordinate ?? 0)
                            const r = (radius ?? 0) + LABEL_OFFSET

                            const x = cx + r * Math.cos(-angle * RAD)
                            const y = cy + r * Math.sin(-angle * RAD)

                            const cos = Math.cos(-angle * RAD)
                            const sin = Math.sin(-angle * RAD)

                            const textAnchor =
                                Math.abs(cos) < 0.1 ? "middle" : cos > 0 ? "start" : "end"

                            const nudgeX = cos * NUDGE
                            const nudgeY = sin * NUDGE

                            const clampLines = (s: string, max = 18) => {
                                const parts = s.includes(" - ") ? s.split(" - ") : [s]
                                if (parts.length >= 2) return parts.slice(0, 2)
                                const words = s.split(/\s+/)
                                let line1 = ""
                                let line2 = ""
                                for (const w of words) {
                                    if ((line1 + " " + w).trim().length <= max)
                                        line1 = (line1 + " " + w).trim()
                                    else if ((line2 + " " + w).trim().length <= max)
                                        line2 = (line2 + " " + w).trim()
                                    else {
                                        line2 = (line2 || w).slice(0, max - 1) + "…"
                                        break
                                    }
                                }
                                return line2 ? [line1, line2] : [line1]
                            }

                            const lines = clampLines(label, 18)
                            const lineHeight = 12
                            const blockOffset = -((lines.length - 1) * lineHeight) / 2

                            return (
                                <g
                                    transform={`translate(${x + nudgeX},${y + nudgeY + blockOffset})`}
                                    pointerEvents="none"
                                >
                                    <text
                                        textAnchor={textAnchor}
                                        dominantBaseline="middle"
                                        fill="#4B5563"
                                        fontSize={10}
                                        style={{userSelect: "none"}}
                                    >
                                        {lines.map((ln, i) => (
                                            <tspan key={i} x={0} dy={i === 0 ? 0 : lineHeight}>
                                                {ln}
                                            </tspan>
                                        ))}
                                    </text>
                                </g>
                            )
                        }}
                    />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} axisLine={false} tick={false} />
                    <Tooltip
                        labelStyle={{color: "#0F172A"}}
                        formatter={(val: any, name: any, payload: any) => {
                            try {
                                const d = payload?.payload as MetricData | undefined
                                if (!d) return [val, "Score"]
                                const pct = typeof val === "number" ? val : Number(val)
                                const rawFromPct = (pctNum: number) =>
                                    (pctNum / 100) * (d?.maxScore ?? 0)

                                const color =
                                    typeof payload?.color === "string" ? payload.color : "#0F172A"
                                const styledName = (
                                    <span style={{color, fontWeight: 600}}>{String(name)}</span>
                                )

                                if (d.type === "binary") {
                                    const valueLabel = `${pct.toFixed(2)}% / 100%`
                                    return [
                                        <span key="value" style={{color, fontWeight: 600}}>
                                            {valueLabel}
                                        </span>,
                                        styledName,
                                    ]
                                }

                                const raw = rawFromPct(pct)
                                const valueColor = {color, fontWeight: 600}
                                if (String(d?.subject).toLowerCase().includes("duration")) {
                                    return [
                                        <span key="value" style={valueColor}>
                                            {`${formatLatency(raw)} / ${formatLatency(d?.maxScore)}`}
                                        </span>,
                                        styledName,
                                    ]
                                }
                                if (String(d?.subject).toLowerCase().includes("cost")) {
                                    return [
                                        <span key="value" style={valueColor}>
                                            {`${formatCurrency(raw)} / ${formatCurrency(d?.maxScore)}`}
                                        </span>,
                                        styledName,
                                    ]
                                }
                                return [
                                    <span
                                        key="value"
                                        style={valueColor}
                                    >{`${format3Sig(raw)} / ${format3Sig(d?.maxScore)}`}</span>,
                                    styledName,
                                ]
                            } catch (error) {
                                return [String(val), String(name)]
                            }
                        }}
                    />
                    {series.map((s: SeriesMeta, i: number) => (
                        <Radar
                            key={s.key}
                            name={s.name ?? `Eval ${i + 1}`}
                            dataKey={s.key}
                            stroke={s.color}
                            fill={s.color}
                            fillOpacity={0.2}
                            dot={{fill: s.color, r: 4}}
                            isAnimationActive={false}
                        />
                    ))}
                </RadarChart>
            </ResponsiveContainer>
        </div>
    )
}

export default memo(EvaluatorMetricsSpiderChart)
