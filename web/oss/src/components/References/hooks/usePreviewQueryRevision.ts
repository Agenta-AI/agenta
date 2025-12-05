import {useMemo} from "react"

import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {
    evaluationQueryRevisionAtomFamily,
    type EvaluationQueryConfigurationResult,
} from "@/oss/components/EvalRunDetails2/atoms/query"

export const usePreviewQueryRevision = (
    {runId}: {runId: string | null | undefined},
    options?: {enabled?: boolean},
) => {
    const resolvedEnabled = options?.enabled ?? true
    const enabled = Boolean(resolvedEnabled && runId)
    const targetRunId = enabled ? (runId ?? null) : null
    const queryAtom = useMemo(() => evaluationQueryRevisionAtomFamily(targetRunId), [targetRunId])

    const queryState = useAtomValueWithSchedule(queryAtom, {
        priority: LOW_PRIORITY,
    })
    const rawData = enabled
        ? (queryState?.data as EvaluationQueryConfigurationResult | undefined)
        : undefined
    const result = rawData ?? null
    const hasResult = Boolean(result)
    const reference = result?.reference ?? {}
    const revision = result?.revision ?? null
    const isLoading =
        enabled &&
        !hasResult &&
        Boolean(queryState?.isLoading || queryState?.isFetching || queryState?.isPending)
    const error = enabled ? (queryState?.error ?? null) : null

    return {reference, revision, isLoading, error}
}

export default usePreviewQueryRevision
