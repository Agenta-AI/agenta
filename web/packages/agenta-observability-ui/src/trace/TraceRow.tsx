import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import drawerCatalog from "@agenta/i18n/catalogs/observabilityUi.traceDrawer"
import type {TraceSpanNode} from "@agenta/observability"
import {
    formattedSpanCostAtomFamily,
    formattedSpanLatencyAtomFamily,
    formattedSpanTokensAtomFamily,
    getCost,
    getTokenBreakdown,
    getTokens,
} from "@agenta/observability"
import {TokenBreakdownList} from "@agenta/ui/components/presentational"
import {SimpleTooltip} from "@agenta/ui/ui"
import {Coins, PlusCircle, Timer} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {AvatarTreeContent} from "../cells/AvatarTreeContent"
import {SpanDisplayName} from "../cells/SpanNameCell"
import {isSpanRunning} from "../traceDrawer/spanRunning"
import {toolSpanLabel} from "../traceDrawer/toolSpanLabel"

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
    /**
     * One line: the label, then tokens, cost and latency on the right (the trace tree). A tool
     * span is labeled from its call, with the span name in the tooltip.
     */
    oneLine?: boolean
    className?: string
}

/** "running" with a pulsing dot, in place of the latency of a span with no end time. */
export const RunningLatency = () => {
    const t = useT(drawerCatalog)
    return (
        <span className="inline-flex shrink-0 items-center gap-1 text-meta text-info">
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-info" />
            {t("observabilityUi.traceDrawer.runningLatency")}
        </span>
    )
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
    oneLine = false,
    className,
}: TraceRowProps) => {
    const {latency = true, cost = true, tokens = true} = metrics
    const {span_name, span_id, status_code} = span || {}

    const formattedTokens = useAtomValue(formattedSpanTokensAtomFamily(span))
    const formattedCost = useAtomValue(formattedSpanCostAtomFamily(span))
    const formattedLatency = useAtomValue(formattedSpanLatencyAtomFamily(span))
    const tokenBreakdown = getTokenBreakdown(span)
    // A span with no cost or tokens draws nothing, not a dash.
    const hasCost = getCost(span) != null
    const hasTokens = getTokens(span) != null

    const isError = status_code === "STATUS_CODE_ERROR"

    const tokensFigure: ReactNode = (
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
    )

    if (oneLine) {
        const toolLabel = toolSpanLabel(span)
        return (
            <div
                className={`flex min-w-0 items-center gap-1 ${className ?? ""}`}
                key={span_id}
                data-testid="trace-tree-row"
            >
                <AvatarTreeContent value={span} className="size-5" />
                <SimpleTooltip title={span_name}>
                    <span
                        className={`min-w-0 flex-1 truncate text-label font-normal ${
                            isError ? "text-destructive" : ""
                        }`}
                    >
                        {toolLabel ?? (
                            <SpanDisplayName name={span_name} references={span?.references} />
                        )}
                    </span>
                </SimpleTooltip>
                <span className="flex shrink-0 items-center gap-2 font-mono text-meta tabular-nums text-muted-foreground">
                    {tokens && hasTokens ? tokensFigure : null}
                    {cost && hasCost ? <span>{formattedCost}</span> : null}
                    {latency ? (
                        isSpanRunning(span) ? (
                            <RunningLatency />
                        ) : (
                            <span>{formattedLatency}</span>
                        )
                    ) : null}
                </span>
            </div>
        )
    }

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

                {cost && hasCost && (
                    <SimpleTooltip title={`Cost: ${formattedCost}`} side="bottom">
                        <div className={METRIC_CLASS}>
                            <Coins />
                            {formattedCost}
                        </div>
                    </SimpleTooltip>
                )}

                {tokens && hasTokens && tokensFigure}
            </div>
        </div>
    )
}

export default TraceRow
