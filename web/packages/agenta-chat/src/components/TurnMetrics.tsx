import {traceDataSummaryAtomFamily} from "@agenta/entities/loadable"
import {ExecutionMetricsDisplay, MetaSeparator} from "@agenta/ui/components/presentational"
import {SkeletonBlock} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import type {MessageUsageMetrics} from "../assets"

/**
 * A turn's cost, tokens and latency — the same data and component the playground and the trace
 * drawer use.
 *
 * The two halves come from different places, which is the whole reason this is not just
 * `<ExecutionMetricsDisplay metrics={usage}/>`: LATENCY comes from the trace, while tokens/cost
 * come from the streamed message usage, because the agent-run trace summary does not surface them
 * on the Pi/local path. A turn very often has a trace and NO usage, and rendering only the usage
 * branch then shows nothing at all — which is exactly what /m did.
 *
 * Usage wins where both exist, so the figures match what the model actually reported. Only the
 * latency slot waits on the trace; a fixed-size placeholder holds its spot so the row neither
 * shifts nor blanks data it already has.
 */
export const TurnMetrics = ({
    traceId,
    usage,
    separator = false,
}: {
    traceId?: string | null
    usage?: MessageUsageMetrics
    /** Prepend a `·`, so these figures read as part of the segment before them. */
    separator?: boolean
}) => {
    const summary = useAtomValue(traceDataSummaryAtomFamily(traceId ?? ""))
    if (!traceId) {
        return usage ? (
            <ExecutionMetricsDisplay metrics={usage} variant="plain" separator={separator} />
        ) : null
    }
    if (summary.isPending) {
        return (
            <div className="flex items-center gap-1">
                {separator ? <MetaSeparator /> : null}
                <SkeletonBlock active className="h-4 w-10 rounded-control-sm" />
                {usage ? (
                    <ExecutionMetricsDisplay metrics={usage} variant="plain" separator />
                ) : null}
            </div>
        )
    }
    return (
        <ExecutionMetricsDisplay
            metrics={{...summary.metrics, ...usage}}
            variant="plain"
            separator={separator}
        />
    )
}
