import {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"
import {UseEvaluationRunScenarioStepsFetcherResult} from "@/oss/lib/hooks/useEvaluationRunScenarioSteps/types"
import {EvaluationStatus} from "@/oss/lib/Types"

interface ScenarioStep {
    stepKey?: string
    status?: string
    error?: unknown
    scenarioId?: string
    references?: {
        evaluator?: {slug?: string; key?: string}
        application?: {slug?: string}
    }
}

const FAILURE_STATUS_SET = new Set(
    [
        EvaluationStatus.FAILURE,
        EvaluationStatus.FAILED,
        EvaluationStatus.ERROR,
        EvaluationStatus.ERRORS,
        EvaluationStatus.AGGREGATION_FAILED,
        EvaluationStatus.FINISHED_WITH_ERRORS,
    ].map((status) => String(status).toLowerCase()),
)

const normalizeStatus = (status?: string): string => {
    if (!status) return ""
    return String(status).toLowerCase()
}

export const hasFailureStatus = (status?: string): boolean => {
    return FAILURE_STATUS_SET.has(normalizeStatus(status))
}

export const resolveErrorMessage = (error: unknown): string | undefined => {
    if (!error) return undefined
    if (typeof error === "string") return error

    if (error instanceof Error) {
        return error.stack || error.message
    }

    if (typeof error === "object" && error !== null) {
        const err = error as Record<string, unknown>
        const code =
            typeof err.code === "number"
                ? err.code
                : typeof err.statusCode === "number"
                  ? err.statusCode
                  : undefined
        const message =
            typeof err.message === "string"
                ? err.message
                : typeof err.detail === "string"
                  ? err.detail
                  : undefined
        const typeLink = typeof err.type === "string" ? err.type : undefined
        const stacktrace =
            typeof err.stacktrace === "string"
                ? err.stacktrace
                : typeof err.stack === "string"
                  ? err.stack
                  : undefined

        if (code || message || typeLink || stacktrace) {
            const lines: string[] = []
            if (code || message) {
                lines.push(`(${code ?? ""}) ${message ?? "Evaluator returned an error."}`.trim())
            }
            if (typeLink) {
                lines.push("", "For more information, please follow this link:", typeLink)
            }
            if (stacktrace) {
                lines.push("", "Stacktrace:", stacktrace)
            }
            return lines.join("\n").trim()
        }

        try {
            return JSON.stringify(error)
        } catch {
            return String(error)
        }
    }

    return String(error)
}

const matchesSlug = (step: ScenarioStep | undefined, slug: string): boolean => {
    if (!step || !slug) return false
    const candidates = [slug]
    const dashed = slug.replace(/\./g, "-")
    if (dashed !== slug) candidates.push(dashed)
    const underscored = slug.replace(/\./g, "_")
    if (underscored !== slug) candidates.push(underscored)

    const stepIdentifiers = [
        step.stepKey,
        step.references?.evaluator?.slug,
        step.references?.evaluator?.key,
        step.references?.application?.slug,
    ]
    for (const identifier of stepIdentifiers) {
        if (!identifier) continue
        const normalized = String(identifier).toLowerCase()
        const matched = candidates.some((candidate) => {
            const lowered = candidate.toLowerCase()
            return (
                normalized === lowered ||
                normalized.endsWith(`.${lowered}`) ||
                normalized.endsWith(`-${lowered}`) ||
                normalized.endsWith(`_${lowered}`)
            )
        })
        if (matched) return true
    }

    return false
}

const collectScenarioSteps = (
    data?: UseEvaluationRunScenarioStepsFetcherResult,
): ScenarioStep[] => {
    if (!data) return []
    const buckets: ScenarioStep[] = []
    if (Array.isArray(data.steps)) buckets.push(...(data.steps as ScenarioStep[]))
    if (Array.isArray(data.annotationSteps))
        buckets.push(...(data.annotationSteps as ScenarioStep[]))
    if (Array.isArray(data.invocationSteps))
        buckets.push(...(data.invocationSteps as ScenarioStep[]))
    return buckets
}

export const resolveStepFailure = ({
    data,
    scenarioId,
    slugCandidates,
    stepKey,
    debug,
}: {
    data?: UseEvaluationRunScenarioStepsFetcherResult
    scenarioId: string
    slugCandidates?: string[]
    stepKey?: string
    debug?: {metricKey: string; runId: string}
}): {status?: string; error?: string} | null => {
    if (!data) return null
    const steps = collectScenarioSteps(data)
    const failureCandidates = steps.filter((step) => hasFailureStatus(step?.status))

    let failingStep: ScenarioStep | undefined

    if (stepKey) {
        failingStep = failureCandidates.find((step) => step.stepKey === stepKey)
    }

    if (!failingStep && slugCandidates?.length) {
        for (const candidateSlug of slugCandidates) {
            if (!candidateSlug) continue
            const match = failureCandidates.find((step) => matchesSlug(step, candidateSlug))
            if (match) {
                failingStep = match

                break
            }
        }
    }

    if (failingStep) {
        return {
            status: failingStep.status,
            error: resolveErrorMessage(failingStep.error),
        }
    }

    const fallbackInvocation = (data.invocationSteps || []).find(
        (step) => step?.scenarioId === scenarioId && hasFailureStatus(step?.status),
    )

    if (fallbackInvocation) {
        return {
            status: fallbackInvocation.status,
            error: resolveErrorMessage(fallbackInvocation.error),
        }
    }

    return null
}

const OUTPUTS_PREFIX = "data.outputs."
const OUTPUT_SECTION_KEYS = ["metrics", "notes", "extra"] as const

const getNestedValue = (source: any, path?: string): any => {
    if (!source || !path) return undefined
    const segments = path.split(".").filter(Boolean)
    if (!segments.length) return undefined
    return segments.reduce<any>((acc, segment) => {
        if (acc === undefined || acc === null) return undefined
        return acc[segment]
    }, source)
}

const normalizeOutputsPath = (path?: string): string | undefined => {
    if (!path) return undefined
    if (path.startsWith(OUTPUTS_PREFIX)) {
        return path.slice(OUTPUTS_PREFIX.length)
    }
    if (path.startsWith("outputs.")) {
        return path.slice("outputs.".length)
    }
    return path
}

export const resolveAnnotationMetricValue = ({
    annotations,
    fieldPath,
    metricKey,
    name,
}: {
    annotations: AnnotationDto[]
    fieldPath?: string
    metricKey?: string
    name?: string
}) => {
    if (!annotations?.length) return undefined

    const fieldSegments = fieldPath?.split(".").filter(Boolean) ?? []

    const annotationsBySlug = new Map<string, AnnotationDto>()
    annotations.forEach((ann) => {
        const slug = ann?.references?.evaluator?.slug
        if (slug) annotationsBySlug.set(slug, ann)
    })

    const slugIndex = fieldSegments.findIndex((segment) => annotationsBySlug.has(segment))
    const slug = slugIndex >= 0 ? fieldSegments[slugIndex] : undefined
    const remainderSegments = slugIndex >= 0 ? fieldSegments.slice(slugIndex + 1) : fieldSegments
    const remainderPath = remainderSegments.length ? remainderSegments.join(".") : undefined

    const keyCandidates = Array.from(
        new Set(
            [metricKey, name, remainderSegments.at(-1), fieldSegments.at(-1)]
                .filter((key): key is string => Boolean(key))
                .map((key) => key),
        ),
    )

    const outputPathCandidates = Array.from(
        new Set(
            [
                normalizeOutputsPath(fieldPath),
                normalizeOutputsPath(remainderPath),
                ...keyCandidates.flatMap((key) =>
                    OUTPUT_SECTION_KEYS.map((section) => `${section}.${key}`),
                ),
            ].filter((path): path is string => Boolean(path)),
        ),
    )

    const rootPathCandidates = Array.from(
        new Set([fieldPath, remainderPath, ...keyCandidates].filter(Boolean) as string[]),
    )

    const prioritizedAnnotations = (() => {
        if (slug) {
            const matched = annotationsBySlug.get(slug)
            if (matched) return [matched]
        }

        const matchedByKey = annotations.filter((ann) => {
            const outputs = ann?.data?.outputs
            if (!outputs) return false
            return keyCandidates.some((key) =>
                OUTPUT_SECTION_KEYS.some(
                    (section) => getNestedValue(outputs[section], key) !== undefined,
                ),
            )
        })

        if (matchedByKey.length) return matchedByKey
        return annotations
    })()

    for (const ann of prioritizedAnnotations) {
        const outputs = ann?.data?.outputs ?? {}
        for (const path of outputPathCandidates) {
            const val = getNestedValue(outputs, path)
            if (val !== undefined) return val
        }

        for (const path of rootPathCandidates) {
            const val = getNestedValue(ann, path)
            if (val !== undefined) return val
        }
    }

    return undefined
}
