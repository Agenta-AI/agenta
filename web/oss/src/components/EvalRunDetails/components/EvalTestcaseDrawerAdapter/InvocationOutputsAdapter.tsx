import {useMemo} from "react"

import type {RootDrawerViewMode, TestcaseDataEditorColumn} from "@agenta/entity-ui/testcase"
import {atom, useAtomValue} from "jotai"

import {
    buildColumnValueConfig,
    scenarioColumnValueSelectionAtomFamily,
} from "../../atoms/scenarioColumnValues"
import type {EvaluationTableColumn} from "../../atoms/table"

import EvalDrawerDataSection from "./EvalDrawerDataSection"
import type {EvalDrawerOutputSection} from "./model"

interface InvocationOutputsAdapterProps {
    runId: string
    scenarioId: string
    sections: EvalDrawerOutputSection[]
    rootViewMode?: RootDrawerViewMode
    collapseSignal?: number
}

const toEditorColumn = (
    section: EvalDrawerOutputSection,
    column: EvaluationTableColumn,
): TestcaseDataEditorColumn => {
    const key = `${section.id}:${column.id}`
    const label = column.displayLabel ?? column.label ?? column.valueKey ?? column.path ?? column.id

    return {
        key,
        label,
        name: label,
        pathMode: "direct",
    }
}

export function useInvocationOutputDrawerData({
    runId,
    scenarioId,
    sections,
}: Pick<InvocationOutputsAdapterProps, "runId" | "scenarioId" | "sections">) {
    const editorColumns = useMemo(
        () =>
            sections.flatMap((section) =>
                section.columns.map((column) => toEditorColumn(section, column)),
            ),
        [sections],
    )

    const valueAtom = useMemo(
        () =>
            atom((get) =>
                sections.reduce<Record<string, unknown>>((acc, section) => {
                    for (const column of section.columns) {
                        const editorKey = `${section.id}:${column.id}`
                        const selection = get(
                            scenarioColumnValueSelectionAtomFamily({
                                scenarioId,
                                runId,
                                column: buildColumnValueConfig(column, {enabled: true}),
                            }),
                        )

                        acc[editorKey] = selection.stepError
                            ? (selection.stepError.raw ?? selection.stepError.message)
                            : (selection.displayValue ?? selection.value ?? "")
                    }
                    return acc
                }, {}),
            ),
        [runId, scenarioId, sections],
    )
    const value = useAtomValue(valueAtom)

    return {columns: editorColumns, value}
}

const InvocationOutputsAdapter = ({
    runId,
    scenarioId,
    sections,
    rootViewMode,
    collapseSignal,
}: InvocationOutputsAdapterProps) => {
    const {columns, value} = useInvocationOutputDrawerData({runId, scenarioId, sections})

    if (!columns.length) return null

    return (
        <EvalDrawerDataSection
            title="Outputs"
            value={value}
            columns={columns}
            rootViewMode={rootViewMode}
            collapseSignal={collapseSignal}
        />
    )
}

export default InvocationOutputsAdapter
