/* eslint-disable @typescript-eslint/no-explicit-any -- relocated eval-run parity data layer (WP-4e-2b); reads dynamic backend-shaped payloads, logic unchanged */
import {formatMetricDisplay} from "@agenta/ui/cell-renderers"
import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"

import type {PreviewTestCase} from "../../../core"
import {previewEvalTypeAtom} from "../state/evalType"
import {readInvocationResponse} from "../traces/traceUtils"
import {resolveInvocationTraceValue} from "../utils/traceValue"
import {resolveGenericStepValueByPath, resolveInputStepValueByPath} from "../utils/valueAccess"

import {evaluationAnnotationQueryAtomFamily} from "./annotations"
import type {AnnotationDto} from "./annotationTypes"
import {scenarioMetricMetaAtomFamily, scenarioMetricValueAtomFamily} from "./metrics"
import {activePreviewRunIdAtom} from "./run"
import {
    extractBooleanLike,
    extractStepsByKind,
    findStepWithError,
    isStringTypePlaceholder,
    pickStep,
    resolveAnnotationValue,
    toTraceId,
} from "./scenarioColumnValuesHelpers"
import {scenarioStepsQueryFamily} from "./scenarioSteps"
import {scenarioTestcaseMetaAtomFamily, scenarioTestcaseValueAtomFamily} from "./scenarioTestcase"
import type {EvaluationTableColumn} from "./table"
import {
    columnValueDescriptorMapAtomFamily,
    createColumnValueDescriptor,
    type ColumnDescriptorInput,
} from "./table/columnAccess"
import {evaluationRunIndexAtomFamily} from "./table/run"
import {traceQueryMetaAtomFamily, traceValueAtomFamily} from "./traces"

export interface QueryState<T> {
    data: T | null | undefined
    isLoading: boolean
    isFetching: boolean
    error?: unknown
}

export interface StepError {
    code?: number
    type?: string
    message: string
    stacktrace?: string
    raw?: unknown
}

export type {StepError as EvaluatorStepError}

export interface ScenarioStepValueResult {
    value: unknown
    displayValue?: unknown
    isLoading: boolean
    isFetching: boolean
    error?: unknown
    /** Error from the step itself (e.g., evaluator failure) */
    stepError?: StepError | null
}

export interface ColumnValueConfig {
    id: string
    columnKind: EvaluationTableColumn["kind"]
    stepType: EvaluationTableColumn["stepType"]
    stepKey?: string
    path: string
    pathSegments?: string[]
    metricKey?: string
    metricType?: EvaluationTableColumn["metricType"]
    valueKey?: string
    enabled?: boolean
    evaluatorId?: string | null
    evaluatorSlug?: string | null
}

const isOutputsColumn = (config: ColumnValueConfig): boolean => {
    const normalized = config.path?.toLowerCase() ?? ""
    const metricKey = config.metricKey?.toLowerCase() ?? ""
    const valueKey = config.valueKey?.toLowerCase() ?? ""

    const containsOutputIndicator = (candidate?: string) =>
        typeof candidate === "string" &&
        (candidate === "outputs" ||
            candidate.startsWith("outputs.") ||
            candidate.includes(".outputs"))

    return (
        containsOutputIndicator(normalized) ||
        containsOutputIndicator(metricKey) ||
        containsOutputIndicator(valueKey)
    )
}

export const buildColumnValueConfig = (
    column: EvaluationTableColumn,
    options?: {enabled?: boolean},
): ColumnValueConfig => ({
    id: column.id,
    columnKind: column.kind,
    stepType: column.stepType,
    stepKey: column.stepKey,
    path: column.path,
    pathSegments: column.pathSegments,
    metricKey: column.metricKey,
    metricType: column.metricType,
    valueKey: column.valueKey,
    enabled: options?.enabled ?? true,
    evaluatorId: "evaluatorId" in column ? ((column as any).evaluatorId ?? null) : null,
    evaluatorSlug: "evaluatorSlug" in column ? ((column as any).evaluatorSlug ?? null) : null,
})

