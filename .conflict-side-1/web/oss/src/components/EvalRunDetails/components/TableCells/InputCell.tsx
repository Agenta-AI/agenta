import {memo, useMemo} from "react"

import {
    CellContentPopover,
    ChatMessagesCellContent,
    JsonCellContent,
    TextCellContent,
    extractChatMessages,
    normalizeValue,
    safeJsonStringify,
    tryParseJson,
} from "@agenta/ui/cell-renderers"
import {useAtomValue} from "jotai"

import type {EvaluationTableColumn} from "../../atoms/table"
import useScenarioCellValue from "../../hooks/useScenarioCellValue"
import {scenarioRowHeightAtom, type ScenarioRowHeight} from "../../state/rowHeight"

// Max lines for JSON/text content (fills most of the cell)
// Small (80px - 16px padding) / ~14px line height ≈ 4 lines
// Medium (160px - 24px padding) / ~14px line height ≈ 9 lines
// Large (280px - 24px padding) / ~14px line height ≈ 18 lines
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

const CONTAINER_CLASS = "scenario-table-cell"

const PreviewEvaluationInputCell = ({
    scenarioId,
    runId,
    column,
}: PreviewEvaluationInputCellProps) => {
    const rowHeight = useAtomValue(scenarioRowHeightAtom)
    const {ref, selection, showSkeleton} = useScenarioCellValue({scenarioId, runId, column})
    const {value: rawValue} = selection

    // Get limits based on row height
    const maxLines = MAX_LINES_BY_HEIGHT[rowHeight]
    const maxChatTotalLines = MAX_CHAT_LINES_BY_HEIGHT[rowHeight]
    const maxLinesPerMessage = MAX_LINES_PER_MESSAGE_BY_HEIGHT[rowHeight]

    // Unwrap redundant "inputs" wrapper from online evaluations
    const value = useMemo(() => unwrapInputsWrapper(rawValue), [rawValue])

    // Try to parse JSON strings - must be before any early returns
    const {parsed: jsonValue, isJson} = useMemo(() => tryParseJson(value), [value])

    // Check for chat messages
    const chatMessages = useMemo(() => extractChatMessages(jsonValue), [jsonValue])
    const isChatMessages = chatMessages !== null && chatMessages.length > 0

    // Compute display value and copy text before early returns (React hooks rule)
    const displayValue = useMemo(() => normalizeValue(value), [value])
    const copyText = useMemo(() => {
        if (value === undefined || value === null) return undefined
        if (isChatMessages || isJson) return safeJsonStringify(jsonValue)
        return displayValue
    }, [value, isChatMessages, isJson, jsonValue, displayValue])

    const keyPrefix = `${scenarioId ?? "scenario"}-${column.id ?? column.path ?? "input"}`
    const widthStyle = {width: "100%"}

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
                <div ref={ref} className={CONTAINER_CLASS} style={widthStyle}>
                    <ChatMessagesCellContent
                        value={jsonValue}
                        keyPrefix={keyPrefix}
                        maxLines={maxLinesPerMessage}
                        maxTotalLines={maxChatTotalLines}
                        truncate
                    />
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
                <div ref={ref} className={CONTAINER_CLASS} style={widthStyle}>
                    <JsonCellContent value={jsonValue} maxLines={maxLines} />
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
            <div ref={ref} className={CONTAINER_CLASS} style={widthStyle}>
                <TextCellContent value={displayValue} maxLines={maxLines} />
            </div>
        </CellContentPopover>
    )
}

export default memo(PreviewEvaluationInputCell)
