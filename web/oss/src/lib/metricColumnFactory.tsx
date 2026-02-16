import React from "react"

import {ColumnsType} from "antd/es/table"

import {MetricDetailsPopoverWrapper} from "@/oss/components/HumanEvaluations/assets/MetricDetailsPopover"
import {USEABLE_METRIC_TYPES} from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/constants"
import {getMetricsFromEvaluator} from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/transforms"
import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"
import {buildMetricSorter} from "@/oss/lib/metricSorter"
import {
    isSortableMetricType,
    BasicStats,
    canonicalizeMetricKey,
    getMetricValueWithAliases,
} from "@/oss/lib/metricUtils"

const METRIC_OUTPUT_PREFIX = "attributes.ag.data.outputs."
const METRIC_ANALYTICS_PREFIX = "attributes.ag.metrics."

const toTitleCase = (value: string): string =>
    value
        .replace(/[_\-.]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase())

const normalizeMetricLabel = (raw: unknown): string => {
    if (typeof raw !== "string") return "Metric"
    const trimmed = raw.trim()
    if (!trimmed) return "Metric"

    const stripPrefix = (value: string, prefix: string): string => {
        if (value === prefix) return ""
        return value.startsWith(prefix) ? value.slice(prefix.length) : value
    }

    let label = stripPrefix(trimmed, METRIC_OUTPUT_PREFIX)
    label = stripPrefix(label, "outputs.")
    label = stripPrefix(label, "outputs")
    label = stripPrefix(label, METRIC_ANALYTICS_PREFIX)
    label = stripPrefix(label, "metrics.")
    label = stripPrefix(label, "metrics")
    label = label.replace(/^attributes\.ag\./, "")

    label = label.replace(/\[(.+?)\]/g, "$1")

    if (!label) {
        label = trimmed
    }

    if (label.includes(".")) {
        return label
    }

    const titled = toTitleCase(label)
    return titled || trimmed
}

const resolveMetricStats = (
    metrics: Record<string, BasicStats> | undefined,
    candidates: (string | undefined)[],
    fallbackSuffix?: string,
): BasicStats | undefined => {
    if (!metrics) return undefined
    const allCandidates = [...candidates]
    if (fallbackSuffix) {
        candidates.forEach((key) => {
            if (!key || key.endsWith(fallbackSuffix)) return
            allCandidates.push(`${key}.${fallbackSuffix}`)
        })
    }

    for (const key of allCandidates) {
        if (!key) continue
        if (metrics[key]) return metrics[key]
        const canonical = canonicalizeMetricKey(key)
        if (canonical !== key && metrics[canonical]) return metrics[canonical]
        const alias = getMetricValueWithAliases<BasicStats>(metrics, key)
        if (alias) return alias
    }
    return undefined
}

import {EvaluationRow} from "../components/HumanEvaluations/types"

export interface BuildEvaluatorMetricColumnsParams {
    evaluator: EvaluatorDto
    runMetricsMap?: Record<string, Record<string, BasicStats>>
    hidePrimitiveTable?: boolean
    debug?: boolean
    resolveStepSlugs?: (params: {
        record: EvaluationRow
        evaluator: EvaluatorDto
    }) => string[] | undefined
    additionalSlugCandidates?: string[]
}

const deriveRunId = (record: EvaluationRow): string | undefined => {
    if (!record) return undefined
    if ("id" in record && typeof record.id === "string") return record.id
    if ("run_id" in record && typeof (record as any).run_id === "string")
        return (record as any).run_id
    if ("runId" in record && typeof (record as any).runId === "string") return (record as any).runId
    if ("key" in record && typeof record.key === "string") return record.key
    return undefined
}

const normalizeSlugList = (candidates?: (string | undefined)[]): string[] => {
    const unique = new Set(
        (candidates || [])
            .map((candidate) => (typeof candidate === "string" ? candidate.trim() : ""))
            .filter((candidate) => Boolean(candidate)),
    )
    return Array.from(unique) as string[]
}

