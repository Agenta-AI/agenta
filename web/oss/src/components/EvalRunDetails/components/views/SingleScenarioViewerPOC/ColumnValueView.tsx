import {memo, useMemo} from "react"

import {ExclamationCircleOutlined} from "@ant-design/icons"
import {Typography} from "antd"

import type {EvaluationTableColumn} from "../../../atoms/table"
import useScenarioCellValue from "../../../hooks/useScenarioCellValue"
import {renderScenarioChatMessages} from "../../../utils/chatMessages"

interface ColumnValueViewProps {
    column: EvaluationTableColumn
    scenarioId: string | null
    runId: string
}

const ColumnValueView = ({column, scenarioId, runId}: ColumnValueViewProps) => {
    const {selection, showSkeleton} = useScenarioCellValue({
        scenarioId: scenarioId ?? undefined,
        runId,
        column,
        disableVisibilityTracking: true,
    })
    const {value, displayValue, stepError} = selection

    const chatNodes = useMemo(
        () =>
            renderScenarioChatMessages(
                value,
                `${scenarioId ?? "scenario"}-${column.id ?? column.path ?? "col"}`,
            ),
        [scenarioId, column.id, column.path, value],
    )

    if (showSkeleton) {
        return <Typography.Text type="secondary">Loading…</Typography.Text>
    }

    // Display step error if present (e.g., invocation failure)
    if (stepError) {
        return (
            <div className="flex flex-col gap-1 text-red-500">
                <div className="flex items-center gap-1">
                    <ExclamationCircleOutlined />
                    <span className="font-medium">Error</span>
                </div>
                <Typography.Text type="danger">{stepError.message}</Typography.Text>
            </div>
        )
    }

    const resolved = (displayValue ?? value) as any
    if (resolved === null || typeof resolved === "undefined") {
        return <Typography.Text type="secondary">—</Typography.Text>
    }

    if (chatNodes && chatNodes.length) {
        return <div className="flex w-full flex-col gap-2">{chatNodes}</div>
    }

    if (
        typeof resolved === "string" ||
        typeof resolved === "number" ||
        typeof resolved === "boolean"
    ) {
        return <Typography.Text>{String(resolved)}</Typography.Text>
    }

    return (
        <pre className="whitespace-pre-wrap break-words bg-[#F8FAFC] rounded-lg p-3 max-h-80 overflow-auto border border-[#EAECF0]">
            {JSON.stringify(resolved, null, 2)}
        </pre>
    )
}

export default memo(ColumnValueView)
