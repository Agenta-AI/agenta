import type {Key} from "react"

import {getNodeById} from "@agenta/entities/trace"

interface SpanRow {
    trace_id?: string
    span_id?: string
    children?: unknown
}

/**
 * The trace ids of the selected table rows, each once. The traces table keys its rows by span
 * id, but delete and the queue act on whole traces.
 */
export const selectedTraceIds = (traces: SpanRow[], keys: Key[]): string[] => {
    const ids = keys
        .map((key) => getNodeById(traces, String(key))?.trace_id)
        .filter((id): id is string => Boolean(id))
    return [...new Set(ids)]
}