const toDescriptorInput = (config: ColumnValueConfig): ColumnDescriptorInput => ({
    id: config.id,
    kind: config.columnKind,
    stepType: config.stepType,
    stepKey: config.stepKey,
    path: config.path,
    pathSegments: config.pathSegments,
    valueKey: config.valueKey,
    metricKey: config.metricKey,
    metricType: config.metricType,
})

const EMPTY_RESULT: ScenarioStepValueResult = {
    value: undefined,
    displayValue: undefined,
    isLoading: true,
    isFetching: false,
    error: undefined,
}

const _EMPTY_TESTCASE_STATE: QueryState<PreviewTestCase | null> = {
    data: undefined,
    isLoading: false,
    isFetching: false,
}

const EMPTY_ANNOTATION_STATE: QueryState<AnnotationDto | null> = {
    data: undefined,
    isLoading: false,
    isFetching: false,
}

const debugScenarioValue =
    process.env.NEXT_PUBLIC_EVAL_RUN_DEBUG === "true"
        ? (message: string, payload: Record<string, unknown>, options?: {onceKey?: string}) => {
              if (typeof window === "undefined") return

              if (options?.onceKey) {
                  const onceFlag = (window as any).__evalRunDetails2DebugOnce ?? new Set<string>()
                  if (!(window as any).__evalRunDetails2DebugOnce) {
                      ;(window as any).__evalRunDetails2DebugOnce = onceFlag
                  }
                  if (onceFlag.has(options.onceKey)) return
                  onceFlag.add(options.onceKey)
              }
          }
        : () => {}

const summarizeDataShape = (value: unknown): string => {
    if (value === null) return "null"
    if (value === undefined) return "undefined"
    if (typeof value === "string") {
        return value.length > 160 ? `string(${value.slice(0, 160)}…)` : `string(${value})`
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value)
    }
    if (Array.isArray(value)) {
        return `array(len=${value.length})`
    }
    if (typeof value === "object") {
        const keys = Object.keys(value as Record<string, unknown>)
        const preview = keys.slice(0, 10).join(", ")
        const suffix = keys.length > 10 ? "…" : ""
        return `object(keys=[${preview}${suffix}])`
    }
    return typeof value
}

interface ScenarioColumnValueAtomParams {
    scenarioId?: string
    runId?: string
    column: ColumnValueConfig
}

const defaultResult: ScenarioStepValueResult = {
    value: undefined,
    displayValue: undefined,
    isLoading: false,
    isFetching: false,
    error: undefined,
}