export const buildMetricKeyCandidates = (metricKey: string, slugCandidates: string[]): string[] => {
    const resolvedSlugs = normalizeSlugList(slugCandidates)
    const variants = new Set<string>()

    const addOutputVariants = (key: string) => {
        if (!key) return
        if (key.startsWith("attributes.ag.data.outputs.")) {
            variants.add(key)
            const tail = key.slice("attributes.ag.data.outputs.".length)
            if (tail) variants.add(`outputs.${tail}`)
            else variants.add("outputs")
            return
        }
        if (key.startsWith("outputs.")) {
            variants.add(key)
            const tail = key.slice("outputs.".length)
            variants.add(`attributes.ag.data.outputs.${tail}`)
            return
        }
        if (key === "outputs") {
            variants.add(key)
            variants.add("attributes.ag.data.outputs")
            return
        }
        variants.add(`attributes.ag.data.outputs.${key}`)
    }

    const addAnalyticsVariants = (key: string) => {
        if (!key) return
        if (key.startsWith("attributes.ag.metrics.")) {
            variants.add(key)
            const tail = key.slice("attributes.ag.metrics.".length)
            if (tail) variants.add(`metrics.${tail}`)
            else variants.add("metrics")
            return
        }
        if (key.startsWith("metrics.")) {
            variants.add(key)
            const tail = key.slice("metrics.".length)
            variants.add(`attributes.ag.metrics.${tail}`)
            return
        }
        if (key === "metrics") {
            variants.add(key)
            variants.add("attributes.ag.metrics")
            return
        }
        variants.add(`attributes.ag.metrics.${key}`)
    }

    const registerVariants = (key: string) => {
        if (!key) return
        variants.add(key)
        addOutputVariants(key)
        addAnalyticsVariants(key)
    }

    registerVariants(metricKey)

    const baseVariants = Array.from(variants)

    resolvedSlugs.forEach((slug) => {
        if (!slug) return
        baseVariants.forEach((variant) => {
            variants.add(`${slug}.${variant}`)
        })
    })

    return Array.from(variants)
}

const flattenMetricDefinitions = (
    schema: Record<string, any> | undefined,
    prefix?: string,
    acc: Record<string, any> = {},
): Record<string, any> => {
    if (!schema || typeof schema !== "object") return acc

    Object.entries(schema).forEach(([key, rawValue]) => {
        if (!rawValue || typeof rawValue !== "object") return
        const value = rawValue.anyOf?.[0] || rawValue
        const name = prefix ? `${prefix}.${key}` : key
        const type = value?.type as string | undefined

        if (type === "object" && value?.properties && typeof value.properties === "object") {
            flattenMetricDefinitions(value.properties, name, acc)
            return
        }

        if (type === "array") {
            acc[name] = {...value, type}
            return
        }

        if (type && USEABLE_METRIC_TYPES.includes(type)) {
            acc[name] = {...value, type}
        }
    })

    return acc
}

const inferMetricTypeFromStats = (stats: BasicStats | undefined): string | undefined => {
    if (!stats) return undefined
    const numericCandidates = [(stats as any).mean, (stats as any).sum, (stats as any).max]
    if (numericCandidates.some((value) => typeof value === "number")) {
        return "number"
    }

    const frequency = Array.isArray((stats as any).frequency)
        ? ((stats as any).frequency as any[])
        : undefined

    if (frequency && frequency.length) {
        const sampleEntry = frequency.find((entry) => entry?.value !== undefined)
        const sample = sampleEntry?.value
        const sampleType = typeof sample
        if (sampleType === "boolean" || sampleType === "string") return sampleType
        if (sampleType === "number") return "number"
    }

    return undefined
}

const extractOutputsTail = (key: string): string | undefined => {
    if (!key) return undefined
    const lower = key.toLowerCase()
    if (lower.includes(METRIC_ANALYTICS_PREFIX)) return undefined
    const idx = lower.lastIndexOf(METRIC_OUTPUT_PREFIX)
    if (idx >= 0) {
        const tail = key.slice(idx + METRIC_OUTPUT_PREFIX.length)
        return tail || undefined
    }
    if (lower.startsWith("outputs.")) {
        return key.slice("outputs.".length)
    }
    if (!lower.startsWith("attributes.ag.metrics")) {
        return key
    }
    return undefined
}

