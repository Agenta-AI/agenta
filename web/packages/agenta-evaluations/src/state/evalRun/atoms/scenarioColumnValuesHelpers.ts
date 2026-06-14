/* eslint-disable @typescript-eslint/no-explicit-any -- relocated eval-run parity data layer (WP-4e-2b); reads dynamic backend-shaped payloads, logic unchanged */
import type {IStepResponse} from "../../../core"
import {resolveValueBySegments, splitPath} from "../utils/valueAccess"

import type {AnnotationDto} from "./annotationTypes"
import type {ColumnValueConfig, StepError} from "./scenarioColumnValues"
import type {ColumnValueDescriptor} from "./table/columnAccess"

export const getStepKind = (step: IStepResponse): string | undefined => {
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

export const pickStep = (steps: IStepResponse[], stepKey?: string): IStepResponse | undefined => {
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

export interface RunIndex {
    inputKeys?: Set<string>
    invocationKeys?: Set<string>
    annotationKeys?: Set<string>
}

export const extractStepsByKind = (steps: IStepResponse[], runIndex?: RunIndex | null) => {
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

export const extractBooleanLike = (value: unknown): boolean | undefined => {
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

export const toTraceId = (step: IStepResponse | undefined) => {
    if (!step) return undefined
    return (
        (step as any)?.traceId ||
        (step as any)?.trace_id ||
        (step as any)?.trace?.tree?.id ||
        undefined
    )
}

/**
 * Extract step error if the step has status "failure" and an error object.
 * This is used to display evaluator errors in the UI.
 */
export const extractStepError = (step: IStepResponse | undefined): StepError | null => {
    if (!step) return null
    const status = (step as any)?.status
    const error = (step as any)?.error
    if (status !== "failure" || error === undefined || error === null) return null

    if (typeof error === "object") {
        return {
            code: error.code,
            type: error.type,
            message: error.message ?? "Unknown error",
            stacktrace: error.stacktrace,
            raw: error,
        }
    }

    return {
        message: String(error),
        raw: error,
    }
}

/**
 * Find a step by stepKey and check if it has an error.
 */
export const findStepWithError = (
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
export const isStringTypePlaceholder = (value: unknown): boolean => {
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

export const resolveAnnotationValue = (
    annotationData: AnnotationDto | AnnotationDto[] | null | undefined,
    column: ColumnValueConfig,
    descriptor: ColumnValueDescriptor,
) => {
    if (!annotationData) return undefined

    // Handle array of annotations - use the first one (most recent)
    const annotation = Array.isArray(annotationData) ? annotationData[0] : annotationData
    if (!annotation) return undefined

    const pathSegments = descriptor.pathSegments ?? column.pathSegments ?? splitPath(column.path)
    const outputs = (annotation?.data?.outputs ?? {}) as Record<string, any>
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