const scenarioColumnValueBaseAtomFamily = atomFamily(
    ({scenarioId, runId: paramRunId, column}: ScenarioColumnValueAtomParams) =>
        atom<ScenarioStepValueResult>((get) => {
            if (!scenarioId) {
                return EMPTY_RESULT
            }

            const runId = paramRunId ?? get(activePreviewRunIdAtom)
            if (!runId) {
                debugScenarioValue("Missing runId when resolving column value", {
                    scenarioId,
                    columnId: column.id,
                    stepType: column.stepType,
                })
            }
            const evalType = get(previewEvalTypeAtom)

            const stepsQuery = get(scenarioStepsQueryFamily({scenarioId, runId}))
            // Stale-while-revalidate: only show loading when there's no data yet
            // Don't show loading during background refetches (isFetching with existing data)
            const hasStepsData = Boolean(stepsQuery.data)
            const stepsQueryLoading =
                !hasStepsData && (stepsQuery.isLoading || stepsQuery.isPending)
            const baseSteps = stepsQuery.data?.steps ?? []
            const runIndex = get(evaluationRunIndexAtomFamily(runId ?? null))
            const derivedByKind = extractStepsByKind(baseSteps, runIndex)
            const inputs = derivedByKind.inputs
            const invocations = derivedByKind.invocations
            const annotations = derivedByKind.annotations
            const steps = baseSteps

            const descriptorMap = get(columnValueDescriptorMapAtomFamily(runId ?? null))
            const descriptor =
                (descriptorMap && column.id ? descriptorMap[column.id] : undefined) ??
                createColumnValueDescriptor(toDescriptorInput(column), null)

            if (column.stepType === "input") {
                if (column.enabled === false) {
                    return {
                        value: undefined,
                        displayValue: undefined,
                        isLoading: false,
                        isFetching: false,
                        error: undefined,
                    }
                }

                // Get testcase entity and metadata for this scenario
                const testcaseMeta = get(scenarioTestcaseMetaAtomFamily({scenarioId, runId}))

                // Primary source: testcase entity (when testcaseId exists)
                if (testcaseMeta.hasTestcase) {
                    const valueFromTestcase = get(
                        scenarioTestcaseValueAtomFamily({scenarioId, runId, path: column.path}),
                    )

                    if (valueFromTestcase !== undefined) {
                        // Stale-while-revalidate: if we have a value, never show loading
                        return {
                            value: valueFromTestcase,
                            displayValue: valueFromTestcase,
                            isLoading: false,
                            isFetching: testcaseMeta.isFetching,
                            error: testcaseMeta.error,
                        }
                    }

                    // If testcase exists but value not found at path, only show loading on initial load
                    // (when isLoading is true and we haven't found any value yet)
                    if (testcaseMeta.isLoading) {
                        return {
                            value: undefined,
                            displayValue: undefined,
                            isLoading: true,
                            isFetching: testcaseMeta.isFetching,
                            error: undefined,
                        }
                    }
                }

                // Fallback for online evaluations: step data or trace data
                const targetStep = pickStep(inputs.length ? inputs : steps, column.stepKey)
                const pathSegments = descriptor.pathSegments

                // Try step's embedded inputs first
                const stepValue = resolveInputStepValueByPath(targetStep, pathSegments)
                if (stepValue !== undefined) {
                    return {
                        value: stepValue,
                        displayValue: stepValue,
                        isLoading: false,
                        isFetching: false,
                        error: undefined,
                    }
                }

                // Try local trace data
                const localTrace = (targetStep as any)?.trace
                if (localTrace) {
                    const traceCandidates: {path: string; valueKey?: string}[] = [
                        {path: column.path, valueKey: column.valueKey},
                    ]
                    if (column.path.endsWith(".inputs")) {
                        traceCandidates.push({
                            path: column.path.slice(0, -".inputs".length),
                            valueKey: column.valueKey,
                        })
                    }

                    for (const candidate of traceCandidates) {
                        const localTraceValue = resolveInvocationTraceValue(
                            localTrace,
                            candidate.path,
                            candidate.valueKey,
                        )
                        if (localTraceValue !== undefined) {
                            return {
                                value: localTraceValue,
                                displayValue: localTraceValue,
                                isLoading: false,
                                isFetching: false,
                                error: undefined,
                            }
                        }
                    }
                }

                // Last resort: fetch from remote trace
                const traceId = toTraceId(targetStep)
                if (traceId) {
                    const traceMeta = get(traceQueryMetaAtomFamily({traceId, runId}))
                    const traceCandidates: {path: string; valueKey?: string}[] = [
                        {path: column.path, valueKey: column.valueKey},
                    ]
                    if (column.path.endsWith(".inputs")) {
                        traceCandidates.push({
                            path: column.path.slice(0, -".inputs".length),
                            valueKey: column.valueKey,
                        })
                    }

                    for (const candidate of traceCandidates) {
                        const remoteTraceValue = get(
                            traceValueAtomFamily({
                                traceId,
                                path: candidate.path,
                                valueKey: candidate.valueKey,
                                runId,
                            }),
                        )
                        if (remoteTraceValue !== undefined) {
                            return {
                                value: remoteTraceValue,
                                displayValue: remoteTraceValue,
                                isLoading: false,
                                isFetching: false,
                                error: undefined,
                            }
                        }
                    }

                    // Still loading trace data
                    if (traceMeta?.isLoading) {
                        return {
                            value: undefined,
                            displayValue: undefined,
                            isLoading: true,
                            isFetching: traceMeta.isFetching ?? false,
                            error: undefined,
                        }
                    }

                    return {
                        value: undefined,
                        displayValue: undefined,
                        isLoading: false,
                        isFetching: false,
                        error: traceMeta?.error,
                    }
                }

                // No data source available
                if (!stepsQueryLoading && !testcaseMeta.isLoading) {
                    debugScenarioValue("Input column resolved empty value", {
                        scenarioId,
                        runId,
                        columnId: column.id,
                        path: column.path,
                        stepKey: column.stepKey,
                        hasTestcase: testcaseMeta.hasTestcase,
                    })
                }

                return {
                    value: undefined,
                    displayValue: undefined,
                    isLoading: stepsQueryLoading || testcaseMeta.isLoading,
                    isFetching: Boolean(stepsQuery.isFetching) || testcaseMeta.isFetching,
                    error: testcaseMeta.error,
                }
            }

            if (column.stepType === "invocation") {
                if (column.enabled === false) {
                    return {
                        value: undefined,
                        displayValue: undefined,
                        isLoading: false,
                        isFetching: false,
                        error: undefined,
                    }
                }

                // Use findStepWithError to also check for step-level errors (e.g., invocation failures)
                const {step: targetStep, error: stepError} = findStepWithError(
                    invocations.length ? invocations : steps,
                    column.stepKey,
                )

                // If the step has an error (e.g., invocation failed), return early with the error
                if (stepError) {
                    return {
                        value: undefined,
                        displayValue: undefined,
                        isLoading: false,
                        isFetching: false,
                        error: undefined,
                        stepError,
                    }
                }

                const traceId = toTraceId(targetStep)
                const pathSegments = descriptor.pathSegments

                let scenarioInvocationValue: unknown = undefined
                if (invocations.length > 0 && column.stepKey) {
                    const invocationResponse = readInvocationResponse({
                        scenarioData: {invocationSteps: invocations},
                        stepKey: column.stepKey,
                        path: column.path,
                        scenarioId,
                        evalType: evalType as any,
                    })
                    scenarioInvocationValue =
                        invocationResponse.rawValue !== undefined
                            ? invocationResponse.rawValue
                            : invocationResponse.value
                }

                const traceMeta = traceId ? get(traceQueryMetaAtomFamily({traceId, runId})) : null
                let traceValue: unknown = undefined
                if (traceId && scenarioInvocationValue === undefined) {
                    const traceCandidates = descriptor.invocation?.traceValueCandidates ?? [
                        {
                            path: column.path,
                            valueKey: column.valueKey,
                        },
                    ]
                    for (const candidate of traceCandidates) {
                        const candidateValue = get(
                            traceValueAtomFamily({
                                traceId,
                                path: candidate.path,
                                valueKey: candidate.valueKey,
                                runId,
                            }),
                        )
                        if (candidateValue !== undefined) {
                            traceValue = candidateValue
                            break
                        }
                    }
                }

                const fallbackValue = resolveGenericStepValueByPath(targetStep, pathSegments)
                const value = scenarioInvocationValue ?? traceValue ?? fallbackValue

                const availableInvocationSteps =
                    invocations.length > 0
                        ? invocations.map((step: any) => ({
                              stepKey:
                                  step?.stepKey ??
                                  step?.key ??
                                  step?.step_key ??
                                  step?.scenarioStepKey,
                              traceId: step?.trace?.tree?.id ?? step?.traceId ?? step?.trace_id,
                              shape: summarizeDataShape(step),
                              dataShape: summarizeDataShape(step?.data),
                              resultShape: summarizeDataShape(step?.result),
                              outputsShape: summarizeDataShape(step?.outputs),
                          }))
                        : undefined

                debugScenarioValue(
                    "Invocation column probe",
                    {
                        scenarioId,
                        runId,
                        columnId: column.id,
                        columnPath: column.path,
                        valueKey: column.valueKey,
                        stepKey: column.stepKey,
                        resolvedTraceId: traceId,
                        scenarioInvocationValue: summarizeDataShape(scenarioInvocationValue),
                        traceValue: summarizeDataShape(traceValue),
                        fallbackValue: summarizeDataShape(fallbackValue),
                        pathSegments,
                        targetStepShape: summarizeDataShape(targetStep),
                        traceMetaState: {
                            isLoading: traceMeta?.isLoading,
                            isFetching: traceMeta?.isFetching,
                            error: traceMeta?.error ? String(traceMeta.error) : undefined,
                        },
                        availableInvocationSteps,
                    },
                    {
                        onceKey: `${scenarioId ?? "unknown"}:${column.id}:${
                            column.path
                        }:${stepsQueryLoading || traceMeta?.isLoading ? "loading" : "ready"}`,
                    },
                )

                if (
                    (value === undefined || value === null) &&
                    !stepsQueryLoading &&
                    !stepsQuery.isLoading &&
                    !(traceMeta?.isLoading ?? false)
                ) {
                    debugScenarioValue("Invocation column resolved empty value", {
                        scenarioId,
                        runId,
                        columnId: column.id,
                        path: column.path,
                        stepKey: column.stepKey,
                        hasTargetStep: Boolean(targetStep),
                        hasScenarioInvocationValue:
                            scenarioInvocationValue !== undefined &&
                            scenarioInvocationValue !== null,
                        hasTraceData: Boolean(traceValue),
                    })
                }

                // Stale-while-revalidate: only show loading if we have no value yet
                const hasValue =
                    value !== undefined ||
                    scenarioInvocationValue !== undefined ||
                    traceValue !== undefined ||
                    fallbackValue !== undefined
                return {
                    value,
                    displayValue: value,
                    isLoading:
                        !scenarioId ||
                        (!hasValue && stepsQueryLoading) ||
                        (!hasValue && Boolean(traceMeta?.isLoading)),
                    isFetching: Boolean(stepsQuery.isFetching) || Boolean(traceMeta?.isFetching),
                    error: traceMeta?.error,
                }
            }

            const shouldAttemptMetricLookup =
                column.enabled !== false &&
                scenarioId &&
                (column.stepType === "metric" ||
                    column.columnKind === "metric" ||
                    (column.stepType === "annotation" && Boolean(column.metricKey)))

            // For metric columns, check for step errors before attempting metric lookup
            // This ensures evaluator errors are displayed in metric cells
            if (
                shouldAttemptMetricLookup &&
                column.stepKey &&
                (column.stepType === "metric" || column.columnKind === "metric")
            ) {
                const {error: stepError} = findStepWithError(
                    annotations.length ? annotations : steps,
                    column.stepKey,
                )
                if (stepError) {
                    return {
                        value: undefined,
                        displayValue: undefined,
                        isLoading: false,
                        isFetching: false,
                        error: undefined,
                        stepError,
                    }
                }
            }

            let metricCandidate: ScenarioStepValueResult | null = null

            if (shouldAttemptMetricLookup) {
                const metricMeta = get(
                    scenarioMetricMetaAtomFamily({scenarioId: scenarioId as string, runId}),
                )

                const candidateStepKeys: (string | null | undefined)[] = []
                const pushCandidate = (key?: string | null) => {
                    if (!key) return
                    if (!candidateStepKeys.includes(key)) {
                        candidateStepKeys.push(key)
                    }
                }

                pushCandidate(column.stepKey ?? null)
                invocations.forEach((invocationStep) => {
                    const possibleKeys = [
                        (invocationStep as any)?.stepKey,
                        (invocationStep as any)?.key,
                        (invocationStep as any)?.step_key,
                        (invocationStep as any)?.scenarioStepKey,
                    ]
                        .map((maybe) => (typeof maybe === "string" && maybe.length ? maybe : null))
                        .filter(Boolean) as string[]
                    possibleKeys.forEach(pushCandidate)
                })

                // Only fall back to null stepKey if the column doesn't have a specific stepKey.
                // This prevents cross-evaluator matching when comparing runs with different
                // evaluator configurations (e.g., matching "success" from exact-match when
                // looking for similarity-match's "success").
                if (!column.stepKey && !candidateStepKeys.includes(null)) {
                    candidateStepKeys.push(null)
                }

                let metricValue: unknown = undefined
                let resolvedMetricStepKey: string | null | undefined = null

                for (const candidateStepKey of candidateStepKeys) {
                    const nextValue = get(
                        scenarioMetricValueAtomFamily({
                            scenarioId: scenarioId as string,
                            path: column.path,
                            metricKey: column.metricKey,
                            stepKey: candidateStepKey ?? undefined,
                            evaluatorId: column.evaluatorId ?? null,
                            evaluatorSlug: column.evaluatorSlug ?? null,
                            runId,
                            columnId: column.id,
                        }),
                    )

                    if (nextValue !== undefined) {
                        metricValue = nextValue
                        resolvedMetricStepKey = candidateStepKey
                        break
                    }
                }

                const metricDisplayValue = formatMetricDisplay({
                    value: metricValue,
                    metricKey: column.metricKey ?? column.valueKey ?? column.path,
                    metricType: column.metricType,
                })

                // Check if this is a string-type placeholder (no actual value)
                // String metrics don't store values, so we need to fall back to annotation data
                const isPlaceholder = isStringTypePlaceholder(metricValue)

                // Stale-while-revalidate: only show loading if we have no metric value yet
                const hasMetricValue = metricValue !== undefined && !isPlaceholder
                metricCandidate = {
                    value: isPlaceholder ? undefined : metricValue,
                    displayValue: isPlaceholder ? undefined : metricDisplayValue,
                    isLoading: !hasMetricValue && metricMeta.isLoading,
                    isFetching: metricMeta.isFetching,
                    error: metricMeta.error,
                    resolvedStepKey: resolvedMetricStepKey,
                } as ScenarioStepValueResult & {resolvedStepKey?: string | null | undefined}

                // For metric columns, return immediately unless it's a string-type placeholder
                // String-type placeholders need to fall through to annotation lookup
                if (column.stepType === "metric" || column.columnKind === "metric") {
                    if (!isPlaceholder) {
                        return metricCandidate
                    }
                    // Fall through to annotation lookup for string-type metrics
                }

                const isOutputLikeColumn = isOutputsColumn(column)

                if (
                    !isOutputLikeColumn &&
                    !isPlaceholder &&
                    metricValue !== undefined &&
                    metricValue !== null &&
                    metricCandidate.isLoading === false
                ) {
                    return metricCandidate
                }

                if (metricMeta.isLoading || metricMeta.isFetching) {
                    return metricCandidate
                }

                // For string-type metrics, fall through to annotation lookup
                if (isPlaceholder) {
                    // For string metrics, we need to use the INVOCATION's trace ID to query annotations
                    // (not the annotation step's trace ID, which is the annotation's own ID)
                    // The annotation query API looks for annotations by their links.*.trace_id
                    const invocationStep = invocations[0]
                    const invocationTraceId = toTraceId(invocationStep)

                    // If steps are still loading, we don't have the invocation trace ID yet
                    // Return loading state to prevent showing empty value prematurely
                    if (!invocationTraceId && stepsQueryLoading) {
                        return {
                            value: undefined,
                            displayValue: undefined,
                            isLoading: true,
                            isFetching: stepsQuery.isFetching,
                            error: undefined,
                        }
                    }

                    if (invocationTraceId) {
                        const annotationQuery = get(
                            evaluationAnnotationQueryAtomFamily({
                                traceId: invocationTraceId,
                                runId,
                            }),
                        ) as QueryState<AnnotationDto[] | null>

                        // If annotation query is still loading, indicate loading state
                        // This ensures the cell shows a loading indicator until annotation data is ready
                        if (annotationQuery.isLoading || annotationQuery.isFetching) {
                            return {
                                value: undefined,
                                displayValue: undefined,
                                isLoading: true,
                                isFetching: annotationQuery.isFetching,
                                error: undefined,
                            }
                        }

                        // Filter annotations by evaluator slug to get the right one for this column
                        const allAnnotations = annotationQuery.data ?? []
                        const evaluatorSlug = column.stepKey?.split(".").pop() // e.g., "new-human" from "completion_testset-xxx.new-human"
                        const evaluatorId = column.evaluatorId ?? column.evaluatorSlug ?? null

                        // Try multiple matching strategies for finding the right annotation
                        const matchingAnnotation = allAnnotations.find((ann: AnnotationDto) => {
                            const annEvaluatorSlug = ann?.references?.evaluator?.slug
                            const annEvaluatorId = ann?.references?.evaluator?.id
                            const annEvaluatorRevisionSlug =
                                ann?.references?.evaluator_revision?.slug

                            // Match by evaluator slug from step key
                            if (evaluatorSlug && annEvaluatorSlug === evaluatorSlug) return true
                            // Match by evaluator revision slug from step key (for SDK evaluators)
                            if (evaluatorSlug && annEvaluatorRevisionSlug === evaluatorSlug)
                                return true
                            // Match by evaluator ID
                            if (
                                evaluatorId &&
                                (annEvaluatorId === evaluatorId || annEvaluatorSlug === evaluatorId)
                            )
                                return true
                            // Match by column's evaluator slug
                            if (column.evaluatorSlug && annEvaluatorSlug === column.evaluatorSlug)
                                return true
                            // Match by column's evaluator slug against revision slug (for SDK evaluators)
                            if (
                                column.evaluatorSlug &&
                                annEvaluatorRevisionSlug === column.evaluatorSlug
                            )
                                return true

                            return false
                        })

                        // If no specific match found, use the first annotation as fallback
                        // (for cases where there's only one annotation per trace)
                        const annotationData =
                            matchingAnnotation ??
                            (allAnnotations.length === 1 ? allAnnotations[0] : null)
                        const valueFromAnnotation = resolveAnnotationValue(
                            annotationData,
                            column,
                            descriptor,
                        )
                        if (valueFromAnnotation !== undefined) {
                            return {
                                value: valueFromAnnotation,
                                displayValue: formatMetricDisplay({
                                    value: valueFromAnnotation,
                                    metricKey: column.metricKey ?? column.valueKey ?? column.path,
                                    metricType: column.metricType,
                                }),
                                isLoading: false,
                                isFetching: false,
                                error: annotationQuery.error,
                            }
                        }
                    }
                    // If no annotation value found via invocation trace ID,
                    // fall through to the regular annotation column handling below
                    // which uses the annotation step's own trace ID
                }
            }

            if (column.stepType === "annotation") {
                if (column.enabled === false) {
                    return {
                        value: undefined,
                        displayValue: undefined,
                        isLoading: false,
                        isFetching: false,
                        error: undefined,
                    }
                }

                // Use findStepWithError to also check for step-level errors (e.g., evaluator failures)
                const {step: targetStep, error: stepError} = findStepWithError(
                    annotations.length ? annotations : steps,
                    column.stepKey,
                )

                // If the step has an error (e.g., evaluator failed), return early with the error
                if (stepError) {
                    return {
                        value: undefined,
                        displayValue: undefined,
                        isLoading: false,
                        isFetching: false,
                        error: undefined,
                        stepError,
                    }
                }

                const traceId = toTraceId(targetStep)
                const annotationQuery = traceId
                    ? (get(
                          evaluationAnnotationQueryAtomFamily({
                              traceId,
                              runId,
                          }),
                      ) as QueryState<AnnotationDto | null>)
                    : EMPTY_ANNOTATION_STATE

                const annotationData =
                    annotationQuery.data ?? (targetStep as any)?.annotation ?? null
                const pathSegments = descriptor.pathSegments
                const valueFromAnnotation = resolveAnnotationValue(
                    annotationData,
                    column,
                    descriptor,
                )
                const fallbackValue = resolveGenericStepValueByPath(targetStep, pathSegments)
                const metricValueSource =
                    metricCandidate?.value ?? metricCandidate?.displayValue ?? undefined
                const shouldCoerceBoolean = descriptor.annotation?.coerceBoolean ?? false

                const rawCandidates: {source: string; value: unknown}[] = []
                if (shouldCoerceBoolean && metricValueSource !== undefined) {
                    rawCandidates.push({source: "metric", value: metricValueSource})
                }
                rawCandidates.push(
                    {source: "annotation", value: valueFromAnnotation},
                    {source: "fallback", value: fallbackValue},
                )
                if (metricValueSource !== undefined) {
                    rawCandidates.push({source: "metric", value: metricValueSource})
                }

                const selectedCandidate = rawCandidates.find(
                    (candidate) => candidate.value !== undefined,
                ) ?? {source: "none", value: undefined}
                const rawValue = selectedCandidate.value
                const normalizedBoolean =
                    shouldCoerceBoolean && rawValue !== undefined
                        ? extractBooleanLike(rawValue)
                        : undefined
                const value = normalizedBoolean ?? rawValue
                const displaySource = normalizedBoolean ?? rawValue
                const displayValue =
                    displaySource === undefined
                        ? undefined
                        : shouldCoerceBoolean && normalizedBoolean !== undefined
                          ? normalizedBoolean
                          : formatMetricDisplay({
                                value: displaySource,
                                metricKey: column.metricKey ?? column.valueKey ?? column.path,
                                metricType: column.metricType,
                            })

                if (
                    (displaySource === undefined || displaySource === null) &&
                    !stepsQueryLoading &&
                    !stepsQuery.isLoading &&
                    !annotationQuery.isLoading
                ) {
                    debugScenarioValue("Annotation column resolved empty value", {
                        scenarioId,
                        runId,
                        columnId: column.id,
                        path: column.path,
                        stepKey: column.stepKey,
                        hasAnnotationData: Boolean(annotationData),
                    })
                }

                // Stale-while-revalidate: only show loading if we have no value yet
                const hasAnnotationValue =
                    value !== undefined ||
                    valueFromAnnotation !== undefined ||
                    fallbackValue !== undefined
                return {
                    value,
                    displayValue,
                    isLoading:
                        !scenarioId ||
                        (!hasAnnotationValue && (stepsQueryLoading || annotationQuery.isLoading)),
                    isFetching:
                        Boolean(stepsQuery.isFetching) || Boolean(annotationQuery.isFetching),
                    error: annotationQuery.error,
                }
            }

            if (metricCandidate) {
                return metricCandidate
            }

            return defaultResult
        }),
)

