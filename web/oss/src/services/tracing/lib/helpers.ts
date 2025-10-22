import dayjs from "dayjs"
import {sortSpansByStartTime} from "@/oss/lib/helpers/tracing"

import {
    TraceSpanNode,
    TracesResponse,
    SpansResponse,
    TracingDashboardData,
    GenerationDashboardData,
} from "../types"

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
