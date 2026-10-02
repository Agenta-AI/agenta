import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    EMPTY_FILTERS,
    USAGE_RANGE,
    defaultRange,
    isRangeLocked,
    usageDrawerAtom,
    usageFiltersAtom,
    usageHasAgentsAtom,
    usageNowAtom,
    usageRangeAtom,
    usageWindowAtom,
    type UsageDimension,
    type UsageFocus,
    type UsageMetric,
    type UsageRetention,
} from "@agenta/observability/usage"
import {projectIdAtom} from "@agenta/shared/state"
import {Button} from "@agenta/ui/ui"
import {FunnelSimple} from "@phosphor-icons/react"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {BreakdownCard, type BreakdownMetric} from "./cards/BreakdownCard"
import {FailureRateCard} from "./cards/FailureRateCard"
import {
    CostCard,
    RunsCard,
    SuccessCard,
    TokensCard,
    type OverviewContext,
} from "./cards/OverviewCards"
import {USAGE_COLOR_CSS} from "./colors"
import {UsageDrawer} from "./drawer/UsageDrawer"
import {bucketUnit, fullLabel, shortLabel} from "./labels"
import {UsageEmptyState} from "./UsageEmptyState"
import {UsageToolbar} from "./UsageToolbar"
import {useAgentNames, useUsageSplit, useUsageWindowData} from "./useUsageData"

export interface UsagePageProps {
    /** The plan's trace retention; null keeps every range open (OSS, custom plans). */
    retention: UsageRetention | null
    onUpgrade?: () => void
    onCreateAgent?: () => void
    /** Opens a run's trace from the drawer's runs list. */
    onOpenTrace?: (traceId: string) => void
}

const SPLIT_KEYS = 10

const CALLS_NOTE =
    "Not narrowed by the filters: model and tool calls do not record their agent yet."

