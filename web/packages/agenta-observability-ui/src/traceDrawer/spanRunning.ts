import type {TraceSpanNode} from "@agenta/observability"

/** A span that has started and has no end time yet is still running. */
export const isSpanRunning = (span: TraceSpanNode | null | undefined): boolean =>
    Boolean(span?.start_time) && (span?.end_time === null || span?.end_time === undefined)
