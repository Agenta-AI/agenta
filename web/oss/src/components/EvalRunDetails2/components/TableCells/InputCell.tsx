import {memo} from "react"

import type {EvaluationTableColumn} from "../../atoms/table"
import {COLUMN_WIDTHS} from "../../constants/table"
import useScenarioCellValue from "../../hooks/useScenarioCellValue"

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

const CONTAINER_CLASS = "min-h-[100px] flex flex-col justify-center"

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

    const width = resolveColumnWidth(column)
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
                <span className="text-xs text-neutral-500">—</span>
            </div>
        )
    }

    const displayValue = normalizeValue(value)

    return (
        <div ref={ref} className={CONTAINER_CLASS} style={widthStyle}>
            <span className="text-xs text-neutral-800 whitespace-pre-wrap">{displayValue}</span>
        </div>
    )
}

export default memo(PreviewEvaluationInputCell)
