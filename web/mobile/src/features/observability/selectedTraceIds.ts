import type {Key} from "react"

import {getNodeById} from "@agenta/entities/trace"

interface SpanRow {
    trace_id?: string
    span_id?: string
    children?: unknown
}

/**
 * The trace ids of the selected table rows. The traces table keys its rows by span id, so a
 * selection is a list of spans; delete and the queue act on whole traces. Each trace is listed
 * once, even when several of its spans are selected.
 */
export const selectedTraceIds = (traces: SpanRow[], keys: Key[]): string[] => {
    const ids = keys
        .map((key) => getNodeById(traces, String(key))?.trace_id)
        .filter((id): id is string => Boolean(id))
    return [...new Set(ids)]
}
