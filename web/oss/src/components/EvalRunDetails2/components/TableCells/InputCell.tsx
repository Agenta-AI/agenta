import {memo, useMemo} from "react"

import type {EvaluationTableColumn} from "../../atoms/table"
import useScenarioCellValue from "../../hooks/useScenarioCellValue"
import {renderScenarioChatMessages} from "../../utils/chatMessages"

import CellContentPopover from "./CellContentPopover"

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
 * Convert a key to a human-friendly label (e.g., "country" -> "Country", "user_name" -> "User Name")
 */
const humanizeKey = (key: string): string => {
    return key
        .replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase -> camel Case
        .replace(/[_-]/g, " ") // snake_case/kebab-case -> spaces
        .replace(/\b\w/g, (char) => char.toUpperCase()) // Capitalize first letter of each word
}

/**
 * Check if value is a simple flat object (no nested objects/arrays)
 */
const isSimpleFlatObject = (value: unknown): value is Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    const entries = Object.entries(value as Record<string, unknown>)
    return entries.every(
        ([, v]) =>
            v === null ||
            v === undefined ||
            typeof v === "string" ||
            typeof v === "number" ||
            typeof v === "boolean",
    )
}

/**
 * Render a flat object as human-friendly key-value pairs
 */
const renderKeyValuePairs = (obj: Record<string, unknown>): React.ReactNode => {
    const entries = Object.entries(obj)
    return (
        <div className="flex flex-col gap-1">
            {entries.map(([key, val]) => (
                <div key={key} className="flex flex-wrap gap-1">
                    <span className="font-medium text-neutral-600">{humanizeKey(key)}:</span>
                    <span className="text-neutral-900">
                        {val === null || val === undefined ? "—" : String(val)}
                    </span>
                </div>
            ))}
        </div>
    )
}

const normalizeValue = (value: unknown): string => {
    if (value === null || value === undefined) return "—"
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value)
    }
    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
}

const CONTAINER_CLASS = "scenario-table-cell min-h-[96px]"

const PreviewEvaluationInputCell = ({
    scenarioId,
    runId,
    column,
}: PreviewEvaluationInputCellProps) => {
    const {ref, selection, showSkeleton} = useScenarioCellValue({scenarioId, runId, column})
    const {value: rawValue} = selection

    // Unwrap redundant "inputs" wrapper from online evaluations
    const value = useMemo(() => unwrapInputsWrapper(rawValue), [rawValue])

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

    // Render flat objects as human-friendly key-value pairs
    if (isSimpleFlatObject(value)) {
        return (
            <CellContentPopover content={popoverContent}>
                <div ref={ref} className={CONTAINER_CLASS} style={widthStyle}>
                    {renderKeyValuePairs(value)}
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
