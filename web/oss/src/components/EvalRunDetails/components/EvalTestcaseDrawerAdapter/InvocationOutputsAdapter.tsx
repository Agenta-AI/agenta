import type {ReactNode} from "react"
import {memo, useMemo} from "react"

import {TestcaseDataEditor, type TestcaseDataEditorColumn} from "@agenta/entity-ui/testcase"
import {Skeleton, Typography} from "antd"

import type {EvaluationTableColumn} from "../../atoms/table"
import useScenarioCellValue from "../../hooks/useScenarioCellValue"

import type {EvalDrawerOutputSection} from "./model"

const {Text} = Typography

const toEditorColumn = (column: EvaluationTableColumn): TestcaseDataEditorColumn => {
    const key = column.valueKey || column.path || column.id
    const label = column.displayLabel ?? column.label ?? key

    return {
        key,
        label,
        name: label,
        pathMode: "direct",
    }
}

const OutputErrorBlock = ({
    label,
    message,
    stacktrace,
}: {
    label: string
    message: string
    stacktrace?: string
}) => (
    <div className="flex flex-col gap-1 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">
        <Text className="text-xs font-medium text-red-600">{label}</Text>
        <span className="whitespace-pre-wrap break-words">{message}</span>
        {stacktrace ? (
            <span className="mt-1 border-t border-solid border-red-200 pt-2 text-red-500/80 whitespace-pre-wrap break-words">
                {stacktrace}
            </span>
        ) : null}
    </div>
)

const OutputColumnValue = memo(
    ({
        runId,
        scenarioId,
        column,
    }: {
        runId: string
        scenarioId: string
        column: EvaluationTableColumn
    }) => {
        const {selection, showSkeleton} = useScenarioCellValue({
            runId,
            scenarioId,
            column,
            disableVisibilityTracking: true,
        })
        const editorColumn = useMemo(() => toEditorColumn(column), [column])
        const label = editorColumn.label ?? editorColumn.name ?? editorColumn.key

        if (selection.stepError) {
            return (
                <OutputErrorBlock
                    label={label}
                    message={selection.stepError.message}
                    stacktrace={selection.stepError.stacktrace}
                />
            )
        }

        if (showSkeleton) {
            return (
                <div className="px-4 py-3">
                    <Skeleton active paragraph={{rows: 1}} title={false} />
                </div>
            )
        }

        return (
            <TestcaseDataEditor
                value={{[editorColumn.key]: selection.displayValue ?? selection.value ?? ""}}
                columns={[editorColumn]}
                mode="view"
                surface="drawer"
                features={{
                    typeChips: true,
                    rootViewMode: false,
                    columnMapping: false,
                }}
            />
        )
    },
)

OutputColumnValue.displayName = "OutputColumnValue"

const InvocationOutputsAdapter = ({
    runId,
    scenarioId,
    sections,
    renderHeaderSlot,
}: {
    runId: string
    scenarioId: string
    sections: EvalDrawerOutputSection[]
    renderHeaderSlot?: (section: EvalDrawerOutputSection) => ReactNode
}) => {
    if (!sections.length) return null

    return (
        <div className="flex flex-col">
            {sections.map((section) => (
                <div
                    key={section.id}
                    className="flex flex-col border-t border-solid border-[#0517290F]"
                >
                    <div className="flex min-h-9 min-w-0 items-center justify-between gap-3 border-b border-solid border-[#0517290F] bg-[#fafafa] px-4 py-1.5">
                        <span className="truncate text-[13px] font-semibold text-[#051729]">
                            {section.label || "Outputs"}
                        </span>
                        {renderHeaderSlot?.(section)}
                    </div>
                    <div className="flex flex-col">
                        {section.columns.map((column) => (
                            <OutputColumnValue
                                key={column.id}
                                runId={runId}
                                scenarioId={scenarioId}
                                column={column}
                            />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    )
}

export default memo(InvocationOutputsAdapter)
