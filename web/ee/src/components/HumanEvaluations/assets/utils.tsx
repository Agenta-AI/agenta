import type {Dispatch, SetStateAction} from "react"

import UserAvatarTag from "@agenta/oss/src/components/ui/UserAvatarTag"
import VariantDetailsWithStatus from "@agenta/oss/src/components/VariantDetailsWithStatus"
import {GearSix} from "@phosphor-icons/react"
import {Statistic} from "antd"
import {ColumnsType} from "antd/es/table"
import {getDefaultStore, useAtomValue} from "jotai"
import uniqBy from "lodash/uniqBy"
import dynamic from "next/dynamic"

import {USEABLE_METRIC_TYPES} from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/constants"
import {getDefaultValue} from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/transforms"
import LabelValuePill from "@/oss/components/ui/LabelValuePill"
import {evaluatorsAtom} from "@/oss/lib/atoms/evaluation"
import {calculateAvgScore} from "@/oss/lib/helpers/evaluate"
import {
    RunIndex,
    ColumnDef,
    StepMeta,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/helpers/buildRunIndex"
import {IScenario} from "@/oss/lib/hooks/useEvaluationRunScenarios/types"
import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"
import {buildEvaluatorMetricColumns, buildMetricKeyCandidates} from "@/oss/lib/metricColumnFactory"
import {getMetricConfig, metricPriority} from "@/oss/lib/metrics/utils"
import {
    SchemaMetricType,
    canonicalizeMetricKey,
    getMetricValueWithAliases,
    summarizeMetric,
} from "@/oss/lib/metricUtils"
import {_Evaluation, EvaluationStatus} from "@/oss/lib/Types"
import {BasicStats} from "@/oss/services/runMetrics/api/types"
import {appDetailQueryAtomFamily} from "@/oss/state/app"

import {GeneralAutoEvalMetricColumns} from "../../EvalRunDetails/components/VirtualizedScenarioTable/assets/constants"
import {extractPrimaryInvocation, extractEvaluationAppId} from "../../pages/evaluations/utils"
import {EvaluationRow} from "../types"

import EvaluationStatusCell from "./EvaluationStatusCell"
import {LegacyEvalResultCell, LegacyEvalResultCellTitle} from "./LegacyEvalResultCell"
import MetricDetailsPopover from "./MetricDetailsPopover"
import {formatMetricValue} from "./MetricDetailsPopover/assets/utils"

const TableDropdownMenu = dynamic(() => import("./TableDropdownMenu"), {
    ssr: false,
    loading: () => <div className="w-16 h-16"></div>,
})

const ALLOWED_AUTO_INVOCATION_METRIC_KEYS = new Set(
    GeneralAutoEvalMetricColumns.map((column) => canonicalizeMetricKey(column.path)),
)
const isUuidLike = (value: string | undefined): boolean => {
    if (!value) return false
    const trimmed = value.trim()
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
}

const stripVariantSuffix = (value: string | undefined): string | undefined => {
    if (!value) return undefined
    const trimmed = value.trim()
    if (!trimmed) return undefined
    const parts = trimmed.split("-")
    if (parts.length <= 1) return trimmed
    const last = parts[parts.length - 1]
    if (/^[0-9a-f]{6,}$/i.test(last)) {
        const candidate = parts.slice(0, -1).join("-")
        return candidate || trimmed
    }
    return trimmed
}

const inferAppNameFromEvaluationName = (name: unknown): string | undefined => {
    if (typeof name !== "string" || !name.trim()) return undefined
    const candidate = stripVariantSuffix(name.trim())
    if (candidate && !isUuidLike(candidate)) return candidate
    return undefined
}

const titleCase = (value: string) =>
    value
        .replace(/[_-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase())

const resolveMetricStats = (
    metrics: Record<string, BasicStats> | undefined,
    candidateKeys: (string | undefined)[],
): BasicStats | undefined => {
    if (!metrics) return undefined
    for (const key of candidateKeys) {
        if (!key) continue
        if (metrics[key]) return metrics[key]
        const canonical = canonicalizeMetricKey(key)
        if (canonical !== key && metrics[canonical]) return metrics[canonical]
        const alias = getMetricValueWithAliases<BasicStats>(metrics, key)
        if (alias) return alias
    }
    return undefined
}

const labelForRunMetric = (canonicalKey: string) => {
    if (canonicalKey.startsWith("attributes.ag.data.")) {
        const tail = canonicalKey.split(".").pop() || canonicalKey
        return titleCase(tail)
    }
    const {label} = getMetricConfig(canonicalKey)
    return label
}

const OUTPUT_PREFIX = "attributes.ag.data.outputs."
const ANALYTICS_PREFIX = "attributes.ag.metrics."

const stripMetricPrefix = (value: string): string | undefined => {
    if (value.startsWith(OUTPUT_PREFIX)) return value.slice(OUTPUT_PREFIX.length)
    if (value.startsWith(ANALYTICS_PREFIX)) return value.slice(ANALYTICS_PREFIX.length)
    return undefined
}

const isOutputMetricKey = (
    value: string,
): {isKey: boolean; normalized?: string; leafMetric?: string; prefix?: "outputs" | "metrics"} => {
    if (!value) return {isKey: false}
    const canonical = canonicalizeMetricKey(value)
    const outputIdx = canonical.indexOf(OUTPUT_PREFIX)
    const analyticsIdx = canonical.indexOf(ANALYTICS_PREFIX)
    let normalized: string | undefined
    let suffix: string | undefined
    let prefix: "outputs" | "metrics" | undefined
    if (outputIdx !== -1) {
        normalized = canonical.slice(outputIdx)
        suffix = normalized.slice(OUTPUT_PREFIX.length)
        prefix = "outputs"
    } else if (analyticsIdx !== -1) {
        normalized = canonical.slice(analyticsIdx)
        suffix = normalized.slice(ANALYTICS_PREFIX.length)
        prefix = "metrics"
    }
    if (!normalized || !suffix) return {isKey: false}
    const trimmedSuffix = suffix.replace(/^\.+/, "")
    if (!trimmedSuffix) return {isKey: false}
    const leafMetric = trimmedSuffix
    return {isKey: true, normalized, leafMetric, prefix}
}

const normalizeIdentifier = (value: unknown): string | undefined => {
    if (value === null || value === undefined) return undefined
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    return undefined
}

const getRunIdFromEvaluation = (evaluation: EvaluationRow | any): string | undefined => {
    if (!evaluation || typeof evaluation !== "object") return undefined
    const candidates = [
        normalizeIdentifier((evaluation as any).id),
        normalizeIdentifier((evaluation as any).run_id),
        normalizeIdentifier((evaluation as any).runId),
        normalizeIdentifier((evaluation as any).key),
    ].filter(Boolean) as string[]
    return candidates[0]
}

const deriveStepSlugFromKey = (key?: string): string | undefined => {
    if (!key || typeof key !== "string") return undefined
    const trimmed = key.trim()
    if (!trimmed) return undefined
    const parts = trimmed.split(".").filter(Boolean)
    if (parts.length >= 2) return parts[parts.length - 1]
    return parts[0]
}

const collectReferenceIdentifiers = (meta?: StepMeta): string[] => {
    if (!meta) return []
    const refs = meta.refs ?? {}
    const candidates = [
        refs?.evaluator?.slug,
        refs?.evaluator?.id,
        refs?.evaluator?.key,
        refs?.evaluatorVariant?.slug,
        refs?.evaluatorVariant?.id,
        refs?.evaluatorVariant?.key,
        refs?.evaluatorRevision?.slug,
        refs?.evaluatorRevision?.id,
        refs?.evaluatorRevision?.key,
    ]
    return (candidates.map(normalizeIdentifier).filter(Boolean) as string[]) ?? []
}

const collectEvaluatorIdentifiers = (evaluator?: EvaluatorDto): Set<string> => {
    const identifiers = [
        normalizeIdentifier(evaluator?.slug),
        normalizeIdentifier((evaluator as any)?.id),
        normalizeIdentifier((evaluator as any)?.key),
    ].filter(Boolean) as string[]
    return new Set(identifiers)
}

const collectStepSlugsFromRunIndex = (
    runIndex: RunIndex | undefined,
    evaluator: EvaluatorDto,
): string[] => {
    if (!runIndex) return []
    const matches = new Set<string>()
    const evaluatorIdentifiers = collectEvaluatorIdentifiers(evaluator)
    Object.values(runIndex.steps ?? {}).forEach((meta) => {
        if (!meta || meta.kind !== "annotation") return
        const stepSlug = deriveStepSlugFromKey(meta.key)
        if (!stepSlug) return
        const referenceCandidates = collectReferenceIdentifiers(meta)
        const hasRefMatch = referenceCandidates.some((candidate) =>
            evaluatorIdentifiers.has(candidate),
        )
        const matchesByKey =
            evaluator?.slug && typeof meta.key === "string"
                ? meta.key.endsWith(`.${evaluator.slug}`) || meta.key === evaluator.slug
                : false
        if (hasRefMatch || matchesByKey || evaluatorIdentifiers.has(stepSlug)) {
            matches.add(stepSlug)
        }
    })
    return Array.from(matches)
}

const collectStepIdentifiersForEvaluator = (
    runIndexes: Record<string, RunIndex | undefined>,
    evaluator: EvaluatorDto,
): string[] => {
    if (!runIndexes || !evaluator) return []
    const identifiers = new Set<string>()
    const evaluatorIdentifiers = collectEvaluatorIdentifiers(evaluator)

    Object.values(runIndexes).forEach((runIndex) => {
        if (!runIndex) return

        Object.entries(runIndex.steps ?? {}).forEach(([key, meta]) => {
            if (!meta || meta.kind !== "annotation") return

            const stepSlug = deriveStepSlugFromKey(meta.key)
            const referenceCandidates = collectReferenceIdentifiers(meta)
            const hasReferenceMatch = referenceCandidates.some((candidate) =>
                evaluatorIdentifiers.has(candidate),
            )
            const matchesByKey =
                evaluator?.slug && typeof meta.key === "string"
                    ? meta.key.endsWith(`.${evaluator.slug}`) || meta.key === evaluator.slug
                    : false
            const matchesBySlug = stepSlug ? evaluatorIdentifiers.has(stepSlug) : false

            if (!hasReferenceMatch && !matchesByKey && !matchesBySlug) return

            if (typeof key === "string") {
                identifiers.add(key)
                const normalizedKey = normalizeIdentifier(key)
                if (normalizedKey) identifiers.add(normalizedKey)
            }
            if (stepSlug) {
                identifiers.add(stepSlug)
                const normalizedSlug = normalizeIdentifier(stepSlug)
                if (normalizedSlug) identifiers.add(normalizedSlug)
            }
            referenceCandidates.forEach((candidate) => {
                identifiers.add(candidate)
                const normalized = normalizeIdentifier(candidate)
                if (normalized) identifiers.add(normalized)
            })
        })
    })

    return Array.from(identifiers).filter(Boolean) as string[]
}

const resolveEvaluatorRevisionSlug = (
    evaluatorSlug: string | undefined,
    runIndexesByRunId: Record<string, RunIndex | undefined>,
): string | undefined => {
    if (!evaluatorSlug) return undefined
    for (const runIndex of Object.values(runIndexesByRunId)) {
        if (!runIndex) continue
        for (const meta of Object.values(runIndex.steps ?? {})) {
            const refSlug = normalizeIdentifier(meta?.refs?.evaluator?.slug)
            if (refSlug !== evaluatorSlug) continue
            const revisionSlug =
                normalizeIdentifier(meta?.refs?.evaluatorRevision?.slug) ??
                deriveStepSlugFromKey(meta?.key)
            if (revisionSlug) return revisionSlug
        }
    }
    return undefined
}

const collectStepKeysForEvaluator = (slug: string, runIndex?: RunIndex): string[] => {
    if (!runIndex) return []
    const stepKeys = new Set<string>()

    if (runIndex.steps?.[slug]) {
        stepKeys.add(slug)
    }

    Object.entries(runIndex.steps ?? {}).forEach(([stepKey, meta]) => {
        if (stepKeys.has(stepKey)) return
        const refs = meta?.refs ?? {}
        const candidates = [
            refs?.evaluator?.slug,
            refs?.evaluator?.id,
            refs?.evaluatorVariant?.slug,
            refs?.evaluatorVariant?.id,
            refs?.evaluatorRevision?.slug,
            refs?.evaluatorRevision?.id,
        ]

        if (candidates.some((value) => typeof value === "string" && slug.includes(value))) {
            stepKeys.add(stepKey)
        }
    })

    return Array.from(stepKeys)
}

const flattenMetricDefinitionEntries = (
    schema: Record<string, any> | undefined,
    prefix?: string,
    acc: Record<string, any> = {},
): Record<string, any> => {
    if (!schema || typeof schema !== "object") {
        return acc
    }

    Object.entries(schema).forEach(([key, rawDefinition]) => {
        if (!rawDefinition || typeof rawDefinition !== "object") return

        const candidate =
            Array.isArray((rawDefinition as any).anyOf) && (rawDefinition as any).anyOf.length
                ? (rawDefinition as any).anyOf[0]
                : rawDefinition
        const qualifiedKey = prefix ? `${prefix}.${key}` : key
        const type = candidate?.type as string | undefined

        if (
            type === "object" &&
            candidate?.properties &&
            typeof candidate.properties === "object"
        ) {
            flattenMetricDefinitionEntries(candidate.properties, qualifiedKey, acc)
            return
        }

        if (!type && candidate?.properties && typeof candidate.properties === "object") {
            flattenMetricDefinitionEntries(candidate.properties, qualifiedKey, acc)
            return
        }

        if (type === "array") {
            const {value, items, ...restProps} = candidate
            acc[qualifiedKey] = {
                value: value ?? "",
                items: {
                    type: items?.type === "string" ? items.type : "string",
                    enum: items?.enum || [],
                },
                ...restProps,
                type,
            }
            return
        }

        if (type && USEABLE_METRIC_TYPES.includes(type)) {
            const {value, ...restProps} = candidate
            acc[qualifiedKey] = {
                value:
                    value ??
                    getDefaultValue({
                        property: candidate,
                        ignoreObject: true,
                    }),
                ...restProps,
                type,
            }
            return
        }

        if (candidate?.value !== undefined || candidate?.description) {
            acc[qualifiedKey] = candidate
        }
    })

    return acc
}

const pruneParentMetricEntries = (metrics: Record<string, any>): Record<string, any> => {
    if (!metrics || !Object.keys(metrics).length) return metrics
    const nestedPrefixes = new Map<string, boolean>()
    Object.entries(metrics).forEach(([key, definition]) => {
        const label = (definition?.label as string | undefined) ?? key
        if (!label) return
        const [prefix] = label.split(".")
        if (!prefix) return
        if ((prefix === "outputs" || prefix === "metrics") && label.includes(".")) {
            nestedPrefixes.set(prefix, true)
        }
    })

    const result: Record<string, any> = {}
    Object.entries(metrics).forEach(([key, definition]) => {
        const label = (definition?.label as string | undefined) ?? key
        const normalized = label ?? ""
        const [prefix] = normalized.split(".")
        const lowerLabel = normalized.toLowerCase()
        if (lowerLabel.startsWith("metrics.") || lowerLabel.startsWith("metric.")) {
            return
        }
        if (
            nestedPrefixes.get(prefix) &&
            (prefix === "outputs" || prefix === "metrics") &&
            normalized.indexOf(".") === -1 &&
            (key === prefix || !definition?.label)
        ) {
            return
        }
        result[key] = definition
    })
    return result
}

const collectColumnsForStepKeys = (keys: string[], runIndex?: RunIndex): ColumnDef[] => {
    if (!runIndex || !Array.isArray(keys) || !keys.length) return []
    const columns: ColumnDef[] = []
    keys.forEach((key) => {
        const perStep = runIndex.columnsByStep?.[key]
        if (Array.isArray(perStep)) {
            perStep.forEach((column) => {
                columns.push(column)
            })
        }
    })
    return columns
}

const deriveMetricKeyFromColumn = (column: ColumnDef): string | undefined => {
    if (!column || column.kind !== "annotation") return undefined
    if (typeof column.path === "string" && column.path.trim()) {
        const canonicalPath = canonicalizeMetricKey(column.path.trim())
        const stripped = stripMetricPrefix(canonicalPath)
        if (stripped) return stripped

        const parts = canonicalPath.split(".").filter(Boolean)
        if (parts.length) return parts[parts.length - 1]
    }

    if (typeof column.name === "string") {
        const trimmed = column.name.trim()
        if (trimmed) return trimmed.replace(/\s+/g, "_").toLowerCase()
    }

    return undefined
}

const inferSchemaTypeFromStats = (stats: BasicStats | undefined): SchemaMetricType | undefined => {
    if (!stats) return undefined

    if (typeof (stats as any).mean === "number" || typeof (stats as any).sum === "number") {
        return "number"
    }

    const tryEntryValues = [
        Array.isArray((stats as any).frequency) ? (stats as any).frequency : undefined,
        Array.isArray((stats as any).rank) ? (stats as any).rank : undefined,
    ]
        .filter(Boolean)
        .flat() as {value: unknown}[]

    if (tryEntryValues.length) {
        const valueTypes = new Set(tryEntryValues.map((entry) => typeof entry.value))
        if (valueTypes.size === 1) {
            const [onlyType] = Array.from(valueTypes)
            if (onlyType === "boolean" || onlyType === "number" || onlyType === "string") {
                return onlyType as SchemaMetricType
            }
        }
    }

    return undefined
}

const deriveMetricsFromRunStats = (
    slug: string | undefined,
    runMetricsMap?: Record<string, Record<string, BasicStats>>,
    runIndexesByRunId?: Record<string, RunIndex | undefined>,
): Record<string, {type?: SchemaMetricType}> => {
    if (!slug) return {}

    const slugPrefix = `${slug}.`
    const derived = new Map<string, {type?: SchemaMetricType}>()

    const recordMetric = (
        metricKey: string | undefined,
        type?: SchemaMetricType,
        meta?: Record<string, any>,
    ) => {
        if (!metricKey) return
        const existing = derived.get(metricKey) ?? {}
        if (!existing.type && type) {
            existing.type = type
        }
        if (meta) {
            Object.assign(existing, meta)
        }
        derived.set(metricKey, existing)
    }

    if (runMetricsMap) {
        Object.entries(runMetricsMap).forEach(([runId, metrics]) => {
            if (!metrics) return
            let hasPrefixedMetrics = false
            Object.entries(metrics).forEach(([rawKey, stats]) => {
                if (typeof rawKey !== "string") return
                if (!rawKey.startsWith(slugPrefix)) return
                hasPrefixedMetrics = true

                const withoutSlug = rawKey.slice(slugPrefix.length)
                const canonical = canonicalizeMetricKey(withoutSlug)

                const strippedCanonical = stripMetricPrefix(canonical)
                const strippedRaw = stripMetricPrefix(withoutSlug)

                const metricKey = strippedCanonical ?? strippedRaw ?? canonical
                if (!metricKey) return

                const inferredType = inferSchemaTypeFromStats(stats)
            })

            if (!hasPrefixedMetrics) {
                Object.entries(metrics).forEach(([rawKey, stats]) => {
                    if (typeof rawKey !== "string") return
                    if (!rawKey.startsWith(slugPrefix)) return
                    const {isKey, leafMetric, prefix, normalized} = isOutputMetricKey(rawKey)
                    if (!isKey || !leafMetric) return
                    const inferredType = inferSchemaTypeFromStats(stats)
                    let displayLabel: string | undefined
                    if (normalized) {
                        if (prefix === "outputs") {
                            const suffix = normalized.slice(OUTPUT_PREFIX.length)
                            displayLabel = suffix ? `outputs.${suffix}` : "outputs"
                        } else if (prefix === "metrics") {
                            const suffix = normalized.slice(ANALYTICS_PREFIX.length)
                            displayLabel = suffix ? `metrics.${suffix}` : "metrics"
                        }
                    }
                })
            }

            if (!runIndexesByRunId?.[runId]) return
            const columns = collectColumnsForStepKeys(
                collectStepKeysForEvaluator(slug, runIndexesByRunId[runId]),
                runIndexesByRunId[runId],
            )

            columns
                .filter((column) => column.kind === "annotation")
                .forEach((column) => {
                    const metricKey = deriveMetricKeyFromColumn(column)
                    if (!metricKey) return

                    const stats = resolveMetricStats(metrics, [
                        `${slug}.${metricKey}`,
                        metricKey,
                        `${OUTPUT_PREFIX}${metricKey}`,
                        `${ANALYTICS_PREFIX}${metricKey}`,
                    ])
                    const inferredType =
                        inferSchemaTypeFromStats(stats) ||
                        ((): SchemaMetricType | undefined => {
                            const type = column.metricType
                            if (!type) return undefined
                            if (Array.isArray(type)) {
                                return type[0] as SchemaMetricType
                            }
                            return type as SchemaMetricType
                        })()
                    recordMetric(metricKey, inferredType)
                })
        })
    }

    return Object.fromEntries(derived.entries())
}

export const extractEvaluationStatus = (
    scenarios: IScenario[],
    status?: EvaluationStatus,
    evalType?: "auto" | "human",
) => {
    if (status === EvaluationStatus.CANCELLED) {
        return {runStatus: EvaluationStatus.CANCELLED, scenarios}
    }
    // Derive overall run status if not provided
    let derived: EvaluationStatus = EvaluationStatus.PENDING
    if (scenarios.length) {
        if (scenarios.some((s) => s.status === EvaluationStatus.FAILURE)) {
            derived = EvaluationStatus.FAILURE
        } else if (scenarios.some((s) => s.status === EvaluationStatus.ERRORS)) {
            derived = EvaluationStatus.ERROR
        } else if (scenarios.some((s) => s.status === EvaluationStatus.CANCELLED)) {
            derived = EvaluationStatus.CANCELLED
        } else if (
            scenarios.some((s) =>
                [EvaluationStatus.INCOMPLETE].includes(s.status as EvaluationStatus),
            )
        ) {
            derived = EvaluationStatus.RUNNING
        } else if (scenarios.every((s) => s.status === EvaluationStatus.SUCCESS)) {
            derived = EvaluationStatus.SUCCESS
        } else if (
            (evalType === "auto" || evalType === "custom") &&
            scenarios.some((s) => s.status === EvaluationStatus.RUNNING)
        ) {
            derived = EvaluationStatus.RUNNING
        } else {
            derived = EvaluationStatus.PENDING
        }
    }
    const finalStatus = scenarios.length ? derived : (status ?? derived)

    return {runStatus: finalStatus as EvaluationStatus, scenarios}
}

/**
 * Builds columns configuration for a table based on evaluator metrics.
 *
 * @param {Object} params - The parameters for configuring the columns.
 * @param {EvaluatorDto[]} params.evaluators - Evaluators data for building evaluator metric columns.
 * @param {Record<string, boolean>} params.collapsedGroups - State of collapsed groups for metric columns.
 * @param {Function} params.toggleGroup - Function to toggle the collapsed state of metric groups.
 *
 * @returns {Object} An object containing the configured columns and all metric columns.
 */

export const getEvaluatorMetricColumns = ({
    evaluations,
    runMetricsMap,
    preferRunStepSlugs = false,
}: {
    evaluations: EvaluationRow[]
    runMetricsMap?: Record<string, Record<string, BasicStats>>
    preferRunStepSlugs?: boolean
}) => {
    // Calculate how many evaluations include each evaluator so we can order
    // the columns by their popularity across runs (descending).
    const evaluatorCounts: Record<string, number> = {}
    const declaredEvaluatorSlugs = new Set<string>()
    evaluations.forEach((evaluation) => {
        evaluation.evaluators?.forEach((ev: EvaluatorDto) => {
            evaluatorCounts[ev.slug] = (evaluatorCounts[ev.slug] ?? 0) + 1
            const normalized = normalizeIdentifier(ev?.slug)
            if (normalized) declaredEvaluatorSlugs.add(normalized)
        })
    })

    const runIndexesByRunId: Record<string, RunIndex | undefined> = {}
    evaluations.forEach((evaluation) => {
        const runIndex = (evaluation as any)?.runIndex
        if (!runIndex) return
        const runId = getRunIdFromEvaluation(evaluation)
        if (runId) {
            runIndexesByRunId[runId] = runIndex
        }
    })

    const stepSlugCache = new Map<string, string[]>()
    const resolveStepSlugs =
        preferRunStepSlugs && Object.keys(runIndexesByRunId).length
            ? ({record, evaluator}: {record: EvaluationRow; evaluator: EvaluatorDto}) => {
                  const runId = getRunIdFromEvaluation(record)
                  if (!runId) return []
                  const cacheKey = [
                      runId,
                      normalizeIdentifier((evaluator as any)?.id) ?? "",
                      normalizeIdentifier(evaluator?.slug) ?? "",
                      normalizeIdentifier((evaluator as any)?.key) ?? "",
                  ].join(":")
                  if (stepSlugCache.has(cacheKey)) {
                      return stepSlugCache.get(cacheKey)!
                  }
                  const runIndex = runIndexesByRunId[runId]
                  if (!runIndex) {
                      stepSlugCache.set(cacheKey, [])
                      return []
                  }
                  const slugs = collectStepSlugsFromRunIndex(runIndex, evaluator)
                  stepSlugCache.set(cacheKey, slugs)
                  return slugs
              }
            : undefined

    // Build a unique list of evaluators and sort it by frequency. If two
    // evaluators have the same frequency, fall back to their names for a
    // deterministic ordering.
    const evaluators = uniqBy(
        [...(evaluations.flatMap((evaluation) => evaluation.evaluators || []) as EvaluatorDto[])],
        "slug",
    )
        .filter(Boolean)
        .map((evaluator: EvaluatorDto) => {
            const metricsCandidate: Record<string, any> = {}
            const stepIdentifierCandidates = collectStepIdentifiersForEvaluator(
                runIndexesByRunId,
                evaluator,
            )
                .concat([
                    evaluator.slug,
                    normalizeIdentifier((evaluator as any)?.id),
                    normalizeIdentifier((evaluator as any)?.key),
                    ...(Array.isArray(evaluator?.stepIdentifierCandidates)
                        ? (evaluator.stepIdentifierCandidates as string[])
                        : []),
                ])
                .filter((value, index, self) => value && self.indexOf(value) === index)
            const mergeMetricDefinitions = (
                source?: Record<string, any>,
                {skipFlatten = false}: {skipFlatten?: boolean} = {},
            ) => {
                if (!source || typeof source !== "object" || Array.isArray(source)) return
                const entries = skipFlatten ? source : flattenMetricDefinitionEntries(source)
                Object.entries(entries).forEach(([key, definition]) => {
                    if (!definition || typeof definition !== "object") return
                    const existing = metricsCandidate[key]
                    metricsCandidate[key] = existing
                        ? {...definition, ...existing}
                        : {...definition}
                })
            }

            const serviceFormat = (evaluator as any)?.data?.service?.format
            if (serviceFormat && typeof serviceFormat === "object") {
                const properties = (serviceFormat as any)?.properties
                const outputsCandidate =
                    (properties && typeof properties === "object"
                        ? (properties as any).outputs
                        : undefined) ?? (serviceFormat as any).outputs

                if (outputsCandidate && typeof outputsCandidate === "object") {
                    const schemaDefinitions =
                        (outputsCandidate as any).properties &&
                        typeof (outputsCandidate as any).properties === "object"
                            ? ((outputsCandidate as any).properties as Record<string, any>)
                            : (outputsCandidate as Record<string, any>)
                    mergeMetricDefinitions(schemaDefinitions)
                }
            }

            const fallbackOutputs =
                (evaluator as any)?.settings_values?.outputs ??
                (evaluator as any)?.settings?.outputs ??
                undefined
            if (
                fallbackOutputs &&
                typeof fallbackOutputs === "object" &&
                !Array.isArray(fallbackOutputs)
            ) {
                mergeMetricDefinitions(fallbackOutputs as Record<string, any>)
            }

            if ((evaluator as any)?.metrics && typeof (evaluator as any)?.metrics === "object") {
                mergeMetricDefinitions((evaluator as any).metrics as Record<string, any>, {
                    skipFlatten: true,
                })
            }

            const inferredMetrics = deriveMetricsFromRunStats(
                evaluator?.slug,
                runMetricsMap,
                runIndexesByRunId,
            )

            let metrics: Record<string, any> = {...metricsCandidate}

            if (!Object.keys(metrics).length && Object.keys(inferredMetrics).length) {
                metrics = {...inferredMetrics}
            } else if (Object.keys(inferredMetrics).length) {
                Object.entries(inferredMetrics).forEach(([metricKey, definition]) => {
                    if (!(metricKey in metrics)) {
                        metrics[metricKey] = definition
                        return
                    }

                    if (!definition?.type) return

                    const existing = metrics[metricKey]
                    const existingType =
                        existing && typeof existing === "object"
                            ? (existing as any).type
                            : undefined

                    if (!existingType) {
                        metrics[metricKey] = {
                            ...(typeof existing === "object" && existing ? existing : {}),
                            type: definition.type,
                        }
                    }
                })
            }

            metrics = pruneParentMetricEntries(metrics)

            const revisionSlug =
                preferRunStepSlugs && evaluator?.slug
                    ? resolveEvaluatorRevisionSlug(evaluator.slug, runIndexesByRunId)
                    : undefined

            const displayName =
                revisionSlug ??
                evaluator?.name ??
                evaluator?.slug ??
                (typeof (evaluator as any)?.displayName === "string"
                    ? ((evaluator as any).displayName as string)
                    : undefined)

            const normalizedSlug = normalizeIdentifier(evaluator?.slug)

            return {
                ...evaluator,
                name: displayName,
                slug: evaluator?.slug ?? revisionSlug ?? evaluator?.name,
                metrics,
                stepIdentifierCandidates,
                originalSlug: normalizedSlug ?? evaluator?.slug,
            }
        })
        .filter(
            (
                evaluator: EvaluatorDto & {
                    originalSlug?: string
                    stepIdentifierCandidates?: string[]
                },
            ) => {
                const normalizedOriginal = normalizeIdentifier((evaluator as any)?.originalSlug)
                if (normalizedOriginal && declaredEvaluatorSlugs.has(normalizedOriginal))
                    return true
                const normalizedSlug = normalizeIdentifier(evaluator?.slug)
                if (normalizedSlug && declaredEvaluatorSlugs.has(normalizedSlug)) return true
                const candidateMatch = Array.isArray((evaluator as any)?.stepIdentifierCandidates)
                    ? (evaluator as any).stepIdentifierCandidates.some((candidate: string) => {
                          const normalized = normalizeIdentifier(candidate)
                          return normalized ? declaredEvaluatorSlugs.has(normalized) : false
                      })
                    : false
                if (candidateMatch) return true
                return false
            },
        )
        .sort((a, b) => {
            const diff = (evaluatorCounts[b.slug] ?? 0) - (evaluatorCounts[a.slug] ?? 0)
            if (!a.name || !b.name) return diff
            return diff !== 0 ? diff : a.name.localeCompare(b.name)
        })

    const evaluatorColumns = evaluators
        .flatMap((ev) => {
            const keys = Object.keys(ev.metrics || {})
            if (!keys.length) return []
            const children = buildEvaluatorMetricColumns({
                evaluator: ev,
                runMetricsMap,
                resolveStepSlugs,
                additionalSlugCandidates: (ev as any)?.stepIdentifierCandidates ?? [],
            }).filter(Boolean)

            if (!children.length) return []

            return [
                {
                    key: ev.slug,
                    title: ev.name ?? ev.slug,
                    collapsible: true,
                    children,
                    renderAggregatedData: ({record}) => {
                        const hasEvaluator = Array.isArray((record as any).evaluators)
                            ? (record as any).evaluators.some(
                                  (e: EvaluatorDto) => e.slug === ev.slug,
                              )
                            : false
                        if (!hasEvaluator) {
                            return <div className="not-available-table-cell" />
                        }

                        const id = "id" in record ? record.id : (record as any).key
                        const metrics = runMetricsMap?.[id]
                        if (!metrics) return <div className="not-available-table-cell" />

                        const pills = Object.keys(ev.metrics || {})
                            .map((metricKey) => {
                                const slugCandidates =
                                    resolveStepSlugs?.({record, evaluator: ev}) ??
                                    (ev.slug ? [ev.slug] : [])
                                const stats = resolveMetricStats(
                                    metrics,
                                    buildMetricKeyCandidates(metricKey, slugCandidates),
                                )
                                const value = summarizeMetric(
                                    stats,
                                    (ev.metrics as any)?.[metricKey]?.type,
                                )
                                if (value == null) return null
                                const definition = (ev.metrics as any)?.[metricKey]
                                const label = (definition?.label as string | undefined) ?? metricKey
                                return (
                                    <LabelValuePill
                                        key={metricKey}
                                        label={label}
                                        value={formatMetricValue(metricKey, value)}
                                        className="!min-w-0 [&_div:first-child]:!min-w-0 [&_div:first-child]:w-fit"
                                    />
                                )
                            })
                            .filter(Boolean)

                        if (!pills.length) return <div className="not-available-table-cell" />

                        return (
                            <div className="flex flex-col items-start gap-1 max-w-[450px] overflow-x-auto [&::-webkit-scrollbar]:!w-0">
                                {pills}
                            </div>
                        )
                    },
                },
            ]
        })
        .flat()

    return evaluatorColumns
}

export const getRunMetricColumns = ({
    runMetricsMap,
    runMetricKeys,
    runMetricKeyAliases,
    runMetricFallbacks,
    evaluatorSlugs,
    evaluators,
    evalType,
}: {
    runMetricsMap: Record<string, any>
    runMetricKeys: Set<string>
    runMetricKeyAliases: Map<string, Set<string>>
    runMetricFallbacks: Map<string, Set<string>>
    evaluatorSlugs: Set<string>
    evaluators: EvaluatorDto[]
    evalType: "auto" | "human"
}) => {
    if (evalType === "auto" || evalType === "custom") {
        const runMetricChildren: ColumnsType<EvaluationRow> = GeneralAutoEvalMetricColumns.map(
            (metricDef) => {
                const canonicalKey = canonicalizeMetricKey(metricDef.path)
                const aliasSet = runMetricKeyAliases.get(canonicalKey) ?? new Set<string>()
                aliasSet.add(canonicalKey)
                aliasSet.add(metricDef.path)
                const fallbackSet = runMetricFallbacks.get(canonicalKey) ?? new Set<string>()
                const aliasCandidates = Array.from(new Set([...aliasSet, ...fallbackSet]))
                const {primary: primaryKey} = getMetricConfig(canonicalKey)

                return {
                    title: () => <span>{metricDef.name}</span>,
                    key: `run__${canonicalKey}`,
                    dataIndex: canonicalKey,
                    onHeaderCell: () => ({style: {minWidth: 160}}),
                    sorter: {
                        compare: (a, b) => {
                            const aId = "id" in a ? a.id : a.key
                            const bId = "id" in b ? b.id : b.key
                            const avStats = resolveMetricStats(runMetricsMap?.[aId], [
                                canonicalKey,
                                ...aliasCandidates,
                            ])
                            const bvStats = resolveMetricStats(runMetricsMap?.[bId], [
                                canonicalKey,
                                ...aliasCandidates,
                            ])
                            const av = avStats?.[primaryKey]
                            const bv = bvStats?.[primaryKey]
                            return Number(av ?? 0) - Number(bv ?? 0)
                        },
                    },
                    render: (_: any, record: EvaluationRow) => {
                        const id = "id" in record ? record.id : record.key
                        const metric = resolveMetricStats(runMetricsMap?.[id], [
                            canonicalKey,
                            ...aliasCandidates,
                        ])

                        if (!metric) return "N/A"

                        const displayValue = metric?.[primaryKey]
                        if (displayValue == null) return "N/A"

                        if (typeof metric === "object") {
                            const {[primaryKey]: _omit, ...rest} = metric
                            if (Object.keys(rest).length) {
                                return (
                                    <MetricDetailsPopover
                                        metricKey={canonicalKey}
                                        primaryLabel={primaryKey}
                                        primaryValue={displayValue}
                                        extraDimensions={rest}
                                    >
                                        <span className="cursor-pointer underline underline-offset-2">
                                            {formatMetricValue(canonicalKey, displayValue)}
                                        </span>
                                    </MetricDetailsPopover>
                                )
                            }
                        }
                        return String(displayValue)
                    },
                }
            },
        )

        const runMetricsGroup = runMetricChildren.length
            ? [
                  {
                      title: "Invocation Metrics",
                      collapsible: true,
                      children: runMetricChildren,
                      renderAggregatedData: ({record}) => {
                          const id = "id" in record ? record.id : record.key
                          const metrics = runMetricsMap?.[id]
                          if (!metrics) return null

                          const pills = GeneralAutoEvalMetricColumns.map((metricDef) => {
                              const canonicalKey = canonicalizeMetricKey(metricDef.path)
                              const aliasSet =
                                  runMetricKeyAliases.get(canonicalKey) ?? new Set<string>()
                              aliasSet.add(canonicalKey)
                              aliasSet.add(metricDef.path)
                              const fallbackSet =
                                  runMetricFallbacks.get(canonicalKey) ?? new Set<string>()
                              const {primary: primaryKey} = getMetricConfig(canonicalKey)
                              const metric = resolveMetricStats(metrics, [
                                  canonicalKey,
                                  ...Array.from(new Set([...aliasSet, ...fallbackSet])),
                              ]) as any
                              const value = metric?.[primaryKey]
                              if (value == null) return null
                              return (
                                  <LabelValuePill
                                      key={canonicalKey}
                                      label={metricDef.name}
                                      value={formatMetricValue(canonicalKey, value)}
                                      className="!min-w-0 [&_div:first-child]:!min-w-0 [&_div:first-child]:w-fit"
                                  />
                              )
                          }).filter(Boolean) as JSX.Element[]

                          if (!pills.length) return null

                          return (
                              <div className="flex flex-col items-start gap-1 max-w-[450px] overflow-x-auto [&::-webkit-scrollbar]:!w-0">
                                  {pills as React.ReactNode[]}
                              </div>
                          )
                      },
                  },
              ]
            : []

        return runMetricsGroup
    }

    let filteredRunMetricKeys = Array.from(runMetricKeys).filter((key) => {
        const dotIdx = key.indexOf(".")
        if (dotIdx === -1) return true
        const slug = key.slice(0, dotIdx)
        return !evaluatorSlugs.has(slug)
    })
    // Sort keys with shared priority helper
    filteredRunMetricKeys.sort((a, b) => {
        const [pa, sa] = metricPriority(a)
        const [pb, sb] = metricPriority(b)
        if (pa !== pb) return pa - pb
        if (sa !== sb) return sa - sb
        return a.localeCompare(b)
    })

    const runMetricChildren: ColumnsType<EvaluationRow> = filteredRunMetricKeys.map((metricKey) => {
        const aliasSet = runMetricKeyAliases.get(metricKey) ?? new Set<string>([metricKey])
        const fallbackSet = runMetricFallbacks.get(metricKey) ?? new Set<string>()
        const aliasCandidates = Array.from(new Set([...aliasSet, ...fallbackSet]))
        const {primary: primaryKey} = getMetricConfig(metricKey)
        const label = labelForRunMetric(metricKey)
        return {
            title: () => <span>{label}</span>,
            key: `run__${metricKey}`,
            dataIndex: metricKey,
            onHeaderCell: () => ({style: {minWidth: 160}}),
            sorter: {
                compare: (a, b) => {
                    const aId = "id" in a ? a.id : a.key
                    const bId = "id" in b ? b.id : b.key
                    const avStats = resolveMetricStats(runMetricsMap?.[aId], [
                        metricKey,
                        ...aliasCandidates,
                    ])
                    const bvStats = resolveMetricStats(runMetricsMap?.[bId], [
                        metricKey,
                        ...aliasCandidates,
                    ])
                    const av = avStats?.[primaryKey]
                    const bv = bvStats?.[primaryKey]
                    return Number(av ?? 0) - Number(bv ?? 0)
                },
            },
            render: (_: any, record: EvaluationRow) => {
                const id = "id" in record ? record.id : record.key
                const metric = resolveMetricStats(runMetricsMap?.[id], [
                    metricKey,
                    ...aliasCandidates,
                ])

                if (!metric) return "N/A"

                const displayValue = metric?.[primaryKey]
                if (displayValue == null) return "N/A"

                if (typeof metric === "object") {
                    const {[primaryKey]: _omit, ...rest} = metric
                    if (Object.keys(rest).length) {
                        return (
                            <MetricDetailsPopover
                                metricKey={metricKey}
                                primaryLabel={primaryKey}
                                primaryValue={displayValue}
                                extraDimensions={rest}
                            >
                                <span className="cursor-pointer underline underline-offset-2">
                                    {formatMetricValue(metricKey, displayValue)}
                                </span>
                            </MetricDetailsPopover>
                        )
                    }
                }
                return String(displayValue)
            },
        }
    })

    const runMetricsGroup = runMetricChildren.length
        ? [
              {
                  title: "Invocation Metrics",
                  collapsible: true,
                  children: runMetricChildren,
                  renderAggregatedData: ({record}) => {
                      const id = "id" in record ? record.id : record.key
                      const metrics = runMetricsMap?.[id]
                      if (!metrics) return null

                      const pills = filteredRunMetricKeys
                          .map((metricKey) => {
                              const aliasSet =
                                  runMetricKeyAliases.get(metricKey) ?? new Set([metricKey])
                              const fallbackSet =
                                  runMetricFallbacks.get(metricKey) ?? new Set<string>()
                              const {primary: primaryKey} = getMetricConfig(metricKey)
                              const metric = resolveMetricStats(metrics, [
                                  metricKey,
                                  ...Array.from(new Set([...aliasSet, ...fallbackSet])),
                              ]) as any
                              const value = metric?.[primaryKey]
                              if (value == null) return null
                              return (
                                  <LabelValuePill
                                      key={metricKey}
                                      label={labelForRunMetric(metricKey)}
                                      value={formatMetricValue(metricKey, value)}
                                      className="!min-w-0 [&_div:first-child]:!min-w-0 [&_div:first-child]:w-fit"
                                  />
                              )
                          })
                          .filter(Boolean)
                      if (!pills.length) return null

                      return (
                          <div className="flex flex-col items-start gap-1 max-w-[450px] overflow-x-auto [&::-webkit-scrollbar]:!w-0">
                              {pills}
                          </div>
                      )
                  },
              },
          ]
        : []

    return runMetricsGroup
}

const ApplicationCell = ({record, evalType}) => {
    const primaryInvocation = extractPrimaryInvocation(record)
    const fallbackVariant = Array.isArray((record as any)?.variants)
        ? (record as any)?.variants?.[0]
        : undefined
    const variantAppName =
        fallbackVariant?.appName ||
        fallbackVariant?.appSlug ||
        (typeof fallbackVariant?.app_id === "string" ? fallbackVariant.app_id : undefined)
    const derivedAppId = extractEvaluationAppId(record)
    const strippedPrimaryVariantName = stripVariantSuffix(primaryInvocation?.variantName)
    const strippedFallbackVariantName = stripVariantSuffix(fallbackVariant?.variantName)
    const isAutoEval = evalType === "auto" || evalType === "custom"

    const candidates = isAutoEval
        ? [
              (record as any)?.appName,
              primaryInvocation?.appName,
              variantAppName,
              strippedPrimaryVariantName,
              strippedFallbackVariantName,
              inferAppNameFromEvaluationName((record as any)?.name),
              derivedAppId,
          ]
        : [(record as any)?.appName, primaryInvocation?.appName, variantAppName]

    const appName = candidates.find((value) => {
        if (typeof value !== "string") return false
        const trimmed = value.trim()
        if (!trimmed) return false
        return !isUuidLike(trimmed)
    })

    if (appName) return appName
    return "-"
}

export const getColumns = ({
    evaluations,
    onVariantNavigation,
    setSelectedEvalRecord,
    setIsDeleteEvalModalOpen,
    runMetricsMap,
    evalType,
    scope = "app",
    baseAppURL,
    extractAppId,
    projectURL,
    resolveAppId,
    preferRunStepSlugs = false,
    disableVariantAction = false,
}: {
    evaluations: EvaluationRow[]
    onVariantNavigation: (params: {revisionId: string; appId?: string}) => void
    setSelectedEvalRecord: Dispatch<SetStateAction<EvaluationRow | undefined>>
    setIsDeleteEvalModalOpen: Dispatch<SetStateAction<boolean>>
    runMetricsMap?: Record<string, Record<string, BasicStats>>
    evalType?: "human" | "auto"
    scope?: "app" | "project"
    baseAppURL: string
    extractAppId: (evaluation: EvaluationRow) => string | undefined
    projectURL: string
    resolveAppId?: (evaluation: EvaluationRow) => string | undefined
    preferRunStepSlugs?: boolean
    disableVariantAction?: boolean
}): ColumnsType<EvaluationRow> => {
    const baseColumns: ColumnsType<EvaluationRow> = [
        {
            title: "Name",
            dataIndex: "name",
            key: "name",
            fixed: "left",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_: any, record: EvaluationRow) => {
                return "name" in record ? record.name : record.key
            },
        },
        {
            title: "Variant",
            dataIndex: "variants",
            key: "variants",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_: any, record: EvaluationRow) => {
                const primaryInvocation = extractPrimaryInvocation(record)

                if (
                    "variants" in record &&
                    Array.isArray(record.variants) &&
                    record.variants.length
                ) {
                    return (
                        <VariantDetailsWithStatus
                            variantName={record.variants[0]?.variantName}
                            revision={record.variants[0]?.revision}
                            showStable
                        />
                    )
                }

                if (primaryInvocation?.variantName) {
                    return (
                        <VariantDetailsWithStatus
                            variantName={primaryInvocation.variantName}
                            revision={primaryInvocation.revisionLabel}
                            showStable
                        />
                    )
                }

                return <span>-</span>
            },
        },
        {
            title: "Testset",
            dataIndex: "testsetName",
            key: "testsetName",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record) => {
                return record.testset
                    ? record.testset.name
                    : record.testsets?.map((ts) => <span key={ts.id}>{ts.name}</span>)
            },
        },
        {
            title: "Status",
            dataIndex: "status",
            key: "status",
            onHeaderCell: () => ({
                style: {minWidth: 180},
            }),
            render: (value, record) => {
                const isLegacy = !record?.data?.steps

                return !isLegacy ? (
                    <EvaluationStatusCell status={value} runId={record.id} evalType={evalType} />
                ) : (
                    <div className="not-available-table-cell"></div>
                )
            },
        },
        // Evaluator metric columns will be injected here dynamically below
        {
            title: "Created by",
            dataIndex: "createdBy",
            key: "createdBy",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (value, record) => {
                const isLegacy = !record?.data?.steps
                return isLegacy || !value?.user?.username ? (
                    <div className="not-available-table-cell"></div>
                ) : (
                    <UserAvatarTag modifiedBy={value?.user.username} />
                )
            },
        },
        {
            title: "Created on",
            dataIndex: "createdAt",
            key: "createdAt",
            sorter: (a, b) => {
                return (a?.createdAtTimestamp ?? 0) - (b?.createdAtTimestamp ?? 0)
            },
            defaultSortOrder: "descend",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
        },
        {
            title: <GearSix size={16} />,
            key: "key",
            width: 56,
            fixed: "right",
            align: "center",
            render: (_, record) => (
                <TableDropdownMenu
                    record={record}
                    evalType={evalType}
                    setSelectedEvalRecord={setSelectedEvalRecord}
                    setIsDeleteEvalModalOpen={setIsDeleteEvalModalOpen}
                    onVariantNavigation={onVariantNavigation}
                    baseAppURL={baseAppURL}
                    extractAppId={extractAppId}
                    scope={scope}
                    projectURL={projectURL}
                    resolveAppId={resolveAppId}
                    disableVariantAction={disableVariantAction}
                />
            ),
        },
    ]

    if (scope === "project") {
        baseColumns.splice(1, 0, {
            title: "Application",
            dataIndex: "application",
            key: "application",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record) => <ApplicationCell record={record} evalType={evalType} />,
        })
    }

    const evaluatorMetricColumns = getEvaluatorMetricColumns({
        evaluations,
        runMetricsMap,
        preferRunStepSlugs,
    })

    // Find index of Status column
    const statusIdx = baseColumns.findIndex((col) => col.title === "Status")

    // Build run metric columns if runMetricsMap provided
    const runMetricKeyAliases = new Map<string, Set<string>>()
    const runMetricFallbacks = new Map<string, Set<string>>()
    if (runMetricsMap) {
        Object.values(runMetricsMap).forEach((metrics) => {
            Object.keys(metrics || {}).forEach((rawKey) => {
                const canonical = canonicalizeMetricKey(rawKey)
                if (!runMetricKeyAliases.has(canonical)) {
                    runMetricKeyAliases.set(canonical, new Set([canonical]))
                }
                runMetricKeyAliases.get(canonical)!.add(rawKey)

                if (rawKey.startsWith("attributes.ag.data.outputs.") && canonical !== rawKey) {
                    const legacyKey = rawKey.split(".").slice(-1)[0]
                    if (legacyKey) {
                        if (!runMetricFallbacks.has(canonical)) {
                            runMetricFallbacks.set(canonical, new Set())
                        }
                        runMetricFallbacks.get(canonical)!.add(legacyKey)
                    }
                }
            })
        })
    }
    const runMetricKeys = new Set<string>(runMetricKeyAliases.keys())
    // Exclude evaluator metric keys of form "slug.metric" when slug matches known evaluators
    const evaluatorSlugs = new Set<string>()
    evaluations.forEach((rec) => {
        if ("evaluators" in rec && Array.isArray(rec.evaluators)) {
            rec?.evaluators?.forEach((e: any) => {
                if (e?.slug) evaluatorSlugs.add(e.slug)
            })
        }
    })

    // Count frequency of each evaluatorSlug
    const evaluatorFrequency = new Map<string, number>()

    evaluations.forEach((rec) => {
        if ("evaluators" in rec && Array.isArray(rec.evaluators)) {
            rec?.evaluators?.forEach((e: any) => {
                if (e?.slug) {
                    evaluatorFrequency.set(e.slug, (evaluatorFrequency.get(e.slug) || 0) + 1)
                }
            })
        }
    })

    const hasLegacyRun = evaluations.some((rec) => !rec?.data?.steps)
    let legacyScoreColumns: ColumnsType<EvaluationRow> = []

    if (hasLegacyRun) {
        if (evalType === "human") {
            legacyScoreColumns = [
                {
                    title: (
                        <div className="flex flex-col">
                            <span>Average score</span>
                            <span>(legacy)</span>
                        </div>
                    ),
                    dataIndex: "averageScore",
                    key: "averageScore",
                    onHeaderCell: () => ({
                        style: {minWidth: 160},
                    }),
                    render: (_, record) => {
                        const isLegacy = !record?.data?.steps
                        const score = calculateAvgScore(record)
                        return isLegacy ? (
                            <span>
                                <Statistic
                                    className="[&_.ant-statistic-content-value]:text-sm [&_.ant-statistic-content-value]:text-primary [&_.ant-statistic-content-suffix]:text-sm [&_.ant-statistic-content-suffix]:text-primary"
                                    value={score}
                                    precision={score <= 99 ? 2 : 1}
                                    suffix="%"
                                />
                            </span>
                        ) : (
                            <div className="not-available-table-cell" />
                        )
                    },
                },
            ]
        } else if (evalType === "auto" || evalType === "custom") {
            const legacyAutoEvals = evaluations.filter((rec) => !rec?.data?.steps)

            const evaluators = getDefaultStore().get(evaluatorsAtom)
            const evaluatorConfigs = uniqBy(
                legacyAutoEvals
                    ?.map((item) =>
                        item.aggregated_results?.map((item) => ({
                            ...item.evaluator_config,
                            evaluator: evaluators?.find(
                                (e) => e.key === item.evaluator_config.evaluator_key,
                            ),
                        })),
                    )
                    .flat(),
                "id",
            )

            legacyScoreColumns = [
                {
                    title: "Results",
                    key: "results",
                    align: "left",
                    collapsible: true,
                    onHeaderCell: () => ({style: {minWidth: 240}}),
                    children: evaluatorConfigs?.map((evaluator) => ({
                        title: () => <LegacyEvalResultCellTitle evaluator={evaluator} />,
                        key: evaluator?.name,
                        onHeaderCell: () => ({style: {minWidth: 240}}),
                        render: (_, record) => {
                            if (!evaluators?.length) return

                            const matchingResults = record.aggregated_results?.filter(
                                (result) => result.evaluator_config.id === evaluator?.id,
                            )

                            if (!matchingResults?.length) {
                                return null
                            }

                            return <LegacyEvalResultCell matchingResults={matchingResults} />
                        },
                    })),
                },
            ]
        }
    }

    const runMetricsGroup = getRunMetricColumns({
        runMetricsMap: runMetricsMap ?? {},
        runMetricKeys,
        runMetricKeyAliases,
        runMetricFallbacks,
        evaluatorSlugs,
        evaluators: evaluations.flatMap((e) => e.evaluators),
        evalType,
    })

    // Insert metric columns after Status
    if (statusIdx !== -1) {
        return [
            ...baseColumns.slice(0, statusIdx + 1),
            // ...metricColumns,
            ...evaluatorMetricColumns,
            ...legacyScoreColumns,
            ...runMetricsGroup,
            ...baseColumns.slice(statusIdx + 1),
        ]
    }
    return baseColumns
}

export const getMetricSummaryValue = (
    metric: BasicStats | undefined,
    metricType?: string,
): string | number | undefined => {
    // Delegates to central helper to keep behaviour consistent
    return summarizeMetric(metric, metricType as any)
}
