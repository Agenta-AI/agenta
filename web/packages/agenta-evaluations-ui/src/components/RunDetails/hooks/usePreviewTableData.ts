import {useMemo} from "react"

import {
    evaluationEvaluatorsByRunQueryAtomFamily,
    evaluationRunQueryAtomFamily,
    tableColumnsAtomFamily,
} from "@agenta/evaluations/state/evalRun"
import type {EvaluationTableColumnsResult} from "@agenta/evaluations/state/evalRun"
import {useAtomValue} from "jotai"

export interface PreviewTableData {
    columnResult?: EvaluationTableColumnsResult
    // The expression below short-circuits to `undefined` when `runQuery.data` is absent, so
    // the runtime value is `boolean | undefined` (used only in boolean position by consumers).
    // Typed to match actual behavior rather than coercing the value.
    columnsPending: boolean | undefined
}

export const usePreviewTableData = ({runId}: {runId: string | undefined}): PreviewTableData => {
    const safeRunId = runId ?? null
    const columnsAtom = useMemo(() => tableColumnsAtomFamily(safeRunId as string), [safeRunId])

    const columnsResult = useAtomValue(columnsAtom)
    const runQuery = useAtomValue(
        useMemo(() => evaluationRunQueryAtomFamily(safeRunId), [safeRunId]),
    )
    const evaluatorQuery = useAtomValue(
        useMemo(() => evaluationEvaluatorsByRunQueryAtomFamily(safeRunId), [safeRunId]),
    )

    return {
        columnResult: columnsResult,
        columnsPending:
            (runQuery.isPending && !runQuery.data) ||
            (runQuery.data && evaluatorQuery.isPending && !evaluatorQuery.data),
    }
}

export default usePreviewTableData
