/* eslint-disable @typescript-eslint/no-explicit-any -- relocated eval run-details view; OSS-owned loose payload shapes (see §11.4) */
import type {RunIndex} from "@agenta/evaluations/core"
import {canonicalizeMetricKey} from "@agenta/shared/metrics"

interface EvaluatorDefinitionLike {
    id?: string | null
    slug?: string | null
    name?: string | null
    metrics?: {path?: string | null; name?: string | null}[]
}

interface EvaluatorStepMeta {
    stepKey: string
    label: string
    evaluatorRef?: {id?: string | null; slug?: string | null} | null
}

export interface EvaluatorMetricDefinition {
    canonicalKey: string
    rawKey: string
    fullKey: string
    metricType?: string
}

export interface EvaluatorMetricEntry {
    stepKey: string
    label: string
    evaluatorRef?: {id?: string | null; slug?: string | null} | null
    metrics: EvaluatorMetricDefinition[]
}

const EVALUATOR_OUTPUT_PATH_PREFIXES = [
    "attributes.ag.data.outputs.",
    "ag.data.outputs.",
    "data.outputs.",
    "outputs.",
]

const isEvaluatorOutputMetric = (path: string) => {
    const normalized = canonicalizeMetricKey(path || "")
    return EVALUATOR_OUTPUT_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

export const extractEvaluatorRef = (rawRefs: Record<string, any> | undefined | null) => {
    if (!rawRefs) return {id: undefined, slug: undefined}

    const ref =
        rawRefs.evaluator ??
        rawRefs.evaluator_ref ??
        rawRefs.evaluatorRef ??
        rawRefs.evaluatorRevision ??
        rawRefs.evaluator_revision ??
        rawRefs.evaluator_revision_ref ??
        null

    const id =
        typeof ref?.id === "string" && ref.id.trim()
            ? ref.id.trim()
            : typeof rawRefs.evaluator_id === "string" && rawRefs.evaluator_id.trim()
              ? rawRefs.evaluator_id.trim()
              : undefined
    const slug =
        typeof ref?.slug === "string" && ref.slug.trim()
            ? ref.slug.trim()
            : typeof rawRefs.evaluator_slug === "string" && rawRefs.evaluator_slug.trim()
              ? rawRefs.evaluator_slug.trim()
              : undefined

    return {id, slug}
}

export const buildEvaluatorMetricEntries = (
    statsMap: Record<string, unknown> | null | undefined,
    evaluatorSteps: EvaluatorStepMeta[],
    fallbackMetricsByStep?: Record<string, EvaluatorMetricDefinition[]>,
    evaluatorDefinitions?: EvaluatorDefinitionLike[],
): EvaluatorMetricEntry[] => {
    if (!evaluatorSteps.length) {
        return []
    }

    return evaluatorSteps
        .map(({stepKey, label, evaluatorRef}) => {
            const prefix = `${stepKey}.`
            const unique = new Map<string, EvaluatorMetricDefinition>()
            const fallbackMetrics = fallbackMetricsByStep?.[stepKey] ?? []
            const fallbackByCanonicalKey = new Map<string, EvaluatorMetricDefinition>()
            const allowedCanonicalKeys = new Set(
                fallbackMetrics
                    .map((metric) => {
                        const canonicalKey =
                            metric.canonicalKey || canonicalizeMetricKey(metric.rawKey)
                        if (canonicalKey) {
                            fallbackByCanonicalKey.set(canonicalKey, {...metric, canonicalKey})
                        }
                        return canonicalKey
                    })
                    .filter((key): key is string => Boolean(key)),
            )
            const hasSchema = allowedCanonicalKeys.size > 0

            if (statsMap) {
                Object.keys(statsMap).forEach((key) => {
                    if (!key.startsWith(prefix)) return
                    const rawKey = key.slice(prefix.length)
                    if (!rawKey) return
                    const canonicalKey = canonicalizeMetricKey(rawKey)
                    if (!isEvaluatorOutputMetric(canonicalKey)) {
                        return
                    }
                    if (hasSchema && !allowedCanonicalKeys.has(canonicalKey)) {
                        if (!rawKey.startsWith("attributes.ag.data.outputs.")) {
                            return
                        }
                    }
                    if (!unique.has(canonicalKey)) {
                        const fallbackDefinition = fallbackByCanonicalKey.get(canonicalKey)
                        unique.set(canonicalKey, {
                            canonicalKey,
                            rawKey,
                            fullKey: key,
                            metricType: fallbackDefinition?.metricType,
                        })
                    }
                })
            }

            if (unique.size === 0 && fallbackMetricsByStep?.[stepKey]?.length) {
                fallbackMetricsByStep[stepKey].forEach((metric) => {
                    const fallbackKey = metric.canonicalKey ?? canonicalizeMetricKey(metric.rawKey)
                    if (!isEvaluatorOutputMetric(fallbackKey)) {
                        return
                    }
                    if (!unique.has(fallbackKey)) {
                        unique.set(fallbackKey, {
                            canonicalKey: fallbackKey,
                            rawKey: metric.rawKey,
                            fullKey: metric.fullKey,
                            metricType: metric.metricType,
                        })
                    }
                })
            }

            // Match by id OR slug (same as EvaluatorMetricsChart): refs may
            // carry the revision id while definitions are keyed by artifact id.
            const definition = evaluatorDefinitions?.find?.(
                (def) =>
                    (evaluatorRef?.id && def.id === evaluatorRef.id) ||
                    (evaluatorRef?.slug && def.slug === evaluatorRef.slug),
            )

            return {
                stepKey,
                label: definition?.name ?? label,
                evaluatorRef,
                metrics: Array.from(unique.values()),
            }
        })
        .filter((entry) => entry.metrics.length > 0)
}

const normalizeMetricPath = (path: string) => {
    const trimmed = (path || "").replace(/^[.]+/, "")
    if (!trimmed) return null
    if (trimmed.startsWith("attributes.")) return trimmed
    if (trimmed.startsWith("metrics.")) return `attributes.ag.${trimmed}`
    if (trimmed.startsWith("data.")) return `attributes.ag.${trimmed}`
    if (trimmed.startsWith("outputs.")) return `attributes.ag.${trimmed}`
    return `attributes.ag.data.outputs.${trimmed}`
}

export const buildEvaluatorFallbackMetricsByStep = (
    runIndex: RunIndex | null | undefined,
    evaluatorDefinitions: EvaluatorDefinitionLike[],
): Record<string, EvaluatorMetricDefinition[]> => {
    if (!runIndex || !evaluatorDefinitions.length) return {}

    const metricsBySlug = new Map<string, EvaluatorMetricDefinition[]>()
    const metricsById = new Map<string, EvaluatorMetricDefinition[]>()

    evaluatorDefinitions.forEach((definition) => {
        const entries =
            definition.metrics?.map((metric) => {
                const normalized = normalizeMetricPath(metric.path ?? metric.name ?? "")
                if (!normalized) return null
                if (!isEvaluatorOutputMetric(normalized)) return null
                return {
                    canonicalKey: canonicalizeMetricKey(normalized),
                    rawKey: normalized,
                    fullKey: normalized,
                    metricType: (metric as any).metricType,
                }
            }) ?? []
        const filtered = entries.filter(Boolean) as EvaluatorMetricDefinition[]
        if (!filtered.length) return
        if (definition.slug) {
            metricsBySlug.set(definition.slug, filtered)
        }
        if (definition.id) {
            metricsById.set(definition.id, filtered)
        }
    })

    const result: Record<string, EvaluatorMetricDefinition[]> = {}

    Array.from(runIndex.annotationKeys ?? []).forEach((stepKey) => {
        const stepMeta = runIndex.steps?.[stepKey]
        const evaluatorRef = extractEvaluatorRef(stepMeta?.refs)
        const candidates: EvaluatorMetricDefinition[] =
            (evaluatorRef.slug ? metricsBySlug.get(evaluatorRef.slug) : undefined) ??
            (evaluatorRef.id ? metricsById.get(evaluatorRef.id) : undefined) ??
            []
        if (!candidates.length) return
        result[stepKey] = candidates.map((metric) => ({
            canonicalKey: metric.canonicalKey,
            rawKey: metric.rawKey,
            fullKey: metric.fullKey.startsWith(`${stepKey}.`)
                ? metric.fullKey
                : `${stepKey}.${metric.rawKey}`,
            metricType: metric.metricType,
        }))
    })

    return result
}
