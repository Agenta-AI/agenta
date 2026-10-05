import type {MetricsBucket, TraceSpan} from "@agenta/entities/trace"

import {PATH} from "./queries"
import {ANALYTICS_RANGE} from "./ranges"
import type {
    AnalyticsCustomRange,
    KeyedSeries,
    AnalyticsOverview,
    AnalyticsPoint,
    AnalyticsRangeKey,
    AnalyticsRun,
    AnalyticsRunTools,
    AnalyticsSeries,
    AnalyticsTotals,
    AnalyticsWindow,
} from "./types"

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const WEEK = 7 * DAY

/** Ranges longer than a month read by the week; a bar per day would be a hairline. */
const WEEKLY_AFTER_DAYS = 31

/** Daily, or weeks ending at `newest`; the oldest week is short when the days do not divide by 7. */
const dayWindow = (oldest: number, newest: number): AnalyticsWindow => {
    if (newest - oldest <= WEEKLY_AFTER_DAYS * DAY) return {oldest, newest, interval: 24 * 60}
    // Whole days back from `newest`, so the API's day buckets line up with the weeks across DST.
    return {
        oldest: newest - Math.round((newest - oldest) / DAY) * DAY,
        newest,
        interval: 7 * 24 * 60,
    }
}

/** Hourly buckets ending at the next full hour for 24h; local-midnight days or weeks otherwise. */
export const rangeWindow = (range: AnalyticsRangeKey, now: number): AnalyticsWindow => {
    if (range === "24h") {
        const end = Math.ceil(now / HOUR) * HOUR
        return {oldest: end - DAY, newest: end, interval: 60}
    }
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    const end = today.getTime() + DAY
    return dayWindow(end - ANALYTICS_RANGE[range].days * DAY, end)
}

/** A custom span by hour when it covers two days or less, else by day or week. */
export const customWindow = (range: AnalyticsCustomRange): AnalyticsWindow =>
    range.newest - range.oldest <= 2 * DAY
        ? {...range, interval: 60}
        : dayWindow(range.oldest, range.newest)

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "Sep 3 – Sep 18", with years when the span crosses one or is not this year. */
export const customRangeLabel = (range: AnalyticsCustomRange, now: number): string => {
    const first = new Date(range.oldest)
    // `newest` is the midnight after the last day; the midpoint of that day is safe across DST.
    const last = new Date(range.newest - DAY / 2)
    const withYear =
        first.getFullYear() !== last.getFullYear() ||
        last.getFullYear() !== new Date(now).getFullYear()
    const day = (d: Date) =>
        `${MONTHS[d.getMonth()]} ${d.getDate()}${withYear ? `, ${d.getFullYear()}` : ""}`
    return first.toDateString() === last.toDateString()
        ? day(first)
        : `${day(first)} – ${day(last)}`
}

const isWeekly = (window: AnalyticsWindow) => window.interval > 24 * 60

export const bucketStarts = (window: AnalyticsWindow): number[] => {
    const width = window.interval * MINUTE
    const span = (window.newest - window.oldest) / width
    if (!isWeekly(window)) {
        const count = Math.max(1, Math.round(span))
        return Array.from({length: count}, (_, i) => window.oldest + i * width)
    }
    const count = Math.max(1, Math.ceil(span))
    return Array.from({length: count}, (_, i) =>
        Math.max(window.oldest, window.newest - (count - i) * width),
    )
}

/** The bucket a time falls in; out of range below 0 or at the bucket count and above. */
export const bucketOf = (window: AnalyticsWindow, time: number) => {
    const width = window.interval * MINUTE
    if (!isWeekly(window)) return Math.floor((time - window.oldest) / width)
    if (time < window.oldest) return -1
    return bucketStarts(window).length - Math.ceil((window.newest - time) / width)
}

const bucketIndex = (window: AnalyticsWindow, timestamp: string) =>
    bucketOf(window, Date.parse(timestamp))

/** Where the bucket that starts at `start` ends. */
export const bucketEnd = (window: AnalyticsWindow, start: number) =>
    bucketStarts(window).find((s) => s > start) ?? window.newest

/** The window one bucket covers, split finer: a week by day, a day by hour, an hour by five minutes. */
export const bucketWindow = (window: AnalyticsWindow, index: number): AnalyticsWindow => {
    const oldest = bucketStarts(window)[index]
    const interval = isWeekly(window) ? 24 * 60 : window.interval === 24 * 60 ? 60 : 5
    return {oldest, newest: bucketEnd(window, oldest), interval}
}

type Blob = Record<string, unknown> | null | undefined

const field = (blob: Blob, name: string) => {
    const value = blob?.[name]
    return typeof value === "number" && Number.isFinite(value) ? value : 0
}

/** One numeric field of one metric, per bucket of the window (zero where a bucket is missing). */
export const numberSeries = (
    window: AnalyticsWindow,
    buckets: MetricsBucket[],
    path: string,
    name: "sum" | "count" = "sum",
): number[] => {
    const out = bucketStarts(window).map(() => 0)
    for (const bucket of buckets) {
        const i = bucketIndex(window, bucket.timestamp)
        if (i >= 0 && i < out.length) out[i] += field(bucket.metrics?.[path], name)
    }
    return out
}

