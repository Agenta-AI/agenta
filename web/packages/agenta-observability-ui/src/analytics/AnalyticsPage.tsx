import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import analyticsCatalog from "@agenta/i18n/catalogs/observabilityUi.analytics"
import {
    EMPTY_FILTERS,
    ANALYTICS_RANGE,
    createAnalyticsViewAtoms,
    defaultRange,
    isRangeLocked,
    analyticsHasAgentsAtom,
    AnalyticsViewAtomsContext,
    sharedAnalyticsViewAtoms,
    useAnalyticsViewAtoms,
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
import {ANALYTICS_COLOR_CSS} from "./colors"
import {AnalyticsDrawer} from "./drawer/AnalyticsDrawer"
import {bucketUnit, fullLabel, groupKeyLabel, shortLabel, type EmptyWhat} from "./labels"
import {useAgentNames, useFailureReasons, usePageAnalytics} from "./useAnalyticsData"
import {useRangeLabel} from "./useRangeLabel"

export interface AnalyticsPageProps {
    /** The plan's trace retention; null keeps every range open (OSS, custom plans). */
    retention: AnalyticsRetention | null
    onUpgrade?: () => void
    onCreateAgent?: () => void
    creatingAgent?: boolean
    createAgentError?: string | null
    /** Opens a run's trace from the drawer's runs list. */
    onOpenTrace?: (traceId: string) => void
    /**
     * The Analytics page of one agent. The page shows only this agent's runs and keeps its own
     * range, filters and grouping, so the shared Analytics view does not change. It has no Agent
     * filter or grouping and no "Failures by agent" card.
     */
    lockedAgentId?: string
    /** Shown in place of the Agent filter on the page of one agent. */
    lockedAgentChip?: ReactNode
}

const WHAT_KEYS = {
    cost: "observabilityUi.analytics.whatCost",
    runs: "observabilityUi.analytics.whatRuns",
    tokens: "observabilityUi.analytics.whatTokens",
    failedRuns: "observabilityUi.analytics.whatFailedRuns",
} as const satisfies Record<EmptyWhat, string>

export const AnalyticsPage = (props: AnalyticsPageProps) => {
    const {lockedAgentId} = props
    // Picked once: the host remounts the page for another agent.
    const [view] = useState(() =>
        lockedAgentId ? createAnalyticsViewAtoms(lockedAgentId) : sharedAnalyticsViewAtoms,
    )
    return (
        <AnalyticsViewAtomsContext.Provider value={view}>
            <AnalyticsPageBody {...props} />
        </AnalyticsViewAtomsContext.Provider>
    )
}

const AnalyticsPageBody = ({
    retention,
    onUpgrade,
    onCreateAgent,
    creatingAgent,
    createAgentError,
    onOpenTrace,
    lockedAgentChip,
}: AnalyticsPageProps) => {
    const view = useAnalyticsViewAtoms()
    // The view decides: the page of one agent made its own view with that agent.
    const {lockedAgentId} = view
    const [range, setRange] = useAtom(view.range)
    const [custom, setCustom] = useAtom(view.custom)
    const t = useT(analyticsCatalog)
    const {label: rangeLabel, inline: rangeInline} = useRangeLabel()
    const [filters, setFilters] = useAtom(view.filters)
    // What the charts read: the reader's filters, and the locked agent on the page of one agent.
    const queryFilters = useAtomValue(view.queryFilters)
    const window = useAtomValue(view.window)
    const agents = useAtomValue(analyticsHasAgentsAtom)
    const openDrawer = useSetAtom(view.drawer)
    const [group, setGroup] = useAtom(view.group)
    const [rangeOpen, setRangeOpen] = useState(false)
    // Without a tick the window freezes at first read: runs after `newest` would never show.
    const setNow = useSetAtom(view.now)
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
        if (!custom && isRangeLocked(ANALYTICS_RANGE[range], retention))
            setRange(defaultRange(retention))
    }, [custom, range, retention, setRange])

    const {data, split, keyColor} = usePageAnalytics(window, queryFilters, group)

    const agentName = useAgentNames(
        useMemo(
            () => [...new Set([...data.agentOrder, ...filters.agent])],
            [data.agentOrder, filters.agent],
        ),
    )
    const filtered = filters.agent.length > 0 || filters.model.length > 0
    const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), [setFilters])
    const emptyText = useCallback(
        (what: EmptyWhat) =>
            filtered
                ? {text: t("observabilityUi.analytics.noRunsMatchFilters"), onClear: clearFilters}
                : {
                      text: t("observabilityUi.analytics.emptyInRange", {
                          what: t(WHAT_KEYS[what]),
                          range: rangeInline,
                      }),
                  },
        [filtered, clearFilters, rangeInline, t],
    )
    const onExplore = useCallback(
        (metric: AnalyticsMetric, bucket: number | null) =>
            openDrawer({
                bucket,
                metric,
                // One agent has nothing to break down by agent.
                dim: group === "agent" || (group === "none" && !lockedAgentId) ? "agent" : "model",
                focus: null,
                failedOnly: false,
            }),
        [openDrawer, group, lockedAgentId],
    )

    const failures = useFailureReasons(window, queryFilters, data.overview.totals.failed)

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
        const dim = group
        const g = data.groups[dim]
        const keyCount = g.order.length
        const points = data.overview.points
        return {
            keyLabel: groupKeyLabel(dim, agentName),
            keyColor: (key: string) => keyColor(dim, key),
            failed: g.failed,
            runs: {
                series: g.runs,
                total: points.map((p) => p.runs),
                status: g.status,
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
    }, [group, split, data, agentName, keyColor])
    const ctx: OverviewContext = {
        data,
        labels,
        fullLabels,
        unit: bucketUnit(window),
        rangeLabel,
        agentName,
        grouped,
        failures,
        emptyText,
        onExplore,
    }

    const overviewStatus = data.status.overview
    // Archived agents keep their history, so "no agents" alone does not mean "no runs".
    // An agent page with no runs shows each card's empty range text instead.
    const noAnalyticsYet =
        !lockedAgentId &&
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
                <AnalyticsEmptyState
                    onCreateAgent={onCreateAgent}
                    creating={creatingAgent}
                    error={createAgentError}
                />
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
                custom={custom}
                onCustomChange={setCustom}
                rangeLabel={rangeLabel}
                retention={retention}
                onUpgrade={onUpgrade}
                filters={filters}
                onFiltersChange={setFilters}
                group={group}
                onGroupChange={setGroup}
                lockedAgentChip={lockedAgentChip}
                queryFilters={queryFilters}
                window={window}
                agentName={agentName}
                rangeOpen={rangeOpen}
                onRangeOpenChange={setRangeOpen}
            />
            {noMatch ? (
                <div className="flex flex-wrap items-center gap-2.5 rounded-lg bg-muted px-3.5 py-2.5 text-sm">
                    <FunnelSimple className="text-muted-foreground" />
                    <span className="text-muted-foreground">
                        {t("observabilityUi.analytics.noRunsMatch")}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                        {[
                            filters.agent.length
                                ? t("observabilityUi.analytics.filterAgent", {
                                      names: filters.agent.map(agentName).join(", "),
                                  })
                                : null,
                            filters.model.length
                                ? t("observabilityUi.analytics.filterModel", {
                                      names: filters.model.join(", "),
                                  })
                                : null,
                        ]
                            .filter(Boolean)
                            .join(" · ")}
                    </span>
                    <Button variant="ghost" size="xs" onClick={() => setRangeOpen(true)}>
                        {t("observabilityUi.analytics.changeRange")}
                    </Button>
                    <Button size="xs" onClick={clearFilters}>
                        {t("observabilityUi.analytics.clearFilters")}
                    </Button>
                </div>
            ) : null}
            <CostCard ctx={ctx} />
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-4">
                <RunsCard ctx={ctx} />
                <SuccessCard ctx={ctx} />
            </div>
            <TokensCard ctx={ctx} />
            {lockedAgentId ? null : (
                <FailureRateCard
                    data={data}
                    failures={failures}
                    agentName={agentName}
                    rangeLabel={rangeLabel}
                    emptyText={emptyText}
                    onSelectAgent={(id) =>
                        openDrawer({
                            bucket: null,
                            metric: "runs",
                            dim: "model",
                            focus: {dim: "agent", key: id} satisfies AnalyticsFocus,
                            failedOnly: true,
                        })
                    }
                />
            )}
            <AnalyticsDrawer agentName={agentName} keyColor={keyColor} onOpenTrace={onOpenTrace} />
        </div>
    )
}
