import {traceDataSummaryAtomFamily} from "@agenta/entities/loadable"
import {ExecutionMetricsDisplay, MetaSeparator} from "@agenta/ui/components/presentational"
import {SkeletonBlock} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {mergeTurnMetrics, type MessageUsageMetrics} from "../assets"

/**
 * A turn's cost, tokens and latency — the same data and component the playground and the trace
 * drawer use.
 *
 * Every figure comes from the trace root's cumulative metrics when the trace has it, and cost and
 * tokens fall back to the streamed message usage (`mergeTurnMetrics`). The runner cannot report a
 * cost for every turn, and the trace is not there until the run ends, so neither source alone
 * covers a turn. While the trace loads, the usage shows and a placeholder holds the latency slot.
 */
type Metric = "latency" | "tokens" | "cost"

export const TurnMetrics = ({
    traceId,
    usage,
    separator = false,
    show,
}: {
    traceId?: string | null
    usage?: MessageUsageMetrics
    /** Which figures to draw; all of them by default. A host that puts the time elsewhere (the
     * activity fold's "Worked for 11s") leaves latency out. */
    show?: Metric[]
    /**
     * Draw a leading `·` when these figures render. It carries `first:hidden`, so it disappears
     * when nothing precedes it in the row (a turn whose timestamp resolved to nothing).
     */
    separator?: boolean
}) => {
    const summary = useAtomValue(traceDataSummaryAtomFamily(traceId ?? ""))
    const lead = separator ? <MetaSeparator className="first:hidden" /> : null
    // Only the latency slot waits on the trace; without it there is nothing to wait for.
    const wantsLatency = !show || show.includes("latency")

    if (traceId && summary.isPending) {
        if (!wantsLatency && !usage) return null
        return (
            <>
                {lead}
                {wantsLatency ? (
                    <SkeletonBlock active className="h-4 w-10 rounded-control-sm" />
                ) : null}
                {usage ? (
                    <>
                        {wantsLatency ? <MetaSeparator /> : null}
                        <ExecutionMetricsDisplay metrics={usage} variant="plain" show={show} />
                    </>
                ) : null}
            </>
        )
    }
    if (!traceId && !usage) return null
    return (
        <>
            {lead}
            <ExecutionMetricsDisplay
                metrics={mergeTurnMetrics(summary.metrics, usage)}
                variant="plain"
                show={show}
            />
        </>
    )
}
