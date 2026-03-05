const asTraceId = (value: unknown): string | null => {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
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
    const directCandidates = [
        obj.traceId,
        obj.trace_id,
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
    ]

    for (const candidate of directCandidates) {
        const normalized = asTraceId(candidate)
        if (normalized) return normalized
    }

    const nestedCandidates = [obj.output, obj.result, obj.response]
    for (const nested of nestedCandidates) {
        const found = extractTraceIdFromPayload(nested)
        if (found) return found
    }

    return null
}
