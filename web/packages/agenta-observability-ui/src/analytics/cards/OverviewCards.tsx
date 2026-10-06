import {useMemo, useState} from "react"

import {
    formatCount,
    formatMetric,
    formatMoney,
    rankKeys,
    sharePercent,
    successRate,
    sum,
    type KeyedSeries,
    type AnalyticsMetric,
} from "@agenta/observability/analytics"

import {ChartTooltipPanel, type TooltipRow} from "../charts/ChartTooltipPanel"
import {TimeChart} from "../charts/TimeChart"
import {SERIES_COLORS, analyticsColor} from "../colors"
import type {AnalyticsWindowData, FailureReasons} from "../useAnalyticsData"

import {ChartLegendRow, AnalyticsCard, type LegendItem} from "./AnalyticsCard"
import {GroupedCard, type GroupedMetric, type GroupedSource} from "./GroupedCard"

export interface GroupedData {
    keyLabel: (key: string) => string
    keyColor: (key: string) => string
    runs: GroupedSource
    cost: GroupedSource
    tokens: GroupedSource
    failed: KeyedSeries
}

export interface OverviewContext {
    data: AnalyticsWindowData
    labels: string[]
    fullLabels: string[]
    unit: string
    rangeLabel: string
    agentName: (id: string) => string
    /** The page's group-by, when set: per-key series the main cards stack. */
    grouped: GroupedData | null
    failures: FailureReasons
    emptyText: (what: string) => {text: string; onClear?: () => void}
    onExplore: (metric: AnalyticsMetric, bucket: number | null) => void
}

/** The two keys with the most of `series` in one bucket, plus "Other" for the rest of `total`. */
const topRows = (
    series: KeyedSeries,
    index: number,
    total: number,
    name: (key: string) => string,
    format: (value: number) => string,
    color: string,
): TooltipRow[] => {
    const top = Object.keys(series)
        .map((key) => ({key, value: series[key][index] ?? 0}))
        .filter((row) => row.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 2)
    const rows: TooltipRow[] = top.map((row, i) => ({
        color: i ? `color-mix(in srgb, ${color} 55%, transparent)` : color,
        label: name(row.key),
        value: format(row.value),
        share: sharePercent(row.value, total),
    }))
    const rest = total - sum(top.map((row) => row.value))
    if (top.length && rest > total * 0.005)
        rows.push({
            color: analyticsColor("other"),
            label: "Other",
            value: format(rest),
            share: sharePercent(rest, total),
        })
    return rows
}

const useHover = () => useState<number | null>(null)

/** A main card under a group-by: the same headline, the chart stacked by group. */
const GroupedMainCard = ({
    ctx,
    grouped,
    metric,
    title,
    value,
    height,
}: {
    ctx: OverviewContext
    grouped: GroupedData
    metric: GroupedMetric
    title: string
    value: string
    height: number
}) => (
    <GroupedCard
        title={title}
        value={value}
        caption={ctx.rangeLabel}
        metric={metric}
        source={grouped[metric]}
        keyLabel={grouped.keyLabel}
        keyColor={grouped.keyColor}
        labels={ctx.labels}
        fullLabels={ctx.fullLabels}
        height={height}
        empty={ctx.emptyText(metric)}
        onExplore={(bucket) => ctx.onExplore(metric, bucket)}
    />
)

export const CostCard = ({ctx}: {ctx: OverviewContext}) =>
    ctx.grouped ? (
        <GroupedMainCard
            ctx={ctx}
            grouped={ctx.grouped}
            metric="cost"
            title="Cost"
            value={formatMoney(ctx.data.overview.totals.cost)}
            height={210}
        />
    ) : (
        <CostChartCard ctx={ctx} />
    )

export const RunsCard = ({ctx}: {ctx: OverviewContext}) =>
    ctx.grouped ? (
        <GroupedMainCard
            ctx={ctx}
            grouped={ctx.grouped}
            metric="runs"
            title="Runs"
            value={formatCount(ctx.data.overview.totals.runs)}
            height={150}
        />
    ) : (
        <RunsChartCard ctx={ctx} />
    )

export const TokensCard = ({ctx}: {ctx: OverviewContext}) =>
    ctx.grouped ? (
        <GroupedMainCard
            ctx={ctx}
            grouped={ctx.grouped}
            metric="tokens"
            title="Tokens"
            value={formatMetric("tokens", ctx.data.overview.totals.tokens)}
            height={150}
        />
    ) : (
        <TokensChartCard ctx={ctx} />
    )

