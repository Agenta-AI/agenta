import {useMemo} from "react"

import {atom} from "jotai"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {evaluatorReferenceAtomFamily} from "@/oss/components/References/atoms/entityReferences"
import type {EvaluatorReference} from "@/oss/components/References/atoms/entityReferences"

const idleEvaluatorReferenceAtom = atom(() => ({
    data: null as EvaluatorReference | null,
    isLoading: false,
    isFetching: false,
    isPending: false,
}))

interface UseEvaluatorReferenceParams {
    projectId: string | null
    evaluatorSlug?: string | null
    evaluatorId?: string | null
}

interface UseEvaluatorReferenceOptions {
    enabled?: boolean
}

const useEvaluatorReference = (
    {projectId, evaluatorSlug, evaluatorId}: UseEvaluatorReferenceParams,
    options?: UseEvaluatorReferenceOptions,
) => {
    const enabled = options?.enabled ?? true

    const referenceAtom = useMemo(() => {
        if (!enabled || !projectId || (!evaluatorSlug && !evaluatorId)) {
            return idleEvaluatorReferenceAtom
        }
        return evaluatorReferenceAtomFamily({
            projectId,
            slug: evaluatorSlug ?? undefined,
            id: evaluatorId ?? undefined,
        })
    }, [enabled, evaluatorId, evaluatorSlug, projectId])

    const queryResult = useAtomValueWithSchedule(referenceAtom, {priority: LOW_PRIORITY})
    const reference =
        enabled && projectId && (evaluatorSlug || evaluatorId)
            ? ((queryResult?.data as EvaluatorReference | null) ?? null)
            : null

    const isLoading = Boolean(
        enabled &&
            projectId &&
            (evaluatorSlug || evaluatorId) &&
            !reference &&
            (queryResult?.isLoading || queryResult?.isFetching || queryResult?.isPending),
    )

    return {reference, isLoading}
}

export default useEvaluatorReference
