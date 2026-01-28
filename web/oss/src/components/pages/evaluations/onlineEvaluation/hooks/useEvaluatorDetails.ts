import {useMemo} from "react"

import type {EvaluatorPreviewDto} from "@/oss/lib/hooks/useEvaluators/types"

import {PARAMETER_KEYS_TO_HIDE} from "../constants"
import type {EvaluatorDetails} from "../types"
import {
    extractEvaluatorType,
    extractModelName,
    extractOutputMetrics,
    extractParameterList,
    extractPromptSections,
} from "../utils/evaluatorDetails"

const EMPTY_DETAILS: EvaluatorDetails = {
    typeSlug: undefined,
    typeLabel: undefined,
    typeColor: undefined,
    parameters: [],
    visibleParameters: [],
    parameterPayload: {},
    model: "",
    outputs: [],
    promptSections: [],
}

interface UseEvaluatorDetailsParams {
    evaluator?: EvaluatorPreviewDto
    config?: any
    evaluatorTypeLookup: Map<string, {slug: string; label: string}>
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value)

const mergeEvaluatorWithConfig = (
    evaluator?: EvaluatorPreviewDto,
    config?: any,
): EvaluatorPreviewDto | any | undefined => {
    if (!config) return evaluator
    if (!evaluator) return config as EvaluatorPreviewDto

    const evaluatorAny = evaluator as Record<string, unknown>
    const configAny = config as Record<string, unknown>
    const merged: Record<string, unknown> = {
        ...evaluatorAny,
        ...configAny,
    }

    const previewData = isPlainObject(evaluatorAny.data)
        ? (evaluatorAny.data as Record<string, unknown>)
        : undefined
    const configData = isPlainObject(configAny.data)
        ? (configAny.data as Record<string, unknown>)
        : undefined
    if (previewData || configData) {
        const mergedData: Record<string, unknown> = {
            ...(previewData ?? {}),
            ...(configData ?? {}),
        }

        const previewParameters = isPlainObject(previewData?.parameters)
            ? (previewData?.parameters as Record<string, unknown>)
            : undefined
        const configParameters = isPlainObject(configData?.parameters)
            ? (configData?.parameters as Record<string, unknown>)
            : undefined
        const previewSettings = isPlainObject(evaluatorAny.settings_values)
            ? (evaluatorAny.settings_values as Record<string, unknown>)
            : undefined
        const configSettings = isPlainObject(configAny.settings_values)
            ? (configAny.settings_values as Record<string, unknown>)
            : undefined
        const mergedParameters = {
            ...(previewParameters ?? {}),
            ...(previewSettings ?? {}),
            ...(configParameters ?? {}),
            ...(configSettings ?? {}),
        }
        if (Object.keys(mergedParameters).length) {
            mergedData.parameters = mergedParameters
        }

        merged.data = mergedData
    }

    return merged as EvaluatorPreviewDto
}

export const useEvaluatorDetails = ({
    evaluator,
    config,
    evaluatorTypeLookup,
}: UseEvaluatorDetailsParams): EvaluatorDetails =>
    useMemo(() => {
        const resolvedEvaluator = mergeEvaluatorWithConfig(evaluator, config)
        if (!resolvedEvaluator) {
            return EMPTY_DETAILS
        }
        const typeInfo = extractEvaluatorType(resolvedEvaluator, evaluatorTypeLookup)
        const typeColor = (resolvedEvaluator as any)?.color

        const parameters = extractParameterList(resolvedEvaluator)
        const model = extractModelName(resolvedEvaluator)
        const outputs = extractOutputMetrics(resolvedEvaluator)
        const promptSections = extractPromptSections(resolvedEvaluator)
        const visibleParameters = parameters.filter((param) => {
            const key = param.key?.trim().toLowerCase() ?? ""
            if (PARAMETER_KEYS_TO_HIDE.has(key)) return false
            return true
        })
        const parameterPayload = parameters.reduce<Record<string, string>>((acc, param) => {
            if (!param.key) return acc
            const value = param.fullValue ?? param.displayValue
            if (value) {
                acc[param.key] = value
            }
            return acc
        }, {})

        return {
            typeSlug: typeInfo.slug,
            typeLabel: typeInfo.label,
            typeColor: typeColor,
            parameters,
            visibleParameters,
            parameterPayload,
            model,
            outputs,
            promptSections,
        }
    }, [evaluator, config, evaluatorTypeLookup])
