import {memo, useMemo} from "react"

import clsx from "clsx"

import type {EvaluationTableColumn} from "../../atoms/table"
import useScenarioCellValue from "../../hooks/useScenarioCellValue"
import {renderScenarioChatMessages} from "../../utils/chatMessages"

import CellContentPopover from "./CellContentPopover"
import InvocationTraceSummary from "./InvocationTraceSummary"

const CONTAINER_CLASS = "scenario-table-cell min-h-[96px] h-full gap-2"

const extractAssistantContent = (entry: any): string | undefined => {
    if (!entry) return undefined
    if (typeof entry === "string") return entry
    if (typeof entry.content === "string") return entry.content
    if (Array.isArray(entry.content)) {
        const textChunk = entry.content
            .map((chunk: any) => {
                if (!chunk) return ""
                if (typeof chunk === "string") return chunk
                if (typeof chunk?.text === "string") return chunk.text
                if (chunk?.type === "text" && typeof chunk?.text === "string") return chunk.text
                if (chunk?.type === "output_text" && typeof chunk?.text === "string")
                    return chunk.text
                return ""
            })
            .filter(Boolean)
            .join(" ")
        return textChunk || undefined
    }
    if (typeof entry.text === "string") return entry.text
    if (typeof entry.message === "string") return entry.message
    if (entry?.message && typeof entry.message.content === "string") return entry.message.content
    if (entry?.delta && typeof entry.delta.content === "string") return entry.delta.content
    return undefined
}

const coerceInvocationOutput = (value: unknown): string | undefined => {
    if (typeof value === "string") return value
    if (Array.isArray(value)) {
        for (const item of value) {
            const content = coerceInvocationOutput(item)
            if (content) return content
        }
        return undefined
    }
    if (!value || typeof value !== "object") return undefined

    const obj = value as Record<string, any>

    if (typeof obj.outputs === "string") return obj.outputs
    if (typeof obj.output === "string") return obj.output
    if (typeof obj.text === "string") return obj.text

    const completionSources = [
        obj.completion,
        obj.completions,
        obj.messages?.filter((m: any) => m?.role === "assistant"),
        obj.outputs?.completion,
    ]

    for (const source of completionSources) {
        if (!source) continue
        if (Array.isArray(source)) {
            for (const entry of source) {
                const content = extractAssistantContent(entry)
                if (content) return content
            }
        } else {
            const content = extractAssistantContent(source)
            if (content) return content
        }
    }

    return undefined
}

const normalizeValue = (value: unknown): string => {
    if (value === null || value === undefined) return "—"
    const coerced = coerceInvocationOutput(value)
    if (coerced) return coerced
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
}

const PreviewEvaluationInvocationCell = ({
    scenarioId,
    runId,
    column,
}: {
    scenarioId?: string
    runId?: string
    column: EvaluationTableColumn
}) => {
    const {ref, selection, showSkeleton} = useScenarioCellValue({scenarioId, runId, column})
    const {value} = selection

    const widthStyle = {width: "100%"}
    const chatNodes = useMemo(
        () =>
            renderScenarioChatMessages(
                value,
                `${scenarioId ?? "scenario"}-${column.stepKey ?? column.id ?? "invocation"}`,
            ),
        [column.id, column.stepKey, scenarioId, value],
    )

    // Generate popover content (full content without truncation)
    const popoverChatNodes = useMemo(
        () =>
            renderScenarioChatMessages(
                value,
                `${scenarioId ?? "scenario"}-${column.stepKey ?? column.id ?? "invocation"}-popover`,
            ),
        [column.id, column.stepKey, scenarioId, value],
    )

    if (showSkeleton) {
        return (
            <div ref={ref} className={CONTAINER_CLASS} style={widthStyle}>
                <div className="h-3 w-full rounded bg-neutral-200 animate-pulse" />
            </div>
        )
    }

    if (value === undefined || value === null) {
        return (
            <div ref={ref} className={CONTAINER_CLASS} style={widthStyle}>
                <span className="scenario-table-text scenario-table-placeholder font-mono">—</span>
            </div>
        )
    }

    const displayValue = normalizeValue(value)
    const popoverContent = popoverChatNodes?.length ? (
        <div className="flex w-full flex-col gap-2">{popoverChatNodes}</div>
    ) : (
        <pre className="whitespace-pre-wrap break-words m-0 font-mono text-xs">{displayValue}</pre>
    )

    if (chatNodes && chatNodes.length) {
        return (
            <CellContentPopover content={popoverContent}>
                <div ref={ref} className={CONTAINER_CLASS} style={widthStyle}>
                    <div className="flex w-full flex-col gap-2">{chatNodes}</div>
                    <InvocationTraceSummary
                        scenarioId={scenarioId}
                        stepKey={column.stepKey}
                        runId={runId}
                    />
                </div>
            </CellContentPopover>
        )
    }

    return (
        <CellContentPopover content={popoverContent}>
            <div ref={ref} className={clsx(CONTAINER_CLASS, "!justify-between")} style={widthStyle}>
                <span className="scenario-table-text whitespace-pre-wrap font-mono">
                    {displayValue}
                </span>
                <InvocationTraceSummary
                    scenarioId={scenarioId}
                    stepKey={column.stepKey}
                    runId={runId}
                />
            </div>
        </CellContentPopover>
    )
}

export default memo(PreviewEvaluationInvocationCell)
