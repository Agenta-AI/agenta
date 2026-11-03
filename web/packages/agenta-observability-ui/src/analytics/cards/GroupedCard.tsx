import {useMemo, useState, type ReactNode} from "react"

import {
    formatCount,
    formatMetric,
    rankKeys,
    sharePercent,
    sum,
    topSeries,
    OTHER_KEY,
    type KeyedSeries,
} from "@agenta/observability/analytics"

import {ChartTooltipPanel} from "../charts/ChartTooltipPanel"
import {TimeChart, type TimeSeries} from "../charts/TimeChart"
import {analyticsColor} from "../colors"
import type {QueryStatus} from "../useAnalyticsData"

import {ChartLegendRow, AnalyticsCard} from "./AnalyticsCard"

export type GroupedMetric = "runs" | "cost" | "tokens"

export interface GroupedSource {
    /** Per-key values for the metric. */
    series: KeyedSeries
    /** How many keys exist in the window, when `series` holds only some of them. */
    keyCount?: number
    /** Per-bucket total, so "Other" also covers keys outside `series`. */
    total: number[]
    status: QueryStatus
}

export interface GroupedCardProps {
    title: string
    /** The headline: the range total, the same as the ungrouped card. */
    value: ReactNode
    caption: ReactNode
    metric: GroupedMetric
    source: GroupedSource
    keyLabel: (key: string) => string
    /** One color per key across every grouped card. */
    keyColor: (key: string) => string
    labels: string[]
    fullLabels: string[]
    height: number
    empty: {text: string; onClear?: () => void} | null
    onExplore: (bucket: number | null) => void
}

const TOP = 4
const OTHER_LISTED = 2

/** The top four keys of `series` and an "Other" remainder of `total`, labelled and colored. */
export const stackSeries = (
    series: KeyedSeries,
    total: number[],
    keyLabel: (key: string) => string,
    keyColor: (key: string) => string,
    keyCount?: number,
): TimeSeries[] => {
    const order = rankKeys(series)
    const restCount = Math.max(0, (keyCount ?? order.length) - Math.min(TOP, order.length))
    return topSeries(series, order, TOP, total).map((s) => ({
        key: s.key,
        label: s.other ? (restCount ? `Other (${restCount})` : "Unattributed") : keyLabel(s.key),
        color: s.other ? analyticsColor("other") : keyColor(s.key),
        values: s.values,
    }))
}

const formatValue = (metric: GroupedMetric, value: number) =>
    metric === "runs" ? formatCount(value) : formatMetric(metric, value)

const unitWord = (metric: GroupedMetric) =>
    metric === "runs" ? " runs" : metric === "tokens" ? " tokens" : ""

/** A main card split by the page's group: the top four keys stacked, then "Other". */
export const GroupedCard = ({
    title,
    value,
    caption,
    metric,
    source,
    keyLabel,
    keyColor,
    labels,
    fullLabels,
    height,
    empty,
    onExplore,
}: GroupedCardProps) => {
    const [hovered, setHovered] = useState<number | null>(null)
    const [hidden, setHidden] = useState<Record<string, boolean>>({})

    const stack = useMemo(
        () => stackSeries(source.series, source.total, keyLabel, keyColor, source.keyCount),
        [source, keyLabel, keyColor],
    )
    const series: TimeSeries[] = stack.map((s) => ({...s, hidden: hidden[s.key]}))

    // One line naming the biggest members of "Other" in one bucket, so the tooltip stays short.
    const otherNote = (i: number) => {
        const shown = new Set(stack.map((s) => s.key))
        const members = Object.keys(source.series)
            .filter((key) => !shown.has(key) && (source.series[key][i] ?? 0) > 0)
            .sort((a, b) => source.series[b][i] - source.series[a][i])
        const listed = members
            .slice(0, OTHER_LISTED)
            .map((key) => `${keyLabel(key)} ${formatValue(metric, source.series[key][i])}`)
        const rest = members.length - listed.length
        return [...listed, ...(rest > 0 ? [`+${rest} more`] : [])].join(" · ")
    }

    const bucketTotal = (i: number) =>
        sum(series.filter((s) => !s.hidden).map((s) => s.values[i] ?? 0))
    // "Other" opens the breakdown that names its members rather than hiding them.
    const toggle = (key: string) => {
        if (key === OTHER_KEY) return onExplore(null)
        const next = {...hidden, [key]: !hidden[key]}
        if (series.every((s) => next[s.key])) return
        setHidden(next)
    }

    return (
        <AnalyticsCard
            title={title}
            value={value}
            caption={caption}
            onExplore={() => onExplore(null)}
            loading={source.status.pending}
            error={source.status.error}
            onRetry={source.status.refetch}
            empty={sum(source.total) ? null : empty}
            chartHeight={height}
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
                formatTick={(v) => formatMetric(metric, v, true)}
                height={height}
                hovered={hovered}
                onHover={setHovered}
                onSelect={(i) => onExplore(i)}
                tooltip={(i) => (
                    <ChartTooltipPanel
                        title={fullLabels[i]}
                        value={`${formatValue(metric, bucketTotal(i))}${unitWord(metric)}`}
                        rows={series
                            .filter((s) => !s.hidden && (s.values[i] ?? 0) > 0)
                            .sort((a, b) => (b.values[i] ?? 0) - (a.values[i] ?? 0))
                            .map((s) => ({
                                color: s.color,
                                label: s.label,
                                value: formatValue(metric, s.values[i] ?? 0),
                                share: sharePercent(s.values[i] ?? 0, bucketTotal(i)),
                                note: s.key === OTHER_KEY ? otherNote(i) : undefined,
                            }))}
                    />
                )}
            />
        </AnalyticsCard>
    )
}
