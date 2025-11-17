import {useMemo} from "react"

import {atom, useAtomValue} from "jotai"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {previewRunSummaryAtomFamily, type PreviewRunSummary} from "../atoms/runSummaries"

const defaultPreviewSummaryQueryAtom = atom(() => ({
    data: null as PreviewRunSummary | null,
    isLoading: false,
    isFetching: false,
    isPending: false,
}))

interface UsePreviewRunSummaryOptions {
    enabled?: boolean
}

export const usePreviewRunSummary = (
    {
        projectId,
        runId,
    }: {
        projectId: string | null
        runId: string | null
    },
    options?: UsePreviewRunSummaryOptions,
) => {
    const enabled = options?.enabled ?? true
    const summaryAtom = useMemo(() => {
        if (!enabled || !projectId || !runId) return defaultPreviewSummaryQueryAtom
        return previewRunSummaryAtomFamily({projectId, runId})
    }, [enabled, projectId, runId])

    const summaryQuery = useAtomValue(summaryAtom)
    // useAtomValueWithSchedule(summaryAtom, {priority: LOW_PRIORITY})
    const summary = enabled && projectId && runId ? (summaryQuery?.data ?? null) : null
    const hasSummary = Boolean(summary)
    const isLoading = Boolean(
        enabled &&
            projectId &&
            runId &&
            !hasSummary &&
            (summaryQuery?.isLoading || summaryQuery?.isFetching || summaryQuery?.isPending),
    )

    const stepReferences = summary?.stepReferences as Record<string, unknown> | undefined
    const testsetNames = summary?.testsetNames as Record<string, string | null> | undefined

    return {summary, testsetNames, stepReferences, isLoading}
}

export default usePreviewRunSummary
