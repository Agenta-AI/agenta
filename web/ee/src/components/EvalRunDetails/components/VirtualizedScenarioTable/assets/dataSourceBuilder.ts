import groupBy from "lodash/groupBy"

import {evalTypeAtom} from "@/oss/components/EvalRunDetails/state/evalType"
import {formatColumnTitle} from "@/oss/components/Filters/EditColumns/assets/helper"
import {
    evalAtomStore,
    evaluationEvaluatorsFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import type {
    ColumnDef,
    RunIndex,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/helpers/buildRunIndex"
import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"
import {BasicStats, canonicalizeMetricKey} from "@/oss/lib/metricUtils"
import {buildSkeletonRows} from "@/oss/lib/tableUtils"

import {TableRow} from "../types"

import {GeneralAutoEvalMetricColumns, GeneralHumanEvalMetricColumns} from "./constants"
import {createEvaluatorNameResolver} from "./evaluatorNameUtils"

const pickString = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined
    const trimmed = value.trim()
    return trimmed.length ? trimmed : undefined
}

const resolvePreferredSlug = (
    slug: string | undefined,
    revisionSlugByEvaluatorSlug?: Map<string, string>,
): string | undefined => {
    if (!slug) return undefined
    return revisionSlugByEvaluatorSlug?.get(slug) ?? slug
}

const buildBaseSlugByRevisionSlug = (
    revisionSlugByEvaluatorSlug?: Map<string, string>,
): Map<string, string> => {
    const map = new Map<string, string>()
    revisionSlugByEvaluatorSlug?.forEach((revision, base) => {
        if (revision) {
            map.set(revision, base)
        }
    })
    return map
}

const resolveSlugFromStepMeta = (
    meta: RunIndex["steps"][string] | undefined,
    revisionSlugByEvaluatorSlug?: Map<string, string>,
): string | undefined => {
    if (!meta) return undefined
    const refs: any = meta?.refs ?? {}
    const baseSlug =
        pickString(meta?.key) ??
        pickString(refs?.evaluator?.slug) ??
        pickString(refs?.evaluator_variant?.slug) ??
        pickString(refs?.evaluatorRevision?.slug) ??
        pickString(meta.key)
    return resolvePreferredSlug(baseSlug, revisionSlugByEvaluatorSlug)
}

const buildMetricDefsLookup = (
    metricsByEvaluator: Record<string, any[]>,
    revisionSlugByEvaluatorSlug?: Map<string, string>,
) => {
    const baseSlugByRevisionSlug = new Map<string, string>()
    revisionSlugByEvaluatorSlug?.forEach((revision, base) => {
        if (revision) baseSlugByRevisionSlug.set(revision, base)
    })

    return (slug: string | undefined): any[] => {
        if (!slug) return []
        const direct = metricsByEvaluator[slug]
        if (Array.isArray(direct) && direct.length) return direct
        const base = baseSlugByRevisionSlug.get(slug)
        if (base) {
            const baseDefs = metricsByEvaluator[base]
            if (Array.isArray(baseDefs) && baseDefs.length) return baseDefs
        }
        return []
    }
}

const OUTPUT_PREFIX = "attributes.ag.data.outputs."
const OUTPUT_PREFIX_LOWER = OUTPUT_PREFIX.toLowerCase()

const normalizeEvaluatorMetricName = (name?: string): string | undefined => {
    if (typeof name !== "string") return undefined
    const trimmed = name.trim()
    if (!trimmed) return undefined
    const lower = trimmed.toLowerCase()
    if (lower.startsWith(OUTPUT_PREFIX_LOWER)) {
        const tail = trimmed.slice(OUTPUT_PREFIX.length)
        return tail ? `outputs.${tail}` : "outputs"
    }
    return trimmed
}

const inferMetricTypeFromStats = (stats: BasicStats | undefined): string | undefined => {
    if (!stats) return undefined
    if (typeof (stats as any).mean === "number" || typeof (stats as any).sum === "number") {
        return "number"
    }
    if (Array.isArray((stats as any).frequency)) {
        const values = (stats as any).frequency.map((entry: any) => entry?.value)
        const uniqueTypes = new Set(values.map((value) => typeof value))
        if (uniqueTypes.size === 1) {
            const [only] = Array.from(uniqueTypes)
            if (only === "boolean") return "boolean"
            if (only === "string") return "string"
        }
    }
    return undefined
}

const inferMetricsFromStatsForSlug = (
    slug: string,
    statsMap: Record<string, BasicStats> | undefined,
    relatedSlugs: string[] = [],
): any[] => {
    if (!slug || !statsMap) return []
    const candidates = new Set<string>([slug, ...relatedSlugs].filter(Boolean) as string[])
    const derived = new Map<string, {metricType?: string}>()

    const recordMetric = (name: string | undefined, stats: BasicStats | undefined) => {
        if (!name) return
        const normalizedName = normalizeEvaluatorMetricName(name) ?? name
        if (!normalizedName) return
        const existing = derived.get(normalizedName) ?? {}
        if (!existing.metricType) {
            const inferred = inferMetricTypeFromStats(stats)
            if (inferred) existing.metricType = inferred
        }
        derived.set(normalizedName, existing)
    }

    Object.entries(statsMap).forEach(([rawKey, stats]) => {
        if (typeof rawKey !== "string") return
        for (const candidate of candidates) {
            const prefix = `${candidate}.`
            if (rawKey.startsWith(prefix)) {
                const metricName = rawKey.slice(prefix.length)
                if (metricName && !metricName.includes("attributes.ag.metrics")) {
                    if (metricName.startsWith(OUTPUT_PREFIX)) {
                        const tail = metricName.slice(OUTPUT_PREFIX.length)
                        if (tail) {
                            recordMetric(`${tail}`, stats)
                        }
                    }
                }
                return
            }
        }

        if (rawKey.startsWith(OUTPUT_PREFIX)) {
            const tail = rawKey.slice(OUTPUT_PREFIX.length)
            if (!tail) return
            recordMetric(`outputs.${tail}`, stats)
        }
    })

    return Array.from(derived.entries()).map(([key, meta]) => ({[key]: meta}))
}

const AUTO_INVOCATION_METRIC_SUFFIXES = GeneralAutoEvalMetricColumns.map((col) => col.path)
const AUTO_INVOCATION_METRIC_CANONICAL_SET = new Set(
    AUTO_INVOCATION_METRIC_SUFFIXES.map((path) => canonicalizeMetricKey(path)),
)

const matchesGeneralInvocationMetric = (path?: string): boolean => {
    if (!path) return false
    if (AUTO_INVOCATION_METRIC_SUFFIXES.some((suffix) => path.endsWith(suffix))) {
        return true
    }
    const segments = path.split(".")
    for (let i = 0; i < segments.length; i += 1) {
        const candidate = segments.slice(i).join(".")
        if (AUTO_INVOCATION_METRIC_CANONICAL_SET.has(canonicalizeMetricKey(candidate))) {
            return true
        }
    }
    return AUTO_INVOCATION_METRIC_CANONICAL_SET.has(canonicalizeMetricKey(path))
}

/**
 * Build the data source (rows) for the virtualised scenario table.
 * This logic was previously inline inside the table component; moving it here means
 * the component can stay tidy while we have a single canonical place that knows:
 *   • which scenarios belong to the run
 *   • what their execution / annotation status is
 *   • how to present skeleton rows while data is still loading
 */

export function buildScenarioTableRows({
    scenarioIds,
    allScenariosLoaded,
    skeletonCount = 20,
    runId,
    scenarioMetaById,
}: {
    scenarioIds: string[]
    allScenariosLoaded: boolean
    skeletonCount?: number
    runId: string
    scenarioMetaById?: Map<string, {timestamp?: string; createdAt?: string}>
}): TableRow[] {
    if (!allScenariosLoaded) {
        // Render placeholder skeleton rows (fixed count) so the table height is stable
        return buildSkeletonRows(skeletonCount).map((r, idx) => ({
            ...r,
            scenarioIndex: idx + 1,
        }))
    }

    let previousGroupKey: string | undefined
    let temporalGroupIndex = -1

    return scenarioIds.map((id, idx) => {
        const meta = scenarioMetaById?.get(id)
        const timestamp = meta?.timestamp || meta?.createdAt || null
        const groupKey = timestamp ?? "__no_timestamp__"
        const isGroupStart = groupKey !== previousGroupKey
        if (isGroupStart) {
            temporalGroupIndex += 1
            previousGroupKey = groupKey
        }

        return {
            key: id,
            scenarioId: id,
            scenarioIndex: idx + 1,
            runId,
            timestamp,
            temporalGroupKey: groupKey,
            temporalGroupIndex,
            isTemporalGroupStart: isGroupStart,
        }
    })
}

/**
 * Build raw ColumnDef list for scenario table.
 */
export function buildScenarioTableData({
    runIndex,
    metricsFromEvaluators,
    metrics,
    runId,
    evaluators,
    evaluatorNameBySlug,
    revisionSlugByEvaluatorSlug,
}: {
    runIndex: RunIndex | null | undefined
    metricsFromEvaluators: Record<string, any>
    metrics: Record<string, BasicStats>
    runId: string
    evaluators: EvaluatorDto[]
    evaluatorNameBySlug?: Record<string, string>
    revisionSlugByEvaluatorSlug?: Map<string, string>
}): (ColumnDef & {values?: Record<string, any>})[] {
    const baseColumnDefs: ColumnDef[] = runIndex ? Object.values(runIndex.columnsByStep).flat() : []
    const evalType = evalAtomStore().get(evalTypeAtom)
    const isHumanLikeEval = evalType === "human"
    //  || evalType === "online"
    const resolveEvaluatorName = createEvaluatorNameResolver(evaluatorNameBySlug)
    const metricStatsMap = (metrics || {}) as Record<string, BasicStats | undefined>
    const slugToStepKeyMap = new Map<string, string>()
    Object.entries(runIndex?.steps || {}).forEach(([key, meta]) => {
        const slug = resolveSlugFromStepMeta(meta, revisionSlugByEvaluatorSlug)
        if (slug && !slugToStepKeyMap.has(slug)) {
            slugToStepKeyMap.set(slug, key)
        }
    })
    const baseSlugByRevisionSlug = buildBaseSlugByRevisionSlug(revisionSlugByEvaluatorSlug)
    const evaluatorSlugSet = new Set(
        (evaluators || [])
            .map((e) => (typeof e?.slug === "string" ? e.slug : undefined))
            .filter((slug): slug is string => Boolean(slug)),
    )

    const columnsInput = baseColumnDefs.filter(
        (col) => col.kind === "input" && col.name !== "testcase_dedup_id",
    )
    const columnsInvocation = baseColumnDefs.filter((col) => col.kind === "invocation")

    if (!columnsInput.length && isHumanLikeEval && columnsInvocation.length) {
        columnsInput.push({
            name: "Inputs",
            kind: "input",
            path: "__fallback_input__",
            stepKey: columnsInvocation[0]?.stepKey ?? "__fallback_input__",
            key: "__fallback_input__",
        } as ColumnDef)
    }

    // Further group metrics by evaluator when evaluators info present
    const evaluatorMetricGroups: any[] = []
    const invocationMetricGroups: any[] = []
    const rawMetricsByEvaluator: Record<string, any[]> =
        metricsFromEvaluators && typeof metricsFromEvaluators === "object"
            ? (metricsFromEvaluators as Record<string, any[]>)
            : {}

    const normalizedMetricsByEvaluator: Record<string, any[]> = {}
    const registerMetricDefinitions = (targetSlug: string, defs: any[]) => {
        if (!targetSlug || !Array.isArray(defs)) return
        if (!normalizedMetricsByEvaluator[targetSlug]) {
            normalizedMetricsByEvaluator[targetSlug] = []
        }
        defs.forEach((definition) => {
            if (!definition || typeof definition !== "object") return
            const normalizedDefinition: Record<string, any> = {}
            Object.entries(definition).forEach(([key, value]) => {
                if (!key) return
                const normalizedKey = normalizeEvaluatorMetricName(key) ?? key
                normalizedDefinition[normalizedKey] = value
            })
            if (Object.keys(normalizedDefinition).length) {
                normalizedMetricsByEvaluator[targetSlug].push(normalizedDefinition)
            }
        })
    }
    Object.entries(rawMetricsByEvaluator).forEach(([slug, defs]) => {
        if (!Array.isArray(defs)) return
        const preferred = resolvePreferredSlug(slug, revisionSlugByEvaluatorSlug) ?? slug
        registerMetricDefinitions(preferred, defs)
    })

    const getMetricDefinitionsForSlug = buildMetricDefsLookup(
        normalizedMetricsByEvaluator,
        revisionSlugByEvaluatorSlug,
    )

    // Evaluator Metric Columns
    if (metricsFromEvaluators && isHumanLikeEval) {
        const annotationData = baseColumnDefs.filter((def) => def.kind === "annotation")
        const columnsByEvaluator: Record<string, ColumnDef[]> = {}

        annotationData.forEach((data) => {
            const stepMeta = runIndex?.steps?.[data.stepKey]
            const slug = stepMeta?.key.split(".")[1]
            if (!slug) return
            ;(columnsByEvaluator[slug] ||= []).push(data)
        })

        const evaluatorSlugs = new Set<string>()
        Object.keys(columnsByEvaluator).forEach((slug) => {
            const d = columnsByEvaluator[slug]
            evaluatorSlugs.add(slug)
        })

        evaluatorSlugs.forEach((slug) => {
            if (!slug) return
            const slugColumns = columnsByEvaluator[slug] || []
            const baseSlugForRevision = baseSlugByRevisionSlug.get(slug)
            const evaluator =
                evaluators?.find((e) => e.slug === slug) ||
                evaluators?.find(
                    (e) => resolvePreferredSlug(e.slug, revisionSlugByEvaluatorSlug) === slug,
                )
            const evaluatorLabel = resolveEvaluatorName(slug)

            const metricDefsForSlug = getMetricDefinitionsForSlug(slug)
            const inferredMetricDefs =
                metricDefsForSlug.length > 0
                    ? metricDefsForSlug
                    : inferMetricsFromStatsForSlug(
                          slug,
                          metrics?.[slug] as Record<string, BasicStats>,
                          baseSlugForRevision ? [baseSlugForRevision] : [],
                      )
            const resolvedMetricDefs =
                inferredMetricDefs && inferredMetricDefs.length
                    ? inferredMetricDefs
                    : inferMetricsFromStatsForSlug(
                          slug,
                          metricStatsMap,
                          baseSlugForRevision ? [baseSlugForRevision] : [],
                      )

            const resolveMetricType = (metricName: string) => {
                const entry = resolvedMetricDefs.find((definition: Record<string, any>) => {
                    if (!definition || typeof definition !== "object") return false
                    return Object.prototype.hasOwnProperty.call(definition, metricName)
                })
                if (!entry) return undefined
                return entry[metricName]?.metricType
            }

            let children =
                slugColumns.map((data) => {
                    const rawName =
                        data.name?.startsWith(`${slug}.`) && data.name.length > slug.length + 1
                            ? data.name.slice(slug.length + 1)
                            : data.name
                    const metricName = normalizeEvaluatorMetricName(rawName) ?? rawName
                    const normalizedLabel = (metricName || rawName || "").toLowerCase()
                    if (normalizedLabel === "outputs" || normalizedLabel === "metrics") {
                        return undefined
                    }
                    const formattedMetricName = formatColumnTitle(metricName || data.name || "")
                    const primaryKey = metricName
                        ? `${slug}.attributes.ag.data.outputs.${metricName}`
                        : data.name || data.path
                    return {
                        ...data,
                        name: metricName || data.name,
                        title: formattedMetricName,
                        kind: "annotation" as const,
                        // kind: "metric" as const,
                        path: primaryKey,
                        stepKey: data.stepKey,
                        fallbackPath: data.path && data.path !== primaryKey ? data.path : undefined,
                        metricType: resolveMetricType(metricName || data.name || ""),
                    }
                }) || ([].filter(Boolean) as ColumnDef[])

            if (!children.length && resolvedMetricDefs.length) {
                const seen = new Set<string>()
                const fallbackStepKey = slugColumns[0]?.stepKey || slugToStepKeyMap.get(slug)
                children = resolvedMetricDefs
                    .map((definition: Record<string, any>) => {
                        const metricName = Object.keys(definition || {})[0]
                        if (!metricName || seen.has(metricName)) return undefined
                        seen.add(metricName)
                        const formattedMetricName = formatColumnTitle(metricName)
                        return {
                            name: metricName,
                            title: formattedMetricName,
                            kind: "annotation" as const,
                            // kind: "metric" as const,
                            key: `${slug}.${metricName}`,
                            path: `${slug}.${metricName}`,
                            fallbackPath: `${slug}.${metricName}`,
                            stepKey: fallbackStepKey ?? "metric",
                            metricType: definition?.[metricName]?.metricType,
                        }
                    })
                    .filter(Boolean) as ColumnDef[]
            }

            if (!children.length) return

            evaluatorMetricGroups.push({
                title: evaluator?.name || evaluatorLabel,
                key: `metrics_${slug}`,
                children,
            })
        })
    }

    if (metricsFromEvaluators && ["auto", "online", "custom"].includes(evalType)) {
        const annotationData = baseColumnDefs.filter((def) => def.kind === "annotation")

        const stepSlugByKey = new Map<string, string>()
        Object.entries(runIndex?.steps || {}).forEach(([key, meta]) => {
            if (meta.kind === "annotation") {
                const slug = resolveSlugFromStepMeta(meta, revisionSlugByEvaluatorSlug)
                if (slug) {
                    stepSlugByKey.set(key, slug)
                }
            }
        })

        const annotationColumnsBySlug: Record<string, ColumnDef[]> = {}
        annotationData.forEach((column) => {
            const slug = column.stepKey ? stepSlugByKey.get(column.stepKey) : undefined
            if (!slug) return
            ;(annotationColumnsBySlug[slug] ||= []).push(column)
        })

        const gatherMetricDefinitions = (key: string): any[] => {
            const defs = getMetricDefinitionsForSlug(key)
            if (defs.length) return defs
            const alias = stepSlugByKey.get(key)
            if (alias && alias !== key) {
                return getMetricDefinitionsForSlug(alias)
            }
            return []
        }

        const sourceKeys = new Set<string>()
        Array.from(stepSlugByKey.keys()).forEach((key) => {
            sourceKeys.add(key)
            const slugFromKey = resolvePreferredSlug(
                stepSlugByKey.get(key) || key,
                revisionSlugByEvaluatorSlug,
            )
            if (slugFromKey) sourceKeys.add(slugFromKey)
        })
        const evaluatorGroupsBySlug = new Map<
            string,
            {title: string; key: string; children: ColumnDef[]; seen: Set<string>}
        >()

        const getChildIdentity = (child: ColumnDef): string | undefined =>
            (typeof child.key === "string" && child.key.length ? child.key : undefined) ??
            (typeof child.path === "string" && child.path.length ? child.path : undefined) ??
            (typeof child.name === "string" && child.name.length ? child.name : undefined)

        const appendChildrenToGroup = (slug: string, title: string, children: ColumnDef[]) => {
            if (!children.length) return
            const groupKey = `metrics_${slug}_evaluators`
            const existing = evaluatorGroupsBySlug.get(groupKey)
            if (!existing) {
                const seen = new Set<string>()
                const deduped: ColumnDef[] = []
                children.forEach((child) => {
                    const identity = getChildIdentity(child)
                    if (!identity || seen.has(identity)) return
                    seen.add(identity)
                    deduped.push(child)
                })
                if (!deduped.length) return
                evaluatorGroupsBySlug.set(groupKey, {
                    title,
                    key: groupKey,
                    children: deduped,
                    seen,
                })
                return
            }
            children.forEach((child) => {
                const identity = getChildIdentity(child)
                if (!identity || existing.seen.has(identity)) return
                existing.seen.add(identity)
                existing.children.push(child)
            })
        }

        sourceKeys.forEach((rawKey) => {
            const slug = resolvePreferredSlug(
                stepSlugByKey.get(rawKey) || rawKey,
                revisionSlugByEvaluatorSlug,
            )
            if (!slug) return

            const stepData = runIndex?.steps?.[rawKey]

            const baseSlugForRevision = baseSlugByRevisionSlug.get(slug)
            const evaluator = evaluators?.find((e) => e.id === stepData?.refs?.evaluator?.id)
            const evaluatorLabel = resolveEvaluatorName(slug)
            const metricDefsPrimary = gatherMetricDefinitions(rawKey)
            let metricDefsForKey =
                metricDefsPrimary && metricDefsPrimary.length
                    ? metricDefsPrimary
                    : gatherMetricDefinitions(slug)
            if (!metricDefsForKey || !metricDefsForKey.length) {
                const relatedSlugs = new Set<string>()
                if (typeof rawKey === "string" && rawKey.length) relatedSlugs.add(rawKey)
                const alias = stepSlugByKey.get(rawKey)
                if (alias && alias !== slug) relatedSlugs.add(alias)
                if (baseSlugForRevision) relatedSlugs.add(baseSlugForRevision)
                metricDefsForKey = inferMetricsFromStatsForSlug(
                    slug,
                    metricStatsMap,
                    Array.from(relatedSlugs),
                )
            }

            const normalizedRawKey = resolvePreferredSlug(
                stepSlugByKey.get(rawKey) || rawKey,
                revisionSlugByEvaluatorSlug,
            )
            const columnsForKey = [
                ...(annotationColumnsBySlug[slug] || []),
                ...(normalizedRawKey && normalizedRawKey !== slug
                    ? annotationColumnsBySlug[normalizedRawKey] || []
                    : []),
            ]
            const hasMetricDefs =
                normalizedMetricsByEvaluator[slug]?.length ||
                (normalizedRawKey && normalizedMetricsByEvaluator[normalizedRawKey]?.length) ||
                (metricDefsForKey?.length ?? 0) > 0

            if (!columnsForKey.length && !hasMetricDefs && !metricDefsForKey?.length) {
                return
            }

            const seen = new Set<string>()
            const children: ColumnDef[] = []
            const pushChild = (child?: ColumnDef) => {
                if (!child) return
                const key = child.key || child.path || child.name
                if (!key) return
                if (seen.has(key)) return
                seen.add(key)
                children.push(child)
            }

            const appendMetricDefs = (definitions: Record<string, any>[]) => {
                definitions.forEach((definition: Record<string, any>) => {
                    const originalName = Object.keys(definition || {})[0]
                    const metricName = normalizeEvaluatorMetricName(originalName) ?? originalName
                    const metricType = definition?.[metricName]?.metricType
                    if (!metricName) return
                    if (metricType === "object") return
                    const canonicalKey = `${slug}.${metricName}`
                    if (seen.has(canonicalKey)) return
                    const candidatesForSkip = [
                        canonicalKey,
                        metricName,
                        `attributes.ag.data.outputs.${metricName}`,
                    ]
                    if (
                        candidatesForSkip.some((candidate) =>
                            matchesGeneralInvocationMetric(candidate),
                        )
                    ) {
                        return
                    }
                    const formattedName = formatColumnTitle(metricName)

                    pushChild({
                        name: metricName,
                        title: formattedName,
                        kind: "annotation" as const,
                        key: canonicalKey,
                        path: `${rawKey}.${OUTPUT_PREFIX}${metricName}`,
                        stepKey: rawKey ?? "metric",
                        metricType,
                    })
                })
            }

            if (metricDefsForKey.length) {
                appendMetricDefs(metricDefsForKey)
            }

            if (!children.length) return

            appendChildrenToGroup(slug, evaluator?.name || evaluatorLabel, children)
        })

        evaluatorGroupsBySlug.forEach(({seen: _seen, ...group}) => {
            evaluatorMetricGroups.push(group)
        })
    }
    const genericMetricsGroup = {
        title: "Metrics",
        key: "__metrics_group__",
        children:
            evalType === "human" ? GeneralHumanEvalMetricColumns : GeneralAutoEvalMetricColumns,
    }

    let metaStart: ColumnDef[] = [
        {name: "#", kind: "meta" as any, path: "scenarioIndex", stepKey: "meta"},
    ]

    if (evalType === "online") {
        metaStart.push({
            name: "Timestamp",
            kind: "meta" as any,
            path: "timestamp",
            key: "timestamp",
            stepKey: "meta",
        })
    }

    const metaEnd: ColumnDef[] =
        evalType === "human"
            ? [{name: "Action", kind: "meta" as any, path: "action", stepKey: "meta"}]
            : []

    const columnsCore = [...columnsInput, ...columnsInvocation, ...evaluatorMetricGroups]
    if (genericMetricsGroup) columnsCore.push(genericMetricsGroup as any)
    const columns = [...metaStart, ...columnsCore, ...metaEnd]

    return columns
}

/**
 * Build columns for comparison mode showing multiple runs side-by-side
 */
export function buildComparisonTableColumns({
    baseRunId,
    comparisonRunIds,
    baseRunIndex,
    comparisonRunIndexes,
    metricsFromEvaluators,
    evaluatorNameBySlug,
}: {
    baseRunId: string
    comparisonRunIds: string[]
    baseRunIndex: RunIndex | null | undefined
    comparisonRunIndexes: Record<string, RunIndex | null | undefined>
    metricsFromEvaluators: Record<string, Record<string, any>>
    evaluatorNameBySlug?: Record<string, string>
}): (ColumnDef & {values?: Record<string, any>})[] {
    if (!baseRunIndex) return []

    const allRunIds = [baseRunId, ...comparisonRunIds]
    const evalType = evalAtomStore().get(evalTypeAtom)
    const resolveEvaluatorName = createEvaluatorNameResolver(evaluatorNameBySlug)

    // Start with meta columns
    const metaColumns: ColumnDef[] = [
        {name: "#", kind: "meta" as any, path: "scenarioIndex", stepKey: "meta"},
    ]

    // Get base column definitions (inputs, outputs, etc.)
    const baseColumnDefs: ColumnDef[] = Object.values(baseRunIndex.columnsByStep).flat()
    const inputOutputColumns = baseColumnDefs
        .filter((col) => col.kind !== "annotation" && col.kind !== "metric")
        .filter((col) => col.name !== "testcase_dedup_id")

    // For comparison mode, we want to show inputs once, then outputs/metrics for each run
    const inputColumns = inputOutputColumns.filter((col) => col.stepKey === "input")

    // Create run-specific output columns
    const runSpecificColumns: any[] = []

    allRunIds.forEach((runId, index) => {
        const isBase = index === 0
        const runLabel = isBase ? "Base" : `Run ${index}`
        const runShort = runId.slice(0, 8)

        // Output columns for this run
        const outputColumns = inputOutputColumns
            .filter((col) => col.stepKey === "output")
            .map((col) => ({
                ...col,
                name: `${col.name} (${runLabel})`,
                title: `${col.name} (${runShort})`,
                runId,
                isComparison: !isBase,
            }))

        // Metric columns for this run
        if (metricsFromEvaluators && evalType !== "auto") {
            const annotationData = baseColumnDefs.filter((def) => def.kind === "annotation")
            const groupedAnnotationData = groupBy(annotationData, (data) => {
                return data.name.split(".")[0]
            })

            for (const [evaluatorSlug, annotations] of Object.entries(groupedAnnotationData)) {
                const evaluatorLabel = resolveEvaluatorName(evaluatorSlug)
                const metricGroup = {
                    title: `${evaluatorLabel} (${runLabel})`,
                    key: `metrics_${evaluatorSlug}_${runId}`,
                    runId,
                    isComparison: !isBase,
                    children: annotations.map((data) => {
                        const [, metricName] = data.name.split(".")
                        return {
                            ...data,
                            name: metricName,
                            title: `${metricName} (${runShort})`,
                            kind: "metric",
                            path: data.name,
                            stepKey: "metric",
                            runId,
                            isComparison: !isBase,
                            metricType: metricsFromEvaluators[evaluatorSlug]?.find(
                                (x) => metricName in x,
                            )?.[metricName]?.metricType,
                        }
                    }),
                }
                runSpecificColumns.push(metricGroup)
            }
        }

        runSpecificColumns.push(...outputColumns)
    })

    const actionColumns: ColumnDef[] = [
        {name: "Action", kind: "meta" as any, path: "action", stepKey: "meta"},
    ]

    return [...metaColumns, ...inputColumns, ...runSpecificColumns, ...actionColumns]
}

/**
 * Build rows for comparison mode with data from multiple runs
 */
export function buildComparisonTableRows({
    scenarioIds,
    baseRunId,
    comparisonRunIds,
    allScenariosLoaded,
    skeletonCount = 20,
}: {
    scenarioIds: string[]
    baseRunId: string
    comparisonRunIds: string[]
    allScenariosLoaded: boolean
    skeletonCount?: number
}): TableRow[] {
    if (!allScenariosLoaded) {
        return buildSkeletonRows(skeletonCount).map((r, idx) => ({
            ...r,
            scenarioIndex: idx + 1,
        }))
    }

    return scenarioIds.map((scenarioId, idx) => {
        const row: TableRow = {
            key: scenarioId,
            scenarioIndex: idx + 1,
            scenarioId,
            baseRunId,
            comparisonRunIds,
        }

        // Add run-specific data placeholders
        // The actual data will be populated by the table cells using atoms
        const allRunIds = [baseRunId, ...comparisonRunIds]
        allRunIds.forEach((runId) => {
            row[`${runId}_data`] = {
                runId,
                scenarioId,
                // Cell components will use atoms to get actual data
            }
        })

        return row
    })
}
