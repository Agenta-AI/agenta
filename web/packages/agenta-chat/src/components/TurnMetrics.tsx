import type {TurnFigures} from "@agenta/entities/session"
import {ExecutionMetricsDisplay, MetaSeparator} from "@agenta/ui/components/presentational"

import type {MessageUsageMetrics} from "../assets"

/**
 * A turn's cost, tokens and latency, in the component the playground and the trace drawer use.
 *
 * A settled turn takes every figure from its session turn: tokens and cost from its usage,
 * latency from its start and end. No trace is read, so a reader without trace access sees them
 * too, and opening a chat costs no trace request. A running turn shows the usage streamed so far.
 * A figure nobody knows (no row yet, no usage stored) is left out, never shown as 0.
 */
type Metric = "latency" | "tokens" | "cost"

export const TurnMetrics = ({
    usage,
    sessionTurnFigures,
    isStreaming = false,
    separator = false,
    show,
}: {
    /** The usage streamed while the turn runs. */
    usage?: MessageUsageMetrics
    /** The figures stored on the session turn. */
    sessionTurnFigures?: TurnFigures
    isStreaming?: boolean
    /** Which figures to draw; all of them by default. A host that puts the time elsewhere (the
     * activity fold's "Worked for 11s") leaves latency out. */
    show?: Metric[]
    /**
     * Draw a leading `·` when these figures render. It carries `first:hidden`, so it disappears
     * when nothing precedes it in the row (a turn whose timestamp resolved to nothing).
     */
    separator?: boolean
}) => {
    const metrics = pickTurnFigures({usage, sessionTurnFigures, isStreaming})
    if (!metrics) return null
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
            {separator ? <MetaSeparator className="first:hidden" /> : null}
            <ExecutionMetricsDisplay metrics={metrics} variant="plain" show={show} />
        </>
    )
}

/** The figures a turn's footer draws: the session turn's, else the streamed usage while it runs. */
export const pickTurnFigures = ({
    usage,
    sessionTurnFigures,
    isStreaming,
}: {
    usage?: MessageUsageMetrics
    sessionTurnFigures?: TurnFigures
    isStreaming: boolean
}): TurnFigures | undefined => sessionTurnFigures ?? (isStreaming ? usage : undefined)
