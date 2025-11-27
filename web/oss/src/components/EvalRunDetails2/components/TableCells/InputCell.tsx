import {memo, useMemo} from "react"

import type {EvaluationTableColumn} from "../../atoms/table"
import {COLUMN_WIDTHS} from "../../constants/table"
import useScenarioCellValue from "../../hooks/useScenarioCellValue"
import {renderScenarioChatMessages} from "../../utils/chatMessages"

interface PreviewEvaluationInputCellProps {
    scenarioId?: string
    runId?: string
    column: EvaluationTableColumn
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

const resolveColumnWidth = (column: EvaluationTableColumn): number => {
    if (typeof column.width === "number") return column.width
    if (typeof column.minWidth === "number") return column.minWidth
    if (column.stepType === "invocation" || column.stepType === "output") {
        return COLUMN_WIDTHS.response
    }
    if (column.stepType === "annotation" || column.stepType === "metric") {
        return COLUMN_WIDTHS.metric
    }
    return COLUMN_WIDTHS.input
}

const PreviewEvaluationInputCell = ({
    scenarioId,
    runId,
    column,
}: PreviewEvaluationInputCellProps) => {
    const {ref, selection, showSkeleton} = useScenarioCellValue({scenarioId, runId, column})
    const {value} = selection

    const widthStyle = {width: "100%"}
    const chatNodes = useMemo(
        () =>
            renderScenarioChatMessages(
                value,
                `${scenarioId ?? "scenario"}-${column.id ?? column.path ?? "input"}`,
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

    if (chatNodes && chatNodes.length) {
        return (
            <div ref={ref} className={CONTAINER_CLASS} style={widthStyle}>
                <div className="flex w-full flex-col gap-2">{chatNodes}</div>
            </div>
        )
    }

    const displayValue = normalizeValue(value)

    return (
        <div ref={ref} className={CONTAINER_CLASS} style={widthStyle}>
            <span className="scenario-table-text whitespace-pre-wrap">{displayValue}</span>
        </div>
    )
}

export default memo(PreviewEvaluationInputCell)
