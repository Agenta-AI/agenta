import {useEffect, useMemo} from "react"

import {atom} from "jotai"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {evaluatorReferenceAtomFamily} from "@/oss/components/References/atoms/entityReferences"
import type {EvaluatorReference} from "@/oss/components/References/atoms/entityReferences"

import {getCachedEvaluatorReference, setCachedEvaluatorReference} from "../cache/referenceCache"

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

    // Check cache first for instant display when scrolling back into view
    const cachedReference =
        enabled && projectId && (evaluatorSlug || evaluatorId)
            ? getCachedEvaluatorReference(projectId, evaluatorSlug, evaluatorId)
            : undefined

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
    const queryReference =
        enabled && projectId && (evaluatorSlug || evaluatorId)
            ? ((queryResult?.data as EvaluatorReference | null) ?? null)
            : null

    // Update cache when we get new data
    useEffect(() => {
        if (!enabled || !projectId || (!evaluatorSlug && !evaluatorId) || !queryReference) return
        setCachedEvaluatorReference(projectId, evaluatorSlug, evaluatorId, queryReference)
    }, [enabled, projectId, evaluatorSlug, evaluatorId, queryReference])

    // Return cached value if query is still loading
    const reference = queryReference ?? cachedReference ?? null

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
