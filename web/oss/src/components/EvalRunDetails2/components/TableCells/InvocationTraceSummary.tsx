import {memo, useMemo} from "react"

import {Timer, PlusCircle} from "@phosphor-icons/react"
import {Tag, Space} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import StatusRenderer from "@/oss/components/pages/observability/components/StatusRenderer"
import TraceDrawerButton from "@/oss/components/Playground/Components/Drawers/TraceDrawer"
import ResultTag from "@/oss/components/ResultTag/ResultTag"
import {formatCurrency, formatLatency, formatTokenUsage} from "@/oss/lib/helpers/formatters"
import {StatusCode} from "@/oss/services/tracing/types"

import {invocationTraceSummaryAtomFamily} from "../../atoms/invocationTraceSummary"

const InvocationTraceSummary = ({
    scenarioId,
    stepKey,
    runId,
}: {
    scenarioId?: string
    stepKey?: string
    runId?: string
}) => {
    const summaryAtom = useMemo(
        () => invocationTraceSummaryAtomFamily({scenarioId, stepKey, runId}),
        [scenarioId, stepKey, runId],
    )
    const summary = useAtomValue(summaryAtom)
    const formattedLatency = useMemo(
        () => (summary.durationMs !== undefined ? formatLatency(summary.durationMs / 1000) : null),
        [summary.durationMs],
    )
    const formattedTokens = useMemo(
        () => (summary.totalTokens !== undefined ? formatTokenUsage(summary.totalTokens) : null),
        [summary.totalTokens],
    )
    const formattedPromptTokens = useMemo(
        () => (summary.promptTokens !== undefined ? formatTokenUsage(summary.promptTokens) : null),
        [summary.promptTokens],
    )
    const formattedCompletionTokens = useMemo(
        () =>
            summary.completionTokens !== undefined
                ? formatTokenUsage(summary.completionTokens)
                : null,
        [summary.completionTokens],
    )
    const formattedCost = useMemo(
        () => (summary.totalCost !== undefined ? formatCurrency(summary.totalCost) : null),
        [summary.totalCost],
    )
    const statusCode = useMemo<StatusCode | undefined>(() => {
        if (!summary.status) return undefined
        const lowered = summary.status.toLowerCase()
        if (lowered === "error" || lowered === "failed" || lowered === "failure") {
            return StatusCode.STATUS_CODE_ERROR
        }
        if (lowered === "success" || lowered === "ok" || lowered === "completed") {
            return StatusCode.STATUS_CODE_OK
        }
        return StatusCode.STATUS_CODE_UNSET
    }, [summary.status])
    const traceButtonResult = useMemo(
        () =>
            summary.traceId
                ? {
                      response: {
                          trace_id: summary.traceId,
                          trace: {},
                      },
                  }
                : null,
        [summary.traceId],
    )

    if (summary.state !== "ready") return null

    return (
        <div
            className={clsx(
                "flex items-center gap-1 pt-1 text-[11px] text-neutral-600",
                !formattedLatency && !formattedTokens && !formattedCost && !summary.traceId
                    ? "text-neutral-500"
                    : null,
            )}
        >
            <TraceDrawerButton result={traceButtonResult} size="small" type="default" />
            <StatusRenderer status={statusCode} />
            {formattedLatency ? (
                <Tag color="default" bordered={false} className="flex items-center gap-1">
                    <Timer size={14} /> {formattedLatency}
                </Tag>
            ) : null}
            {formattedTokens || formattedCost ? (
                <ResultTag
                    color="default"
                    bordered={false}
                    value1={
                        <div className="flex items-center gap-1 text-nowrap">
                            <PlusCircle size={14} /> {formattedTokens}
                            {formattedTokens && formattedCost ? <span>/</span> : null}
                            {formattedCost}
                        </div>
                    }
                    popoverContent={
                        formattedPromptTokens || formattedCompletionTokens ? (
                            <Space direction="vertical">
                                {formattedPromptTokens ? (
                                    <Space>
                                        <div>{formattedPromptTokens}</div>
                                        <div>Prompt tokens</div>
                                    </Space>
                                ) : null}
                                {formattedCompletionTokens ? (
                                    <Space>
                                        <div>{formattedCompletionTokens}</div>
                                        <div>Completion tokens</div>
                                    </Space>
                                ) : null}
                            </Space>
                        ) : undefined
                    }
                />
            ) : null}
        </div>
    )
}

export default memo(InvocationTraceSummary)
