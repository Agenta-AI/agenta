import {isValidElement, cloneElement, memo, useCallback, useMemo} from "react"

import {Table, Typography} from "antd"
import clsx from "clsx"
import deepEqual from "fast-deep-equal"
import {atom, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import dynamic from "next/dynamic"

import {formatColumnTitle} from "@/oss/components/Filters/EditColumns/assets/helper"
import {formatMetricValue} from "@/oss/components/HumanEvaluations/assets/MetricDetailsPopover/assets/utils"
import {useRunId} from "@/oss/contexts/RunIdContext"
import useURL from "@/oss/hooks/useURL"
import {formatLatency} from "@/oss/lib/helpers/formatters"
import {evaluationRunStateFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {runMetricStatsFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/runScopedMetrics"
import {
    BasicStats,
    canonicalizeMetricKey,
    getMetricDisplayName,
    getMetricValueWithAliases,
} from "@/oss/lib/metricUtils"

import RenameEvalButton from "../../../HumanEvalRun/components/Modals/RenameEvalModal/assets/RenameEvalButton"
import {urlStateAtom} from "../../../state/urlState"
import EvalNameTag from "../../assets/EvalNameTag"
import TagWithLink from "../../assets/TagWithLink"
import {EVAL_TAG_COLOR, EVAL_COLOR, EVAL_BG_COLOR} from "../../assets/utils"
import {formatMetricName} from "../../assets/utils"
import VariantTag from "../../assets/VariantTag"
import {getVariantDisplayMetadata} from "../../assets/variantUtils"
import type {EvaluatorMetricsSpiderChartProps} from "../EvaluatorMetircsSpiderChart/types"

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
    {key: TOKEN_METRIC_KEY, label: "Total tokens"},
    {key: ERRORS_METRIC_KEY, label: "Errors"},
]

const EvalRunScoreTable = ({className}: {className?: string}) => {
    const baseRunId = useRunId()
    const {projectURL} = useURL()
    const urlState = useAtomValue(urlStateAtom)
    const compareRunIds = (urlState?.compare || []).filter((id) => id && id !== baseRunId)
    const allRunIds = useMemo(() => [baseRunId!, ...compareRunIds], [baseRunId, compareRunIds])

    const isComparison = compareRunIds.length > 0

    // Fetch all runs and their metrics
    const runs = useAtomValue(runsStateFamily(allRunIds))
    const metricsByRun = useAtomValue(runsMetricsFamily(allRunIds))

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
            const normalized: Record<string, BasicStats> = {...(source as any)}
            Object.keys(source || {}).forEach((rawKey) => {
                const canonical = canonicalizeMetricKey(rawKey)
                if (canonical !== rawKey && normalized[canonical] === undefined) {
                    normalized[canonical] = source[rawKey]
                }
            })
            map[id] = normalized
        })
        return map
    }, [metricsByRun])

    const getFrequencyData = useCallback((metric: any, returnPercentage = true) => {
        const trueEntry = (metric as any)?.frequency?.find((f: any) => f?.value === true)
        const total = (metric as any)?.count ?? 0
        return returnPercentage
            ? `${(((trueEntry?.count ?? 0) / total) * 100).toFixed(2)}%`
            : ((trueEntry?.count ?? 0) / total) * 100
    }, [])

    const chartMetrics = useMemo(() => {
        // Build union of evaluator metrics across all runs, then add invocation metrics per rules.
        interface Axis {
            name: string
            maxScore: number
            type: "binary" | "numeric"
            value?: number
            [k: string]: any
            _key: string
        }

        const axesByKey: Record<string, Axis> = {}

        // 1) Union evaluator metrics from all runs
        allRunIds.forEach((runId, runIdx) => {
            const stats = metricsLookup[runId] || {}
            const evaluators = evalById[runId]?.enrichedRun?.evaluators
            const processed = new Set<string>()

            Object.keys(stats).forEach((rawKey) => {
                const canonicalKey = canonicalizeMetricKey(rawKey)
                if (processed.has(canonicalKey)) return
                processed.add(canonicalKey)

                if (INVOCATION_METRIC_SET.has(canonicalKey)) return
                if (!canonicalKey.includes(".")) return

                const metric = getMetricValueWithAliases(stats, canonicalKey)
                if (!metric) return

                const [evalSlug, ...metricParts] = canonicalKey.split(".")
                const metricRemainder = metricParts.join(".")
                const evaluator = evaluators?.find((e: any) => e.slug === evalSlug)
                if (!evaluator) return

                const axisKey = canonicalKey
                const isBinary = Array.isArray((metric as any)?.frequency)
                const displayMetricName = metricRemainder
                    ? formatMetricName(metricRemainder)
                    : formatMetricName(canonicalKey)

                if (!axesByKey[axisKey]) {
                    axesByKey[axisKey] = {
                        name: `${evaluator?.name ?? evalSlug} - ${displayMetricName}`,
                        maxScore: isBinary ? 100 : (metric as any)?.max || 100,
                        type: isBinary ? "binary" : "numeric",
                        _key: axisKey,
                    }
                } else if (!isBinary) {
                    const mx = (metric as any)?.max
                    if (typeof mx === "number") {
                        axesByKey[axisKey].maxScore = Math.max(axesByKey[axisKey].maxScore, mx)
                    }
                }

                const seriesKey = runIdx === 0 ? "value" : `value-${runIdx + 1}`
                const v = isBinary ? getFrequencyData(metric, false) : ((metric as any)?.mean ?? 0)
                axesByKey[axisKey][seriesKey] = v
            })
        })

        let axes: Axis[] = Object.values(axesByKey)

        // 2) Invocation metrics only when evaluator metrics are fewer than 3 (based on union)
        const evaluatorCount = axes.length
        const addInvocationAxis = (metricKey: string, label?: string) => {
            const axis: Axis = {
                name: label ?? getMetricDisplayName(metricKey),
                maxScore: 0,
                type: "numeric",
                _key: metricKey,
            }
            allRunIds.forEach((runId, runIdx) => {
                const stats = metricsLookup[runId] || {}
                const metric = getMetricValueWithAliases(stats, metricKey) as BasicStats | any
                const seriesKey = runIdx === 0 ? "value" : `value-${runIdx + 1}`
                axis[seriesKey] = metric?.mean ?? 0
                const mx = metric?.max
                if (typeof mx === "number") axis.maxScore = Math.max(axis.maxScore, mx)
            })
            axes.push(axis)
        }

        if (evaluatorCount < 3) {
            if (evaluatorCount === 2) {
                addInvocationAxis(COST_METRIC_KEY, "Invocation costs")
            } else if (evaluatorCount <= 1) {
                addInvocationAxis(DURATION_METRIC_KEY, "Invocation duration")
                addInvocationAxis(COST_METRIC_KEY, "Invocation costs")
            }
        }

        // 3) Ensure all series keys exist for each axis
        if (axes.length > 0) {
            allRunIds.forEach((_, runIdx) => {
                const seriesKey = runIdx === 0 ? "value" : `value-${runIdx + 1}`
                axes.forEach((a) => {
                    if (a[seriesKey] === undefined) a[seriesKey] = 0
                })
            })
        }

        return axes.map(({_key, ...rest}) => rest)
    }, [allRunIds, evalById, metricsLookup, getFrequencyData])

    const dataSource = useMemo(() => {
        // Build union of all metric keys across runs
        const metricKeys = new Set<string>()
        allRunIds.forEach((id) => {
            const m = metricsLookup[id] || {}
            Object.keys(m).forEach((k) => metricKeys.add(canonicalizeMetricKey(k)))
        })

        // const baseEval = evalById[baseRunId!]?.enrichedRun
        const rows: any[] = []

        // Test Sets row
        const testsetRow: any = {key: "testsets", title: "Test Sets", values: {}}
        allRunIds.forEach((id) => {
            if (baseRunId !== id) return
            const enr = evalById[id]?.enrichedRun
            const tags = (enr?.testsets || []).map((t: any) => (
                <TagWithLink key={t.id} name={t.name} href={`${projectURL}/testsets/${t.id}`} />
            ))
            testsetRow.values[id] = tags.length ? tags[0] : ""
        })
        rows.push(testsetRow)

        // Evaluations row
        const evalsRow: any = {key: "evaluations", title: "Evaluations", values: {}}
        allRunIds.forEach((id) => {
            const state = evalById[id]
            const enr = state?.enrichedRun
            const color = EVAL_TAG_COLOR?.[state?.compareIndex || 1]
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

        // Variants row
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
                    {hasMean && <span className="text-[#586673]">(mean)</span>}
                </div>
            )
            pushMetricRow(canonicalKey, titleNode)
        })

        // Evaluator metrics grouped by evaluator slug
        const allEvaluatorEntries: {slug: string; metricKey: string; fullKey: string}[] = []
        Array.from(metricKeys)
            .filter((k) => !INVOCATION_METRIC_SET.has(k) && k.includes("."))
            .forEach((fullKey) => {
                const [slug, ...restParts] = fullKey.split(".")
                const metricKey = restParts.join(".") || slug
                allEvaluatorEntries.push({slug, metricKey, fullKey})
            })

        // Maintain stable order by slug then metricKey
        allEvaluatorEntries
            .sort((a, b) =>
                a.slug === b.slug
                    ? a.metricKey.localeCompare(b.metricKey)
                    : a.slug.localeCompare(b.slug),
            )
            .forEach(({slug, metricKey, fullKey}) => {
                const state = evalById[baseRunId!]
                const evaluator = state?.enrichedRun?.evaluators?.find((e: any) => e.slug === slug)
                const baseMetric = getMetricValueWithAliases(
                    metricsLookup[baseRunId!] || {},
                    fullKey,
                ) as any
                const [, ...restParts] = fullKey.split(".")
                const metricPath = restParts.length ? restParts.join(".") : metricKey
                const labelSegment = metricPath.split(".").pop() || metricPath
                const displayMetricName = formatColumnTitle(labelSegment)
                const titleNode = (
                    <div className="flex flex-col gap-0.5">
                        <span className="text-[#586673]">
                            {evaluator?.name ?? formatColumnTitle(slug)}
                        </span>
                        <div className="flex items-center gap-2">
                            {displayMetricName}
                            {/* Show (mean) if base has mean */}
                            {baseMetric && (baseMetric as any)?.mean !== undefined && (
                                <span className="text-[#586673]">(mean)</span>
                            )}
                        </div>
                    </div>
                )
                pushMetricRow(fullKey, titleNode)
            })

        return rows
    }, [allRunIds, baseRunId, evalById, getFrequencyData, metricsLookup, runs])
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
                                cols.push({
                                    title: idx === 0 ? "Label" : `Label_${idx + 1}`,
                                    key: `label_${id}`,
                                    render: (_: any, record: any) => {
                                        // Merge "Test Sets" row across all run columns
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
                                                ? {background: (EVAL_BG_COLOR as any)[compareIdx]}
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
                {chartMetrics.length < 3 ? null : (
                    <EvaluatorMetricsSpiderChart
                        className={clsx([
                            "min-h-[400px] h-[400px]",
                            {"w-[50%] !h-full": !isComparison},
                        ])}
                        metrics={chartMetrics}
                        series={useMemo(() => {
                            return allRunIds.map((id, idx) => {
                                const state = evalById[id]
                                const compareIdx = state?.compareIndex || idx + 1
                                return {
                                    key: idx === 0 ? "value" : `value-${idx + 1}`,
                                    color: (EVAL_COLOR as any)[compareIdx] || "#3B82F6",
                                    name: state?.enrichedRun?.name || `Eval ${compareIdx}`,
                                }
                            })
                        }, [allRunIds, evalById])}
                    />
                )}
            </div>
        </div>
    )
}

export default memo(EvalRunScoreTable)
