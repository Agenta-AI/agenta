import {useMemo} from "react"

import {hasCoverage} from "@/oss/services/tracing/lib/agentAnalytics"
import type {AgentAnalyticsWindow} from "@/oss/services/tracing/types/agentAnalytics"

import {formatCost, formatLatency, formatRuns, formatTokens} from "../assets/format"
import {useChartColors} from "../hooks/useChartColors"
import {useTimeAxis} from "../hooks/useTimeAxis"

import ChartCard, {type ChartState} from "./ChartCard"
import CostAreaChart from "./CostAreaChart"
import LatencyChart from "./LatencyChart"
import StackedAreaChart from "./StackedAreaChart"

interface ChartsGridProps {
    current: AgentAnalyticsWindow | null
    /** The dashboard request failed; every card reads the failed state. */
    failed: boolean
}

const EMPTY_BUCKETS: AgentAnalyticsWindow["buckets"] = []

// The locked-scope charts in a two-column grid. Each card reuses the ChartCard
// shell so its four states render consistently.
const ChartsGrid = ({current, failed}: ChartsGridProps) => {
    const colors = useChartColors()

    const data = current?.buckets ?? EMPTY_BUCKETS
    const totals = current?.totals
    const timeAxis = useTimeAxis(data, current?.range ?? "7_days")

    const totalRuns = totals?.totalRuns ?? 0
    const hasRuns = totalRuns > 0

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

    // Tokens: the prompt/completion split only clears its coverage gate sometimes;
    // below it, fall back to a single total-tokens bar.
    const showTokenSplit = hasRuns && hasCoverage(totals?.tokenSplitCount ?? 0, totalRuns)
    const tokensSeries = useMemo(
        () =>
            showTokenSplit
                ? [
                      {key: "tokensPrompt", label: "Prompt", color: colors.primary},
                      {key: "tokensCompletion", label: "Completion", color: colors.accent},
                  ]
                : [{key: "tokens", label: "Tokens", color: colors.primary}],
        [colors, showTokenSplit],
    )

    // Per-card state. A failed request fails every card; otherwise a card is
    // data / no-data, and cost additionally gates on coverage.
    const coreState = (has: boolean): ChartState => (failed ? "failed" : has ? "data" : "no-data")

    const costHasCoverage = hasRuns && hasCoverage(totals?.costCount ?? 0, totalRuns)
    const costState: ChartState = failed
        ? "failed"
        : !hasRuns
          ? "no-data"
          : costHasCoverage
            ? "data"
            : "unavailable"

    return (
        <div className="grid grid-cols-1 gap-4 min-[1024px]:grid-cols-2">
            <ChartCard
                title="Runs"
                description="How many times your agents ran, and how many failed."
                series={runsSeries}
                state={coreState(hasRuns)}
            >
                {(activeKeys) => (
                    <StackedAreaChart
                        data={data}
                        series={runsSeries}
                        activeKeys={activeKeys}
                        valueFormatter={formatRuns}
                        timeAxis={timeAxis}
                    />
                )}
            </ChartCard>

            <ChartCard
                title="Latency"
                description="How long each run took to finish."
                series={latencySeries}
                state={coreState(hasRuns)}
            >
                {(activeKeys) => (
                    <LatencyChart
                        data={data}
                        activeKeys={activeKeys}
                        formatMs={formatLatency}
                        timeAxis={timeAxis}
                    />
                )}
            </ChartCard>

            <ChartCard
                title="Cost"
                description="How much your agents spent, per period."
                series={[{key: "cost", label: "Cost", color: colors.primary}]}
                state={costState}
                unavailableMessage="Cost data isn't available for this window."
            >
                {() => (
                    <CostAreaChart data={data} valueFormatter={formatCost} timeAxis={timeAxis} />
                )}
            </ChartCard>

            <ChartCard
                title="Tokens"
                description="How many tokens were sent and received."
                series={tokensSeries}
                state={coreState(hasRuns)}
            >
                {(activeKeys) => (
                    <StackedAreaChart
                        data={data}
                        series={tokensSeries}
                        activeKeys={activeKeys}
                        valueFormatter={formatTokens}
                        timeAxis={timeAxis}
                    />
                )}
            </ChartCard>
        </div>
    )
}

export default ChartsGrid