/** Value counts of categorical metrics per bucket; several paths merge (e.g. two ref keys). */
export const keyedSeries = (
    window: AnalyticsWindow,
    buckets: MetricsBucket[],
    paths: string[],
): KeyedSeries => {
    const size = bucketStarts(window).length
    const out: KeyedSeries = {}
    for (const bucket of buckets) {
        const i = bucketIndex(window, bucket.timestamp)
        if (i < 0 || i >= size) continue
        for (const path of paths) {
            const freq = bucket.metrics?.[path]?.freq
            if (!Array.isArray(freq)) continue
            for (const entry of freq as {value?: unknown; count?: unknown}[]) {
                if (typeof entry.value !== "string" || typeof entry.count !== "number") continue
                const row = (out[entry.value] ??= Array.from({length: size}, () => 0))
                row[i] += entry.count
            }
        }
    }
    return out
}

export const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

export const emptyTotals = (): AnalyticsTotals => ({
    cost: 0,
    runs: 0,
    failed: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    tokens: 0,
})

export const toOverview = (
    window: AnalyticsWindow,
    overview: MetricsBucket[],
    failed: MetricsBucket[],
): AnalyticsOverview => {
    const series = {
        cost: numberSeries(window, overview, PATH.cost),
        runs: numberSeries(window, overview, PATH.trace, "count"),
        failed: numberSeries(window, failed, PATH.trace, "count"),
        input: numberSeries(window, overview, PATH.input),
        output: numberSeries(window, overview, PATH.output),
        cacheRead: numberSeries(window, overview, PATH.cacheRead),
        cacheWrite: numberSeries(window, overview, PATH.cacheWrite),
        tokens: numberSeries(window, overview, PATH.tokens),
    }
    const keys = Object.keys(series) as (keyof AnalyticsTotals)[]
    const points: AnalyticsPoint[] = bucketStarts(window).map((start, i) => {
        const point = {start, ...emptyTotals()}
        for (const key of keys) point[key] = series[key][i]
        return point
    })
    const totals = emptyTotals()
    for (const key of keys) totals[key] = sum(series[key])
    return {points, totals}
}

/** Keys ranked by their total, highest first. */
export const rankKeys = (series: KeyedSeries): string[] =>
    Object.keys(series).sort((a, b) => sum(series[b]) - sum(series[a]) || a.localeCompare(b))

export const OTHER_KEY = "__other"

/** The top `limit` keys plus "other": the rest of `total` per bucket, else the remaining keys. */
export const topSeries = (
    series: KeyedSeries,
    order: string[],
    limit: number,
    total?: number[],
): AnalyticsSeries[] => {
    const top = order.slice(0, limit).filter((key) => series[key])
    const out: AnalyticsSeries[] = top.map((key) => ({key, values: series[key]}))
    const size = Object.values(series)[0]?.length ?? total?.length ?? 0
    const rest = Array.from({length: size}, (_, i) =>
        total
            ? Math.max(0, total[i] - sum(top.map((key) => series[key][i])))
            : sum(order.slice(limit).map((key) => series[key]?.[i] ?? 0)),
    )
    if (sum(rest) > 1e-9) out.push({key: OTHER_KEY, values: rest, other: true})
    return out
}

export const successRate = (runs: number, failed: number): number | null =>
    runs ? ((runs - failed) / runs) * 100 : null

type Attributes = Record<string, unknown> | null | undefined

const dig = (source: Attributes, path: string[]): unknown =>
    path.reduce<unknown>(
        (node, key) =>
            node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined,
        source,
    )

const asNumber = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : null

export const toAnalyticsRun = (span: TraceSpan): AnalyticsRun => {
    const attributes = span.attributes as Attributes
    const refs = dig(attributes, ["ag", "references"]) as Attributes
    const agentId =
        (dig(refs, ["application", "id"]) as string | undefined) ??
        (dig(refs, ["workflow", "id"]) as string | undefined) ??
        null
    const llm = ["ag", "data", "parameters", "agent", "llm"]
    return {
        traceId: span.trace_id,
        agentId,
        model: (dig(attributes, [...llm, "model"]) as string | undefined) ?? null,
        startedAt: Date.parse(String(span.start_time ?? span.created_at ?? "")),
        tokens: asNumber(dig(attributes, ["ag", "metrics", "tokens", "cumulative", "total"])) ?? 0,
        cost: asNumber(dig(attributes, ["ag", "metrics", "costs", "cumulative", "total"])),
        failed: span.status_code === "STATUS_CODE_ERROR",
        reason: span.status_message ?? null,
        subscription: dig(attributes, [...llm, "connection", "mode"]) === "self_managed",
    }
}

export const toolsByRun = (spans: TraceSpan[]): Record<string, AnalyticsRunTools> => {
    const out: Record<string, AnalyticsRunTools> = {}
    for (const span of spans) {
        const row = (out[span.trace_id] ??= {calls: 0, failed: []})
        row.calls += 1
        if (span.status_code === "STATUS_CODE_ERROR") {
            const name = dig(span.attributes as Attributes, ["ag", "meta", "tool", "name"])
            row.failed.push(typeof name === "string" ? name : (span.span_name ?? "tool"))
        }
    }
    return out
}
