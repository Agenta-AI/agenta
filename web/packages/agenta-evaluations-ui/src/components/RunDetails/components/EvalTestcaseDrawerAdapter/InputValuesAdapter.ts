import {useMemo} from "react"

import {
    buildColumnValueConfig,
    scenarioColumnValueSelectionAtomFamily,
} from "@agenta/evaluations/state/evalRun"
import type {EvaluationTableColumn} from "@agenta/evaluations/state/evalRun"
import {atom, useAtomValue} from "jotai"

import {mapEvalInputColumns} from "./model"

export const useEvalInputDrawerData = ({
    runId,
    scenarioId,
    columns,
}: {
    runId: string
    scenarioId: string
    columns: EvaluationTableColumn[]
}) => {
    const editorColumns = useMemo(() => mapEvalInputColumns(columns), [columns])
    const valueAtom = useMemo(
        () =>
            atom((get) =>
                columns.reduce<Record<string, unknown>>((acc, column) => {
                    const editorKey = column.valueKey || column.path || column.id
                    const selection = get(
                        scenarioColumnValueSelectionAtomFamily({
                            scenarioId,
                            runId,
                            column: buildColumnValueConfig(column, {enabled: true}),
                        }),
                    )
                    acc[editorKey] = selection.displayValue ?? selection.value ?? ""
                    return acc
                }, {}),
            ),
        [columns, runId, scenarioId],
    )
    const value = useAtomValue(valueAtom)

    return {columns: editorColumns, value}
}
