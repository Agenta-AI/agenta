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

import {format3Sig} from "@/oss/components/HumanEvaluations/assets/MetricDetailsPopover/assets/utils"
import {formatCurrency, formatLatency} from "@/oss/lib/helpers/formatters"

import {EVAL_COLOR} from "../../assets/utils"

import {EvaluatorMetricsSpiderChartProps, MetricData, SeriesMeta} from "./types"

const EvaluatorMetricsSpiderChart = ({
    className,
    metrics = [],
    maxScore = 100,
    series = [{key: "value", color: EVAL_COLOR[1], name: "Eval 1"}],
}: EvaluatorMetricsSpiderChartProps) => {
    // Build chart data with per-axis normalization to 0-100 so
    // each axis can have its own maxScore while sharing a single radius scale.
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

            // Add normalized values for additional series using same axis max
            series.forEach((s) => {
                const key = s.key
                if (key === "value") return // already set
                const raw = typeof m[key] === "number" && isFinite(m[key]) ? m[key] : 0
                const norm = Math.max(0, Math.min(100, (raw / axisMax) * 100))
                ;(obj as any)[key] = norm
            })

            return obj
        })
    }, [metrics, maxScore, series])

    if (metrics.length === 0) {
        return (
            <div className={clsx("flex items-center justify-center", className)}>
                <Typography.Text type="secondary">No metrics available</Typography.Text>
            </div>
        )
    }

    const LABEL_OFFSET = 12 // distance outside web
    const NUDGE = 5 // small outward nudge
    const RAD = Math.PI / 180

    return (
        <div className={clsx("border border-solid border-[#EAEFF5] rounded", className)}>
            <ResponsiveContainer width="100%" height="100%">
                <RadarChart
                    cx="52%"
                    cy={chartData.length < 4 ? "62%" : "50%"}
                    outerRadius={150}
                    data={chartData}
                >
                    <PolarGrid stroke="#EAEFF5" />
                    <PolarAngleAxis
                        dataKey="subject"
                        tick={(props: any) => {
                            const {cx, cy, radius, payload, index} = props
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

                            // simple 2-line clamp to avoid spilling into chart
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

                            return (
                                <g
                                    transform={`translate(${x + nudgeX},${y + nudgeY})`}
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
                                            <tspan key={i} x={0} dy={i === 0 ? 0 : 12}>
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
                                // val is normalized percentage for the active series
                                const pct = typeof val === "number" ? val : Number(val)
                                // Reconstruct raw from normalized and axis max (for numeric)
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
                                        <span style={{color, fontWeight: 600}}>{valueLabel}</span>,
                                        styledName,
                                    ]
                                }

                                // Numeric: format latency/costs specially when subject hints it
                                const raw = rawFromPct(pct)
                                const valueColor = {color, fontWeight: 600}
                                if (String(d?.subject).toLowerCase().includes("duration")) {
                                    return [
                                        <span style={valueColor}>
                                            {`${formatLatency(raw)} / ${formatLatency(d?.maxScore)}`}
                                        </span>,
                                        styledName,
                                    ]
                                }
                                if (String(d?.subject).toLowerCase().includes("cost")) {
                                    return [
                                        <span style={valueColor}>
                                            {`${formatCurrency(raw)} / ${formatCurrency(d?.maxScore)}`}
                                        </span>,
                                        styledName,
                                    ]
                                }
                                return [
                                    <span style={valueColor}>{`${format3Sig(raw)} / ${format3Sig(
                                        d?.maxScore,
                                    )}`}</span>,
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
