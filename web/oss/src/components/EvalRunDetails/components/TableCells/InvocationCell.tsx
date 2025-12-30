import {memo, useMemo} from "react"

import clsx from "clsx"
import {AlertCircle} from "lucide-react"
import dynamic from "next/dynamic"

import type {EvaluationTableColumn} from "../../atoms/table"
import useScenarioCellValue from "../../hooks/useScenarioCellValue"
import {renderScenarioChatMessages} from "../../utils/chatMessages"

import CellContentPopover from "./CellContentPopover"
import InvocationTraceSummary from "./InvocationTraceSummary"

const JsonEditor = dynamic(() => import("@/oss/components/Editor/Editor"), {ssr: false})

const CONTAINER_CLASS = "scenario-table-cell"

/**
 * Try to parse a JSON string, returns the parsed value or null if not valid JSON
 */
const tryParseJson = (value: unknown): {parsed: unknown; isJson: boolean} => {
    if (value === null || value === undefined) {
        return {parsed: value, isJson: false}
    }
    // Already an object/array
    if (typeof value === "object") {
        return {parsed: value, isJson: true}
    }
    // Try to parse string as JSON
    if (typeof value === "string") {
        const trimmed = value.trim()
        if (
            (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
            (trimmed.startsWith("[") && trimmed.endsWith("]"))
        ) {
            try {
                const parsed = JSON.parse(trimmed)
                return {parsed, isJson: true}
            } catch {
                return {parsed: value, isJson: false}
            }
        }
    }
    return {parsed: value, isJson: false}
}

/**
 * Safely stringify a value to JSON
 */
const safeJsonStringify = (value: unknown): string => {
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

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
    return safeJsonStringify(value)
}

/**
 * Render JSON content using the code editor
 */
const JsonContent = memo(({value, height}: {value: unknown; height?: number}) => {
    const jsonString = useMemo(() => safeJsonStringify(value), [value])
    return (
        <div className="overflow-hidden [&_.editor-inner]:!border-0 [&_.editor-inner]:!bg-transparent [&_.editor-container]:!bg-transparent [&_.editor-code]:!bg-transparent [&_.editor-code]:!text-xs">
            <JsonEditor
                initialValue={jsonString}
                language="json"
                codeOnly
                showToolbar={false}
                disabled
                enableResize={false}
                boundWidth
                showLineNumbers={false}
                dimensions={{width: "100%", height: height ?? "auto"}}
            />
        </div>
    )
})
JsonContent.displayName = "JsonContent"

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
    const {value, stepError} = selection

    // Try to parse JSON strings - must be before any early returns
    const {parsed: jsonValue, isJson} = useMemo(() => tryParseJson(value), [value])

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
            <CellContentPopover content={errorPopoverContent} copyContent={errorCopyContent}>
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

    const displayValue = normalizeValue(value)
    const popoverContent = popoverChatNodes?.length ? (
        <div className="flex w-full flex-col gap-2">{popoverChatNodes}</div>
    ) : isJson ? (
        <JsonContent value={jsonValue} height={200} />
    ) : (
        <span className="whitespace-pre-wrap break-words block text-xs">{displayValue}</span>
    )

    if (chatNodes && chatNodes.length) {
        return (
            <CellContentPopover content={popoverContent} copyContent={safeJsonStringify(value)}>
                <div ref={ref} className={CONTAINER_CLASS} style={widthStyle}>
                    <div className="scenario-invocation-content flex-1 min-h-0 overflow-hidden">
                        <div className="flex w-full flex-col gap-2">{chatNodes}</div>
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

    // Render JSON objects/arrays using the JSON editor
    if (isJson) {
        return (
            <CellContentPopover content={popoverContent} copyContent={safeJsonStringify(jsonValue)}>
                <div
                    ref={ref}
                    className={clsx(CONTAINER_CLASS, "!justify-between")}
                    style={widthStyle}
                >
                    <div className="scenario-invocation-content flex-1 min-h-0 overflow-hidden">
                        <JsonContent value={jsonValue} />
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

    return (
        <CellContentPopover content={popoverContent} copyContent={displayValue}>
            <div ref={ref} className={clsx(CONTAINER_CLASS, "!justify-between")} style={widthStyle}>
                <div className="scenario-invocation-content flex-1 min-h-0 overflow-hidden">
                    <span className="scenario-table-text whitespace-pre-wrap">{displayValue}</span>
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
