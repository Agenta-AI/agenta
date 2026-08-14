interface TraceIdCarrier {
    trace_id?: string
    span_id?: string
    start_time?: string | number
    startTime?: string | number
    timestamp?: string | number
    created_at?: string | number
    createdAt?: string | number
    invocationIds?: {trace_id?: string; span_id?: string}
    node?: {
        trace_id?: string
        span_id?: string
        start_time?: string | number
        timestamp?: string | number
        created_at?: string | number
    }
    root?: {id?: string}
}

export const getTraceIdFromNode = (node: unknown): string | null => {
    if (!node || typeof node !== "object") return null
    const carrier = node as TraceIdCarrier
    return (
        carrier.trace_id ||
        carrier.invocationIds?.trace_id ||
        carrier.node?.trace_id ||
        carrier.root?.id ||
        null
    )
}

export const getSpanIdFromNode = (node: unknown): string | null => {
    if (!node || typeof node !== "object") return null
    const carrier = node as TraceIdCarrier
    return carrier.span_id || carrier.invocationIds?.span_id || carrier.node?.span_id || null
}

export const getNodeTimestamp = (node: unknown): string | number | null => {
    if (!node || typeof node !== "object") return null
    const carrier = node as TraceIdCarrier
    return (
        carrier.start_time ||
        carrier.startTime ||
        carrier.timestamp ||
        carrier.created_at ||
        carrier.createdAt ||
        carrier.node?.start_time ||
        carrier.node?.timestamp ||
        carrier.node?.created_at ||
        null
    )
}

export const toISOString = (value: string | number | Date | null | undefined): string | null => {
    if (value === null || value === undefined) return null
    let date: Date
    if (value instanceof Date) {
        date = value
    } else if (typeof value === "number") {
        const ms = value < 1e12 ? value * 1000 : value
        date = new Date(ms)
    } else {
        date = new Date(value)
    }
    if (Number.isNaN(date.getTime())) return null
    return date.toISOString()
}
