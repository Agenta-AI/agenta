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
    /**
     * Draw a leading `·` when these figures render. It carries `first:hidden`, so it disappears
     * when nothing precedes it in the row (a turn whose timestamp resolved to nothing).
     */
    separator?: boolean
}) => {
    const summary = useAtomValue(traceDataSummaryAtomFamily(traceId ?? ""))
    const lead = separator ? <MetaSeparator className="first:hidden" /> : null

    if (!traceId) {
        return usage ? (
            <>
                {lead}
                <ExecutionMetricsDisplay metrics={usage} variant="plain" />
            </>
        ) : null
    }
    if (summary.isPending) {
        return (
            <>
                {lead}
                <SkeletonBlock active className="h-4 w-10 rounded-control-sm" />
                {usage ? (
                    <>
                        <MetaSeparator />
                        <ExecutionMetricsDisplay metrics={usage} variant="plain" />
                    </>
                ) : null}
            </>
        )
    }
    return (
        <>
            {lead}
            <ExecutionMetricsDisplay metrics={{...summary.metrics, ...usage}} variant="plain" />
        </>
    )
}
