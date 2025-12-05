import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"

import type {IStepResponse} from "@/oss/lib/evaluations"
import type {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"

import {readInvocationResponse} from "../../../lib/traces/traceUtils"
import {previewEvalTypeAtom} from "../state/evalType"
import {formatMetricDisplay} from "../utils/metricFormatter"
import {resolveInvocationTraceValue} from "../utils/traceValue"
import {
    resolveGenericStepValueByPath,
    resolveInputStepValueByPath,
    resolveValueBySegments,
    splitPath,
} from "../utils/valueAccess"

import {evaluationAnnotationQueryAtomFamily} from "./annotations"
import {scenarioMetricMetaAtomFamily, scenarioMetricValueAtomFamily} from "./metrics"
import {activePreviewRunIdAtom} from "./run"
import {scenarioStepsQueryFamily} from "./scenarioSteps"
import type {EvaluationTableColumn} from "./table"
import {
    columnValueDescriptorMapAtomFamily,
    createColumnValueDescriptor,
    type ColumnDescriptorInput,
    type ColumnValueDescriptor,
} from "./table/columnAccess"
import {evaluationRunIndexAtomFamily} from "./table/run"
import {testcaseQueryMetaAtomFamily, testcaseValueAtomFamily} from "./table/testcases"
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

interface ColumnValueConfig {
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

const EMPTY_TESTCASE_STATE: QueryState<PreviewTestCase | null> = {
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

const getStepKind = (step: IStepResponse): string | undefined => {
    const raw =
        (step as any)?.kind ??
        (step as any)?.type ??
        (step as any)?.stepType ??
        (step as any)?.step_role ??
        (step as any)?.stepRole
    if (raw === "input" || raw === "invocation" || raw === "annotation" || raw === "metric") {
        return raw
    }
    return undefined
}

const pickStep = (steps: IStepResponse[], stepKey?: string): IStepResponse | undefined => {
    if (!steps.length) return undefined
    if (stepKey) {
        const match = steps.find((step) => {
            const possibleKeys = [
                (step as any)?.key,
                (step as any)?.stepKey,
                (step as any)?.step_key,
            ]
            return possibleKeys.includes(stepKey)
        })
        if (match) return match
    }
    return steps[0]
}

interface RunIndex {
    inputKeys?: Set<string>
    invocationKeys?: Set<string>
    annotationKeys?: Set<string>
}

const extractStepsByKind = (steps: IStepResponse[], runIndex?: RunIndex | null) => {
    const inputs: IStepResponse[] = []
    const invocations: IStepResponse[] = []
    const annotations: IStepResponse[] = []

    steps.forEach((step) => {
        const stepKey = (step as any)?.stepKey ?? (step as any)?.step_key ?? ""

        // Use runIndex for classification if available (most reliable)
        if (runIndex) {
            if (runIndex.inputKeys?.has(stepKey)) {
                inputs.push(step)
                return
            }
            if (runIndex.invocationKeys?.has(stepKey)) {
                invocations.push(step)
                return
            }
            if (runIndex.annotationKeys?.has(stepKey)) {
                annotations.push(step)
                return
            }
        }

        // Fallback to step properties if runIndex doesn't have the key
        const kind = getStepKind(step)
        if (kind === "input") {
            inputs.push(step)
        } else if (kind === "invocation") {
            invocations.push(step)
        } else if (kind === "annotation") {
            annotations.push(step)
        }
    })

    return {inputs, invocations, annotations}
}

const extractBooleanLike = (value: unknown): boolean | undefined => {
    if (typeof value === "boolean") return value
    if (typeof value === "number") {
        if (!Number.isFinite(value)) return undefined
        if (value === 0) return false
        if (value === 1) return true
    }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase()
        if (normalized === "true") return true
        if (normalized === "false") return false
    }
    if (value && typeof value === "object") {
        const typed = value as Record<string, unknown>
        if (typeof typed.success === "boolean") return typed.success
        if (typeof typed.passed === "boolean") return typed.passed
        if (typeof typed.value === "boolean") return typed.value
        if (typeof typed.score === "number") {
            if (!Number.isFinite(typed.score as number)) return undefined
            if ((typed.score as number) === 0) return false
            if ((typed.score as number) === 1) return true
        }
        const frequency = Array.isArray(typed.frequency)
            ? typed.frequency
            : Array.isArray((typed as any).freq)
              ? (typed as any).freq
              : null
        if (frequency && frequency.length) {
            const sorted = [...frequency].sort(
                (a: any, b: any) => (b?.count ?? 0) - (a?.count ?? 0),
            )
            for (const entry of sorted) {
                const candidate = extractBooleanLike(entry?.value)
                if (candidate !== undefined) return candidate
            }
        }
    }
    return undefined
}

const toTraceId = (step: IStepResponse | undefined) => {
    if (!step) return undefined
    return (
        (step as any)?.traceId ||
        (step as any)?.trace_id ||
        (step as any)?.trace?.tree?.id ||
        undefined
    )
}

const toTestcaseId = (step: IStepResponse | undefined) => {
    if (!step) return undefined
    return (step as any)?.testcaseId || (step as any)?.testcase_id || undefined
}

/**
 * Extract step error if the step has status "failure" and an error object.
 * This is used to display evaluator errors in the UI.
 */
const extractStepError = (step: IStepResponse | undefined): StepError | null => {
    if (!step) return null
    const status = (step as any)?.status
    const error = (step as any)?.error
    if (status === "failure" && error && typeof error === "object") {
        return {
            code: error.code,
            type: error.type,
            message: error.message ?? "Unknown error",
            stacktrace: error.stacktrace,
        }
    }
    return null
}

/**
 * Find a step by stepKey and check if it has an error.
 */
const findStepWithError = (
    steps: IStepResponse[],
    stepKey?: string,
): {step: IStepResponse | undefined; error: StepError | null} => {
    if (!steps.length) return {step: undefined, error: null}
    if (stepKey) {
        const match = steps.find((step) => {
            const possibleKeys = [
                (step as any)?.key,
                (step as any)?.stepKey,
                (step as any)?.step_key,
            ]
            return possibleKeys.includes(stepKey)
        })
        if (match) {
            return {step: match, error: extractStepError(match)}
        }
    }
    // Return first step if no stepKey match
    const firstStep = steps[0]
    return {step: firstStep, error: extractStepError(firstStep)}
}

/**
 * Detects if a metric value is just a "string type placeholder" without actual data.
 * String metrics don't store actual values (can't build distribution), so we get
 * `{"type":"string","count":N}` instead of the real value.
 * In this case, we should fall back to annotation data.
 */
const isStringTypePlaceholder = (value: unknown): boolean => {
    if (typeof value !== "object" || value === null) return false
    const obj = value as Record<string, unknown>
    // Check if it's a string-type metric placeholder: has type="string" and count, but no actual value
    if (obj.type === "string" && typeof obj.count === "number") {
        // If it only has type and count (and maybe other metadata), it's a placeholder
        const hasActualValue =
            obj.value !== undefined ||
            obj.freq !== undefined ||
            obj.frequency !== undefined ||
            obj.rank !== undefined ||
            obj.mean !== undefined
        return !hasActualValue
    }
    return false
}

const resolveAnnotationValue = (
    annotationData: AnnotationDto | AnnotationDto[] | null | undefined,
    column: ColumnValueConfig,
    descriptor: ColumnValueDescriptor,
) => {
    if (!annotationData) return undefined

    // Handle array of annotations - use the first one (most recent)
    const annotation = Array.isArray(annotationData) ? annotationData[0] : annotationData
    if (!annotation) return undefined

    const pathSegments = descriptor.pathSegments ?? column.pathSegments ?? splitPath(column.path)
    const outputs = annotation?.data?.outputs ?? {}
    const annotationDescriptor = descriptor.annotation
    const metricCandidates = annotationDescriptor?.metricPathCandidates ?? []

    // Extract the valueKey (last segment of the path) for direct lookup
    const valueKey = column.valueKey ?? pathSegments[pathSegments.length - 1]

    // First, try direct lookup by valueKey in each output category
    if (valueKey) {
        const directValue =
            outputs?.metrics?.[valueKey] ??
            outputs?.notes?.[valueKey] ??
            outputs?.extra?.[valueKey] ??
            outputs?.[valueKey]
        if (directValue !== undefined) {
            return directValue
        }
    }

    for (const segments of metricCandidates) {
        const metricValue =
            resolveValueBySegments(outputs?.metrics, segments) ??
            resolveValueBySegments(outputs?.notes, segments) ??
            resolveValueBySegments(outputs?.extra, segments) ??
            resolveValueBySegments(outputs, segments)
        if (metricValue !== undefined) {
            return metricValue
        }
    }

    const segmentVariants = annotationDescriptor?.segmentVariants ?? [pathSegments]

    const candidateSources: unknown[] = [
        {annotation: annotation},
        annotation,
        {attributes: {ag: annotation}},
        annotation?.data,
        outputs,
        outputs?.metrics,
        outputs?.notes,
        outputs?.extra,
    ].filter(Boolean)

    for (const segments of segmentVariants) {
        if (!segments || !segments.length) continue
        for (const source of candidateSources) {
            const result = resolveValueBySegments(source, segments)
            if (result !== undefined) {
                return result
            }
        }
    }

    return undefined
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
            const stepsQueryLoading = stepsQuery.isLoading || stepsQuery.isPending
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
                const targetStep = pickStep(inputs.length ? inputs : steps, column.stepKey)
                const testcaseId = toTestcaseId(targetStep)
                const pathSegments = descriptor.pathSegments
                const traceId = toTraceId(targetStep)
                const testcaseMeta = testcaseId
                    ? get(testcaseQueryMetaAtomFamily({testcaseId, runId}))
                    : null
                const valueFromTestcase = testcaseId
                    ? get(testcaseValueAtomFamily({testcaseId, path: column.path, runId}))
                    : undefined
                const stepValue = resolveInputStepValueByPath(targetStep, pathSegments)

                const traceCandidates: {path: string; valueKey?: string}[] = [
                    {path: column.path, valueKey: column.valueKey},
                ]
                if (column.path.endsWith(".inputs")) {
                    traceCandidates.push({
                        path: column.path.slice(0, -".inputs".length),
                        valueKey: column.valueKey,
                    })
                }

                let localTraceValue: unknown = undefined
                const localTrace = (targetStep as any)?.trace
                if (localTrace) {
                    for (const candidate of traceCandidates) {
                        localTraceValue = resolveInvocationTraceValue(
                            localTrace,
                            candidate.path,
                            candidate.valueKey,
                        )
                        if (localTraceValue !== undefined) break
                    }
                }

                let traceMeta: {isLoading?: boolean; isFetching?: boolean; error?: unknown} | null =
                    null
                let remoteTraceValue: unknown = undefined
                const shouldFetchRemoteTrace =
                    traceId &&
                    valueFromTestcase === undefined &&
                    stepValue === undefined &&
                    localTraceValue === undefined

                if (shouldFetchRemoteTrace && traceId) {
                    traceMeta = get(traceQueryMetaAtomFamily({traceId, runId})) ?? null
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
                            remoteTraceValue = candidateValue
                            break
                        }
                    }
                }

                const value =
                    valueFromTestcase ??
                    stepValue ??
                    localTraceValue ??
                    remoteTraceValue ??
                    undefined

                if (
                    (value === undefined || value === null) &&
                    !stepsQueryLoading &&
                    !stepsQuery.isLoading &&
                    !(testcaseMeta?.isLoading ?? false)
                ) {
                    debugScenarioValue("Input column resolved empty value", {
                        scenarioId,
                        runId,
                        columnId: column.id,
                        path: column.path,
                        stepKey: column.stepKey,
                        hasTargetStep: Boolean(targetStep),
                        hasTestcaseData: Boolean(valueFromTestcase),
                    })
                }

                return {
                    value,
                    displayValue: value,
                    isLoading:
                        !scenarioId ||
                        stepsQueryLoading ||
                        Boolean(stepsQuery.isLoading) ||
                        Boolean(
                            testcaseMeta?.isLoading &&
                                valueFromTestcase === undefined &&
                                stepValue === undefined &&
                                localTraceValue === undefined &&
                                remoteTraceValue === undefined,
                        ) ||
                        Boolean(
                            traceMeta?.isLoading &&
                                remoteTraceValue === undefined &&
                                valueFromTestcase === undefined &&
                                stepValue === undefined &&
                                localTraceValue === undefined,
                        ),
                    isFetching:
                        Boolean(stepsQuery.isFetching) ||
                        Boolean(
                            testcaseMeta?.isFetching &&
                                valueFromTestcase === undefined &&
                                stepValue === undefined &&
                                localTraceValue === undefined &&
                                remoteTraceValue === undefined,
                        ) ||
                        Boolean(
                            traceMeta?.isFetching &&
                                remoteTraceValue === undefined &&
                                valueFromTestcase === undefined &&
                                stepValue === undefined &&
                                localTraceValue === undefined,
                        ),
                    error:
                        valueFromTestcase !== undefined
                            ? testcaseMeta?.error
                            : (traceMeta?.error ?? testcaseMeta?.error),
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

                return {
                    value,
                    displayValue: value,
                    isLoading:
                        !scenarioId ||
                        stepsQueryLoading ||
                        Boolean(stepsQuery.isLoading) ||
                        Boolean(
                            traceMeta?.isLoading &&
                                scenarioInvocationValue === undefined &&
                                traceValue === undefined &&
                                fallbackValue === undefined,
                        ),
                    isFetching:
                        Boolean(stepsQuery.isFetching) ||
                        Boolean(
                            traceMeta?.isFetching &&
                                scenarioInvocationValue === undefined &&
                                traceValue === undefined &&
                                fallbackValue === undefined,
                        ),
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

                metricCandidate = {
                    value: isPlaceholder ? undefined : metricValue,
                    displayValue: isPlaceholder ? undefined : metricDisplayValue,
                    isLoading: metricMeta.isLoading,
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

                            // Match by evaluator slug from step key
                            if (evaluatorSlug && annEvaluatorSlug === evaluatorSlug) return true
                            // Match by evaluator ID
                            if (
                                evaluatorId &&
                                (annEvaluatorId === evaluatorId || annEvaluatorSlug === evaluatorId)
                            )
                                return true
                            // Match by column's evaluator slug
                            if (column.evaluatorSlug && annEvaluatorSlug === column.evaluatorSlug)
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

                return {
                    value,
                    displayValue,
                    isLoading:
                        !scenarioId ||
                        stepsQueryLoading ||
                        Boolean(stepsQuery.isLoading) ||
                        Boolean(
                            annotationQuery.isLoading &&
                                valueFromAnnotation === undefined &&
                                fallbackValue === undefined,
                        ),
                    isFetching:
                        Boolean(stepsQuery.isFetching) ||
                        Boolean(
                            annotationQuery.isFetching &&
                                valueFromAnnotation === undefined &&
                                fallbackValue === undefined,
                        ),
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
