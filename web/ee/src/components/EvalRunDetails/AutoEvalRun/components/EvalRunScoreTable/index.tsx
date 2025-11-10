import {isValidElement, cloneElement, memo, useCallback, useMemo, useEffect, useState} from "react"

import {Table, Typography} from "antd"
import clsx from "clsx"
import deepEqual from "fast-deep-equal"
import {atom, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import dynamic from "next/dynamic"

import {formatColumnTitle} from "@/oss/components/Filters/EditColumns/assets/helper"
import {formatMetricValue} from "@/oss/components/HumanEvaluations/assets/MetricDetailsPopover/assets/utils"
import FiltersPreview from "@/oss/components/pages/evaluations/onlineEvaluation/components/FiltersPreview"
import {useRunId} from "@/oss/contexts/RunIdContext"
import useURL from "@/oss/hooks/useURL"
import dayjs from "@/oss/lib/helpers/dateTimeHelper/dayjs"
import {formatLatency} from "@/oss/lib/helpers/formatters"
import {evaluationRunStateFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {runMetricStatsFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/runScopedMetrics"
import {
    BasicStats,
    canonicalizeMetricKey,
    getMetricDisplayName,
    getMetricValueWithAliases,
} from "@/oss/lib/metricUtils"

import {
    retrieveQueryRevision,
    type QueryFilteringPayload,
} from "../../../../../services/onlineEvaluations/api"
import {
    collectMetricSchemasFromEvaluator,
    deriveSchemaMetricType,
} from "../../../components/VirtualizedScenarioTable/assets/evaluatorSchemaUtils"
import RenameEvalButton from "../../../HumanEvalRun/components/Modals/RenameEvalModal/assets/RenameEvalButton"
import {urlStateAtom} from "../../../state/urlState"
import EvalNameTag from "../../assets/EvalNameTag"
import TagWithLink from "../../assets/TagWithLink"
import {EVAL_TAG_COLOR, EVAL_COLOR, EVAL_BG_COLOR} from "../../assets/utils"
import {formatMetricName} from "../../assets/utils"
import VariantTag from "../../assets/VariantTag"
import {getVariantDisplayMetadata} from "../../assets/variantUtils"
import type {EvaluatorMetricsSpiderChartProps} from "../EvaluatorMetircsSpiderChart/types"
import PlaceholderOverlay from "../shared/PlaceholderOverlay"
import SpiderChartPlaceholder from "../shared/SpiderChartPlaceholder"

const EvaluatorMetricsSpiderChart = dynamic<EvaluatorMetricsSpiderChartProps>(
    () => import("../EvaluatorMetircsSpiderChart"),
    {ssr: false},
)

// Atom helpers to read multiple runs' state/metrics in one go
const runsStateFamily = atomFamily(
    (runIds: string[]) => atom((get) => runIds.map((id) => get(evaluationRunStateFamily(id)))),
    deepEqual,
)
const runsMetricsFamily = atomFamily(
    (runIds: string[]) =>
        atom((get) => runIds.map((id) => ({id, metrics: get(runMetricStatsFamily({runId: id}))}))),
    deepEqual,
)

const INVOCATION_METRIC_KEYS = [
    "attributes.ag.metrics.costs.cumulative.total",
    "attributes.ag.metrics.duration.cumulative",
    "attributes.ag.metrics.tokens.cumulative.total",
    "attributes.ag.metrics.errors.cumulative",
] as const

const INVOCATION_METRIC_SET = new Set<string>(INVOCATION_METRIC_KEYS)

const COST_METRIC_KEY = INVOCATION_METRIC_KEYS[0]
const DURATION_METRIC_KEY = INVOCATION_METRIC_KEYS[1]
const TOKEN_METRIC_KEY = INVOCATION_METRIC_KEYS[2]
const ERRORS_METRIC_KEY = INVOCATION_METRIC_KEYS[3]

const INVOCATION_METRIC_COLUMNS: {key: string; label: string}[] = [
    {key: COST_METRIC_KEY, label: "Cost (Total)"},
    {key: DURATION_METRIC_KEY, label: "Duration (Total)"},
    {key: TOKEN_METRIC_KEY, label: "Tokens (Total)"},
    {key: ERRORS_METRIC_KEY, label: "Errors"},
]

const metricHasContent = (metric: Record<string, any> | undefined): boolean => {
    if (!metric || typeof metric !== "object") return false
    if (typeof metric.mean === "number" && Number.isFinite(metric.mean)) return true
    if (typeof metric.count === "number" && metric.count > 0) return true

    const distribution: any[] | undefined = Array.isArray((metric as any).distribution)
        ? (metric as any).distribution
        : undefined
    if (distribution && distribution.some((bin) => Number(bin?.count ?? 0) > 0)) return true

    const hist = Array.isArray((metric as any).hist) ? (metric as any).hist : undefined
    if (hist && hist.some((bin) => Number(bin?.count ?? bin?.frequency ?? 0) > 0)) return true

    const freq = Array.isArray((metric as any).frequency)
        ? (metric as any).frequency
        : Array.isArray((metric as any).rank)
          ? (metric as any).rank
          : undefined
    if (freq && freq.some((entry) => Number(entry?.count ?? entry?.frequency ?? 0) > 0)) return true

    const unique = (metric as any).unique
    if (Array.isArray(unique) && unique.length > 0) {
        return typeof metric.mean === "number"
    }

    return false
}

const EvalRunScoreTable = ({className, type}: {className?: string; type: "auto" | "online"}) => {
    const baseRunId = useRunId()
    const {projectURL} = useURL()
    const urlState = useAtomValue(urlStateAtom)
    const compareRunIds = (urlState?.compare || []).filter((id) => id && id !== baseRunId)
    const allRunIds = useMemo(() => [baseRunId!, ...compareRunIds], [baseRunId, compareRunIds])

    const isComparison = compareRunIds.length > 0

    // Fetch all runs and their metrics
    const runs = useAtomValue(runsStateFamily(allRunIds))
    const metricsByRun = useAtomValue(runsMetricsFamily(allRunIds))

    const evaluatorsBySlug = useMemo(() => {
        const map = new Map<string, any>()
        const register = (entry: any, slug: string) => {
            if (!entry || typeof entry !== "object") return
            if (!slug || map.has(slug)) return
            map.set(slug, entry)
        }

        runs.forEach((state) => {
            const annotationSteps = state?.enrichedRun?.data?.steps?.filter(
                (step: any) => step?.type === "annotation",
            )
            annotationSteps?.forEach((step: any) => {
                const evaluatorId = step?.references?.evaluator?.id
                if (!evaluatorId) return
                const evaluator = (state?.enrichedRun?.evaluators || []).find(
                    (e: any) => e.id === evaluatorId,
                )
                if (evaluator) {
                    const originalKey = typeof step?.key === "string" ? step.key : undefined
                    const parts = originalKey ? originalKey.split(".") : []
                    const humanKey = parts.length > 1 ? parts[1] : originalKey
                    const resolvedKey = step.origin === "human" ? humanKey : originalKey
                    if (originalKey) {
                        register(evaluator, originalKey)
                    }
                    if (resolvedKey && resolvedKey !== originalKey) {
                        register(evaluator, resolvedKey)
                    }
                }
            })
        })

        return Object.fromEntries(map.entries())
    }, [runs])

    const schemaMetricDefinitionsBySlug = useMemo(() => {
        const map: Record<string, {name: string; type?: string | string[]}[]> = {}
        Object.entries(evaluatorsBySlug).forEach(([slug, evaluator]) => {
            const definitions = collectMetricSchemasFromEvaluator(evaluator)
                .map(({name, schema}) => {
                    const trimmed = (name || "").trim()
                    if (!trimmed) return null
                    return {name: trimmed, type: deriveSchemaMetricType(schema)}
                })
                .filter(Boolean) as {name: string; type?: string | string[]}[]

            const existing = map[slug] ?? []
            const merged = new Map<string, {name: string; type?: string | string[]}>()
            existing.forEach((definition) => merged.set(definition.name, definition))
            definitions.forEach((definition) => merged.set(definition.name, definition))
            map[slug] = Array.from(merged.values())
        })
        return map
    }, [evaluatorsBySlug])

    const evaluatorMetricKeysBySlug = useMemo(() => {
        const map: Record<string, Set<string>> = {}
        Object.entries(schemaMetricDefinitionsBySlug).forEach(([slug, definitions]) => {
            const set = new Set<string>()
            definitions.forEach(({name}) => {
                const canonical = canonicalizeMetricKey(name)
                set.add(name)
                set.add(canonical)
                const prefixed = `${slug}.${name}`
                set.add(prefixed)
                set.add(canonicalizeMetricKey(prefixed))
            })
            map[slug] = set
        })
        return map
    }, [schemaMetricDefinitionsBySlug])

    // Convenience lookup maps
    const evalById = useMemo(() => {
        const map: Record<string, any> = {}
        runs.forEach((r) => (map[r.enrichedRun?.id || r.id] = r))
        return map
    }, [runs])

    const metricsLookup = useMemo(() => {
        const map: Record<string, Record<string, BasicStats>> = {}

        metricsByRun.forEach(({id, metrics}) => {
            const source = (metrics || {}) as Record<string, BasicStats>
            const normalized: Record<string, BasicStats> = {...source}

            Object.entries(source || {}).forEach(([rawKey, value]) => {
                const canonical = canonicalizeMetricKey(rawKey)
                if (canonical !== rawKey && normalized[canonical] === undefined) {
                    normalized[canonical] = value
                }
            })
            map[id] = normalized
        })

        return map
    }, [metricsByRun])

    const combinedMetricEntries = useMemo(() => {
        const entries: {
            fullKey: string
            evaluatorSlug: string
            metricKey: string
        }[] = []
        const seen = new Set<string>()

        const pushEntry = (source: Record<string, any>) => {
            Object.keys(source || {}).forEach((rawKey) => {
                const canonical = canonicalizeMetricKey(rawKey)
                if (INVOCATION_METRIC_SET.has(canonical)) return
                if (!canonical.includes(".")) return
                if (seen.has(canonical)) return

                const metric =
                    (getMetricValueWithAliases(source, canonical) as Record<string, any>) ||
                    (source?.[rawKey] as Record<string, any>)
                if (!metricHasContent(metric)) return

                const segments = canonical.split(".").filter(Boolean)
                if (!segments.length) return

                const resolveSlugFromSegments = () => {
                    let slugCandidate = segments[0]
                    let idx = 1
                    while (idx <= segments.length) {
                        if (evaluatorsBySlug[slugCandidate]) {
                            return {slug: slugCandidate, metricStartIdx: idx}
                        }
                        if (idx >= segments.length) break
                        slugCandidate = `${slugCandidate}.${segments[idx]}`
                        idx += 1
                    }
                    if (segments.length > 1 && evaluatorsBySlug[segments[1]]) {
                        return {slug: segments[1], metricStartIdx: 2}
                    }
                    return null
                }

                const resolved = resolveSlugFromSegments()
                if (!resolved) return
                const {slug, metricStartIdx} = resolved

                const evaluator = evaluatorsBySlug[slug]
                if (!evaluator) return

                const metricKeySegments = segments.slice(metricStartIdx)
                const metricKey =
                    metricKeySegments.length > 0
                        ? metricKeySegments.join(".")
                        : (segments[metricStartIdx - 1] ?? slug)

                if (metricKey.startsWith("attributes.ag.metrics")) {
                    return
                }

                const allowedKeys = evaluatorMetricKeysBySlug[slug]
                if (allowedKeys && allowedKeys.size) {
                    const keySegments = metricKey.split(".").filter(Boolean)
                    const candidateKeys = new Set<string>([metricKey])
                    keySegments.forEach((_, idx) => {
                        const prefix = keySegments.slice(0, idx + 1).join(".")
                        const suffix = keySegments.slice(idx).join(".")
                        if (prefix) candidateKeys.add(prefix)
                        if (suffix) candidateKeys.add(suffix)
                        const segment = keySegments[idx]
                        if (segment) candidateKeys.add(segment)
                    })
                    const matchesDefinition = Array.from(candidateKeys).some((key) =>
                        allowedKeys.has(key),
                    )
                    if (!matchesDefinition) return
                }

                entries.push({fullKey: canonical, evaluatorSlug: slug, metricKey})
                seen.add(canonical)
            })
        }

        metricsByRun.forEach(({metrics}) => {
            const source = (metrics || {}) as Record<string, any>
            pushEntry(source)
        })

        return entries
    }, [metricsByRun, evaluatorsBySlug, evaluatorMetricKeysBySlug])

    const baseRunState = baseRunId ? evalById[baseRunId] : undefined
    const hasBaseScenarios =
        (typeof baseRunState?.statusMeta?.total === "number" &&
            baseRunState.statusMeta.total > 0) ||
        (Array.isArray(baseRunState?.scenarios) && baseRunState.scenarios.length > 0)
    const shouldShowSpiderPlaceholder = !hasBaseScenarios

    const getFrequencyData = useCallback((metric: any, returnPercentage = true) => {
        const trueEntry = (metric as any)?.frequency?.find((f: any) => f?.value === true)
        const total = (metric as any)?.count ?? 0
        return returnPercentage
            ? `${(((trueEntry?.count ?? 0) / total) * 100).toFixed(2)}%`
            : ((trueEntry?.count ?? 0) / total) * 100
    }, [])

    const chartMetrics = useMemo(() => {
        interface Axis {
            name: string
            maxScore: number
            type: "binary" | "numeric"
            value?: number
            [k: string]: any
            _key: string
        }

        const axesByKey: Record<string, Axis> = {}

        combinedMetricEntries.forEach(({fullKey, evaluatorSlug, metricKey}) => {
            const evaluator = evaluatorsBySlug[evaluatorSlug]
            if (!evaluator) return

            const displayMetricName = metricKey
                ? formatMetricName(metricKey)
                : formatMetricName(fullKey)
            const evaluatorLabel = evaluator?.name ?? formatColumnTitle(evaluatorSlug)

            const axis =
                axesByKey[fullKey] ||
                (axesByKey[fullKey] = {
                    name: `${evaluatorLabel} - ${displayMetricName}`,
                    maxScore: 100,
                    type: "numeric",
                    _key: fullKey,
                })

            allRunIds.forEach((runId, runIdx) => {
                const stats = metricsLookup[runId] || {}
                const metric = getMetricValueWithAliases(stats, fullKey)
                if (!metricHasContent(metric)) return

                const isBinary = Array.isArray((metric as any)?.frequency)
                axis.type = isBinary ? "binary" : "numeric"
                if (!isBinary) {
                    const mx = (metric as any)?.max
                    if (typeof mx === "number") {
                        axis.maxScore = Math.max(axis.maxScore, mx)
                    }
                } else {
                    axis.maxScore = 100
                }

                const seriesKey = runIdx === 0 ? "value" : `value-${runIdx + 1}`
                axis[seriesKey] = isBinary
                    ? getFrequencyData(metric, false)
                    : ((metric as any)?.mean ?? 0)
            })
        })

        let axes: Axis[] = Object.values(axesByKey)

        const evaluatorCount = axes.length
        const addInvocationAxis = (metricKey: string, label?: string) => {
            const axis: Axis = {
                name: label ?? getMetricDisplayName(metricKey),
                maxScore: 0,
                type: "numeric",
                _key: metricKey,
            }

            allRunIds.forEach((runId, runIdx) => {
                const metrics = metricsLookup[runId]
                const metric = getMetricValueWithAliases(metrics || {}, metricKey) as any
                if (!metric) return
                const seriesKey = runIdx === 0 ? "value" : `value-${runIdx + 1}`
                if (metric.mean !== undefined) {
                    axis[seriesKey] = metric.mean
                    axis.maxScore = Math.max(axis.maxScore, metric.mean)
                }
            })

            if (axis.maxScore > 0) {
                axes.push(axis)
            }
        }

        if (evaluatorCount < 3) {
            INVOCATION_METRIC_COLUMNS.forEach(({key, label}) => addInvocationAxis(key, label))
        }

        if (axes.length > 0) {
            allRunIds.forEach((_, runIdx) => {
                const seriesKey = runIdx === 0 ? "value" : `value-${runIdx + 1}`
                axes.forEach((a) => {
                    if (a[seriesKey] === undefined) a[seriesKey] = 0
                })
            })
        }

        return axes.map(({_key, ...rest}) => rest)
    }, [allRunIds, combinedMetricEntries, evaluatorsBySlug, metricsLookup, getFrequencyData])

    const spiderChartClassName = clsx([
        "min-h-[400px] h-[400px]",
        {"w-[50%] !h-full": !isComparison},
    ])

    const chartSeries = useMemo(
        () =>
            allRunIds.map((id, idx) => {
                const state = evalById[id]
                const compareIdx = state?.compareIndex || idx + 1
                const colorIdx = state?.colorIndex || (state?.isBase ? 1 : undefined) || compareIdx
                return {
                    key: idx === 0 ? "value" : `value-${idx + 1}`,
                    color: (EVAL_COLOR as any)[colorIdx] || "#3B82F6",
                    name: state?.enrichedRun?.name || `Eval ${compareIdx}`,
                }
            }),
        [allRunIds, evalById],
    )

    const sortedEvaluatorMetricEntries = useMemo(() => {
        const entries = [...combinedMetricEntries]
        entries.sort((a, b) =>
            a.evaluatorSlug === b.evaluatorSlug
                ? a.metricKey.localeCompare(b.metricKey)
                : a.evaluatorSlug.localeCompare(b.evaluatorSlug),
        )
        return entries
    }, [combinedMetricEntries])

    const dataSource = useMemo(() => {
        // const baseEval = evalById[baseRunId!]?.enrichedRun
        const rows: any[] = []

        // Testsets row
        if (type !== "online") {
            const testsetRow: any = {key: "testsets", title: "Testsets", values: {}}
            allRunIds.forEach((id) => {
                if (baseRunId !== id) return
                const enr = evalById[id]?.enrichedRun
                const tags = (enr?.testsets || []).map((t: any) => (
                    <TagWithLink key={t.id} name={t.name} href={`${projectURL}/testsets/${t.id}`} />
                ))
                testsetRow.values[id] = tags.length ? tags[0] : ""
            })
            rows.push(testsetRow)
        }

        // Evaluations row
        const evalsRow: any = {key: "evaluations", title: "Evaluations", values: {}}
        allRunIds.forEach((id) => {
            const state = evalById[id]
            const enr = state?.enrichedRun
            const colorIndex =
                state?.colorIndex || (state?.isBase ? 1 : undefined) || state?.compareIndex || 1
            const color = EVAL_TAG_COLOR?.[colorIndex]
            // evalsRow.values[id] = enr ? <EvalNameTag run={enr} color={color} /> : ""
            evalsRow.values[id] = enr ? (
                <div className="group flex items-center justify-between gap-2 w-full">
                    <EvalNameTag run={enr} color={color} />
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <RenameEvalButton
                            id={id}
                            name={enr?.name}
                            description={enr?.description}
                            runId={id}
                            type="text"
                            size="small"
                        />
                    </span>
                </div>
            ) : (
                ""
            )
        })
        rows.push(evalsRow)

        // date row
        const dateRow: any = {key: "date", title: "Created at", values: {}}
        allRunIds.forEach((id) => {
            const state = evalById[id]
            const enr = state?.enrichedRun
            dateRow.values[id] = enr?.createdAt
        })
        rows.push(dateRow)

        if (type === "online") {
            const samplingRow: any = {
                key: "sampling",
                title: "Sampling rate",
                values: {},
            }
            allRunIds.forEach((id) => {
                const state = evalById[id]
                samplingRow.values[id] = <RunSamplingRate state={state} />
            })
            rows.push(samplingRow)
        }

        // Variants row
        if (type !== "online") {
            const variantsRow: any = {key: "variants", title: "Variants", values: {}}
            allRunIds.forEach((id) => {
                const enr = evalById[id]?.enrichedRun
                const v = enr?.variants?.[0] as any
                if (!v) {
                    variantsRow.values[id] = <div className="not-available-table-cell">N/A</div>
                    return
                }
                const summary = getVariantDisplayMetadata(v)
                variantsRow.values[id] = (
                    <VariantTag
                        id={summary.revisionId}
                        variantName={summary.label}
                        revision={v?.revision}
                        disabled={!summary.canNavigate}
                        enrichedRun={enr}
                        variant={v}
                    />
                )
            })
            rows.push(variantsRow)
        }

        // Filters / Queries row
        if (type === "online") {
            const filtersRow: any = {key: "filters", title: "Filters / Queries", values: {}}
            allRunIds.forEach((id) => {
                const state = evalById[id]
                filtersRow.values[id] = <RunFiltersTags state={state} />
            })
            rows.push(filtersRow)
        }

        // Metric rows (generic + evaluator)
        const pushMetricRow = (key: string, labelNode: any) => {
            const row: any = {key, title: labelNode, values: {}}
            allRunIds.forEach((id) => {
                const metric = getMetricValueWithAliases(metricsLookup[id] || {}, key) as
                    | BasicStats
                    | any
                let value: any

                if (metric && (metric as any)?.mean !== undefined) {
                    const meanValue = (metric as any).mean
                    value =
                        key === DURATION_METRIC_KEY
                            ? formatLatency(meanValue)
                            : formatMetricValue(key, meanValue)
                } else if (
                    metric &&
                    Array.isArray((metric as any)?.unique) &&
                    typeof (metric as any)?.unique?.[0] === "boolean"
                ) {
                    value = getFrequencyData(metric)
                }

                row.values[id] =
                    value === undefined || value === null || value === "" ? (
                        <div className="not-available-table-cell" />
                    ) : (
                        value
                    )
            })
            rows.push(row)
        }

        INVOCATION_METRIC_COLUMNS.forEach(({key: canonicalKey, label}) => {
            const baseMetric = getMetricValueWithAliases(
                metricsLookup[baseRunId!] || {},
                canonicalKey,
            ) as any
            const hasMean = baseMetric && (baseMetric as any)?.mean !== undefined
            const titleNode = (
                <div className="flex items-center gap-2">
                    {label}
                    {/* {hasMean && <span className="text-[#586673]">(mean)</span>} */}
                </div>
            )
            pushMetricRow(canonicalKey, titleNode)
        })

        // Evaluator metrics grouped by evaluator slug
        sortedEvaluatorMetricEntries.forEach(({evaluatorSlug: slug, metricKey, fullKey}) => {
            const evaluator = evaluatorsBySlug[slug]
            const baseMetric = getMetricValueWithAliases(
                metricsLookup[baseRunId!] || {},
                fullKey,
            ) as any
            const metricPath = metricKey || fullKey
            const labelSegment = metricPath.split(".").pop() || metricPath
            const displayMetricName = formatColumnTitle(labelSegment)
            const titleNode = (
                <div className="flex flex-col gap-0.5">
                    <span className="text-[#586673]">
                        {evaluator?.name ?? formatColumnTitle(slug)}
                    </span>
                    <div className="flex items-center gap-2">
                        {displayMetricName}
                        {baseMetric && (baseMetric as any)?.mean !== undefined && (
                            <span className="text-[#586673]">(mean)</span>
                        )}
                    </div>
                </div>
            )
            pushMetricRow(fullKey, titleNode)
        })

        return rows
    }, [
        allRunIds,
        baseRunId,
        evalById,
        evaluatorsBySlug,
        getFrequencyData,
        metricsLookup,
        projectURL,
        sortedEvaluatorMetricEntries,
        type,
    ])

    return (
        <div className={clsx("border border-solid border-[#EAEFF5] rounded h-full", className)}>
            <div className="py-2 px-3 flex flex-col justify-center h-[60px] border-0 border-b border-solid border-[#EAEFF5]">
                <Typography.Text className="font-medium">Evaluator Scores Overview</Typography.Text>
                <Typography.Text className="text-[#758391]">
                    Average evaluator score across evaluations
                </Typography.Text>
            </div>

            <div
                className={clsx([
                    "p-2 w-full flex gap-2 shrink-0",
                    {"flex-col": isComparison},
                    {"h-[calc(100%-60px)]": !isComparison},
                ])}
            >
                <div
                    className={clsx([
                        "overflow-y-auto",
                        {"w-[50%]": !isComparison},
                        {"w-full": chartMetrics.length < 3},
                    ])}
                >
                    <Table
                        dataSource={dataSource}
                        columns={useMemo(() => {
                            // First column is the label/title
                            const cols: any[] = [
                                {
                                    title: "Metric",
                                    dataIndex: "title",
                                    key: "title",
                                    minWidth: 120,
                                    fixed: "left",
                                },
                            ]

                            // One value column per run (base + comparisons)
                            allRunIds.forEach((id, idx) => {
                                const state = evalById[id]
                                const compareIdx = state?.compareIndex || idx + 1
                                const colorIdx =
                                    state?.colorIndex ||
                                    (state?.isBase ? 1 : undefined) ||
                                    compareIdx
                                cols.push({
                                    title: idx === 0 ? "Label" : `Label_${idx + 1}`,
                                    key: `label_${id}`,
                                    render: (_: any, record: any) => {
                                        // Merge "Testsets" row across all run columns
                                        if (record?.key === "testsets") {
                                            if (id === allRunIds[0]) {
                                                return {
                                                    children:
                                                        record?.values?.[baseRunId] ??
                                                        record?.values?.[id] ??
                                                        "",
                                                    props: {colSpan: allRunIds.length},
                                                }
                                            }
                                            return {children: null, props: {colSpan: 0}}
                                        }
                                        const value = record?.values?.[id]
                                        if (!value) return "-"
                                        if (record?.key !== "evaluations") return value

                                        const runState = evalById[id]
                                        const enriched = runState?.enrichedRun
                                        const firstVariant: any = enriched?.variants?.[0]
                                        const summary = getVariantDisplayMetadata(firstVariant)

                                        if (isValidElement(value)) {
                                            return cloneElement(value as any, {
                                                allowVariantNavigation: summary.canNavigate,
                                                variantName: summary.label,
                                                id: summary.revisionId || undefined,
                                            })
                                        }

                                        return summary.label
                                    },
                                    minWidth: 120,
                                    onCell: (record: any) => ({
                                        style:
                                            isComparison && record?.key !== "testsets"
                                                ? {background: (EVAL_BG_COLOR as any)[colorIdx]}
                                                : undefined,
                                    }),
                                })
                            })

                            return cols
                        }, [allRunIds, baseRunId, isComparison, evalById])}
                        pagination={false}
                        showHeader={false}
                        bordered
                        scroll={{x: "max-content"}}
                        rowKey={(r) => r.key}
                    />
                </div>
                {shouldShowSpiderPlaceholder ? (
                    <div
                        className={clsx(
                            "relative overflow-hidden rounded border border-dashed border-[#CBD5E1] bg-[#EEF2FF]/70",
                            spiderChartClassName,
                        )}
                    >
                        <SpiderChartPlaceholder className="pointer-events-none absolute inset-5 opacity-80" />
                        <PlaceholderOverlay
                            evaluationType={type === "online" ? "online" : "auto"}
                        />
                    </div>
                ) : chartMetrics.length < 3 ? null : (
                    <EvaluatorMetricsSpiderChart
                        className={clsx([
                            "min-h-[400px] h-[400px]",
                            {"w-[50%] !h-full": !isComparison},
                        ])}
                        metrics={chartMetrics}
                        series={chartSeries}
                    />
                )}
            </div>
        </div>
    )
}

export default memo(EvalRunScoreTable)

const queryRevisionCache = new Map<string, any>()

function useRunQueryRevision(state: any) {
    const runIndex = state?.runIndex
    const enriched = state?.enrichedRun
    const queryId: string | undefined = useMemo(() => {
        // runIndex path
        const stepsMeta = (runIndex?.steps || {}) as Record<string, any>
        for (const meta of Object.values(stepsMeta)) {
            const refs = (meta as any)?.refs || {}
            const q = refs?.query || {}
            const id = q?.id || refs?.queryId
            if (typeof id === "string" && id.trim()) return id
        }
        // raw data path (like OnlineEvaluation table records)
        const steps = (enriched as any)?.data?.steps
        const inputStep = Array.isArray(steps)
            ? steps.find((s: any) => s?.type === "input")
            : undefined
        const qRefs = inputStep?.references || {}
        const rid = qRefs?.query?.id || qRefs?.queryId
        return typeof rid === "string" && rid.trim() ? rid : undefined
    }, [runIndex?.steps, enriched])

    const [revision, setRevision] = useState<any>(() => {
        if (!queryId) return undefined
        return queryRevisionCache.get(queryId)
    })
    useEffect(() => {
        let mounted = true
        ;(async () => {
            try {
                if (!queryId) {
                    if (mounted) setRevision(undefined)
                    return
                }
                if (queryRevisionCache.has(queryId)) {
                    if (mounted) setRevision(queryRevisionCache.get(queryId))
                    return
                }
                const res = await retrieveQueryRevision({query_ref: {id: queryId}})
                const rev = res?.query_revision || null
                queryRevisionCache.set(queryId, rev)
                if (mounted) setRevision(rev)
            } catch {
                if (mounted) setRevision(null)
            }
        })()
        return () => {
            mounted = false
        }
    }, [queryId])

    const {filtering, windowing} = (revision?.data ?? {}) as {
        filtering?: QueryFilteringPayload
        windowing?: {rate?: number; limit?: number; newest?: string; oldest?: string}
    }

    return {filtering, windowing}
}

function RunFiltersTags({state}: {state: any}) {
    const {filtering, windowing} = useRunQueryRevision(state)

    const historicalRangeLabel = useMemo(() => {
        const oldest = windowing?.oldest
        const newest = windowing?.newest
        if (!oldest || !newest) return undefined
        const oldestDate = dayjs(oldest)
        const newestDate = dayjs(newest)
        if (!oldestDate.isValid() || !newestDate.isValid()) return undefined
        const diffDays = Math.max(newestDate.diff(oldestDate, "day"), 0)
        if (diffDays > 0 && diffDays <= 31) {
            return `Historical: Last ${diffDays} day${diffDays === 1 ? "" : "s"}`
        }
        return `Historical: ${oldestDate.format("DD MMM YYYY")} – ${newestDate.format(
            "DD MMM YYYY",
        )}`
    }, [windowing?.newest, windowing?.oldest])

    const hasMeta = Boolean(windowing?.oldest && windowing?.newest && historicalRangeLabel)

    return (
        <div className="flex flex-col gap-2">
            <FiltersPreview filtering={filtering} compact />
            {hasMeta ? (
                <div className="flex flex-wrap gap-3 text-[11px] text-[#667085]">
                    <span className="whitespace-nowrap">{historicalRangeLabel}</span>
                </div>
            ) : null}
        </div>
    )
}

function RunSamplingRate({state}: {state: any}) {
    const {windowing} = useRunQueryRevision(state)
    const ratePercent = useMemo(() => {
        const r = typeof windowing?.rate === "number" ? windowing?.rate : undefined
        if (r === undefined || Number.isNaN(r)) return undefined
        const clamped = Math.max(0, Math.min(1, r))
        return Math.round(clamped * 100)
    }, [windowing?.rate])

    if (ratePercent === undefined) {
        return <div className="not-available-table-cell">—</div>
    }
    return <span>{ratePercent}%</span>
}
