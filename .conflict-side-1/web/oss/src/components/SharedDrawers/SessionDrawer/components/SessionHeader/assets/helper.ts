export const getTraceIdFromNode = (node: any): string | null => {
    if (!node) return null
    return (
        node.trace_id ||
        node.invocationIds?.trace_id ||
        node.node?.trace_id ||
        node.root?.id ||
        null
    )
}

export const getSpanIdFromNode = (node: any): string | null => {
    if (!node) return null
    return node.span_id || node.invocationIds?.span_id || node.node?.span_id || null
}

export const getNodeTimestamp = (node: any): string | number | null => {
    if (!node) return null
    return (
        node.start_time ||
        node.startTime ||
        node.timestamp ||
        node.created_at ||
        node.createdAt ||
        node.node?.start_time ||
        node.node?.timestamp ||
        node.node?.created_at ||
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
