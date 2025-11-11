import {memo, useMemo} from "react"

import deepEqual from "fast-deep-equal"
import {atom, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"

import {useRunId} from "@/oss/contexts/RunIdContext"
import {
    evaluationEvaluatorsFamily,
    evaluationRunStateFamily,
    loadingStateAtom,
    loadingStateFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {runMetricStatsFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/runScopedMetrics"
import {canonicalizeMetricKey, getMetricValueWithAliases} from "@/oss/lib/metricUtils"

import {EVAL_COLOR, formatMetricName} from "../../AutoEvalRun/assets/utils"
import EvalRunScoreTable from "../../AutoEvalRun/components/EvalRunScoreTable"
import EvaluatorMetricsChart from "../../AutoEvalRun/components/EvaluatorMetricsChart"
import {urlStateAtom} from "../../state/urlState"

import clsx from "clsx"
import {evalTypeAtom} from "../../state/evalType"
import EvalRunOverviewViewerSkeleton from "./assets/EvalRunOverviewViewerSkeleton"

// Only evaluator metrics (slug-prefixed) should render in overview charts; skip invocation metrics.
const INVOCATION_METRIC_PREFIX = "attributes.ag."

// Lightweight readers (mirrors what ScoreTable does) to fetch multiple runs' state/metrics
const runsStateFamily = atomFamily(
    (runIds: string[]) => atom((get) => runIds.map((id) => get(evaluationRunStateFamily(id)))),
    deepEqual,
)
const runsMetricsFamily = atomFamily(
    (runIds: string[]) =>
        atom((get) => runIds.map((id) => ({id, metrics: get(runMetricStatsFamily({runId: id}))}))),
    deepEqual,
)

const EvalRunOverviewViewer = () => {
    const runId = useRunId()
    const urlState = useAtomValue(urlStateAtom)
    const evalType = useAtomValue(evalTypeAtom)
    const compareRunIds = urlState.compare
    const isCompare = !!compareRunIds?.length

    const metrics = useAtomValue(runMetricStatsFamily({runId}))
    const evaluators = useAtomValue(evaluationEvaluatorsFamily(runId))
    const loadingState = useAtomValue(loadingStateAtom)
    const loadingStateFamilyData = useAtomValue(loadingStateFamily(runId))
    const allRunIds = useMemo(
        () => [runId!, ...(compareRunIds || []).filter((id) => id && id !== runId)],
        [runId, compareRunIds],
    )
    const runs = useAtomValue(runsStateFamily(allRunIds))
    const metricsByRun = useAtomValue(runsMetricsFamily(allRunIds))

    const evaluatorsBySlug = useMemo(() => {
        const map: Record<string, any> = {}
        runs.forEach((r) => {
            r?.enrichedRun?.evaluators?.forEach((ev: any) => {
                if (ev?.slug && !map[ev.slug]) {
                    map[ev.slug] = ev
                }
            })
        })
        evaluators?.forEach((ev) => {
            if (ev?.slug && !map[ev.slug]) {
                map[ev.slug] = ev
            }
        })
        return map
    }, [runs, evaluators])

    const combinedMetricEntries = useMemo(() => {
        const entries: {
            fullKey: string
            evaluatorSlug: string
            metricKey: string
            metric: Record<string, any>
        }[] = []
        const seen = new Set<string>()

        const pushEntry = (rawKey: string, source: Record<string, any>) => {
            const canonical = canonicalizeMetricKey(rawKey)
            if (canonical.startsWith(INVOCATION_METRIC_PREFIX)) return
            if (!canonical.includes(".")) return
            if (seen.has(canonical)) return

            const metric =
                (getMetricValueWithAliases(source, canonical) as Record<string, any>) ||
                (source?.[rawKey] as Record<string, any>)
            if (!metric) return

            const [slug, ...rest] = canonical.split(".")
            const metricKey = rest.join(".") || slug

            entries.push({fullKey: canonical, evaluatorSlug: slug, metricKey, metric})
            seen.add(canonical)
        }

        const baseMetrics = (metrics || {}) as Record<string, any>
        Object.keys(baseMetrics).forEach((fullKey) => {
            pushEntry(fullKey, baseMetrics)
        })

        metricsByRun.forEach(({metrics: runMetrics}) => {
            const scoped = (runMetrics || {}) as Record<string, any>
            Object.keys(scoped).forEach((fullKey) => {
                pushEntry(fullKey, scoped)
            })
        })

        return entries
    }, [metrics, metricsByRun, evaluatorsBySlug])

    const evalById = useMemo(() => {
        const map: Record<string, any> = {}
        runs.forEach((r) => (map[r.enrichedRun?.id || r.id] = r))
        return map
    }, [runs])

    const metricsLookup = useMemo(() => {
        const map: Record<string, Record<string, any>> = {}
        metricsByRun.forEach(({id, metrics}) => {
            const source = (metrics || {}) as Record<string, any>
            const normalized: Record<string, any> = {...source}
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

    if (loadingState.isLoadingMetrics || loadingStateFamilyData.isLoadingMetrics) {
        return <EvalRunOverviewViewerSkeleton className={clsx({"px-6": evalType === "auto"})} />
    }
    return (
        <>
            <div className={clsx({"px-6": evalType === "auto"})}>
                <EvalRunScoreTable />
            </div>

            <div className={clsx("w-full flex flex-wrap gap-2", {"px-6": evalType === "auto"})}>
                {combinedMetricEntries.map(({fullKey, metric, evaluatorSlug, metricKey}, idx) => {
                    if (!metric || !Object.keys(metric || {}).length) return null

                    // Build comparison rows for this evaluator metric
                    const rowsWithMeta = isCompare
                        ? allRunIds.map((id, i) => {
                              const state = evalById[id]
                              const compareIdx = state?.compareIndex || i + 1
                              const stats = metricsLookup[id] || {}
                              const m: any = getMetricValueWithAliases(stats, fullKey)
                              const hasMetric = !!m
                              let y = 0
                              if (hasMetric) {
                                  if (Array.isArray(m?.unique)) {
                                      const trueEntry = (m?.frequency || m?.rank || [])?.find(
                                          (f: any) => f?.value === true,
                                      )
                                      const total = m?.count ?? 0
                                      y = total ? ((trueEntry?.count ?? 0) / total) * 100 : 0
                                  } else if (typeof m?.mean === "number") {
                                      y = m.mean
                                  }
                              }
                              return {
                                  id,
                                  x: state?.enrichedRun?.name || `Eval ${compareIdx}`,
                                  y,
                                  hasMetric,
                                  color: (EVAL_COLOR as any)[compareIdx] || "#3B82F6",
                              }
                          })
                        : undefined

                    const averageRows = rowsWithMeta
                        ?.filter((r) => r.hasMetric)
                        .map(({x, y, color}) => ({x, y, color}))
                    const summaryRows = rowsWithMeta?.map(({x, y, color}) => ({
                        x,
                        y,
                        color,
                    }))

                    return (
                        <EvaluatorMetricsChart
                            key={`${metricKey}-${idx}`}
                            className="w-[calc(50%-0.3rem)] 2xl:w-[calc(33.33%-0.34rem)]"
                            name={formatMetricName(metricKey)}
                            metricKey={metricKey}
                            metric={metric}
                            evaluator={evaluatorsBySlug[evaluatorSlug]}
                            isCompare={isCompare}
                            averageRows={averageRows}
                            summaryRows={summaryRows}
                        />
                    )
                })}
            </div>
        </>
    )
}

export default memo(EvalRunOverviewViewer)
