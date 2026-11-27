import type {TraceSpanNode} from "@agenta/observability"
import {
    formattedSpanCostAtomFamily,
    formattedSpanLatencyAtomFamily,
    formattedSpanTokensAtomFamily,
    getTokenBreakdown,
} from "@agenta/observability"
import {TokenBreakdownList} from "@agenta/ui/components/presentational"
import {SimpleTooltip} from "@agenta/ui/composed"
import {Coins, PlusCircle, Timer} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {AvatarTreeContent} from "../cells/AvatarTreeContent"
import {SpanDisplayName} from "../cells/SpanNameCell"

export interface TraceRowMetrics {
    latency?: boolean
    cost?: boolean
    tokens?: boolean
}

export interface TraceRowProps {
    span: TraceSpanNode
    /** Which inline metrics to show. Desktop drives this from its tree settings. */
    metrics?: TraceRowMetrics
    /** Show an SDK placeholder name ("_agent") as the agent it runs, as the table's Name does. */
    resolveAppName?: boolean
    className?: string
}

const METRIC_CLASS = "flex items-center font-mono gap-0.5"

/**
 * A trace span as a compact row: type glyph, span name, and inline latency / cost / tokens.
 *
 * Extracted from the trace drawer's tree, which is the only non-table trace presentation the
 * app ships. Desktop renders it inside its tree; mobile renders it as a list row. The metrics
 * come from the packaged span selectors, so both surfaces format a number the same way.
 */
export const TraceRow = ({
    span,
    metrics = {},
    resolveAppName = false,
    className,
}: TraceRowProps) => {
    const {latency = true, cost = true, tokens = true} = metrics
    const {span_name, span_id, status_code} = span || {}

    const formattedTokens = useAtomValue(formattedSpanTokensAtomFamily(span))
    const formattedCost = useAtomValue(formattedSpanCostAtomFamily(span))
    const formattedLatency = useAtomValue(formattedSpanLatencyAtomFamily(span))
    const tokenBreakdown = getTokenBreakdown(span)

    const isError = status_code === "STATUS_CODE_ERROR"

    return (
        <div className={`flex flex-col gap-0.5 truncate ${className ?? ""}`} key={span_id}>
            <div className="flex items-center gap-1">
                <AvatarTreeContent value={span} />
                <SimpleTooltip title={span_name}>
                    <span
                        className={`text-label font-normal truncate ${
                            isError ? "text-destructive" : ""
                        }`}
                    >
                        {resolveAppName ? (
                            <SpanDisplayName name={span_name} references={span?.references} />
                        ) : (
                            span_name
                        )}
                    </span>
                </SimpleTooltip>
            </div>

            <div className="flex items-center gap-2 text-muted-foreground">
                {latency && (
                    <SimpleTooltip title={`Latency: ${formattedLatency}`} side="bottom">
                        <div className={METRIC_CLASS}>
                            <Timer />
                            {formattedLatency}
                        </div>
                    </SimpleTooltip>
                )}

                {cost && formattedCost && (
                    <SimpleTooltip title={`Cost: ${formattedCost}`} side="bottom">
                        <div className={METRIC_CLASS}>
                            <Coins />
                            {formattedCost}
                        </div>
                    </SimpleTooltip>
                )}

                {tokens && !!formattedTokens && (
                    <SimpleTooltip
                        title={
                            tokenBreakdown ? (
                                <TokenBreakdownList breakdown={tokenBreakdown} />
                            ) : (
                                `Tokens: ${formattedTokens}`
                            )
                        }
                        side="bottom"
                    >
                        <div className={METRIC_CLASS}>
                            <PlusCircle />
                            {formattedTokens}
                        </div>
                    </SimpleTooltip>
                )}
            </div>
        </div>
    )
}

export default TraceRow
