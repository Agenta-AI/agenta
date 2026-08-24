import type {TraceSpanNode} from "@agenta/observability"
import {
    formattedSpanCostAtomFamily,
    formattedSpanLatencyAtomFamily,
    formattedSpanTokensAtomFamily,
} from "@agenta/observability"
import {SimpleTooltip} from "@agenta/ui/ui"
import {Coins, PlusCircle, Timer} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {AvatarTreeContent} from "../cells/AvatarTreeContent"

export interface TraceRowMetrics {
    latency?: boolean
    cost?: boolean
    tokens?: boolean
}

export interface TraceRowProps {
    span: TraceSpanNode
    /** Which inline metrics to show. Desktop drives this from its tree settings. */
    metrics?: TraceRowMetrics
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
export const TraceRow = ({span, metrics = {}, className}: TraceRowProps) => {
    const {latency = true, cost = true, tokens = true} = metrics
    const {span_name, span_id, status_code} = span || {}

    const formattedTokens = useAtomValue(formattedSpanTokensAtomFamily(span))
    const formattedCost = useAtomValue(formattedSpanCostAtomFamily(span))
    const formattedLatency = useAtomValue(formattedSpanLatencyAtomFamily(span))

    const isError = status_code === "STATUS_CODE_ERROR"

    return (
        <div className={`flex flex-col gap-0.5 truncate ${className ?? ""}`} key={span_id}>
            <div className="flex items-center gap-1">
                <AvatarTreeContent value={span} />
                <SimpleTooltip title={span_name}>
                    <span
                        className={`text-xs leading-[1.6666666666666667] truncate ${
                            isError ? "text-colorError font-medium" : ""
                        }`}
                    >
                        {span_name}
                    </span>
                </SimpleTooltip>
            </div>

            <div className="flex items-center gap-2 text-colorTextSecondary">
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
                    <SimpleTooltip title={`Tokens: ${formattedTokens}`} side="bottom">
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
