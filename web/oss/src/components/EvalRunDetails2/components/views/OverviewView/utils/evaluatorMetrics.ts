import {canonicalizeMetricKey} from "@/oss/lib/metricUtils"
import type {RunIndex} from "@/oss/lib/hooks/useEvaluationRunData/assets/helpers/buildRunIndex"

interface EvaluatorDefinitionLike {
    id?: string | null
    slug?: string | null
    metrics?: Array<{path?: string | null; name?: string | null}>
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
}

export interface EvaluatorMetricEntry {
    stepKey: string
    label: string
    evaluatorRef?: {id?: string | null; slug?: string | null} | null
    metrics: EvaluatorMetricDefinition[]
}

export const buildEvaluatorMetricEntries = (
    statsMap: Record<string, unknown> | null | undefined,
    evaluatorSteps: EvaluatorStepMeta[],
    fallbackMetricsByStep?: Record<string, EvaluatorMetricDefinition[]>,
): EvaluatorMetricEntry[] => {
    if (!evaluatorSteps.length) {
        return []
    }

    return evaluatorSteps
        .map(({stepKey, label, evaluatorRef}) => {
            const prefix = `${stepKey}.`
            const unique = new Map<string, EvaluatorMetricDefinition>()
            const fallbackMetrics = fallbackMetricsByStep?.[stepKey] ?? []
            const allowedCanonicalKeys = new Set(
                fallbackMetrics
                    .map((metric) => metric.canonicalKey || canonicalizeMetricKey(metric.rawKey))
                    .filter((key): key is string => Boolean(key)),
            )
            const hasSchema = allowedCanonicalKeys.size > 0

            if (statsMap) {
                Object.keys(statsMap).forEach((key) => {
                    if (!key.startsWith(prefix)) return
                    const rawKey = key.slice(prefix.length)
                    if (!rawKey) return
                    const canonicalKey = canonicalizeMetricKey(rawKey)
                    if (hasSchema && !allowedCanonicalKeys.has(canonicalKey)) {
                        return
                    }
                    if (!unique.has(canonicalKey)) {
                        unique.set(canonicalKey, {
                            canonicalKey,
                            rawKey,
                            fullKey: key,
                        })
                    }
                })
            }

            if (unique.size === 0 && fallbackMetricsByStep?.[stepKey]?.length) {
                fallbackMetricsByStep[stepKey].forEach((metric) => {
                    const fallbackKey = metric.canonicalKey ?? canonicalizeMetricKey(metric.rawKey)
                    if (!unique.has(fallbackKey)) {
                        unique.set(fallbackKey, {
                            canonicalKey: fallbackKey,
                            rawKey: metric.rawKey,
                            fullKey: metric.fullKey,
                        })
                    }
                })
            }

            return {
                stepKey,
                label,
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
                return {
                    canonicalKey: canonicalizeMetricKey(normalized),
                    rawKey: normalized,
                    fullKey: normalized,
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
        const evaluatorRef = stepMeta?.refs?.evaluator ?? {}
        const candidates =
            (evaluatorRef.slug && metricsBySlug.get(evaluatorRef.slug)) ||
            (evaluatorRef.id && metricsById.get(evaluatorRef.id)) ||
            []
        if (!candidates.length) return
        result[stepKey] = candidates.map((metric) => ({
            canonicalKey: metric.canonicalKey,
            rawKey: metric.rawKey,
            fullKey: metric.fullKey.startsWith(`${stepKey}.`)
                ? metric.fullKey
                : `${stepKey}.${metric.rawKey}`,
        }))
    })

    return result
}
