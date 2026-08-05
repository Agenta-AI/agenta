import {useMemo} from "react"

import type {EvaluatorPreviewDto} from "@/oss/services/evaluations/api/evaluatorTypes"

import {EVALUATOR_CATEGORY_LABEL_MAP} from "../constants"
import type {EvaluatorDetails} from "../types"

export interface UseEvaluatorTypeMetaParams {
    details: EvaluatorDetails
    evaluatorRef?: {id?: string; slug?: string} | null
    matchedPreviewEvaluator?: EvaluatorPreviewDto | null
    enrichedRun?: {evaluators?: {slug?: string; name?: string}[]} | null
    selectedEvaluatorConfig?: unknown | null
}

export const useEvaluatorTypeMeta = ({details}: UseEvaluatorTypeMetaParams) => {
    const typeSlug = useMemo(() => details.typeSlug, [details.typeSlug])

    const typeLabel = useMemo(() => {
        if (details.typeLabel) return details.typeLabel
        if (typeSlug) {
            const key = String(typeSlug).toLowerCase()
            const mapped = (EVALUATOR_CATEGORY_LABEL_MAP as any)[key]
            if (mapped) return mapped as string
            const pretty = String(typeSlug).replace(/_/g, " ")
            if (pretty) return pretty.charAt(0).toUpperCase() + pretty.slice(1)
        }
        return undefined
    }, [details.typeLabel, typeSlug])

    const showType = Boolean(typeLabel)

    return {typeLabel, typeKey: details.typeKey ?? typeSlug, showType}
}
