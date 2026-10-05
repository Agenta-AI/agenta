import {useMemo, useState} from "react"

import {
    formatCount,
    formatMetric,
    rankKeys,
    sharePercent,
    sum,
    topSeries,
    type KeyedSeries,
    type AnalyticsDimension,
    type AnalyticsMetric,
} from "@agenta/observability/analytics"

import {ChartTooltipPanel} from "../charts/ChartTooltipPanel"
import {TimeChart, type TimeSeries} from "../charts/TimeChart"
import {SERIES_COLORS, analyticsColor} from "../colors"
import type {QueryStatus} from "../useAnalyticsData"

import {ChartLegendRow, Pills, AnalyticsCard} from "./AnalyticsCard"

export type BreakdownMetric = "runs" | "cost" | "tokens"

export interface BreakdownSource {
    /** Per-key values for the picked metric. */
    series: KeyedSeries
    /** How many keys exist in the window, when `series` holds only some of them. */
    keyCount?: number
    /** Per-bucket total, so "Other" also covers keys outside `series`. */
    total?: number[]
    status: QueryStatus
}

export interface BreakdownCardProps {
    dim: AnalyticsDimension
    metric: BreakdownMetric
    metrics?: BreakdownMetric[]
    onMetricChange?: (metric: BreakdownMetric) => void
    source: BreakdownSource
    labels: string[]
    fullLabels: string[]
    rangeLabel: string
    keyLabel: (key: string) => string
    /** Runs for agents and configured models; tool rows count calls. */
    countWord: "runs" | "calls"
    note?: string
    empty: {text: string; onClear?: () => void} | null
    onExplore: (metric: AnalyticsMetric, bucket: number | null) => void
}

const DIM_LABEL: Record<AnalyticsDimension, string> = {agent: "agent", model: "model", tool: "tool"}
const TOP = 4

const metricLabel = (metric: BreakdownMetric, countWord: "runs" | "calls") =>
    metric === "runs"
        ? countWord === "runs"
            ? "Runs"
            : "Calls"
        : metric === "cost"
          ? "Cost"
          : "Tokens"

const formatValue = (metric: BreakdownMetric, value: number) =>
    metric === "runs" ? formatCount(value) : formatMetric(metric, value)

export const BreakdownCard = ({
    dim,
    metric,
    metrics,
    onMetricChange,
    source,
    labels,
    fullLabels,
    rangeLabel,
    keyLabel,
    countWord,
    note,
    empty,
    onExplore,
}: BreakdownCardProps) => {
    const [hovered, setHovered] = useState<number | null>(null)
    const [hidden, setHidden] = useState<Record<string, boolean>>({})

    const order = useMemo(() => rankKeys(source.series), [source.series])
    const top = useMemo(
        () => topSeries(source.series, order, TOP, source.total),
        [source.series, order, source.total],
    )
    const restCount = Math.max(0, (source.keyCount ?? order.length) - Math.min(TOP, order.length))
    const series: TimeSeries[] = top.map((s, i) => ({
        key: s.key,
        label: s.other ? (restCount ? `Other (${restCount})` : "Unattributed") : keyLabel(s.key),
        color: s.other
            ? analyticsColor("other")
            : analyticsColor(SERIES_COLORS[i % SERIES_COLORS.length]),
        values: s.values,
        hidden: hidden[s.key],
    }))
    const grand = sum(top.map((s) => sum(s.values)))
    const leader = order[0]
    const leaderValue = leader ? sum(source.series[leader]) : 0
    const word = metric === "runs" ? ` ${countWord}` : metric === "tokens" ? " tokens" : ""
    const allWord = {
        runs: `all ${countWord === "runs" ? "runs" : `${DIM_LABEL[dim]} calls`}`,
        cost: "all spend",
        tokens: "all tokens",
    }[metric]

    const bucketTotal = (i: number) =>
        sum(series.filter((s) => !s.hidden).map((s) => s.values[i] ?? 0))
    const toggle = (key: string) => {
        const next = {...hidden, [key]: !hidden[key]}
        if (series.every((s) => next[s.key])) return
        setHidden(next)
    }
    const exploreMetric: AnalyticsMetric =
        metric === "runs" ? (dim === "tool" ? "tools" : "runs") : metric

    return (
        <AnalyticsCard
            title={`${metricLabel(metric, countWord)} by ${DIM_LABEL[dim]}`}
            controls={
                metrics && onMetricChange ? (
                    <Pills
                        options={metrics.map((m) => ({value: m, label: metricLabel(m, countWord)}))}
                        value={metric}
                        onChange={(m) => {
                            setHidden({})
                            onMetricChange(m)
                        }}
                    />
                ) : null
            }
            value={leader ? keyLabel(leader) : "—"}
            caption={
                leader
                    ? `${formatValue(metric, leaderValue)}${word} · ${sharePercent(leaderValue, grand) || "0%"} of ${allWord}`
                    : rangeLabel
            }
            onExplore={() => onExplore(exploreMetric, null)}
            loading={source.status.pending}
            error={source.status.error}
            onRetry={source.status.refetch}
            empty={grand ? null : empty}
            chartHeight={170}
            note={note}
            legend={
                <ChartLegendRow
                    items={series.map((s) => ({
                        key: s.key,
                        label: s.label,
                        color: s.color,
                        hidden: s.hidden,
                    }))}
                    onToggle={toggle}
                />
            }
        >
            <TimeChart
                kind="bar"
                labels={labels}
                series={series}
                formatTick={(v) =>
                    metric === "runs"
                        ? formatMetric("runs", v, true)
                        : formatMetric(metric, v, true)
                }
                height={170}
                hovered={hovered}
                onHover={setHovered}
                onSelect={(i) => onExplore(exploreMetric, i)}
                tooltip={(i) => (
                    <ChartTooltipPanel
                        title={fullLabels[i]}
                        value={`${formatValue(metric, bucketTotal(i))}${word}`}
                        rowsTitle="Split"
                        rows={series
                            .filter((s) => !s.hidden && (s.values[i] ?? 0) > 0)
                            .sort((a, b) => (b.values[i] ?? 0) - (a.values[i] ?? 0))
                            .map((s) => ({
                                color: s.color,
                                label: s.label,
                                value: formatValue(metric, s.values[i] ?? 0),
                                share: sharePercent(s.values[i] ?? 0, bucketTotal(i)),
                            }))}
                    />
                )}
            />
        </AnalyticsCard>
    )
}