const inferMetricDefinitionsFromStats = (
    runMetricsMap: Record<string, Record<string, BasicStats>> | undefined,
    slugCandidates: string[],
): Record<string, any> => {
    if (!runMetricsMap) return {}

    const normalizedSlugs = normalizeSlugList(slugCandidates)
    const derived = new Map<string, Record<string, any>>()

    const includesSlug = (rawKey: string): boolean => {
        if (!normalizedSlugs.length) return true
        return normalizedSlugs.some((slug) => {
            if (!slug) return false
            const slugPrefix = `${slug}.`
            if (rawKey.startsWith(slugPrefix)) return true
            return rawKey.includes(`.${slug}.`)
        })
    }

    const recordMetric = (metricKey: string, stats: BasicStats | undefined) => {
        if (
            !metricKey ||
            metricKey.startsWith(METRIC_ANALYTICS_PREFIX) ||
            metricKey.startsWith("metrics.") ||
            metricKey === "metrics" ||
            metricKey.startsWith("metric.") ||
            metricKey === "metric"
        )
            return
        const existing = derived.get(metricKey) ?? {}
        if (!existing.type) {
            const inferred = inferMetricTypeFromStats(stats)
            if (inferred) existing.type = inferred
        }
        derived.set(metricKey, existing)
    }

    Object.values(runMetricsMap).forEach((metrics) => {
        Object.entries(metrics || {}).forEach(([rawKey, stats]) => {
            if (typeof rawKey !== "string") return
            if (!includesSlug(rawKey)) return

            let stripped = rawKey
            for (const slug of normalizedSlugs) {
                if (!slug) continue
                const slugPrefix = `${slug}.`
                if (stripped.startsWith(slugPrefix)) {
                    stripped = stripped.slice(slugPrefix.length)
                    break
                }
            }

            const tail = extractOutputsTail(stripped)
            if (!tail) return
            recordMetric(tail, stats)
        })
    })

    return Object.fromEntries(derived.entries())
}

