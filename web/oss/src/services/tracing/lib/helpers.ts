import dayjs from "dayjs"

import {sortSpansByStartTime} from "@/oss/lib/traces/tracing"

import {SpansResponse, TraceSpanNode, TracesResponse, TracingDashboardData} from "../types"

export const isTracesResponse = (data: any): data is TracesResponse => {
    return typeof data === "object" && "traces" in data
}

export const isSpansResponse = (data: any): data is SpansResponse => {
    return typeof data === "object" && "spans" in data
}

export const transformTracesResponseToTree = (data: TracesResponse): TraceSpanNode[] => {
    const buildTree = (spans: Record<string, any> | any[]): TraceSpanNode[] => {
        if (!spans) {
            return []
        }

        const spanArray = Object.values(spans).flatMap((span: any) => {
            if (Array.isArray(span)) {
                return buildTree(span)
            }

            const node: TraceSpanNode = {
                ...span,
            }

            if (span?.spans && Object.keys(span.spans).length > 0) {
                node.children = buildTree(span.spans)
            }

            return node
        })

        // Sort spans at this hierarchy level by start_time
        return sortSpansByStartTime(spanArray)
    }

    return Object.values(data.traces).flatMap((trace: any) => buildTree(trace.spans))
}

export const transformTracingResponse = (data: TraceSpanNode[]): TraceSpanNode[] => {
    const enhance = (span: TraceSpanNode): TraceSpanNode => ({
        ...span,
        key: span.span_id,
        invocationIds: {
            trace_id: span.trace_id,
            span_id: span.span_id,
        },
        children: span.children?.map(enhance),
    })

    return data.map(enhance)
}

export const rangeToIntervalMinutes = (range: string): number => {
    switch (range) {
        case "1h":
            return 60
        case "24h":
            return 60
        case "7d":
            return 360
        case "30d":
            return 720
        default:
            return 720
    }
}

export const calculateIntervalFromDuration = (durationMinutes: number): number => {
    // Backend has a hard limit of ~1024 buckets.
    // We enforce a max of 1000 buckets to be safe and avoid the backend defaulting to 30-day buckets.
    const maxBuckets = 1000
    const calculatedInterval = Math.ceil(durationMinutes / maxBuckets)

    // Explicit mappings for standard frontend ranges to ensure nice granularity (~30-70 bars)
    // 30 mins -> 1 min interval (30 bars)
    if (durationMinutes <= 30) return Math.max(1, calculatedInterval)
    // 1 hour -> 1 min interval (60 bars)
    if (durationMinutes <= 60) return Math.max(1, calculatedInterval)
    // 6 hours -> 5 min interval (72 bars)
    if (durationMinutes <= 60 * 6) return Math.max(5, calculatedInterval)
    // 24 hours -> 30 min interval (48 bars)
    if (durationMinutes <= 60 * 24) return Math.max(30, calculatedInterval)
    // 3 days -> 1 hour interval (72 bars)
    if (durationMinutes <= 60 * 24 * 3) return Math.max(60, calculatedInterval)
    // 7 days -> 3 hour interval (56 bars)
    if (durationMinutes <= 60 * 24 * 7) return Math.max(180, calculatedInterval)
    // 14 days -> 6 hour interval (56 bars)
    if (durationMinutes <= 60 * 24 * 14) return Math.max(360, calculatedInterval)
    // 30 days -> 12 hour interval (60 bars)
    if (durationMinutes <= 60 * 24 * 30) return Math.max(720, calculatedInterval)

    // For longer durations
    // ensuring we never request too many buckets.
    return Math.max(720, calculatedInterval)
}

export const normalizeDurationSeconds = (d = 0) => d / 1_000

export const formatTick = (ts: number | string, range: string) =>
    dayjs(ts).format(range === "24_hours" ? "h:mm a" : range === "7_days" ? "ddd" : "D MMM")

export function tracingToGeneration(tracing: TracingDashboardData, range: string) {
    const buckets = tracing.buckets ?? []

    let successCount = 0
    let errorCount = 0
    let totalCost = 0
    let totalTokens = 0
    let totalSuccessDuration = 0

    const data = buckets.map((b) => {
        const succC = b.total?.count ?? 0
        const errC = b.errors?.count ?? 0

        const succCost = b.total?.costs ?? 0
        const errCost = b.errors?.costs ?? 0

        const succTok = b.total?.tokens ?? 0
        const errTok = b.errors?.tokens ?? 0

        const succDurS = normalizeDurationSeconds(b.total?.duration ?? 0)

        successCount += succC
        errorCount += errC
        totalCost += succCost + errCost
        totalTokens += succTok + errTok
        totalSuccessDuration += succDurS

        return {
            timestamp: formatTick(b.timestamp, range),
            success_count: succC,
            failure_count: errC,
            cost: succCost + errCost,
            latency: succC ? succDurS / Math.max(succC, 1) : 0, // avg latency per success in the bucket
            total_tokens: succTok + errTok,
        }
    })

    const totalCount = successCount + errorCount

    return {
        data,
        total_count: totalCount,
        failure_rate: totalCount ? errorCount / totalCount : 0,
        total_cost: totalCost,
        avg_cost: totalCount ? totalCost / totalCount : 0,
        avg_latency: successCount ? totalSuccessDuration / successCount : 0,
        total_tokens: totalTokens,
        avg_tokens: totalCount ? totalTokens / totalCount : 0,
    }
}
