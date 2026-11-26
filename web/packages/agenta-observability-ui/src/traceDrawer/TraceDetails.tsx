import {useT} from "@agenta/i18n"
import drawerCatalog from "@agenta/i18n/catalogs/observabilityUi.traceDrawer"
import {
    formattedSpanCompletionTokensAtomFamily,
    formattedSpanCostAtomFamily,
    formattedSpanLatencyAtomFamily,
    formattedSpanPromptTokensAtomFamily,
    formattedSpanTokensAtomFamily,
    getTokenBreakdown,
    spanEndTimeAtomFamily,
    spanStartTimeAtomFamily,
} from "@agenta/observability"
import type {TraceSpanNode} from "@agenta/observability"
import {formatTokens} from "@agenta/shared/utils"
import {useAtomValue} from "jotai"
import {PlusCircle, Timer} from "lucide-react"

import {statusMapper} from "../cells/AvatarTreeContent"
import {StatusRenderer} from "../cells/StatusRenderer"

import ResultTag from "./ResultTag"

const titleClass = "text-sm leading-[1.5714285714285714] font-medium"
const resultTagClass = "flex items-center font-mono gap-1"
const tokenContainerClass =
    "[&>div:nth-of-type(1)]:leading-[1.5714285714285714] [&>div:nth-of-type(1)]:font-medium [&>div:nth-of-type(2)]:leading-[1.5714285714285714] [&>div:nth-of-type(2)]:font-normal"

const TraceDetails = ({activeTrace}: {activeTrace: TraceSpanNode}) => {
    const t = useT(drawerCatalog)
    const {icon, bgColor, color} = statusMapper(activeTrace?.span_type)
    const formattedTokens = useAtomValue(formattedSpanTokensAtomFamily(activeTrace))
    const formattedCost = useAtomValue(formattedSpanCostAtomFamily(activeTrace))
    const formattedLatency = useAtomValue(formattedSpanLatencyAtomFamily(activeTrace))
    const formattedPromptTokens = useAtomValue(formattedSpanPromptTokensAtomFamily(activeTrace))
    const formattedCompletionTokens = useAtomValue(
        formattedSpanCompletionTokensAtomFamily(activeTrace),
    )
    const tokenBreakdown = getTokenBreakdown(activeTrace)
    const tokenRows = tokenBreakdown
        ? [
              [formatTokens(tokenBreakdown.input), t("observabilityUi.traceDrawer.inputTokens")],
              [
                  formatTokens(tokenBreakdown.cacheRead),
                  t("observabilityUi.traceDrawer.cacheReadTokens"),
              ],
              [
                  formatTokens(tokenBreakdown.cacheWrite),
                  t("observabilityUi.traceDrawer.cacheWriteTokens"),
              ],
              [formatTokens(tokenBreakdown.output), t("observabilityUi.traceDrawer.outputTokens")],
          ]
        : [
              [formattedPromptTokens, t("observabilityUi.traceDrawer.promptTokens")],
              [formattedCompletionTokens, t("observabilityUi.traceDrawer.completionTokens")],
          ]
    const traceStartTime = useAtomValue(spanStartTimeAtomFamily(activeTrace))
    const traceEndTime = useAtomValue(spanEndTimeAtomFamily(activeTrace))
    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1 items-start">
                <span className={titleClass}>{t("observabilityUi.traceDrawer.type")}</span>

                <ResultTag
                    style={{
                        backgroundColor: bgColor,
                        color: color,
                    }}
                    className="font-mono"
                    bordered={false}
                    value1={
                        <>
                            {icon} {activeTrace?.span_type}
                        </>
                    }
                />
            </div>

            <div className="flex flex-col gap-1 items-start">
                <span className={titleClass}>{t("observabilityUi.traceDrawer.status")}</span>
                <StatusRenderer
                    status={activeTrace?.status_code}
                    message={activeTrace?.status_message}
                    bordered={false}
                />
            </div>

            <div className="flex flex-col gap-1 items-start">
                <span className={titleClass}>{t("observabilityUi.traceDrawer.latency")}</span>
                <ResultTag
                    bordered={false}
                    className="bg-[var(--ag-c-0517290F)]"
                    value1={
                        <div className={resultTagClass}>
                            <Timer size={14} /> {formattedLatency}
                        </div>
                    }
                />
            </div>

            <div className="flex flex-col gap-1 items-start">
                <span className={titleClass}>{t("observabilityUi.traceDrawer.timestamp")}</span>

                <ResultTag
                    value1={
                        <div className={resultTagClass}>
                            {t("observabilityUi.traceDrawer.startAt", {time: traceStartTime})}
                        </div>
                    }
                    bordered={false}
                    className="bg-[var(--ag-c-0517290F)]"
                />
                <ResultTag
                    bordered={false}
                    className="bg-[var(--ag-c-0517290F)]"
                    value1={
                        <div className={resultTagClass}>
                            {t("observabilityUi.traceDrawer.endAt", {time: traceEndTime})}
                        </div>
                    }
                />
            </div>

            <div className="flex flex-col gap-1 items-start">
                <span className={titleClass}>{t("observabilityUi.traceDrawer.tokensAndCost")}</span>
                <ResultTag
                    bordered={false}
                    className="bg-[var(--ag-c-0517290F)]"
                    value1={
                        <div className={resultTagClass}>
                            <PlusCircle size={14} />
                            {formattedTokens} / {formattedCost}
                        </div>
                    }
                    popoverContent={
                        <div className="flex flex-col gap-2 items-start">
                            {tokenRows.map(([value, label], index) => (
                                <div
                                    key={index}
                                    className={`flex items-center gap-2 ${tokenContainerClass}`}
                                >
                                    <div>{value}</div>
                                    <div>{label}</div>
                                </div>
                            ))}
                        </div>
                    }
                />
            </div>
        </div>
    )
}

export default TraceDetails
