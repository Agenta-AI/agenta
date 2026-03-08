const asTraceId = (value: unknown): string | null => {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
}

const asSpanId = (value: unknown): string | null => {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    return value as Record<string, unknown>
}

const uuidLikeToTraceId = (value: unknown): string | null => {
    const traceId = asTraceId(value)
    if (!traceId) return null
    return traceId.includes("-") ? traceId.replace(/-/g, "") : traceId
}

const uuidLikeToSpanId = (value: unknown): string | null => {
    const spanId = asSpanId(value)
    if (!spanId) return null
    if (!spanId.includes("-")) return spanId.length === 32 ? spanId.slice(-16) : spanId
    const compact = spanId.replace(/-/g, "")
    return compact.length >= 16 ? compact.slice(-16) : compact
}

export const extractTraceIdFromPayload = (payload: unknown): string | null => {
    if (!payload) return null

    if (Array.isArray(payload)) {
        for (let i = payload.length - 1; i >= 0; i -= 1) {
            const found = extractTraceIdFromPayload(payload[i])
            if (found) return found
        }
        return null
    }

    if (typeof payload !== "object") return null

    const obj = payload as Record<string, unknown>
    const status = obj.status as Record<string, unknown> | undefined
    const detail = obj.detail as Record<string, unknown> | undefined
    const tree = asRecord(obj.tree)
    const firstTreeNode = Array.isArray(tree?.nodes)
        ? asRecord(tree.nodes[0])
        : tree?.nodes && typeof tree.nodes === "object"
          ? asRecord(Object.values(tree.nodes as Record<string, unknown>)[0])
          : null
    const root = asRecord(firstTreeNode?.root)
    const directCandidates = [
        obj.traceId,
        obj.trace_id,
        obj.tree_id,
        (obj.trace as Record<string, unknown> | undefined)?.id,
        status?.traceId,
        status?.trace_id,
        (status?.trace as Record<string, unknown> | undefined)?.id,
        detail?.traceId,
        detail?.trace_id,
        (detail?.trace as Record<string, unknown> | undefined)?.id,
        (obj.response as Record<string, unknown> | undefined)?.traceId,
        (obj.response as Record<string, unknown> | undefined)?.trace_id,
        (obj.metadata as Record<string, unknown> | undefined)?.traceId,
        (obj.metadata as Record<string, unknown> | undefined)?.trace_id,
        root?.id,
    ]

    for (const candidate of directCandidates) {
        const normalized = uuidLikeToTraceId(candidate)
        if (normalized) return normalized
    }

    const nestedCandidates = [obj.output, obj.result, obj.response]
    for (const nested of nestedCandidates) {
        const found = extractTraceIdFromPayload(nested)
        if (found) return found
    }

    return null
}

export const extractSpanIdFromPayload = (payload: unknown): string | null => {
    if (!payload) return null

    if (Array.isArray(payload)) {
        for (let i = payload.length - 1; i >= 0; i -= 1) {
            const found = extractSpanIdFromPayload(payload[i])
            if (found) return found
        }
        return null
    }

    if (typeof payload !== "object") return null

    const obj = payload as Record<string, unknown>
    const status = obj.status as Record<string, unknown> | undefined
    const detail = obj.detail as Record<string, unknown> | undefined
    const tree = asRecord(obj.tree)
    const trace = asRecord(obj.trace)
    const traceSpans = Array.isArray(trace?.spans) ? trace.spans : []
    const rootTraceSpan =
        (traceSpans.find((span) => {
            const record = asRecord(span)
            return record && !record.parent_span_id
        }) as Record<string, unknown> | undefined) ??
        asRecord(traceSpans[0]) ??
        undefined
    const firstNode = Array.isArray(tree?.nodes)
        ? asRecord(tree.nodes[0])
        : tree?.nodes && typeof tree.nodes === "object"
          ? asRecord(Object.values(tree.nodes as Record<string, unknown>)[0])
          : null
    const node = asRecord(firstNode?.node)

    const directCandidates = [
        obj.spanId,
        obj.span_id,
        trace?.spanId,
        trace?.span_id,
        status?.spanId,
        status?.span_id,
        detail?.spanId,
        detail?.span_id,
        (obj.response as Record<string, unknown> | undefined)?.spanId,
        (obj.response as Record<string, unknown> | undefined)?.span_id,
        firstNode?.spanId,
        firstNode?.span_id,
        rootTraceSpan?.id,
        node?.id,
    ]

    for (const candidate of directCandidates) {
        const normalized = uuidLikeToSpanId(candidate)
        if (normalized) return normalized
    }

    const nestedCandidates = [obj.output, obj.result, obj.response]
    for (const nested of nestedCandidates) {
        const found = extractSpanIdFromPayload(nested)
        if (found) return found
    }

    return null
}
