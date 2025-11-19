import usePreviewRunDetails from "../hooks/usePreviewRunDetails"
import usePreviewRunSummary from "../hooks/usePreviewRunSummary"
import type {EvaluationRunTableRow} from "../types"
import {buildReferenceSequence} from "../utils/referenceSchema"

export const useRunRowSummary = (record?: EvaluationRunTableRow, isVisible = true) => {
    const runId = record?.preview?.id ?? record?.runId ?? null
    const projectId = record?.projectId ?? null
    const enabled = Boolean(record && !record.__isSkeleton && runId && projectId && isVisible)
    const {summary, isLoading, testsetNames, stepReferences} = usePreviewRunSummary(
        {projectId, runId},
        {enabled},
    )

    return {summary, isLoading, testsetNames, stepReferences}
}

export const useRunRowDetails = (record?: EvaluationRunTableRow, _isVisible = true) => {
    const runId = record?.preview?.id ?? record?.runId ?? null
    const enabled = Boolean(record && !record.__isSkeleton && runId)
    const {camelRun, runIndex, status, isLoading} = usePreviewRunDetails(runId, {enabled})

    return {camelRun, runIndex, status, isLoading}
}

export const useRunRowReferences = (record?: EvaluationRunTableRow) => {
    return buildReferenceSequence(record?.previewMeta ?? null)
}
