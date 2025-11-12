import {useMemo} from "react"

import {getColorPairFromStr} from "@/oss/lib/helpers/colors"
import type {EvaluatorPreviewDto} from "@/oss/lib/hooks/useEvaluators/types"

import {EVALUATOR_CATEGORY_LABEL_MAP} from "../constants"
import type {EvaluatorDetails} from "../types"

export interface UseEvaluatorTypeMetaParams {
    details: EvaluatorDetails
    evaluatorRef?: {id?: string; slug?: string} | null
    matchedPreviewEvaluator?: EvaluatorPreviewDto | null
    enrichedRun?: {evaluators?: {slug?: string; name?: string}[]} | null
    selectedEvaluatorConfig?: {color?: string} | null
}

export const useEvaluatorTypeMeta = ({
    details,
    evaluatorRef,
    matchedPreviewEvaluator,
    enrichedRun,
    selectedEvaluatorConfig,
}: UseEvaluatorTypeMetaParams) => {
    const typeSlug = useMemo(() => details.typeSlug, [details.typeSlug])

    const typeColor = useMemo(() => {
        return (
            (selectedEvaluatorConfig as any)?.color ??
            (typeof details.typeColor === "string" ? (details.typeColor as string) : undefined)
        )
    }, [selectedEvaluatorConfig, details.typeColor])

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

    const fallbackColors = useMemo(() => {
        if (typeColor) return undefined
        return details.typeSlug ? getColorPairFromStr(String(details.typeSlug)) : undefined
    }, [details.typeSlug, typeColor])

    const showType = Boolean(typeLabel)

    return {typeLabel, typeColor, fallbackColors, showType}
}
