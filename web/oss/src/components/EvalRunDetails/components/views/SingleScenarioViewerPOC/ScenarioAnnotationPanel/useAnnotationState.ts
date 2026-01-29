import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import deepEqual from "fast-deep-equal"

import {uuidToSpanId} from "@/oss/lib/traces/helpers"

import type {
    AnnotationDto,
    AnnotationMetricField,
    AnnotationMetrics,
    EvaluatorDto,
    ScenarioStep,
} from "../types"

const USEABLE_METRIC_TYPES = ["number", "integer", "float", "boolean", "string", "array"]

const getOutputsSchema = (evaluator: EvaluatorDto) => {
    const schemaOutputs = evaluator.data?.schemas?.outputs
    if (schemaOutputs && typeof schemaOutputs === "object") {
        return schemaOutputs
    }
    return evaluator.data?.service?.format?.properties?.outputs ?? {}
}

const inferFieldType = (value: unknown): AnnotationMetricField | null => {
    if (value === null || value === undefined) {
        return {value: null, type: "string"}
    }
    if (typeof value === "boolean") {
        return {value, type: "boolean"}
    }
    if (typeof value === "number") {
        return {value, type: Number.isInteger(value) ? "integer" : "number"}
    }
    if (typeof value === "string") {
        return {value, type: "string"}
    }
    if (Array.isArray(value)) {
        const sample = value.find((entry) => entry !== null && entry !== undefined)
        const itemType =
            typeof sample === "boolean"
                ? "boolean"
                : typeof sample === "number"
                  ? Number.isInteger(sample)
                      ? "integer"
                      : "number"
                  : typeof sample === "string"
                    ? "string"
                    : "string"
        return {
            value,
            type: "array",
            items: {
                type: itemType,
                enum: [],
            },
        }
    }
    if (typeof value === "object") {
        return {value: JSON.stringify(value), type: "string"}
    }
    return null
}

const inferFieldsFromOutputs = (outputs: Record<string, unknown>) => {
    const fields: Record<string, AnnotationMetricField> = {}
    for (const [key, value] of Object.entries(outputs)) {
        const field = inferFieldType(value)
        if (!field) continue
        fields[key] = field
    }
    return fields
}

// ============================================================================
// Utility Functions
// ============================================================================

function getMetricFieldsFromEvaluator(
    evaluator: EvaluatorDto,
): Record<string, AnnotationMetricField> {
    const schema = getOutputsSchema(evaluator)?.properties ?? {}
    const fields: Record<string, AnnotationMetricField> = {}

    for (const [key, rawProp] of Object.entries(schema)) {
        if (!rawProp || typeof rawProp !== "object") continue

        const prop = (rawProp as Record<string, unknown>).anyOf
            ? ((rawProp as Record<string, unknown>).anyOf as unknown[])[0]
            : rawProp
        const propObj = prop as Record<string, unknown>
        const rawType = propObj?.type as string | string[] | undefined

        if (!rawType) continue

        if (Array.isArray(rawType)) {
            const enumValues =
                (propObj.enum as unknown[] | undefined)?.filter(
                    (value) => value !== null && value !== undefined && value !== "",
                ) || []
            const filteredTypes = rawType.filter((value) => value !== "null")
            if (filteredTypes.length === 0) continue
            const baseType = filteredTypes[0]
            fields[key] = {
                value: baseType === "string" ? "" : null,
                type: filteredTypes,
                enum: enumValues as string[],
                minimum: propObj.minimum as number | undefined,
                maximum: propObj.maximum as number | undefined,
            }
            continue
        }

        const type = rawType

        if (type === "array") {
            const items = propObj.items as Record<string, unknown> | undefined
            fields[key] = {
                value: [],
                type: "array",
                items: {
                    type: (typeof items?.type === "string" ? items.type : "string") as string,
                    enum: (items?.enum as string[] | undefined) ?? [],
                },
            }
        } else if (USEABLE_METRIC_TYPES.includes(type)) {
            fields[key] = {
                value: type === "string" ? "" : null,
                type,
                minimum: propObj.minimum as number | undefined,
                maximum: propObj.maximum as number | undefined,
            }
        }
    }

    return fields
}

