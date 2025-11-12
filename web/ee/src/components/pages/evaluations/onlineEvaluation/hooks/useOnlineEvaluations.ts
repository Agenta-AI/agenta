import {useEffect, useMemo, useState} from "react"

import {EvaluationType} from "@/oss/lib/enums"

import type {EvaluationRow} from "@/oss/components/HumanEvaluations/types"
import usePreviewEvaluations from "../../../../../lib/hooks/usePreviewEvaluations"
import deepEqual from "fast-deep-equal"

interface UseOnlineEvaluationsOptions {
    appId?: string
    scope?: "app" | "project"
}
const useOnlineEvaluations = ({appId, scope}: UseOnlineEvaluationsOptions = {}) => {
    const appFilter = scope === "app" ? (appId ?? null) : null
    const {swrData, runs} = usePreviewEvaluations({
        types: [EvaluationType.online],
        appId: appFilter,
    })
    // Enrichment is handled within usePreviewEvaluations

    const sortedRuns = useMemo<EvaluationRow[] | undefined>(() => {
        // Primary: use enriched runs from runs/query
        const primary = runs || []
        if (primary.length > 0) {
            return [...primary].sort(
                (a: any, b: any) => (b?.createdAtTimestamp ?? 0) - (a?.createdAtTimestamp ?? 0),
            ) as EvaluationRow[]
        }
        return undefined
    }, [runs])

    const [resolvedEvaluations, setResolvedEvaluations] = useState<EvaluationRow[]>([])
    const [hasResolvedInitial, setHasResolvedInitial] = useState(false)

    useEffect(() => {
        if (sortedRuns && sortedRuns.length && !deepEqual(sortedRuns, resolvedEvaluations)) {
            setResolvedEvaluations(sortedRuns)
            setHasResolvedInitial(true)
            return
        }

        if (
            !swrData.isLoading &&
            !swrData.isPending &&
            !deepEqual(sortedRuns, resolvedEvaluations)
        ) {
            setResolvedEvaluations((prev) => {
                if (prev.length === 0) return prev
                return []
            })
            setHasResolvedInitial(true)
        }
    }, [sortedRuns, swrData.isLoading, swrData.isPending])

    return {
        evaluations: sortedRuns ?? resolvedEvaluations,
        isLoading: !hasResolvedInitial,
        isValidating: !hasResolvedInitial && swrData.isPending,
        mutate: async () => {
            await swrData.mutate()
        },
    }
}

export default useOnlineEvaluations
