import {useStore} from "jotai"

import {evaluationRunQueryAtomFamily} from "@/oss/components/EvalRunDetails2/atoms/table/run"
import {previewRunSummaryAtomFamily} from "@/oss/components/EvaluationRunsTablePOC/atoms/runSummaries"

import {logExportAction} from "./helpers"

export const getPreviewRunSummaryFromStore = (
    store: ReturnType<typeof useStore>,
    projectId: string | null,
    runId: string | null,
) => {
    if (!projectId || !runId) return null
    try {
        const summaryAtom = previewRunSummaryAtomFamily({projectId, runId})
        const summaryResult = store.get(summaryAtom) as any
        const summary = summaryResult?.data ?? summaryResult ?? null
        if (summary) {
            logExportAction("loaded run summary for export", {projectId, runId})
        } else {
            logExportAction("run summary unavailable for export", {projectId, runId})
        }
        return summary
    } catch (error) {
        logExportAction("run summary fetch failed for export", {projectId, runId, error})
        return null
    }
}

export const getCamelRunFromStore = (store: ReturnType<typeof useStore>, runId: string | null) => {
    if (!runId) return null
    try {
        const runAtom = evaluationRunQueryAtomFamily(runId)
        const runResult = store.get(runAtom) as any
        const data = runResult?.data ?? runResult ?? null
        const camelRun = data?.camelRun ?? data?.rawRun ?? null
        if (camelRun) {
            logExportAction("loaded camel run for export", {runId})
        } else {
            logExportAction("camel run missing for export", {runId})
        }
        return camelRun
    } catch (error) {
        logExportAction("camel run fetch failed for export", {runId, error})
        return null
    }
}
