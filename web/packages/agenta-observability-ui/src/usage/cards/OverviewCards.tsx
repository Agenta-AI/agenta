import {useState} from "react"

import {
    formatCount,
    formatMetric,
    formatMoney,
    sharePercent,
    successRate,
    sum,
    type KeyedSeries,
    type UsageMetric,
} from "@agenta/observability/usage"

import {ChartTooltipPanel, type TooltipRow} from "../charts/ChartTooltipPanel"
import {TimeChart} from "../charts/TimeChart"
import {SERIES_COLORS, usageColor} from "../colors"
import type {UsageWindowData} from "../useUsageData"

import {ChartLegendRow, UsageCard, type LegendItem} from "./UsageCard"

export interface OverviewContext {
    data: UsageWindowData
    labels: string[]
    fullLabels: string[]
    unit: string
    rangeLabel: string
    agentName: (id: string) => string
    agentCost: KeyedSeries
    /** Model and tool calls cannot be narrowed, so call-level facts hide under a filter. */
    filtered: boolean
    emptyText: (what: string) => {text: string; onClear?: () => void}
    onExplore: (metric: UsageMetric, bucket: number | null) => void
}

/** The two keys with the most of `series` in one bucket, as tooltip rows. */
const topRows = (
    series: KeyedSeries,
    index: number,
    total: number,
    name: (key: string) => string,
    format: (value: number) => string,
    color: string,
): TooltipRow[] =>
    Object.keys(series)
        .map((key) => ({key, value: series[key][index] ?? 0}))
        .filter((row) => row.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 2)
        .map((row, i) => ({
            color,
            label: name(row.key),
            value: format(row.value),
            share: sharePercent(row.value, total),
            ...(i ? {color: `color-mix(in srgb, ${color} 55%, transparent)`} : {}),
        }))

const useHover = () => useState<number | null>(null)

export const CostCard = ({ctx}: {ctx: OverviewContext}) => {
    const [hovered, setHovered] = useHover()
    const {points, totals} = ctx.data.overview
    const values = points.map((p) => p.cost)
    const avg = values.length ? totals.cost / values.length : 0
    const status = ctx.data.status.overview
    return (
        <UsageCard
            title="Cost"
            value={formatMoney(hovered === null ? totals.cost : values[hovered])}
            caption={hovered === null ? ctx.rangeLabel : ctx.fullLabels[hovered]}
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
                series={[{key: "cost", label: "Cost", color: usageColor("cost"), values}]}
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
                        rows={topRows(
                            ctx.agentCost,
                            i,
                            values[i],
                            ctx.agentName,
                            formatMoney,
                            usageColor("cost"),
                        )}
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
        </UsageCard>
    )
}

export const RunsCard = ({ctx}: {ctx: OverviewContext}) => {
    const [hovered, setHovered] = useHover()
    const {points, totals} = ctx.data.overview
    const values = points.map((p) => p.runs)
    const status = ctx.data.status.overview
    return (
        <UsageCard
            title="Runs"
            value={formatCount(hovered === null ? totals.runs : values[hovered])}
            caption={hovered === null ? ctx.rangeLabel : ctx.fullLabels[hovered]}
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
                series={[{key: "runs", label: "Runs", color: usageColor("runs"), values}]}
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
                            usageColor("runs"),
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
        </UsageCard>
    )
}

export const SuccessCard = ({ctx}: {ctx: OverviewContext}) => {
    const [hovered, setHovered] = useHover()
    const {points, totals} = ctx.data.overview
    const values = points.map((p) => successRate(p.runs, p.failed))
    const overall = successRate(totals.runs, totals.failed)
    const present = values.filter((v): v is number => v !== null)
    const floor = present.length ? Math.max(0, Math.floor((Math.min(...present) - 5) / 10) * 10) : 0
    const status = ctx.data.status.overview
    const caption =
        hovered !== null
            ? ctx.fullLabels[hovered]
            : `succeeded · ${formatCount(totals.failed)} failed (${formatMetric(
                  "failrate",
                  totals.runs ? (totals.failed / totals.runs) * 100 : 0,
              )})`
    return (
        <UsageCard
            title="Success rate"
            value={formatMetric("success", hovered === null ? overall : values[hovered])}
            caption={caption}
            onExplore={() => ctx.onExplore("success", null)}
            loading={status.pending}
            error={status.error}
            onRetry={status.refetch}
            empty={totals.runs ? null : ctx.emptyText("runs")}
            chartHeight={150}
        >
            <TimeChart
                kind="line"
                labels={ctx.labels}
                series={[
                    {
                        key: "success",
                        label: "Success rate",
                        color: usageColor("success"),
                        values,
                    },
                ]}
                formatTick={(v) => formatMetric("success", v, true)}
                yMin={floor}
                yMax={100}
                height={150}
                hovered={hovered}
                onHover={setHovered}
                onSelect={(i) => ctx.onExplore("success", i)}
                tooltip={(i) => (
                    <ChartTooltipPanel
                        title={ctx.fullLabels[i]}
                        runs={`${formatCount(points[i].runs)} runs`}
                        value={`${formatMetric("success", values[i])} success`}
                        facts={[
                            {
                                label: "Failed runs",
                                value: `${formatCount(points[i].failed)} of ${formatCount(points[i].runs)}`,
                            },
                        ]}
                    />
                )}
            />
        </UsageCard>
    )
}

const TOKEN_TYPES = [
    {key: "input", label: "Input"},
    {key: "output", label: "Output"},
    {key: "cacheRead", label: "Cache read"},
    {key: "cacheWrite", label: "Cache write"},
] as const

export const TokensCard = ({ctx}: {ctx: OverviewContext}) => {
    const [hovered, setHovered] = useHover()
    const [hidden, setHidden] = useState<Record<string, boolean>>({})
    const {points, totals} = ctx.data.overview
    const status = ctx.data.status.overview
    const series = TOKEN_TYPES.map((type, i) => ({
        key: type.key,
        label: type.label,
        color: usageColor(SERIES_COLORS[i]),
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
    const topCallModel = (i: number) =>
        ctx.data.callModelOrder
            .map((key) => ({key, value: ctx.data.callModels[key][i]}))
            .sort((a, b) => b.value - a.value)[0]?.key ?? "—"
    return (
        <UsageCard
            title="Tokens by type"
            value={formatMetric("tokens", hovered === null ? totals.tokens : shown(hovered))}
            caption={hovered === null ? ctx.rangeLabel : ctx.fullLabels[hovered]}
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
                        rowsTitle="Split"
                        rows={series
                            .filter((s) => !s.hidden && (s.values[i] ?? 0) > 0)
                            .map((s) => ({
                                color: s.color,
                                label: s.label,
                                value: formatMetric("tokens", s.values[i]),
                                share: sharePercent(s.values[i] ?? 0, shown(i)),
                            }))}
                        facts={ctx.filtered ? [] : [{label: "Top model", value: topCallModel(i)}]}
                    />
                )}
            />
        </UsageCard>
    )
}
