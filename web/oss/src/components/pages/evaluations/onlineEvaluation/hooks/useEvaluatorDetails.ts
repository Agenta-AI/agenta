import {useMemo} from "react"

import type {Workflow} from "@agenta/entities/workflow"

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
    evaluator?: Workflow
    config?: Workflow
    evaluatorTypeLookup: Map<string, {slug: string; label: string}>
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value)

/**
 * Merge a preview evaluator (full workflow with revision data) with
 * an evaluator config (selected instance) to get the most complete data.
 */
const mergeEvaluatorWithConfig = (
    evaluator?: Workflow,
    config?: Workflow,
): Workflow | undefined => {
    if (!config) return evaluator
    if (!evaluator) return config

    const merged: Record<string, unknown> = {
        ...evaluator,
        ...config,
    }

    const previewData = isPlainObject(evaluator.data) ? evaluator.data : undefined
    const configData = isPlainObject(config.data) ? config.data : undefined
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
        const mergedParameters = {
            ...(previewParameters ?? {}),
            ...(configParameters ?? {}),
        }
        if (Object.keys(mergedParameters).length) {
            mergedData.parameters = mergedParameters
        }

        merged.data = mergedData
    }

    return merged as Workflow
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
