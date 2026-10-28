import {traceDataSummaryAtomFamily} from "@agenta/entities/loadable"
import {ExecutionMetricsDisplay, MetaSeparator} from "@agenta/ui/components/presentational"
import {SkeletonBlock} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {
    mergeTurnMetrics,
    turnMetricsTraceKey,
    type MessageUsageMetrics,
    type TurnRowMetrics,
} from "../assets"

/**
 * A turn's cost, tokens and latency — the same data and component the playground and the trace
 * drawer use.
 *
 * When the turn row carries usage (`turnRow`), every figure comes from it: tokens and cost from
 * its usage, latency from its start and end. No trace is read, so a reader without trace access
 * sees them too. A figure the row does not know is left out, never shown as 0.
 *
 * Otherwise every figure comes from the trace root's cumulative metrics when the trace has it, and cost and
 * tokens fall back to the streamed message usage (`mergeTurnMetrics`). The runner cannot report a
 * cost for every turn, and the trace is not there until the run ends, so neither source alone
 * covers a turn. While the trace loads, the usage shows and a placeholder holds the latency slot.
 */
type Metric = "latency" | "tokens" | "cost"

export const TurnMetrics = ({
    traceId,
    usage,
    turnRow,
    separator = false,
    show,
}: {
    traceId?: string | null
    usage?: MessageUsageMetrics
    /** The figures stored on the turn row; when present, the trace is not read. */
    turnRow?: TurnRowMetrics
    /** Which figures to draw; all of them by default. A host that puts the time elsewhere (the
     * activity fold's "Worked for 11s") leaves latency out. */
    show?: Metric[]
    /**
     * Draw a leading `·` when these figures render. It carries `first:hidden`, so it disappears
     * when nothing precedes it in the row (a turn whose timestamp resolved to nothing).
     */
    separator?: boolean
}) => {
    const summary = useAtomValue(traceDataSummaryAtomFamily(turnMetricsTraceKey(traceId, turnRow)))
    const lead = separator ? <MetaSeparator className="first:hidden" /> : null
    if (turnRow) {
        const shown = (["latency", "tokens", "cost"] as const).some(
            (metric) =>
                (!show || show.includes(metric)) &&
                {latency: turnRow.durationMs, tokens: turnRow.totalTokens, cost: turnRow.totalCost}[
                    metric
                ] !== undefined,
        )
        if (!shown) return null
        return (
            <>
                {lead}
                <ExecutionMetricsDisplay metrics={turnRow} variant="plain" show={show} />
            </>
        )
    }
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
    const metrics = mergeTurnMetrics(summary.metrics, usage)
    // No figure to draw: no lead either, or the next separator in the row shows on its own.
    const hasFigure = (["latency", "tokens", "cost"] as const).some(
        (metric) =>
            (!show || show.includes(metric)) &&
            {latency: metrics.durationMs, tokens: metrics.totalTokens, cost: metrics.totalCost}[
                metric
            ] !== undefined,
    )
    if (!hasFigure) return null
    return (
        <>
            {lead}
            <ExecutionMetricsDisplay metrics={metrics} variant="plain" show={show} />
        </>
    )
}
