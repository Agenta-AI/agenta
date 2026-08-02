import {useMemo} from "react"

import {formatCurrency, formatNumber} from "@agenta/shared/utils"
import {Card} from "antd"

import {computeHealth} from "@/oss/services/tracing/lib/agentAnalytics"
import type {
    AgentAnalyticsTotals,
    AgentAnalyticsWindow,
} from "@/oss/services/tracing/types/agentAnalytics"

import {formatLatency} from "../assets/format"
import {buildHealthProse} from "../assets/health"
import {useChartColors} from "../hooks/useChartColors"

import HealthDonut from "./HealthDonut"
import StatTile, {type StatChange} from "./StatTile"

interface SummaryPanelProps {
    current: AgentAnalyticsWindow
    previous: AgentAnalyticsTotals
}

const signed = (value: number, unit: string): string =>
    `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(1)}${unit}`

// Relative percent change; good direction depends on the metric.
const relativeChange = (
    cur: number,
    prev: number,
    higherIsGood: boolean,
    hasBaseline: boolean,
): StatChange | null => {
    if (!hasBaseline || !prev) return null
    const pct = ((cur - prev) / prev) * 100
    return {display: signed(pct, "%"), good: higherIsGood ? pct >= 0 : pct <= 0}
}

// Success rate moves in percentage points, not relative percent.
const pointChange = (
    curRate: number,
    prevRate: number,
    hasBaseline: boolean,
): StatChange | null => {
    if (!hasBaseline) return null
    const pts = (curRate - prevRate) * 100
    return {display: signed(pts, "pt"), good: pts >= 0}
}

const SummaryPanel = ({current, previous}: SummaryPanelProps) => {
    const colors = useChartColors()
    const {totals, buckets} = current

    const health = useMemo(() => computeHealth(totals), [totals])
    const hasBaseline = previous.totalRuns > 0

    const successPct = (100 * totals.successRate).toFixed(1)
    const failedPct = (100 * (1 - totals.successRate)).toFixed(1)
    const prose = buildHealthProse(
        health,
        successPct,
        totals.avgLatency > previous.avgLatency,
        totals.totalCost > previous.totalCost,
    )

    const runsSpark = useMemo(() => buckets.map((b) => b.runs), [buckets])
    const rateSpark = useMemo(
        () => buckets.map((b) => (b.runs ? (b.success / b.runs) * 100 : 0)),
        [buckets],
    )
    const latencySpark = useMemo(() => buckets.map((b) => b.latencyAvg), [buckets])
    const costSpark = useMemo(() => buckets.map((b) => b.cost), [buckets])

    return (
        <Card className="[&_.ant-card-body]:p-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:gap-4">
                <div className="flex items-center gap-2 xl:w-[250px] xl:shrink-0">
                    <HealthDonut health={health} />
                    <div className="flex flex-col gap-1.5 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-colorText">Agent health</span>
                        </div>
                        <span className="text-colorTextSecondary leading-snug text-[11px]">
                            {prose}
                        </span>
                    </div>
                </div>

                <div className="h-px w-full bg-colorBorderSecondary xl:h-auto xl:w-px xl:self-stretch" />

                <div className="grid flex-1 grid-cols-1 gap-3 xl:gap-2 min-[560px]:grid-cols-2 xl:grid-cols-4">
                    <StatTile
                        label="Total runs"
                        value={formatNumber(totals.totalRuns)}
                        change={relativeChange(
                            totals.totalRuns,
                            previous.totalRuns,
                            true,
                            hasBaseline,
                        )}
                        spark={runsSpark}
                        color={colors.latency}
                    />
                    <StatTile
                        label="Success rate"
                        value={`${successPct}%`}
                        secondary={totals.failedRuns > 0 ? `${failedPct}% failed` : undefined}
                        change={pointChange(totals.successRate, previous.successRate, hasBaseline)}
                        spark={rateSpark}
                        color={colors.success}
                    />
                    <StatTile
                        label="Avg latency"
                        value={formatLatency(totals.avgLatency)}
                        change={relativeChange(
                            totals.avgLatency,
                            previous.avgLatency,
                            false,
                            hasBaseline,
                        )}
                        spark={latencySpark}
                        color={colors.p95}
                    />
                    <StatTile
                        label="Total cost"
                        value={formatCurrency(totals.totalCost)}
                        change={relativeChange(
                            totals.totalCost,
                            previous.totalCost,
                            false,
                            hasBaseline,
                        )}
                        spark={costSpark}
                        color={colors.completion}
                    />
                </div>
            </div>
        </Card>
    )
}

export default SummaryPanel
