import {useMemo} from "react"

import {atom} from "jotai"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {getColumnViewportVisibilityAtom} from "@/oss/components/InfiniteVirtualTable/atoms/columnVisibility"

import {evaluatorReferenceAtomFamily} from "@/oss/components/References/atoms/entityReferences"
import type {EvaluatorReference} from "@/oss/components/References/atoms/entityReferences"
import {evaluationRunsColumnVisibilityContextAtom} from "../atoms/view"

const nullEvaluatorAtom = atom(null)
const alwaysTrueAtom = atom(true)

const evaluatorReferenceCache = new Map<string, EvaluatorReference | null>()

export interface UseEvaluatorHeaderReferenceArgs {
    evaluatorSlug?: string | null
    evaluatorId?: string | null
    columnKey?: string | null
    enabled?: boolean
    projectIdOverride?: string | null
}

export const useEvaluatorHeaderReference = ({
    evaluatorSlug,
    evaluatorId,
    columnKey,
    enabled = true,
    projectIdOverride,
}: UseEvaluatorHeaderReferenceArgs) => {
    const columnContext = useAtomValueWithSchedule(evaluationRunsColumnVisibilityContextAtom, {
        priority: LOW_PRIORITY,
    })

    const effectiveProjectId = projectIdOverride ?? columnContext.projectId ?? null

    const viewportAtom = useMemo(() => {
        if (!columnKey || !columnContext.scopeId) {
            return alwaysTrueAtom
        }
        return getColumnViewportVisibilityAtom(columnContext.scopeId, columnKey)
    }, [columnContext.scopeId, columnKey])

    const isViewportVisible = useAtomValueWithSchedule(viewportAtom, {
        priority: LOW_PRIORITY,
    })

    const identityKey = useMemo(() => {
        const projectPart = effectiveProjectId ?? "none"
        const slugPart = evaluatorSlug ?? "none"
        const idPart = evaluatorId ?? "none"
        return `${projectPart}:${slugPart}:${idPart}`
    }, [effectiveProjectId, evaluatorId, evaluatorSlug])

    const evaluatorAtom = useMemo(() => {
        if (
            !enabled ||
            !effectiveProjectId ||
            !isViewportVisible ||
            (!evaluatorSlug && !evaluatorId)
        ) {
            return nullEvaluatorAtom
        }
        return evaluatorReferenceAtomFamily({
            projectId: effectiveProjectId,
            slug: evaluatorSlug ?? undefined,
            id: evaluatorId ?? undefined,
        })
    }, [enabled, effectiveProjectId, evaluatorId, evaluatorSlug, isViewportVisible])

    const evaluatorQueryResult = useAtomValueWithSchedule(evaluatorAtom, {priority: LOW_PRIORITY})

    const evaluatorReference = useMemo(() => {
        if (evaluatorQueryResult?.data) {
            evaluatorReferenceCache.set(identityKey, evaluatorQueryResult.data)
            return evaluatorQueryResult.data
        }
        return evaluatorReferenceCache.get(identityKey) ?? null
    }, [identityKey, evaluatorQueryResult?.data])

    return {
        columnContext,
        evaluatorReference,
        isViewportVisible,
    }
}
