import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {uuidToSpanId} from "@/oss/lib/traces/helpers"

import type {
    AnnotationDto,
    AnnotationMetricField,
    AnnotationMetrics,
    EvaluatorDto,
    ScenarioStep,
} from "../types"

const USEABLE_METRIC_TYPES = ["number", "integer", "float", "boolean", "string", "array"]

// ============================================================================
// Scenario State - All state scoped by scenarioId
// ============================================================================

export interface ScenarioAnnotationState {
    runId: string
    evaluators: EvaluatorDto[]
    annotations: AnnotationDto[]
    invocationSteps: ScenarioStep[]
    allSteps: ScenarioStep[]
    metricEdits: AnnotationMetrics
    errors: string[]
}

const createInitialState = (): ScenarioAnnotationState => ({
    runId: "",
    evaluators: [],
    annotations: [],
    invocationSteps: [],
    allSteps: [],
    metricEdits: {},
    errors: [],
})

/**
 * Main state atom family - each scenario has its own isolated state.
 * This is the single source of truth for all annotation panel state.
 */
export const scenarioAnnotationStateFamily = atomFamily(
    (_scenarioId: string) => atom<ScenarioAnnotationState>(createInitialState()),
    (a, b) => a === b,
)

/** Current scenario ID */
export const currentScenarioIdAtom = atom<string>("")

// ============================================================================
// Utility Functions
// ============================================================================

function getMetricFieldsFromEvaluator(
    evaluator: EvaluatorDto,
): Record<string, AnnotationMetricField> {
    const schema = evaluator.data?.service?.format?.properties?.outputs?.properties ?? {}
    const fields: Record<string, AnnotationMetricField> = {}

    for (const [key, rawProp] of Object.entries(schema)) {
        if (!rawProp || typeof rawProp !== "object") continue

        const prop = (rawProp as Record<string, unknown>).anyOf
            ? ((rawProp as Record<string, unknown>).anyOf as unknown[])[0]
            : rawProp
        const propObj = prop as Record<string, unknown>
        const type = propObj?.type as string | undefined

        if (!type) continue

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
    const schema = evaluator.data?.service?.format?.properties?.outputs?.properties ?? {}
    const rawOutputs = (annotation.data?.outputs as Record<string, unknown>) ?? {}
    // Outputs can be nested under metrics/notes/extra or directly at the top level
    const outputs = {
        ...(rawOutputs.metrics as Record<string, unknown>),
        ...(rawOutputs.notes as Record<string, unknown>),
        ...(rawOutputs.extra as Record<string, unknown>),
        ...rawOutputs,
    }
    const fields: Record<string, AnnotationMetricField> = {}

    for (const [key, rawProp] of Object.entries(schema)) {
        if (!rawProp || typeof rawProp !== "object") continue

        const prop = (rawProp as Record<string, unknown>).anyOf
            ? ((rawProp as Record<string, unknown>).anyOf as unknown[])[0]
            : rawProp
        const propObj = prop as Record<string, unknown>
        const type = propObj?.type as string | undefined

        if (!type) continue

        // Check for the value - it might be stored with the exact key or we need to find it
        const value = key in outputs ? outputs[key] : undefined

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
            fields[key] = {
                value: value ?? (type === "string" ? "" : null),
                type,
                minimum: propObj.minimum as number | undefined,
                maximum: propObj.maximum as number | undefined,
            }
        }
    }

    return fields
}

// ============================================================================
// Selectors - Read from current scenario's state
// ============================================================================

/** Get current scenario state */
const currentScenarioStateAtom = atom((get) => {
    const scenarioId = get(currentScenarioIdAtom)
    if (!scenarioId) return createInitialState()
    const state = get(scenarioAnnotationStateFamily(scenarioId))
    return state
})

/** Evaluators for the current scenario */
export const evaluatorsAtom = atom((get) => get(currentScenarioStateAtom).evaluators)

/** Annotations for the current scenario */
export const scenarioAnnotationsAtom = atom((get) => get(currentScenarioStateAtom).annotations)

