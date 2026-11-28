import {TraceSpanNode} from "@agenta/observability"

/** How the span body draws the span: by the shape of each value, or as the stored JSON or YAML. */
export type SpanBodyMode = "formatted" | "raw"

export interface TraceTypeHeaderProps {
    activeTrace: TraceSpanNode | undefined
    error: unknown
    mode?: SpanBodyMode
    /** Without it the header has no Formatted / Raw switch. */
    onModeChange?: (mode: SpanBodyMode) => void
}
