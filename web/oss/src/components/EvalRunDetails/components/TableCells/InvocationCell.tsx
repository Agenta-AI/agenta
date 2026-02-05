import {memo, useMemo} from "react"

import {
    CellContentPopover,
    ChatMessagesCellContent,
    JsonCellContent,
    TextCellContent,
    extractChatMessages,
    safeJsonStringify,
    tryParseJson,
} from "@agenta/ui/cell-renderers"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import {AlertCircle} from "lucide-react"

import type {EvaluationTableColumn} from "../../atoms/table"
import useScenarioCellValue from "../../hooks/useScenarioCellValue"
import {scenarioRowHeightAtom, type ScenarioRowHeight} from "../../state/rowHeight"

import InvocationTraceSummary from "./InvocationTraceSummary"

// Max lines for JSON/text content (fills most of the cell)
const MAX_LINES_BY_HEIGHT: Record<ScenarioRowHeight, number> = {
    small: 4,
    medium: 9,
    large: 18,
}

// Max total lines for chat messages (accounting for role labels ~1 line each)
const MAX_CHAT_LINES_BY_HEIGHT: Record<ScenarioRowHeight, number> = {
    small: 3,
    medium: 7,
    large: 14,
}

// Max lines per individual chat message content
const MAX_LINES_PER_MESSAGE_BY_HEIGHT: Record<ScenarioRowHeight, number> = {
    small: 2,
    medium: 5,
    large: 8,
}

const CONTAINER_CLASS = "scenario-table-cell"

/**
 * Extract assistant content from invocation output for display
 */
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

/**
 * Coerce invocation output to a display string
 */
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

/**
 * Normalize invocation output value for display
 */