/** Invocation steps for the current scenario */
export const invocationStepsAtom = atom((get) => get(currentScenarioStateAtom).invocationSteps)

/** All steps for the current scenario */
export const allStepsAtom = atom((get) => get(currentScenarioStateAtom).allSteps)

/** Current run ID */
export const currentRunIdAtom = atom((get) => get(currentScenarioStateAtom).runId)

/** Current scenario's metric edits */
export const currentMetricEditsAtom = atom((get) => get(currentScenarioStateAtom).metricEdits)

/** Current scenario's errors */
export const currentErrorsAtom = atom((get) => get(currentScenarioStateAtom).errors)

// ============================================================================
// Derived Atoms (computed from current scenario state)
// ============================================================================

/** Map of evaluator slug -> evaluator for quick lookup */
export const evaluatorMapAtom = atom((get) => {
    const evaluators = get(evaluatorsAtom)
    const map = new Map<string, EvaluatorDto>()
    for (const e of evaluators) {
        if (e.slug) map.set(e.slug, e)
    }
    return map
})

/** Set of evaluator slugs that have existing annotations */
export const annotatedSlugsAtom = atom((get) => {
    const annotations = get(scenarioAnnotationsAtom)
    const slugs = new Set<string>()
    for (const ann of annotations) {
        const slug = ann.references?.evaluator?.slug
        if (slug) slugs.add(slug)
    }
    return slugs
})

/** Array of evaluator slugs that need new annotations */
export const unannotatedSlugsAtom = atom((get) => {
    const evaluators = get(evaluatorsAtom)
    const annotatedSlugs = get(annotatedSlugsAtom)
    return evaluators
        .map((e) => e.slug)
        .filter((slug): slug is string => Boolean(slug) && !annotatedSlugs.has(slug))
})

/** Baseline metrics computed from annotations and evaluator schemas */
export const baselineMetricsAtom = atom((get) => {
    const _scenarioId = get(currentScenarioIdAtom)
    const annotations = get(scenarioAnnotationsAtom)
    const unannotatedSlugs = get(unannotatedSlugsAtom)
    const evaluatorMap = get(evaluatorMapAtom)
    const baseline: AnnotationMetrics = {}

    // Add metrics from existing annotations
    for (const ann of annotations) {
        const slug = ann.references?.evaluator?.slug

        if (!slug) continue

        const evaluator = evaluatorMap.get(slug)
        if (!evaluator) continue

        const metrics = getMetricsFromAnnotation(ann, evaluator)
        baseline[slug] = metrics
    }

    // Add empty metrics for unannotated evaluators
    for (const slug of unannotatedSlugs) {
        const evaluator = evaluatorMap.get(slug)
        if (!evaluator) continue

        baseline[slug] = getMetricFieldsFromEvaluator(evaluator)
    }

    return baseline
})

/** Effective metrics = baseline merged with user edits */
export const effectiveMetricsAtom = atom((get) => {
    const _scenarioId = get(currentScenarioIdAtom)
    const baseline = get(baselineMetricsAtom)
    const edits = get(currentMetricEditsAtom)

    if (Object.keys(edits).length === 0) {
        return baseline
    }

    const merged: AnnotationMetrics = {}
    const allSlugs = new Set([...Object.keys(baseline), ...Object.keys(edits)])

    for (const slug of allSlugs) {
        const baselineFields = baseline[slug] ?? {}
        const editFields = edits[slug] ?? {}
        merged[slug] = {...baselineFields, ...editFields}
    }

    return merged
})

/** Whether there are pending changes */
export const hasPendingChangesAtom = atom((get) => {
    const edits = get(currentMetricEditsAtom)
    const baseline = get(baselineMetricsAtom)

    if (Object.keys(edits).length === 0) return false

    for (const [slug, fields] of Object.entries(edits)) {
        const baselineSlug = baseline[slug] ?? {}
        for (const [key, field] of Object.entries(fields)) {
            const baselineField = baselineSlug[key]
            const currentValue = field.value
            const baselineValue = baselineField?.value

            if (!deepEqual(currentValue, baselineValue)) {
                const isCurrentEmpty =
                    currentValue === null ||
                    currentValue === undefined ||
                    currentValue === "" ||
                    (Array.isArray(currentValue) && currentValue.length === 0)
                const isBaselineEmpty =
                    baselineValue === null ||
                    baselineValue === undefined ||
                    baselineValue === "" ||
                    (Array.isArray(baselineValue) && baselineValue.length === 0)

                if (!isCurrentEmpty || !isBaselineEmpty) {
                    return true
                }
            }
        }
    }
    return false
})