const CostChartCard = ({ctx}: {ctx: OverviewContext}) => {
    const [hovered, setHovered] = useHover()
    const {points, totals} = ctx.data.overview
    const values = points.map((p) => p.cost)
    const avg = values.length ? totals.cost / values.length : 0
    const status = ctx.data.status.overview
    return (
        <AnalyticsCard
            title="Cost"
            value={formatMoney(totals.cost)}
            caption={ctx.rangeLabel}
            onExplore={() => ctx.onExplore("cost", null)}
            loading={status.pending}
            error={status.error}
            onRetry={status.refetch}
            empty={totals.cost ? null : ctx.emptyText("cost")}
            chartHeight={210}
        >
            <TimeChart
                kind="bar"
                labels={ctx.labels}
                series={[{key: "cost", label: "Cost", color: analyticsColor("cost"), values}]}
                formatTick={(v) => formatMetric("cost", v, true)}
                average={{
                    value: avg,
                    label: `avg ${formatMetric("cost", avg, true)} / ${ctx.unit}`,
                }}
                height={210}
                hovered={hovered}
                onHover={setHovered}
                onSelect={(i) => ctx.onExplore("cost", i)}
                tooltip={(i) => (
                    <ChartTooltipPanel
                        title={ctx.fullLabels[i]}
                        runs={`${formatCount(points[i].runs)} runs`}
                        value={formatMoney(values[i])}
                        facts={[
                            {
                                label: "Avg cost per run",
                                value: formatMoney(
                                    points[i].runs ? values[i] / points[i].runs : null,
                                ),
                            },
                        ]}
                    />
                )}
            />
        </AnalyticsCard>
    )
}

const RunsChartCard = ({ctx}: {ctx: OverviewContext}) => {
    const [hovered, setHovered] = useHover()
    const {points, totals} = ctx.data.overview
    const values = points.map((p) => p.runs)
    const status = ctx.data.status.overview
    return (
        <AnalyticsCard
            title="Runs"
            value={formatCount(totals.runs)}
            caption={ctx.rangeLabel}
            onExplore={() => ctx.onExplore("runs", null)}
            loading={status.pending}
            error={status.error}
            onRetry={status.refetch}
            empty={totals.runs ? null : ctx.emptyText("runs")}
            chartHeight={150}
        >
            <TimeChart
                kind="bar"
                labels={ctx.labels}
                series={[{key: "runs", label: "Runs", color: analyticsColor("runs"), values}]}
                formatTick={(v) => formatMetric("runs", v, true)}
                height={150}
                hovered={hovered}
                onHover={setHovered}
                onSelect={(i) => ctx.onExplore("runs", i)}
                tooltip={(i) => (
                    <ChartTooltipPanel
                        title={ctx.fullLabels[i]}
                        value={`${formatCount(values[i])} runs`}
                        rows={topRows(
                            ctx.data.agentRuns,
                            i,
                            values[i],
                            ctx.agentName,
                            formatCount,
                            analyticsColor("runs"),
                        )}
                        facts={[
                            {
                                label: "Failed runs",
                                value: `${formatCount(points[i].failed)} of ${formatCount(values[i])}`,
                            },
                        ]}
                    />
                )}
            />
        </AnalyticsCard>
    )
}

export const SuccessCard = ({ctx}: {ctx: OverviewContext}) => {
    const [hovered, setHovered] = useHover()
    const {points, totals} = ctx.data.overview
    const values = points.map((p) => successRate(p.runs, p.failed))
    const overall = successRate(totals.runs, totals.failed)
    const failedBars = useMemo(
        () => ({
            key: "failed",
            color: analyticsColor("failedRuns"),
            values: points.map((p) => p.failed),
        }),
        [points],
    )
    // Under a group-by: one rate line per top group, by runs.
    const grouped = ctx.grouped
    const groupLines = useMemo(
        () =>
            grouped
                ? rankKeys(grouped.runs.series)
                      .slice(0, 4)
                      .map((key) => ({
                          key,
                          label: grouped.keyLabel(key),
                          color: grouped.keyColor(key),
                          runs: grouped.runs.series[key],
                          values: grouped.runs.series[key].map((n, b) =>
                              successRate(n, grouped.failed[key]?.[b] ?? 0),
                          ),
                      }))
                : null,
        [grouped],
    )
    const present = (groupLines ? groupLines.flatMap((l) => l.values) : values).filter(
        (v): v is number => v !== null,
    )
    const floor = present.length ? Math.max(0, Math.floor((Math.min(...present) - 5) / 10) * 10) : 0
    const status = ctx.data.status.overview
    const caption = `succeeded · ${formatCount(totals.failed)} failed (${formatMetric(
        "failrate",
        totals.runs ? (totals.failed / totals.runs) * 100 : 0,
    )})`
    return (
        <AnalyticsCard
            title="Success rate"
            value={formatMetric("success", overall)}
            caption={caption}
            onExplore={() => ctx.onExplore("success", null)}
            loading={status.pending}
            error={status.error}
            onRetry={status.refetch}
            empty={totals.runs ? null : ctx.emptyText("runs")}
            chartHeight={150}
            legend={
                <ChartLegendRow
                    items={
                        groupLines
                            ? groupLines.map(({key, label, color}) => ({key, label, color}))
                            : [
                                  {
                                      key: "success",
                                      label: "Success rate",
                                      color: analyticsColor("success"),
                                  },
                                  {
                                      key: "failed",
                                      label: `Failed runs (${formatCount(totals.failed)})`,
                                      color: analyticsColor("failedRuns"),
                                  },
                              ]
                    }
                />
            }
        >
            <TimeChart
                kind="line"
                labels={ctx.labels}
                series={
                    groupLines ?? [
                        {
                            key: "success",
                            label: "Success rate",
                            color: analyticsColor("success"),
                            values,
                        },
                    ]
                }
                formatTick={(v) => formatMetric("success", v, true)}
                yMin={floor}
                yMax={100}
                underlay={groupLines ? null : failedBars}
                height={150}
                hovered={hovered}
                onHover={setHovered}
                onSelect={(i) => ctx.onExplore("success", i)}
                tooltip={(i) => (
                    <ChartTooltipPanel
                        title={ctx.fullLabels[i]}
                        runs={`${formatCount(points[i].runs)} runs`}
                        value={`${formatMetric("success", values[i])} success${
                            points[i].failed ? ` · ${formatCount(points[i].failed)} failed` : ""
                        }`}
                        rowsTitle={groupLines ? undefined : "Why they failed"}
                        rows={
                            groupLines
                                ?.filter((l) => l.runs[i])
                                .map((l) => ({
                                    color: l.color,
                                    label: l.label,
                                    value: formatMetric("success", l.values[i]),
                                })) ??
                            ctx.failures
                                .reasonsAt(i)
                                .slice(0, 3)
                                .map((r) => ({
                                    color: analyticsColor("failed"),
                                    label: r.label,
                                    value: formatCount(r.count),
                                }))
                        }
                        facts={
                            ctx.failures.busiestAgent(i)
                                ? [
                                      {
                                          label: "Most failures",
                                          value: ctx.agentName(ctx.failures.busiestAgent(i)!),
                                      },
                                  ]
                                : []
                        }
                    />
                )}
            />
        </AnalyticsCard>
    )
}