export function buildEvaluatorMetricColumns({
    evaluator,
    runMetricsMap,
    hidePrimitiveTable = false,
    debug = false,
    resolveStepSlugs,
    additionalSlugCandidates = [],
}: BuildEvaluatorMetricColumnsParams): ColumnsType<EvaluationRow> {
    const defaultSlugCandidates = normalizeSlugList([
        evaluator.slug,
        (evaluator as any)?.slug,
        (evaluator as any)?.id,
        (evaluator as any)?.key,
        ...(additionalSlugCandidates || []),
    ])

    const normalizedMetrics: Record<string, any> = {}

    const extractType = (candidate: any): string | undefined => {
        if (!candidate) return undefined
        if (typeof candidate === "string") return candidate
        if (Array.isArray(candidate)) {
            const str = candidate.find((value) => typeof value === "string")
            return typeof str === "string" ? str : undefined
        }
        if (typeof candidate?.type === "string") return candidate.type
        return undefined
    }

    const mergeMetricDefinition = (key: string, definition: any) => {
        if (!key || !definition) return
        const entry = normalizedMetrics[key] || {}
        const candidateType = extractType(definition.type ?? definition)
        if (candidateType && !entry.type) {
            entry.type = candidateType
        }
        const candidateLabel = definition.label ?? definition.title
        if (candidateLabel && !entry.label) {
            entry.label = candidateLabel
        }
        if (definition.description && !entry.description) {
            entry.description = definition.description
        }
        normalizedMetrics[key] = entry
    }

    const schemaFields = getMetricsFromEvaluator(evaluator) as Record<string, any>
    Object.entries(schemaFields || {}).forEach(([key, definition]) => {
        mergeMetricDefinition(key, definition)
    })

    const schemaDefinitions = flattenMetricDefinitions(
        evaluator.data?.service?.format?.properties?.outputs?.properties,
    )
    Object.entries(schemaDefinitions).forEach(([key, definition]) => {
        mergeMetricDefinition(key, definition)
    })

    const settingsValuesDefinitions = flattenMetricDefinitions(
        (evaluator as any)?.settings_values?.outputs,
    )
    Object.entries(settingsValuesDefinitions).forEach(([key, definition]) => {
        mergeMetricDefinition(key, definition)
    })

    const settingsDefinitions = flattenMetricDefinitions((evaluator as any)?.settings?.outputs)
    Object.entries(settingsDefinitions).forEach(([key, definition]) => {
        mergeMetricDefinition(key, definition)
    })

    const inferredMetricDefinitions = inferMetricDefinitionsFromStats(
        runMetricsMap,
        defaultSlugCandidates,
    )
    Object.entries(inferredMetricDefinitions).forEach(([key, definition]) => {
        mergeMetricDefinition(key, definition)
    })

    Object.entries(normalizedMetrics).forEach(([key, entry]) => {
        const candidate =
            typeof entry.label === "string" && entry.label.trim().length ? entry.label : undefined
        entry.label = normalizeMetricLabel(candidate ?? key)
    })

    const metricKeys = Object.keys(normalizedMetrics)
    const enrichedEvaluator = {...evaluator, metrics: normalizedMetrics}

    const resolveSlugsForRecord = (record: EvaluationRow | undefined): string[] => {
        if (!record) return defaultSlugCandidates
        const resolved = resolveStepSlugs?.({record, evaluator})
        const normalized = normalizeSlugList(resolved)
        if (normalized.length) return normalized
        return defaultSlugCandidates
    }

    const resolveMetricsForRecord = (
        record: EvaluationRow,
        metricKey: string,
    ): {runId?: string; candidates: string[]} => {
        const runId = deriveRunId(record)
        const slugCandidates = resolveSlugsForRecord(record)
        const candidates = buildMetricKeyCandidates(metricKey, slugCandidates)
        return {runId, candidates}
    }

    return metricKeys
        .map((metricKey) => {
            const schemaType = normalizedMetrics?.[metricKey]?.type
            const sortable = isSortableMetricType(schemaType)

            if (schemaType === "object") return null
            if (schemaType === "string") return null
            const definition = normalizedMetrics[metricKey] || {}
            const columnLabel = normalizeMetricLabel(definition.label ?? metricKey)

            return {
                key: `${evaluator.slug}:${metricKey}`,
                dataIndex: metricKey,
                title: (
                    <div className="flex flex-col gap-1 whitespace-nowrap">
                        <span>{columnLabel}</span>
                    </div>
                ),
                sorter: sortable
                    ? buildMetricSorter<EvaluationRow>((row) => {
                          const {runId, candidates} = resolveMetricsForRecord(row, metricKey)
                          const metrics = runMetricsMap?.[runId || ""]
                          return resolveMetricStats(metrics, candidates)
                      })
                    : undefined,
                render: (_: any, record: EvaluationRow) => {
                    const {runId, candidates} = resolveMetricsForRecord(record, metricKey)
                    const hasEvaluator = Array.isArray((record as any).evaluators)
                        ? (record as any).evaluators.some(
                              (e: EvaluatorDto) => e.slug === evaluator.slug,
                          )
                        : false

                    const effectiveRunId = runId || ""
                    const runMetric = runMetricsMap?.[effectiveRunId]
                    const stats = resolveMetricStats(runMetric, candidates)
                    const [effectiveSlug] = resolveSlugsForRecord(record)
                    const popoverSlug = effectiveSlug || evaluator.slug || metricKey
                    return hasEvaluator ? (
                        <MetricDetailsPopoverWrapper
                            runId={effectiveRunId}
                            evaluatorSlug={popoverSlug}
                            evaluatorMetricKey={metricKey}
                            evaluator={enrichedEvaluator}
                            statsOverride={stats}
                            hidePrimitiveTable={hidePrimitiveTable}
                            debug={debug}
                        />
                    ) : (
                        <div className="not-available-table-cell" />
                    )
                },
            } as any
        })
        .filter(Boolean) as ColumnsType<EvaluationRow>
}