export const UsagePage = ({retention, onUpgrade, onCreateAgent, onOpenTrace}: UsagePageProps) => {
    const [range, setRange] = useAtom(usageRangeAtom)
    const [filters, setFilters] = useAtom(usageFiltersAtom)
    const window = useAtomValue(usageWindowAtom)
    const agents = useAtomValue(usageHasAgentsAtom)
    const openDrawer = useSetAtom(usageDrawerAtom)
    const [agentMetric, setAgentMetric] = useState<BreakdownMetric>("runs")
    const [modelMetric, setModelMetric] = useState<BreakdownMetric>("runs")
    const [rangeOpen, setRangeOpen] = useState(false)

    // Without a tick the window freezes at first read: runs after `newest` would never show.
    const setNow = useSetAtom(usageNowAtom)
    useEffect(() => {
        setNow(Date.now())
        const timer = setInterval(() => setNow(Date.now()), 60_000)
        return () => clearInterval(timer)
    }, [setNow])

    // Agent ids and an open drawer belong to one project and one visit to the tab.
    const projectId = useAtomValue(projectIdAtom)
    const lastProject = useRef(projectId)
    useEffect(() => {
        if (lastProject.current !== projectId) setFilters(EMPTY_FILTERS)
        lastProject.current = projectId
    }, [projectId, setFilters])
    useEffect(() => () => openDrawer(null), [openDrawer])

    // A plan that keeps less history than the open range moves the page to what it keeps.
    useEffect(() => {
        if (isRangeLocked(USAGE_RANGE[range], retention)) setRange(defaultRange(retention))
    }, [range, retention, setRange])

    const data = useUsageWindowData(window, filters)
    // Without a group-by, cost and tokens per agent cost one request each: the top 10 by runs.
    const agentSplit = useUsageSplit("agent", data.agentOrder.slice(0, SPLIT_KEYS), window, filters)
    const callSplit = useUsageSplit(
        "callModel",
        data.callModelOrder.slice(0, SPLIT_KEYS),
        window,
        EMPTY_FILTERS,
        modelMetric !== "runs",
    )

    const agentName = useAgentNames(
        useMemo(
            () => [...new Set([...data.agentOrder, ...filters.agent])],
            [data.agentOrder, filters.agent],
        ),
    )
    const filtered = filters.agent.length > 0 || filters.model.length > 0
    const rangeLabel = USAGE_RANGE[range].label
    const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), [setFilters])
    const emptyText = useCallback(
        (what: string) =>
            filtered
                ? {text: "No runs match your filters", onClear: clearFilters}
                : {text: `No ${what} in the ${rangeLabel.toLowerCase()}`},
        [filtered, clearFilters, rangeLabel],
    )
    const onExplore = useCallback(
        (metric: UsageMetric, bucket: number | null, dim: UsageDimension = "agent") =>
            openDrawer({bucket, metric, dim, focus: null, failedOnly: false}),
        [openDrawer],
    )

    const labels = useMemo(
        () => data.starts.map((s) => shortLabel(window, s)),
        [data.starts, window],
    )
    const fullLabels = useMemo(
        () => data.starts.map((s) => fullLabel(window, s)),
        [data.starts, window],
    )
    const ctx: OverviewContext = {
        data,
        labels,
        fullLabels,
        unit: bucketUnit(window),
        rangeLabel,
        agentName,
        agentCost: agentSplit.cost,
        filtered,
        emptyText,
        onExplore,
    }

    const overviewStatus = data.status.overview
    // Archived agents keep their history, so "no agents" alone does not mean "no usage".
    const noUsageYet =
        !agents.pending &&
        !agents.failed &&
        !agents.hasAgents &&
        !overviewStatus.pending &&
        !overviewStatus.error &&
        data.overview.totals.runs === 0 &&
        !filtered
    if (noUsageYet) {
        return (
            <>
                <style>{USAGE_COLOR_CSS}</style>
                <UsageEmptyState onCreateAgent={onCreateAgent} />
            </>
        )
    }

    const noMatch = filtered && !overviewStatus.pending && !data.overview.totals.runs
    const agentSource = {
        runs: {
            series: data.agentRuns,
            total: data.overview.points.map((p) => p.runs),
            status: data.status.agents,
        },
        cost: {
            series: agentSplit.cost,
            keyCount: data.agentOrder.length,
            total: data.overview.points.map((p) => p.cost),
            status: agentSplit.status,
        },
        tokens: {
            series: agentSplit.tokens,
            keyCount: data.agentOrder.length,
            total: data.overview.points.map((p) => p.tokens),
            status: agentSplit.status,
        },
    }[agentMetric]
    const modelSource = {
        runs: {series: data.callModels, status: data.status.calls},
        cost: {
            series: callSplit.cost,
            keyCount: data.callModelOrder.length,
            total: data.callCost,
            status: callSplit.status,
        },
        tokens: {
            series: callSplit.tokens,
            keyCount: data.callModelOrder.length,
            total: data.callTokens,
            status: callSplit.status,
        },
    }[modelMetric]
    const breakdownProps = {labels, fullLabels, rangeLabel}

    return (
        <div className="flex flex-col gap-4 pb-10">
            <style>{USAGE_COLOR_CSS}</style>
            <UsageToolbar
                range={range}
                onRangeChange={setRange}
                retention={retention}
                onUpgrade={onUpgrade}
                filters={filters}
                onFiltersChange={setFilters}
                window={window}
                agentName={agentName}
                rangeOpen={rangeOpen}
                onRangeOpenChange={setRangeOpen}
            />
            {noMatch ? (
                <div className="flex flex-wrap items-center gap-2.5 rounded-lg bg-muted px-3.5 py-2.5 text-sm">
                    <FunnelSimple className="text-muted-foreground" />
                    <span className="text-muted-foreground">No runs match</span>
                    <span className="min-w-0 flex-1 truncate">
                        {[
                            filters.agent.length
                                ? `Agent: ${filters.agent.map(agentName).join(", ")}`
                                : null,
                            filters.model.length ? `Model: ${filters.model.join(", ")}` : null,
                        ]
                            .filter(Boolean)
                            .join(" · ")}
                    </span>
                    <Button variant="ghost" size="xs" onClick={() => setRangeOpen(true)}>
                        Change range
                    </Button>
                    <Button size="xs" onClick={clearFilters}>
                        Clear filters
                    </Button>
                </div>
            ) : null}
            <CostCard ctx={ctx} />
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-4">
                <RunsCard ctx={ctx} />
                <SuccessCard ctx={ctx} />
            </div>
            <TokensCard ctx={ctx} />

            <h2 className="m-0 mt-6 text-base font-medium text-foreground">Breakdown</h2>
            <FailureRateCard
                data={data}
                agentName={agentName}
                rangeLabel={rangeLabel}
                emptyText={emptyText}
                onSelectAgent={(id) =>
                    openDrawer({
                        bucket: null,
                        metric: "runs",
                        dim: "model",
                        focus: {dim: "agent", key: id} satisfies UsageFocus,
                        failedOnly: true,
                    })
                }
            />
            <BreakdownCard
                {...breakdownProps}
                dim="agent"
                metric={agentMetric}
                metrics={["runs", "cost", "tokens"]}
                onMetricChange={setAgentMetric}
                source={agentSource}
                keyLabel={agentName}
                countWord="runs"
                empty={emptyText("runs")}
                onExplore={(metric, bucket) => onExplore(metric, bucket, "agent")}
            />
            <BreakdownCard
                {...breakdownProps}
                dim="model"
                metric={modelMetric}
                metrics={["runs", "cost", "tokens"]}
                onMetricChange={setModelMetric}
                source={modelSource}
                keyLabel={(key) => key}
                countWord="calls"
                note={filtered ? CALLS_NOTE : undefined}
                empty={{text: `No model calls in the ${rangeLabel.toLowerCase()}`}}
                onExplore={(metric, bucket) =>
                    onExplore(metric === "tools" ? "runs" : metric, bucket, "model")
                }
            />
            <BreakdownCard
                {...breakdownProps}
                dim="tool"
                metric="runs"
                source={{series: data.toolCalls, status: data.status.tools}}
                keyLabel={(key) => key}
                countWord="calls"
                note={filtered ? CALLS_NOTE : undefined}
                empty={{text: `No tool calls in the ${rangeLabel.toLowerCase()}`}}
                onExplore={(_, bucket) => onExplore("tools", bucket, "tool")}
            />
            <UsageDrawer agentName={agentName} onOpenTrace={onOpenTrace} />
        </div>
    )
}