/** Helper to check if a value is empty */
const isEmptyValue = (value: unknown): boolean => {
    if (value === null || value === undefined || value === "") return true
    if (Array.isArray(value) && value.length === 0) return true
    return false
}

/** Check if all required fields are filled for all evaluators */
export const allRequiredFieldsFilledAtom = atom((get) => {
    const evaluators = get(evaluatorsAtom)
    const effectiveMetrics = get(effectiveMetricsAtom)

    if (evaluators.length === 0) return false

    // For each evaluator, check if all required fields have values
    for (const evaluator of evaluators) {
        const slug = evaluator.slug
        if (!slug) continue

        // Get required fields from evaluator schema
        const requiredKeys: string[] =
            evaluator.data?.service?.format?.properties?.outputs?.required ?? []

        if (requiredKeys.length === 0) {
            // No required fields for this evaluator, skip
            continue
        }

        // Get current metric values for this evaluator
        const metricFields = effectiveMetrics[slug]
        if (!metricFields) {
            // No metrics at all for this evaluator but it has required fields
            return false
        }

        // Check each required field
        for (const key of requiredKeys) {
            const field = metricFields[key]
            const value = field?.value

            if (isEmptyValue(value)) {
                // Required field is empty
                return false
            }
        }
    }

    return true
})

/**
 * Extract trace ID from a step, checking multiple possible locations
 */
