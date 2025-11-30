import {useMemo} from "react"

import {useAtomValue} from "jotai"

import {
    evaluationEvaluatorsByRunQueryAtomFamily,
    evaluationRunQueryAtomFamily,
    tableColumnsAtomFamily,
} from "../atoms/table"
import type {EvaluationTableColumnsResult} from "../atoms/table"

export interface PreviewTableData {
    columnResult?: EvaluationTableColumnsResult
    columnsPending: boolean
}

export const usePreviewTableData = ({runId}: {runId: string}): PreviewTableData => {
    const columnsAtom = useMemo(() => tableColumnsAtomFamily(runId), [runId])

    const columnsResult = useAtomValue(columnsAtom)
    const runQuery = useAtomValue(useMemo(() => evaluationRunQueryAtomFamily(runId), [runId]))
    const evaluatorQuery = useAtomValue(
        useMemo(() => evaluationEvaluatorsByRunQueryAtomFamily(runId), [runId]),
    )

    return {
        columnResult: columnsResult,
        columnsPending:
            (runQuery.isPending && !runQuery.data) ||
            (runQuery.data && evaluatorQuery.isPending && !evaluatorQuery.data),
    }
}

export default usePreviewTableData
