import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import drawerCatalog from "@agenta/i18n/catalogs/observabilityUi.traceDrawer"
import {
    formattedSpanCostAtomFamily,
    formattedSpanLatencyAtomFamily,
    formattedSpanTokensAtomFamily,
    getCost,
    getTokenBreakdown,
    getTokens,
    spanEndTimeAtomFamily,
    spanStartTimeAtomFamily,
} from "@agenta/observability"
import type {TraceSpanNode} from "@agenta/observability"
import {TokenBreakdownList} from "@agenta/ui/components/presentational"
import {cn} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {RunningLatency} from "../trace/TraceRow"

import {isSpanRunning} from "./spanRunning"

const Cell = ({label, children, wide}: {label: string; children: ReactNode; wide?: boolean}) => (
    <div className={cn("flex min-w-0 flex-col gap-0.5", wide && "col-span-2")}>
        <dt className="text-meta text-muted-foreground">{label}</dt>
        <dd className="m-0 min-w-0 break-words text-label">{children}</dd>
    </div>
)

/**
 * The span's numbers in the side panel: label over value, two columns. A token breakdown (input,
 * cache read, cache write, output) is the shared `TokenBreakdownList`. A span with no cost or
 * tokens draws no cell for them, and a running span shows "Running" and no end.
 */
const SpanMetricsGrid = ({span}: {span: TraceSpanNode}) => {
    const t = useT(drawerCatalog, valueViewCatalog)
    const latency = useAtomValue(formattedSpanLatencyAtomFamily(span))
    const cost = useAtomValue(formattedSpanCostAtomFamily(span))
    const tokens = useAtomValue(formattedSpanTokensAtomFamily(span))
    const start = useAtomValue(spanStartTimeAtomFamily(span))
    const end = useAtomValue(spanEndTimeAtomFamily(span))

    const running = isSpanRunning(span)
    const failed = span.status_code === "STATUS_CODE_ERROR"
    const breakdown = getTokenBreakdown(span)
    const hasTokens = getTokens(span) != null

    return (
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3" data-testid="span-metrics-grid">
            <Cell label={t("observabilityUi.traceDrawer.type")}>{span.span_type ?? "—"}</Cell>
            <Cell label={t("observabilityUi.traceDrawer.status")}>
                <span className={cn(failed && "text-destructive", running && "text-info")}>
                    {running
                        ? t("chat.valueView.running")
                        : failed
                          ? t("observabilityUi.traceDrawer.statusError")
                          : t("observabilityUi.traceDrawer.statusSuccess")}
                </span>
                {span.status_message ? (
                    <span className="block text-meta font-normal text-muted-foreground">
                        {span.status_message}
                    </span>
                ) : null}
            </Cell>
            <Cell label={t("observabilityUi.traceDrawer.latency")}>
                {running ? <RunningLatency /> : latency}
            </Cell>
            {getCost(span) != null ? (
                <Cell label={t("observabilityUi.traceDrawer.cost")}>{cost}</Cell>
            ) : null}
            {hasTokens ? (
                <Cell label={t("observabilityUi.traceDrawer.tokens")} wide={Boolean(breakdown)}>
                    {breakdown ? (
                        <span className="block max-w-60 font-normal">
                            <TokenBreakdownList breakdown={breakdown} />
                        </span>
                    ) : (
                        tokens
                    )}
                </Cell>
            ) : null}
            <Cell label={t("observabilityUi.traceDrawer.start")}>{start}</Cell>
            {running ? null : <Cell label={t("observabilityUi.traceDrawer.end")}>{end}</Cell>}
        </dl>
    )
}

export default SpanMetricsGrid