const normalizeInvocationValue = (value: unknown): string => {
    if (value === null || value === undefined) return "—"
    const coerced = coerceInvocationOutput(value)
    if (coerced) return coerced
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    return safeJsonStringify(value)
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
    const rowHeight = useAtomValue(scenarioRowHeightAtom)
    const {ref, selection, showSkeleton} = useScenarioCellValue({scenarioId, runId, column})
    const {value, stepError} = selection

    // Get limits based on row height
    const maxLines = MAX_LINES_BY_HEIGHT[rowHeight]
    const maxChatTotalLines = MAX_CHAT_LINES_BY_HEIGHT[rowHeight]
    const maxLinesPerMessage = MAX_LINES_PER_MESSAGE_BY_HEIGHT[rowHeight]

    // Try to parse JSON strings - must be before any early returns
    const {parsed: jsonValue, isJson} = useMemo(() => tryParseJson(value), [value])

    // Check for chat messages
    const chatMessages = useMemo(() => extractChatMessages(jsonValue), [jsonValue])
    const isChatMessages = chatMessages !== null && chatMessages.length > 0

    // Compute display value and copy text before early returns (React hooks rule)
    const displayValue = useMemo(() => normalizeInvocationValue(value), [value])
    const copyText = useMemo(() => {
        if (value === undefined || value === null) return undefined
        if (isChatMessages || isJson) return safeJsonStringify(jsonValue)
        return displayValue
    }, [value, isChatMessages, isJson, jsonValue, displayValue])

    const keyPrefix = `${scenarioId ?? "scenario"}-${column.stepKey ?? column.id ?? "invocation"}`
    const widthStyle = {width: "100%"}

    if (showSkeleton) {
        return (
            <div ref={ref} className={CONTAINER_CLASS} style={widthStyle}>
                <div className="h-3 w-full rounded bg-neutral-200 animate-pulse" />
            </div>
        )
    }

    // Show error state when invocation has failed - display error message in cell with red styling
    if (stepError) {
        const errorPopoverContent = (
            <div className="flex flex-col gap-2 text-red-600">
                <div className="flex items-center gap-1.5 text-red-500">
                    <AlertCircle size={14} className="flex-shrink-0" />
                    <span className="text-xs font-medium">Invocation Error</span>
                </div>
                <span className="whitespace-pre-wrap break-words text-xs font-medium">
                    {stepError.message}
                </span>
                {stepError.stacktrace ? (
                    <span className="whitespace-pre-wrap break-words text-xs text-red-500/80 border-t border-red-200 pt-2 mt-1">
                        {stepError.stacktrace}
                    </span>
                ) : null}
            </div>
        )

        const errorCopyContent = `${stepError?.message}${stepError?.stacktrace ? `\n${stepError?.stacktrace}` : ""}`
        return (
            <CellContentPopover fullContent={errorPopoverContent} copyText={errorCopyContent}>
                <div
                    ref={ref}
                    className={clsx(CONTAINER_CLASS, "!justify-between")}
                    style={widthStyle}
                >
                    <div className="flex-1 min-h-0 overflow-hidden">
                        <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1.5 text-red-500">
                                <AlertCircle size={14} className="flex-shrink-0" />
                                <span className="text-xs font-medium">Error</span>
                            </div>
                            <span className="scenario-table-text whitespace-pre-wrap text-red-600 text-xs">
                                {stepError.message}
                            </span>
                        </div>
                    </div>
                    <div className="flex-shrink-0">
                        <InvocationTraceSummary
                            scenarioId={scenarioId}
                            stepKey={column.stepKey}
                            runId={runId}
                        />
                    </div>
                </div>
            </CellContentPopover>
        )
    }

    if (value === undefined || value === null) {
        return (
            <div ref={ref} className={CONTAINER_CLASS} style={widthStyle}>
                <span className="scenario-table-text scenario-table-placeholder">—</span>
            </div>
        )
    }

    // Render chat messages
    if (isChatMessages) {
        return (
            <CellContentPopover
                fullContent={
                    <ChatMessagesCellContent
                        value={jsonValue}
                        keyPrefix={`${keyPrefix}-popover`}
                        truncate={false}
                    />
                }
                copyText={copyText}
            >
                <div
                    ref={ref}
                    className={clsx(CONTAINER_CLASS, "!justify-between")}
                    style={widthStyle}
                >
                    <div className="scenario-invocation-content flex-1 min-h-0 overflow-hidden">
                        <ChatMessagesCellContent
                            value={jsonValue}
                            keyPrefix={keyPrefix}
                            maxLines={maxLinesPerMessage}
                            maxTotalLines={maxChatTotalLines}
                            truncate
                        />
                    </div>
                    <div className="flex-shrink-0">
                        <InvocationTraceSummary
                            scenarioId={scenarioId}
                            stepKey={column.stepKey}
                            runId={runId}
                        />
                    </div>
                </div>
            </CellContentPopover>
        )
    }

    // Render JSON objects/arrays
    if (isJson) {
        return (
            <CellContentPopover
                fullContent={<JsonCellContent value={jsonValue} truncate={false} />}
                copyText={copyText}
            >
                <div
                    ref={ref}
                    className={clsx(CONTAINER_CLASS, "!justify-between")}
                    style={widthStyle}
                >
                    <div className="scenario-invocation-content flex-1 min-h-0 overflow-hidden">
                        <JsonCellContent value={jsonValue} maxLines={maxLines} />
                    </div>
                    <div className="flex-shrink-0">
                        <InvocationTraceSummary
                            scenarioId={scenarioId}
                            stepKey={column.stepKey}
                            runId={runId}
                        />
                    </div>
                </div>
            </CellContentPopover>
        )
    }

    // Plain text
    return (
        <CellContentPopover
            fullContent={<TextCellContent value={displayValue} truncate={false} />}
            copyText={copyText}
        >
            <div ref={ref} className={clsx(CONTAINER_CLASS, "!justify-between")} style={widthStyle}>
                <div className="scenario-invocation-content flex-1 min-h-0 overflow-hidden">
                    <TextCellContent value={displayValue} maxLines={maxLines} />
                </div>
                <div className="flex-shrink-0">
                    <InvocationTraceSummary
                        scenarioId={scenarioId}
                        stepKey={column.stepKey}
                        runId={runId}
                    />
                </div>
            </div>
        </CellContentPopover>
    )
}

export default memo(PreviewEvaluationInvocationCell)
