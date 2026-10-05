import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    EMPTY_FILTERS,
    ANALYTICS_RANGE,
    defaultRange,
    isRangeLocked,
    analyticsDrawerAtom,
    analyticsFiltersAtom,
    analyticsGroupAtom,
    analyticsHasAgentsAtom,
    analyticsNowAtom,
    analyticsRangeAtom,
    analyticsWindowAtom,
    rankKeys,
    type AnalyticsFocus,
    type AnalyticsMetric,
    type AnalyticsRetention,
} from "@agenta/observability/analytics"
import {projectIdAtom} from "@agenta/shared/state"
import {Button} from "@agenta/ui/ui"
import {FunnelSimple} from "@phosphor-icons/react"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {AnalyticsEmptyState} from "./AnalyticsEmptyState"
import {AnalyticsToolbar} from "./AnalyticsToolbar"
import {FailureRateCard} from "./cards/FailureRateCard"
import {
    CostCard,
    RunsCard,
    SuccessCard,
    TokensCard,
    type GroupedData,
    type OverviewContext,
} from "./cards/OverviewCards"
import {ANALYTICS_COLOR_CSS, SERIES_COLORS, analyticsColor} from "./colors"
import {AnalyticsDrawer} from "./drawer/AnalyticsDrawer"
import {bucketUnit, fullLabel, shortLabel} from "./labels"
import {useAgentNames, useAnalyticsSplit, useAnalyticsWindowData} from "./useAnalyticsData"

export interface AnalyticsPageProps {
    /** The plan's trace retention; null keeps every range open (OSS, custom plans). */
    retention: AnalyticsRetention | null
    onUpgrade?: () => void
    onCreateAgent?: () => void
    /** Opens a run's trace from the drawer's runs list. */
    onOpenTrace?: (traceId: string) => void
}

// Without a group-by, cost and tokens per key cost one request each, so splits stop here.
const SPLIT_KEYS = 25

export const AnalyticsPage = ({
    retention,
    onUpgrade,
    onCreateAgent,
    onOpenTrace,
}: AnalyticsPageProps) => {
    const [range, setRange] = useAtom(analyticsRangeAtom)
    const [filters, setFilters] = useAtom(analyticsFiltersAtom)
    const window = useAtomValue(analyticsWindowAtom)
    const agents = useAtomValue(analyticsHasAgentsAtom)
    const openDrawer = useSetAtom(analyticsDrawerAtom)
    const [group, setGroup] = useAtom(analyticsGroupAtom)
    const [rangeOpen, setRangeOpen] = useState(false)

    // Without a tick the window freezes at first read: runs after `newest` would never show.
    const setNow = useSetAtom(analyticsNowAtom)
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
        if (isRangeLocked(ANALYTICS_RANGE[range], retention)) setRange(defaultRange(retention))
    }, [range, retention, setRange])

    const data = useAnalyticsWindowData(window, filters)
    // Every agent up to the cap, so a costly agent with few runs is not lost to "Other".
    const agentSplit = useAnalyticsSplit(
        "agent",
        data.agentOrder.slice(0, SPLIT_KEYS),
        window,
        filters,
    )
    const modelSplit = useAnalyticsSplit(
        "model",
        data.modelOrder.slice(0, SPLIT_KEYS),
        window,
        filters,
        group === "model",
    )

    const agentName = useAgentNames(
        useMemo(
            () => [...new Set([...data.agentOrder, ...filters.agent])],
            [data.agentOrder, filters.agent],
        ),
    )
    const filtered = filters.agent.length > 0 || filters.model.length > 0
    const rangeLabel = ANALYTICS_RANGE[range].label
    const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), [setFilters])
    const emptyText = useCallback(
        (what: string) =>
            filtered
                ? {text: "No runs match your filters", onClear: clearFilters}
                : {text: `No ${what} in the ${rangeLabel.toLowerCase()}`},
        [filtered, clearFilters, rangeLabel],
    )
    const onExplore = useCallback(
        (metric: AnalyticsMetric, bucket: number | null) =>
            openDrawer({
                bucket,
                metric,
                dim: group === "model" ? "model" : "agent",
                focus: null,
                failedOnly: false,
            }),
        [openDrawer, group],
    )

    const labels = useMemo(
        () => data.starts.map((s) => shortLabel(window, s)),
        [data.starts, window],
    )
    const fullLabels = useMemo(
        () => data.starts.map((s) => fullLabel(window, s)),
        [data.starts, window],
    )
    const grouped = useMemo<GroupedData | null>(() => {
        if (group === "none") return null
        const byAgent = group === "agent"
        const split = byAgent ? agentSplit : modelSplit
        const keyCount = (byAgent ? data.agentOrder : data.modelOrder).length
        const points = data.overview.points
        const runs = byAgent ? data.agentRuns : data.modelRuns
        // Colors go to the keys any card shows, in that order, so a key keeps one color.
        const shown = [
            ...new Set([runs, split.cost, split.tokens].flatMap((s) => rankKeys(s).slice(0, 4))),
        ]
        const keyColor = (key: string) =>
            analyticsColor(SERIES_COLORS[Math.max(0, shown.indexOf(key)) % SERIES_COLORS.length])
        return {
            keyLabel: byAgent ? agentName : (key: string) => key,
            keyColor,
            failed: byAgent ? data.agentFailed : data.modelFailed,
            runs: {
                series: runs,
                total: points.map((p) => p.runs),
                status: byAgent ? data.status.agents : data.status.models,
            },
            cost: {
                series: split.cost,
                keyCount,
                total: points.map((p) => p.cost),
                status: split.status,
            },
            tokens: {
                series: split.tokens,
                keyCount,
                total: points.map((p) => p.tokens),
                status: split.status,
            },
        }
    }, [group, agentSplit, modelSplit, data, agentName])
    const ctx: OverviewContext = {
        data,
        labels,
        fullLabels,
        unit: bucketUnit(window),
        rangeLabel,
        agentName,
        agentCost: agentSplit.cost,
        grouped,
        emptyText,
        onExplore,
    }

    const overviewStatus = data.status.overview
    // Archived agents keep their history, so "no agents" alone does not mean "no runs".
    const noAnalyticsYet =
        !agents.pending &&
        !agents.failed &&
        !agents.hasAgents &&
        !overviewStatus.pending &&
        !overviewStatus.error &&
        data.overview.totals.runs === 0 &&
        !filtered
    if (noAnalyticsYet) {
        return (
            <>
                <style>{ANALYTICS_COLOR_CSS}</style>
                <AnalyticsEmptyState onCreateAgent={onCreateAgent} />
            </>
        )
    }

    const noMatch = filtered && !overviewStatus.pending && !data.overview.totals.runs

    return (
        <div className="flex flex-col gap-4 pb-10">
            <style>{ANALYTICS_COLOR_CSS}</style>
            <AnalyticsToolbar
                range={range}
                onRangeChange={setRange}
                retention={retention}
                onUpgrade={onUpgrade}
                filters={filters}
                onFiltersChange={setFilters}
                group={group}
                onGroupChange={setGroup}
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

            <FailureRateCard
                data={data}
                agentName={agentName}
                rangeLabel={rangeLabel}
                emptyText={emptyText}
                onSelectAgent={(id, failedOnly) =>
                    openDrawer({
                        bucket: null,
                        metric: "runs",
                        dim: "model",
                        focus: {dim: "agent", key: id} satisfies AnalyticsFocus,
                        failedOnly,
                    })
                }
            />
            <AnalyticsDrawer agentName={agentName} onOpenTrace={onOpenTrace} />
        </div>
    )
}