const TOKEN_TYPES = [
    {key: "input", label: "Input"},
    {key: "output", label: "Output"},
    {key: "cacheRead", label: "Cache read"},
    {key: "cacheWrite", label: "Cache write"},
] as const

const TokensChartCard = ({ctx}: {ctx: OverviewContext}) => {
    const [hovered, setHovered] = useHover()
    const [hidden, setHidden] = useState<Record<string, boolean>>({})
    const {points, totals} = ctx.data.overview
    const status = ctx.data.status.overview
    const series = TOKEN_TYPES.map((type, i) => ({
        key: type.key,
        label: type.label,
        color: analyticsColor(SERIES_COLORS[i]),
        values: points.map((p) => p[type.key]),
        hidden: hidden[type.key],
    }))
    const shown = (i: number) => sum(series.filter((s) => !s.hidden).map((s) => s.values[i] ?? 0))
    const legend: LegendItem[] = series.map((s) => ({
        key: s.key,
        label: s.label,
        color: s.color,
        hidden: s.hidden,
    }))
    const toggle = (key: string) => {
        const next = {...hidden, [key]: !hidden[key]}
        if (TOKEN_TYPES.every((t) => next[t.key])) return
        setHidden(next)
    }
    // The configured model with the most runs in the bucket; filters narrow it like every card.
    const topModel = (i: number) => {
        const top = ctx.data.modelOrder
            .map((key) => ({key, value: ctx.data.modelRuns[key][i] ?? 0}))
            .sort((a, b) => b.value - a.value)[0]
        return top?.value ? top.key : "—"
    }
    return (
        <AnalyticsCard
            title="Tokens by type"
            value={formatMetric("tokens", totals.tokens)}
            caption={ctx.rangeLabel}
            onExplore={() => ctx.onExplore("tokens", null)}
            loading={status.pending}
            error={status.error}
            onRetry={status.refetch}
            empty={totals.tokens ? null : ctx.emptyText("tokens")}
            chartHeight={150}
            legend={<ChartLegendRow items={legend} onToggle={toggle} />}
        >
            <TimeChart
                kind="bar"
                labels={ctx.labels}
                series={series}
                formatTick={(v) => formatMetric("tokens", v, true)}
                height={150}
                hovered={hovered}
                onHover={setHovered}
                onSelect={(i) => ctx.onExplore("tokens", i)}
                tooltip={(i) => (
                    <ChartTooltipPanel
                        title={ctx.fullLabels[i]}
                        runs={`${formatCount(points[i].runs)} runs`}
                        value={`${formatMetric("tokens", shown(i))} tokens`}
                        rows={series
                            .filter((s) => !s.hidden && (s.values[i] ?? 0) > 0)
                            .map((s) => ({
                                color: s.color,
                                label: s.label,
                                value: formatMetric("tokens", s.values[i]),
                                share: sharePercent(s.values[i] ?? 0, shown(i)),
                            }))}
                        facts={[{label: "Most used model", value: topModel(i)}]}
                    />
                )}
            />
        </AnalyticsCard>
    )
}