function getMetricsFromAnnotation(
    annotation: AnnotationDto,
    evaluator: EvaluatorDto,
): Record<string, AnnotationMetricField> {
    const schema = getOutputsSchema(evaluator)?.properties ?? {}
    const rawOutputs = (annotation.data?.outputs as Record<string, unknown>) ?? {}

    // Flatten nested structures - outputs can be at top level or nested under metrics/notes/extra
    const outputs: Record<string, unknown> = {}

    // First, add any nested values
    if (rawOutputs.metrics && typeof rawOutputs.metrics === "object") {
        Object.assign(outputs, rawOutputs.metrics)
    }
    if (rawOutputs.notes && typeof rawOutputs.notes === "object") {
        Object.assign(outputs, rawOutputs.notes)
    }
    if (rawOutputs.extra && typeof rawOutputs.extra === "object") {
        Object.assign(outputs, rawOutputs.extra)
    }

    // Then add top-level values (these take precedence)
    for (const [k, v] of Object.entries(rawOutputs)) {
        if (k !== "metrics" && k !== "notes" && k !== "extra") {
            outputs[k] = v
        }
    }

    if (!Object.keys(schema).length) {
        return inferFieldsFromOutputs(outputs)
    }

    const fields: Record<string, AnnotationMetricField> = {}

    for (const [key, rawProp] of Object.entries(schema)) {
        if (!rawProp || typeof rawProp !== "object") continue

        const prop = (rawProp as Record<string, unknown>).anyOf
            ? ((rawProp as Record<string, unknown>).anyOf as unknown[])[0]
            : rawProp
        const propObj = prop as Record<string, unknown>
        const rawType = propObj?.type as string | string[] | undefined

        if (!rawType) continue

        // Check if value exists - be careful with boolean false which is falsy but valid
        const hasValue = key in outputs
        const value = hasValue ? outputs[key] : undefined

        if (Array.isArray(rawType)) {
            const enumValues =
                (propObj.enum as unknown[] | undefined)?.filter(
                    (item) => item !== null && item !== undefined && item !== "",
                ) || []
            const filteredTypes = rawType.filter((item) => item !== "null")
            if (filteredTypes.length === 0) continue
            const baseType = filteredTypes[0]
            const defaultValue = baseType === "string" ? "" : null
            fields[key] = {
                value: hasValue ? value : defaultValue,
                type: filteredTypes,
                enum: enumValues as string[],
                minimum: propObj.minimum as number | undefined,
                maximum: propObj.maximum as number | undefined,
            }
            continue
        }

        const type = rawType

        if (type === "array") {
            const items = propObj.items as Record<string, unknown> | undefined
            fields[key] = {
                value: value ?? [],
                type: "array",
                items: {
                    type: (typeof items?.type === "string" ? items.type : "string") as string,
                    enum: (items?.enum as string[] | undefined) ?? [],
                },
            }
        } else if (USEABLE_METRIC_TYPES.includes(type)) {
            // For boolean, null means "not set", but false is a valid value
            const defaultValue = type === "string" ? "" : null
            fields[key] = {
                value: hasValue ? value : defaultValue,
                type,
                minimum: propObj.minimum as number | undefined,
                maximum: propObj.maximum as number | undefined,
            }
        }
    }

    return fields
}

const isEmptyValue = (value: unknown): boolean => {
    if (value === null || value === undefined || value === "") return true
    if (Array.isArray(value) && value.length === 0) return true
    return false
}

// ============================================================================
// Hook
// ============================================================================

interface UseAnnotationStateProps {
    scenarioId: string
    evaluators: EvaluatorDto[]
    annotations: AnnotationDto[]
    invocationSteps: ScenarioStep[]
    allSteps: ScenarioStep[]
}