export const scenarioColumnValueAtomFamily = atomFamily(
    ({scenarioId, runId, column}: ScenarioColumnValueAtomParams) =>
        atom((get) => get(scenarioColumnValueBaseAtomFamily({scenarioId, runId, column}))),
)

export interface ScenarioColumnValueSelection {
    value: unknown
    displayValue?: unknown
    isLoading: boolean
    /** Error from the step itself (e.g., evaluator failure) */
    stepError?: StepError | null
}

export const scenarioColumnValueSelectionAtomFamily = atomFamily(
    ({scenarioId, runId, column}: ScenarioColumnValueAtomParams) =>
        selectAtom(
            scenarioColumnValueAtomFamily({scenarioId, runId, column}),
            (result): ScenarioColumnValueSelection => {
                const selection: ScenarioColumnValueSelection = {
                    value: result.value,
                    displayValue: result.displayValue,
                    isLoading: result.isLoading,
                    stepError: result.stepError,
                }

                debugScenarioValue("Column selection snapshot", {
                    scenarioId,
                    runId,
                    columnId: column.id,
                    stepType: column.stepType,
                    path: column.path,
                    valueShape: summarizeDataShape(selection.value),
                    isLoading: selection.isLoading,
                    hasStepError: Boolean(selection.stepError),
                })

                return selection
            },
            (prev, next) =>
                Object.is(prev.value, next.value) &&
                prev.isLoading === next.isLoading &&
                prev.stepError === next.stepError,
        ),
)
