import {memo, useMemo} from "react"

import dynamic from "next/dynamic"

import type {EvaluationTableColumn} from "../../atoms/table"
import useScenarioCellValue from "../../hooks/useScenarioCellValue"
import {renderScenarioChatMessages} from "../../utils/chatMessages"

import CellContentPopover from "./CellContentPopover"

const JsonEditor = dynamic(() => import("@/oss/components/Editor/Editor"), {ssr: false})

interface PreviewEvaluationInputCellProps {
    scenarioId?: string
    runId?: string
    column: EvaluationTableColumn
}

/**
 * Unwrap redundant "inputs" wrapper from online evaluation data.
 * Online evaluations wrap inputs in {"inputs": {...}}, so we extract the inner value.
 */
const unwrapInputsWrapper = (value: unknown): unknown => {
    if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        "inputs" in value &&
        Object.keys(value).length === 1
    ) {
        return (value as Record<string, unknown>).inputs
    }
    return value
}

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

/**
 * Render JSON content using the code editor
 */
const JsonContent = memo(({value, height}: {value: unknown; height?: number}) => {
    const jsonString = useMemo(() => safeJsonStringify(value), [value])
    return (
        <div className="overflow-hidden [&_.editor-inner]:!border-0 [&_.editor-inner]:!bg-transparent [&_.editor-container]:!bg-transparent [&_.editor-code]:!bg-transparent">
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

const normalizeValue = (value: unknown): string => {
    if (value === null || value === undefined) return "—"
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value)
    }
    return safeJsonStringify(value)
}

const CONTAINER_CLASS = "scenario-table-cell"

const PreviewEvaluationInputCell = ({
    scenarioId,
    runId,
    column,
}: PreviewEvaluationInputCellProps) => {
    const {ref, selection, showSkeleton} = useScenarioCellValue({scenarioId, runId, column})
    const {value: rawValue} = selection

    // Unwrap redundant "inputs" wrapper from online evaluations
    const value = useMemo(() => unwrapInputsWrapper(rawValue), [rawValue])

    // Try to parse JSON strings - must be before any early returns
    const {parsed: jsonValue, isJson} = useMemo(() => tryParseJson(value), [value])

    const widthStyle = {width: "100%"}
    const chatNodes = useMemo(
        () =>
            renderScenarioChatMessages(
                value,
                `${scenarioId ?? "scenario"}-${column.id ?? column.path ?? "input"}`,
            ),
        [column.id, column.path, scenarioId, value],
    )

    // Generate popover content (full content without truncation)
    const popoverChatNodes = useMemo(
        () =>
            renderScenarioChatMessages(
                value,
                `${scenarioId ?? "scenario"}-${column.id ?? column.path ?? "input"}-popover`,
            ),
        [column.id, column.path, scenarioId, value],
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
        <span className="whitespace-pre-wrap break-words block">{displayValue}</span>
    )

    if (chatNodes && chatNodes.length) {
        return (
            <CellContentPopover content={popoverContent}>
                <div ref={ref} className={CONTAINER_CLASS} style={widthStyle}>
                    <div className="flex w-full flex-col gap-2">{chatNodes}</div>
                </div>
            </CellContentPopover>
        )
    }

    // Render JSON objects/arrays using the JSON editor
    if (isJson) {
        return (
            <CellContentPopover content={popoverContent}>
                <div ref={ref} className={CONTAINER_CLASS} style={widthStyle}>
                    <JsonContent value={jsonValue} />
                </div>
            </CellContentPopover>
        )
    }

    return (
        <CellContentPopover content={popoverContent}>
            <div ref={ref} className={CONTAINER_CLASS} style={widthStyle}>
                <span className="scenario-table-text whitespace-pre-wrap">{displayValue}</span>
            </div>
        </CellContentPopover>
    )
}

export default memo(PreviewEvaluationInputCell)
