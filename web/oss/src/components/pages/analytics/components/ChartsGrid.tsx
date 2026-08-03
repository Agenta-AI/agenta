import {useMemo} from "react"

import {useAtomValue} from "jotai"

import {agentsWorkflowsAtom} from "@/oss/components/pages/agents/store"
import {hasCoverage} from "@/oss/services/tracing/lib/agentAnalytics"
import type {
    AgentAnalyticsBreakdownItem,
    AgentAnalyticsWindow,
} from "@/oss/services/tracing/types/agentAnalytics"

import {formatCost, formatLatency, formatRuns, formatTokens} from "../assets/format"
import {useChartColors} from "../hooks/useChartColors"

import BreakdownBarChart from "./BreakdownBarChart"
import ChartCard, {type ChartState} from "./ChartCard"
import CostAreaChart from "./CostAreaChart"
import LatencyChart from "./LatencyChart"
import StackedBarChart from "./StackedBarChart"

interface ChartsGridProps {
    current: AgentAnalyticsWindow | null
    /** The dashboard request failed; every card reads the failed state. */
    failed: boolean
}

const EMPTY_BUCKETS: AgentAnalyticsWindow["buckets"] = []
const EMPTY_BREAKDOWN: AgentAnalyticsBreakdownItem[] = []

// The locked-scope charts plus the category breakdowns, in a two-column grid.
// Each card reuses the ChartCard shell so its four states render consistently.
const ChartsGrid = ({current, failed}: ChartsGridProps) => {
    const colors = useChartColors()
    const agents = useAtomValue(agentsWorkflowsAtom)

    const data = current?.buckets ?? EMPTY_BUCKETS
    const totals = current?.totals
    const breakdowns = current?.breakdowns

    const totalRuns = totals?.totalRuns ?? 0
    const hasRuns = totalRuns > 0

    // A friendly label for each agent id in the breakdown, when one is known.
    const agentNameById = useMemo(() => {
        const map = new Map<string, string>()
        for (const a of agents) if (a.workflowId) map.set(a.workflowId, a.name)
        return map
    }, [agents])

    const agentBreakdown = useMemo(
        () =>
            (breakdowns?.agent ?? EMPTY_BREAKDOWN).map((item) => ({
                ...item,
                label: agentNameById.get(item.key) ?? `${item.key.slice(0, 8)}…`,
            })),
        [breakdowns, agentNameById],
    )

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

    const breakdownState = (items: AgentAnalyticsBreakdownItem[]): ChartState =>
        failed ? "failed" : items.length > 0 ? "data" : "no-data"

    return (
        <div className="grid grid-cols-1 gap-4 min-[1024px]:grid-cols-2">
            <ChartCard
                title="Runs"
                description="How many times your agents ran, and how many failed."
                series={runsSeries}
                state={coreState(hasRuns)}
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
                state={coreState(hasRuns)}
            >
                {(activeKeys) => (
                    <LatencyChart data={data} activeKeys={activeKeys} formatMs={formatLatency} />
                )}
            </ChartCard>

            <ChartCard
                title="Cost"
                description="How much your agents spent, per period."
                series={[{key: "cost", label: "Cost", color: colors.primary}]}
                state={costState}
                unavailableMessage="Cost data isn't available for this window."
            >
                {() => <CostAreaChart data={data} valueFormatter={formatCost} />}
            </ChartCard>

            <ChartCard
                title="Tokens"
                description="How many tokens were sent and received."
                series={tokensSeries}
                state={coreState(hasRuns)}
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

            <ChartCard
                title="Runs per harness"
                description="Which harness each run used."
                series={[{key: "count", label: "Runs", color: colors.primary}]}
                state={breakdownState(breakdowns?.harness ?? EMPTY_BREAKDOWN)}
            >
                {() => (
                    <BreakdownBarChart
                        data={breakdowns?.harness ?? EMPTY_BREAKDOWN}
                        valueFormatter={formatRuns}
                    />
                )}
            </ChartCard>

            <ChartCard
                title="Runs per configured model"
                description="Which configured model each run used."
                series={[{key: "count", label: "Runs", color: colors.primary}]}
                state={breakdownState(breakdowns?.model ?? EMPTY_BREAKDOWN)}
            >
                {() => (
                    <BreakdownBarChart
                        data={breakdowns?.model ?? EMPTY_BREAKDOWN}
                        valueFormatter={formatRuns}
                    />
                )}
            </ChartCard>

            <ChartCard
                title="Runs per agent"
                description="Which agent each run belonged to."
                series={[{key: "count", label: "Runs", color: colors.primary}]}
                state={breakdownState(agentBreakdown)}
            >
                {() => <BreakdownBarChart data={agentBreakdown} valueFormatter={formatRuns} />}
            </ChartCard>
        </div>
    )
}

export default ChartsGrid
