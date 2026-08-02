import {useMemo} from "react"

import type {AgentAnalyticsWindow} from "@/oss/services/tracing/types/agentAnalytics"

import {formatCost, formatLatency, formatRuns, formatTokens} from "../assets/format"
import {useChartColors} from "../hooks/useChartColors"

import ChartCard from "./ChartCard"
import LatencyChart from "./LatencyChart"
import StackedBarChart from "./StackedBarChart"

interface ChartsGridProps {
    current: AgentAnalyticsWindow
}

// The four locked-scope charts in a two-column grid. Each card reuses the
// ChartCard shell so Phase 5's Tools/Models cards slot in without new layout.
const ChartsGrid = ({current}: ChartsGridProps) => {
    const colors = useChartColors()
    const data = current.buckets
    const totals = current.totals

    const runsSeries = useMemo(
        () => [
            {key: "success", label: "Successful", color: colors.primary},
            {key: "failed", label: "Failed", color: colors.failed},
        ],
        [colors],
    )
    const latencySeries = useMemo(
        () => [
            {key: "latencyAvg", label: "Avg", color: colors.primary},
            {key: "latencyP95", label: "p95", color: colors.p95},
        ],
        [colors],
    )
    const costSeries = useMemo(
        () => [
            {key: "costPrompt", label: "Prompt", color: colors.primary},
            {key: "costCompletion", label: "Completion", color: colors.completion},
        ],
        [colors],
    )
    const tokensSeries = useMemo(
        () => [
            {key: "tokensPrompt", label: "Prompt", color: colors.primary},
            {key: "tokensCompletion", label: "Completion", color: colors.completion},
        ],
        [colors],
    )

    return (
        <div className="grid grid-cols-1 gap-4 min-[1024px]:grid-cols-2">
            <ChartCard
                title="Runs"
                description="How many times your agents ran, and how many failed."
                series={runsSeries}
                hasData={totals.totalRuns > 0}
            >
                {(activeKeys) => (
                    <StackedBarChart
                        data={data}
                        series={runsSeries}
                        activeKeys={activeKeys}
                        valueFormatter={formatRuns}
                    />
                )}
            </ChartCard>

            <ChartCard
                title="Latency"
                description="How long each run took to finish."
                series={latencySeries}
                hasData={totals.totalRuns > 0}
            >
                {(activeKeys) => (
                    <LatencyChart data={data} activeKeys={activeKeys} formatMs={formatLatency} />
                )}
            </ChartCard>

            <ChartCard
                title="Costs"
                description="How much you spent on prompts and completions."
                series={costSeries}
                hasData={totals.totalCost > 0}
            >
                {(activeKeys) => (
                    <StackedBarChart
                        data={data}
                        series={costSeries}
                        activeKeys={activeKeys}
                        valueFormatter={formatCost}
                    />
                )}
            </ChartCard>

            <ChartCard
                title="Tokens"
                description="How many tokens were sent and received."
                series={tokensSeries}
                hasData={totals.totalTokens > 0}
            >
                {(activeKeys) => (
                    <StackedBarChart
                        data={data}
                        series={tokensSeries}
                        activeKeys={activeKeys}
                        valueFormatter={formatTokens}
                    />
                )}
            </ChartCard>
        </div>
    )
}

export default ChartsGrid