const extractTraceIdFromStep = (step: ScenarioStep): string | undefined => {
    // Direct properties
    const direct = step.traceId ?? step.trace_id
    if (direct) return direct

    // Nested in trace object (from invocation results)
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

/** Trace/span IDs for annotation linking */
export const traceSpanIdsAtom = atom((get) => {
    const invocationSteps = get(invocationStepsAtom)
    const allSteps = get(allStepsAtom)
    const annotations = get(scenarioAnnotationsAtom)

    for (const step of invocationSteps) {
        const traceId = extractTraceIdFromStep(step)
        if (traceId) {
            const spanId = step.spanId ?? step.span_id ?? uuidToSpanId(traceId) ?? ""
            return {traceId, spanId}
        }
    }

    for (const step of allSteps) {
        const traceId = extractTraceIdFromStep(step)
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
})

/** Invocation step key for annotation linking */
export const invocationStepKeyAtom = atom((get) => {
    const invocationSteps = get(invocationStepsAtom)
    for (const step of invocationSteps) {
        const key = step.stepKey ?? step.step_key ?? step.key
        if (key) return key
    }
    return ""
})

/** Map from evaluator slug to existing annotation step key */
export const annotationStepKeyBySlugAtom = atom((get) => {
    const allSteps = get(allStepsAtom)
    const map = new Map<string, string>()
    for (const step of allSteps) {
        const stepKey = step.stepKey ?? step.step_key ?? step.key
        if (!stepKey || !stepKey.includes(".")) continue

        const parts = stepKey.split(".")
        const slug = parts.length > 1 ? parts[parts.length - 1] : null
        if (slug) {
            map.set(slug, stepKey)
        }
    }
    return map
})

// ============================================================================
// Actions - Write to current scenario's state
// ============================================================================

/** Initialize/update scenario state with source data */
export const setScenarioDataAtom = atom(
    null,
    (
        get,
        set,
        {
            scenarioId,
            runId,
            evaluators,
            annotations,
            invocationSteps,
            allSteps,
        }: {
            scenarioId: string
            runId: string
            evaluators: EvaluatorDto[]
            annotations: AnnotationDto[]
            invocationSteps: ScenarioStep[]
            allSteps: ScenarioStep[]
        },
    ) => {
        // Set current scenario ID first
        set(currentScenarioIdAtom, scenarioId)

        // Get or create state for this scenario
        const currentState = get(scenarioAnnotationStateFamily(scenarioId))

        // Only update annotations if we have new ones or if the state is empty
        // This prevents overwriting good data with stale/empty data during navigation
        // IMPORTANT: Never replace existing annotations with empty array - this causes
        // the UI to flash empty values during refetch after save
        const shouldUpdateAnnotations =
            annotations.length > 0 || currentState.annotations.length === 0

        // Reset metricEdits if there are no annotations (nothing to edit)
        // This prevents stale edits from showing up on unannotated scenarios
        // Only reset if we're certain there are no annotations (both incoming and current are empty)
        const shouldResetEdits = annotations.length === 0 && currentState.annotations.length === 0

        // Update with new source data, preserving user edits and errors
        // Only update annotations if we have meaningful data
        // Reset metricEdits if scenario has no annotations
        set(scenarioAnnotationStateFamily(scenarioId), {
            ...currentState,
            runId,
            evaluators,
            annotations: shouldUpdateAnnotations ? annotations : currentState.annotations,
            metricEdits: shouldResetEdits ? {} : currentState.metricEdits,
            invocationSteps,
            allSteps,
        })
    },
)

/** Update a single metric field value */
export const updateMetricAtom = atom(
    null,
    (
        get,
        set,
        {
            scenarioId: targetScenarioId,
            slug,
            fieldKey,
            value,
        }: {scenarioId?: string; slug: string; fieldKey: string; value: unknown},
    ) => {
        // Use provided scenarioId or fall back to current (for backward compat)
        const scenarioId = targetScenarioId || get(currentScenarioIdAtom)
        if (!scenarioId) return

        // Verify we're updating the correct scenario (prevent stale updates)
        // Only skip if currentId is set AND different from target scenarioId
        // (empty currentId means useEffect hasn't run yet, which is fine)
        const currentId = get(currentScenarioIdAtom)
        if (currentId && scenarioId !== currentId) {
            return
        }

        // If currentId is empty, set it to the target scenarioId
        // This handles the case where updateMetric is called before setScenarioData
        if (!currentId) {
            set(currentScenarioIdAtom, scenarioId)
        }

        const state = get(scenarioAnnotationStateFamily(scenarioId))
        const baseline = get(baselineMetricsAtom)

        const baselineField = baseline[slug]?.[fieldKey] ?? {}
        const currentField = state.metricEdits[slug]?.[fieldKey] ?? baselineField

        set(scenarioAnnotationStateFamily(scenarioId), {
            ...state,
            metricEdits: {
                ...state.metricEdits,
                [slug]: {
                    ...state.metricEdits[slug],
                    [fieldKey]: {
                        ...currentField,
                        value,
                    },
                },
            },
        })
    },
)

/** Reset current scenario's edits to baseline */
export const resetMetricsAtom = atom(null, (get, set) => {
    const scenarioId = get(currentScenarioIdAtom)
    if (!scenarioId) return

    const state = get(scenarioAnnotationStateFamily(scenarioId))
    set(scenarioAnnotationStateFamily(scenarioId), {
        ...state,
        metricEdits: {},
    })
})

/** Set errors for current scenario */
export const setErrorsAtom = atom(null, (get, set, errors: string[]) => {
    const scenarioId = get(currentScenarioIdAtom)
    if (!scenarioId) return

    const state = get(scenarioAnnotationStateFamily(scenarioId))
    set(scenarioAnnotationStateFamily(scenarioId), {
        ...state,
        errors,
    })
})

/** Dismiss an error by index */
export const dismissErrorAtom = atom(null, (get, set, index: number) => {
    const scenarioId = get(currentScenarioIdAtom)
    if (!scenarioId) return

    const state = get(scenarioAnnotationStateFamily(scenarioId))
    set(scenarioAnnotationStateFamily(scenarioId), {
        ...state,
        errors: state.errors.filter((_, i) => i !== index),
    })
})