export function useAnnotationState({
    scenarioId,
    evaluators,
    annotations,
    invocationSteps,
    allSteps,
}: UseAnnotationStateProps) {
    // Local state for user edits - keyed by scenarioId to prevent cross-scenario pollution
    const [metricEdits, setMetricEdits] = useState<AnnotationMetrics>({})
    const [errors, setErrors] = useState<string[]>([])

    // Track the scenarioId to reset edits when it changes
    const prevScenarioIdRef = useRef(scenarioId)
    if (prevScenarioIdRef.current !== scenarioId) {
        prevScenarioIdRef.current = scenarioId
        // Reset edits when scenario changes (synchronous state update)
        setMetricEdits({})
        setErrors([])
    }

    // Track previous baseline to detect when it updates after a save
    const prevBaselineRef = useRef<string>("")

    // Build evaluator map
    const evaluatorMap = useMemo(() => {
        const map = new Map<string, EvaluatorDto>()
        for (const e of evaluators) {
            if (e.slug) map.set(e.slug, e)
            if (e.id) map.set(e.id, e)
        }
        return map
    }, [evaluators])

    // Compute baseline from annotations + evaluator schemas
    const baseline = useMemo((): AnnotationMetrics => {
        const result: AnnotationMetrics = {}

        // Add metrics from existing annotations
        for (const ann of annotations) {
            const evaluatorRef = ann.references?.evaluator
            const evaluatorKey = evaluatorRef?.slug ?? evaluatorRef?.id
            if (!evaluatorKey) continue

            const evaluator = evaluatorMap.get(evaluatorKey)
            if (!evaluator) continue

            const slug = evaluator.slug ?? evaluatorKey
            if (!slug) continue

            result[slug] = getMetricsFromAnnotation(ann, evaluator)
        }

        // Add empty metrics for unannotated evaluators
        const annotatedSlugs = new Set(
            annotations.map((a) => a.references?.evaluator?.slug).filter(Boolean),
        )
        for (const [slug, evaluator] of evaluatorMap) {
            if (!annotatedSlugs.has(slug)) {
                result[slug] = getMetricFieldsFromEvaluator(evaluator)
            }
        }

        return result
    }, [annotations, evaluatorMap])

    // When baseline updates (e.g., after save + refetch), clear edits that now match baseline
    // This allows new changes to be detected properly
    const baselineKey = useMemo(() => JSON.stringify(baseline), [baseline])
    useEffect(() => {
        if (prevBaselineRef.current && prevBaselineRef.current !== baselineKey) {
            console.log("[useAnnotationState] Baseline changed, clearing matching edits")
            // Baseline changed - clear edits that match the new baseline
            // This happens after a successful save when annotations are refetched
            setMetricEdits((currentEdits) => {
                if (Object.keys(currentEdits).length === 0) return currentEdits

                const remainingEdits: AnnotationMetrics = {}
                let hasRemainingEdits = false

                for (const [slug, fields] of Object.entries(currentEdits)) {
                    const baselineSlug = baseline[slug] ?? {}
                    const remainingFields: Record<string, AnnotationMetricField> = {}
                    let hasRemainingFields = false

                    for (const [key, field] of Object.entries(fields)) {
                        const baselineField = baselineSlug[key]
                        // Keep the edit only if it differs from baseline
                        if (!deepEqual(field.value, baselineField?.value)) {
                            remainingFields[key] = field
                            hasRemainingFields = true
                        }
                    }

                    if (hasRemainingFields) {
                        remainingEdits[slug] = remainingFields
                        hasRemainingEdits = true
                    }
                }

                console.log("[useAnnotationState] Remaining edits after cleanup:", remainingEdits)
                return hasRemainingEdits ? remainingEdits : {}
            })
        }
        prevBaselineRef.current = baselineKey
    }, [baselineKey, baseline])

    // Compute effective metrics (baseline merged with edits)
    const effectiveMetrics = useMemo((): AnnotationMetrics => {
        if (Object.keys(metricEdits).length === 0) {
            return baseline
        }

        const merged: AnnotationMetrics = {}
        const allSlugs = new Set([...Object.keys(baseline), ...Object.keys(metricEdits)])

        for (const slug of allSlugs) {
            const baselineFields = baseline[slug] ?? {}
            const editFields = metricEdits[slug] ?? {}
            merged[slug] = {...baselineFields, ...editFields}
        }

        return merged
    }, [baseline, metricEdits])

    // Check for pending changes
    const hasPendingChanges = useMemo((): boolean => {
        if (Object.keys(metricEdits).length === 0) return false

        for (const [slug, fields] of Object.entries(metricEdits)) {
            const baselineSlug = baseline[slug] ?? {}
            for (const [key, field] of Object.entries(fields)) {
                const baselineField = baselineSlug[key]
                const currentValue = field.value
                const baselineValue = baselineField?.value

                if (!deepEqual(currentValue, baselineValue)) {
                    const isCurrentEmpty = isEmptyValue(currentValue)
                    const isBaselineEmpty = isEmptyValue(baselineValue)

                    if (!isCurrentEmpty || !isBaselineEmpty) {
                        return true
                    }
                }
            }
        }
        return false
    }, [metricEdits, baseline])

    // Check if all required fields are filled
    const allRequiredFieldsFilled = useMemo((): boolean => {
        if (evaluators.length === 0) return false

        for (const evaluator of evaluators) {
            const slug = evaluator.slug
            if (!slug) continue

            const requiredKeys: string[] = getOutputsSchema(evaluator)?.required ?? []

            if (requiredKeys.length === 0) continue

            const metricFields = effectiveMetrics[slug]
            if (!metricFields) return false

            for (const key of requiredKeys) {
                const field = metricFields[key]
                if (isEmptyValue(field?.value)) return false
            }
        }

        return true
    }, [evaluators, effectiveMetrics])

    // Get unannotated evaluator slugs
    const unannotatedSlugs = useMemo((): string[] => {
        const annotatedKeys = new Set(
            annotations
                .flatMap((a) => [a.references?.evaluator?.slug, a.references?.evaluator?.id])
                .filter(Boolean) as string[],
        )
        return evaluators
            .map((e) => e.slug)
            .filter(
                (slug): slug is string =>
                    Boolean(slug) &&
                    !annotatedKeys.has(slug) &&
                    !annotatedKeys.has(evaluators.find((e) => e.slug === slug)?.id ?? ""),
            )
    }, [annotations, evaluators])

    // Extract trace/span IDs
    const traceSpanIds = useMemo(() => {
        const extractTraceId = (step: ScenarioStep): string | undefined => {
            const direct = step.traceId ?? step.trace_id
            if (direct) return direct

            const trace = (step as any)?.trace
            if (trace?.tree?.id) return String(trace.tree.id)
            if (Array.isArray(trace?.trees) && trace.trees[0]?.tree?.id) {
                return String(trace.trees[0].tree.id)
            }
            if (Array.isArray(trace?.nodes) && trace.nodes[0]?.trace_id) {
                return String(trace.nodes[0].trace_id)
            }
            return undefined
        }

        for (const step of invocationSteps) {
            const traceId = extractTraceId(step)
            if (traceId) {
                const spanId = step.spanId ?? step.span_id ?? uuidToSpanId(traceId) ?? ""
                return {traceId, spanId}
            }
        }

        for (const step of allSteps) {
            const traceId = extractTraceId(step)
            if (traceId) {
                const spanId = step.spanId ?? step.span_id ?? uuidToSpanId(traceId) ?? ""
                return {traceId, spanId}
            }
        }

        if (annotations.length > 0) {
            const ann = annotations[0]
            const traceId = ann.trace_id ?? ""
            const spanId = ann.span_id ?? (traceId ? (uuidToSpanId(traceId) ?? "") : "")
            return {traceId, spanId}
        }

        return {traceId: "", spanId: ""}
    }, [invocationSteps, allSteps, annotations])

    // Get invocation step key
    const invocationStepKey = useMemo(() => {
        const step = invocationSteps[0]
        return step?.stepKey ?? step?.step_key ?? step?.key ?? ""
    }, [invocationSteps])

    // Get annotation step key by slug - look in allSteps for steps that match the pattern
    // Step keys for annotations follow the pattern: "{invocationStepKey}.{evaluatorSlug}"
    const annotationStepKeyBySlug = useMemo(() => {
        const map: Record<string, string> = {}

        // First, try to find from allSteps (most reliable)
        for (const step of allSteps) {
            const stepKey = step?.stepKey ?? step?.step_key ?? step?.key ?? ""
            if (!stepKey || !stepKey.includes(".")) continue

            // Extract the slug from the step key (last part after the dot)
            const parts = stepKey.split(".")
            const slug = parts.length > 1 ? parts[parts.length - 1] : null
            if (slug) {
                map[slug] = stepKey
            }
        }

        // Fallback: try to find from annotations
        for (const ann of annotations) {
            const evaluatorRef = ann.references?.evaluator
            const evaluatorKey = evaluatorRef?.slug ?? evaluatorRef?.id
            const slug = evaluatorKey
                ? (evaluatorMap.get(evaluatorKey)?.slug ?? evaluatorKey)
                : null
            if (!slug || map[slug]) continue // Skip if already found

            // Check if annotation has a step reference
            const stepKey = ann.references?.step?.key
            if (stepKey) {
                map[slug] = stepKey
            }
        }

        return map
    }, [allSteps, annotations, evaluatorMap])

    // Update a single metric field
    const updateMetric = useCallback(
        ({slug, fieldKey, value}: {slug: string; fieldKey: string; value: unknown}) => {
            setMetricEdits((prev) => {
                const baselineField = baseline[slug]?.[fieldKey] ?? {}
                const currentField = prev[slug]?.[fieldKey] ?? baselineField

                return {
                    ...prev,
                    [slug]: {
                        ...prev[slug],
                        [fieldKey]: {
                            ...currentField,
                            value,
                        },
                    },
                }
            })
        },
        [baseline],
    )

    // Reset edits (clear all pending changes)
    const resetEdits = useCallback(() => {
        setMetricEdits({})
    }, [])

    // Set errors
    const setErrorsCallback = useCallback((newErrors: string[]) => {
        setErrors(newErrors)
    }, [])

    // Dismiss a specific error
    const dismissError = useCallback((index: number) => {
        setErrors((prev) => prev.filter((_, i) => i !== index))
    }, [])

    return {
        // State
        metrics: effectiveMetrics,
        metricEdits,
        errors,
        evaluators,
        annotations,

        // Derived values
        hasPendingChanges,
        allRequiredFieldsFilled,
        unannotatedSlugs,
        traceSpanIds,
        invocationStepKey,
        annotationStepKeyBySlug,

        // Actions
        updateMetric,
        resetEdits,
        setErrors: setErrorsCallback,
        dismissError,
    }
}
