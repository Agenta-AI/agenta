import {useMemo} from "react"

import {atom, useAtomValue} from "jotai"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {
    previewRunMetricStatsLoadableFamily,
    previewRunMetricStatsSelectorFamily,
    runTemporalMetricKeysAtomFamily,
    runTemporalMetricSeriesAtomFamily,
    TemporalMetricPoint,
} from "@/oss/components/EvalRunDetails2/atoms/runMetrics"
import {evaluationEvaluatorsByRunQueryAtomFamily} from "@/oss/components/EvalRunDetails2/atoms/table/evaluators"
import {evaluationRunIndexAtomFamily} from "@/oss/components/EvalRunDetails2/atoms/table/run"
import type {BasicStats} from "@/oss/lib/metricUtils"

import {runDisplayNameAtomFamily, runStatusAtomFamily} from "../../../../atoms/runDerived"
import {INVOCATION_METRIC_KEYS, INVOCATION_METRIC_LABELS} from "../constants"
import type {AggregatedMetricChartData} from "../types"
import {
    buildEvaluatorFallbackMetricsByStep,
    buildEvaluatorMetricEntries,
} from "../utils/evaluatorMetrics"
import {humanizeEvaluatorName, humanizeMetricPath, resolveMetricValue} from "../utils/metrics"

const emptyEvaluatorsAtom = atom({data: [], isPending: false, isFetching: false} as const)
const emptyLoadableAtom = atom({state: "loading"} as const)
const emptyRunIndexAtom = atom(null as ReturnType<typeof evaluationRunIndexAtomFamily> | null)
const falseAtom = atom(false)
const emptyTemporalSeriesAtom = atom<Record<string, TemporalMetricPoint[]>>({})

export interface RunDescriptor {
    runId: string
    displayName: string
    status: string | null
}

export interface EvaluatorRef {
    id?: string | null
    slug?: string | null
}

export interface RunMetricSelectionEntry {
    metric: {
        id: string
        evaluatorLabel: string
        evaluatorRef?: EvaluatorRef | null
        fallbackEvaluatorLabel: string
        stepKey: string
        canonicalKey: string
        rawKey: string
        fullKey: string
        displayLabel: string
    }
    selections: {
        runId: string
        index: number
        runKey: string
        selection: ReturnType<typeof previewRunMetricStatsSelectorFamily>
    }[]
}

export interface RunMetricData {
    baseRunId: string | null
    runDescriptors: RunDescriptor[]
    metricSelections: RunMetricSelectionEntry[]
    runColorMap: Map<string, string>
    isLoading: boolean
    hasResolvedMetrics: boolean
    hasTemporalMetrics: boolean
    temporalSeriesByMetric: Record<string, TemporalMetricPoint[]>
}

const DEFAULT_COLORS = ["#3B82F6", "#2563EB", "#DC2626", "#7C3AED", "#16A34A"]

export const useRunMetricData = (runIds: string[]): RunMetricData => {
    const orderedRunIds = useMemo(() => runIds.filter((id): id is string => Boolean(id)), [runIds])
    const baseRunId = orderedRunIds[0] ?? null

    const runDescriptorsAtom = useMemo(
        () =>
            atom((get) =>
                orderedRunIds.map((runId) => ({
                    runId,
                    displayName: get(runDisplayNameAtomFamily(runId)),
                    status: get(runStatusAtomFamily(runId)),
                })),
            ),
        [orderedRunIds],
    )
    const runDescriptors = useAtomValue(runDescriptorsAtom)

    const hasTemporalMetrics = useAtomValue(
        useMemo(
            () => (baseRunId ? runTemporalMetricKeysAtomFamily(baseRunId) : falseAtom),
            [baseRunId],
        ),
    )

    const temporalSeriesAtom = useMemo(
        () => (baseRunId ? runTemporalMetricSeriesAtomFamily(baseRunId) : emptyTemporalSeriesAtom),
        [baseRunId],
    )
    const temporalSeriesRaw = useAtomValue(temporalSeriesAtom)

    const temporalSeriesByMetric = useMemo(() => temporalSeriesRaw ?? {}, [temporalSeriesRaw])

    const runColorMap = useMemo(() => {
        const map = new Map<string, string>()
        orderedRunIds.forEach((runId, index) => {
            map.set(runId, DEFAULT_COLORS[index % DEFAULT_COLORS.length] ?? DEFAULT_COLORS[0])
        })
        return map
    }, [orderedRunIds])

    const evaluatorQueryAtom = useMemo(
        () =>
            baseRunId ? evaluationEvaluatorsByRunQueryAtomFamily(baseRunId) : emptyEvaluatorsAtom,
        [baseRunId],
    )
    const evaluatorDefinitions = useAtomValue(evaluatorQueryAtom)?.data ?? []

    const runIndex = useAtomValue(
        useMemo(
            () => (baseRunId ? evaluationRunIndexAtomFamily(baseRunId) : emptyRunIndexAtom),
            [baseRunId],
        ),
    )

    const metricsAtom = useMemo(
        () =>
            baseRunId ? previewRunMetricStatsLoadableFamily({runId: baseRunId}) : emptyLoadableAtom,
        [baseRunId],
    )
    const metricsLoadable = useAtomValueWithSchedule(metricsAtom, {priority: LOW_PRIORITY})

    const baseStatsMap = useMemo(() => {
        if (metricsLoadable.state !== "hasData") return {}

        const rawData = metricsLoadable.data as
            | Record<string, BasicStats>
            | {data?: Record<string, BasicStats>}
            | undefined
        if (!rawData) return {}
        if ("data" in rawData && rawData.data && typeof rawData.data === "object") {
            return rawData.data as Record<string, BasicStats>
        }
        return rawData as Record<string, BasicStats>
    }, [metricsLoadable])

    const evaluatorSteps = useMemo(() => {
        if (!runIndex) return []
        return Array.from(runIndex.annotationKeys ?? []).map((stepKey) => {
            const meta = runIndex.steps?.[stepKey]
            const evaluatorRefMeta = meta?.refs?.evaluator ?? {}
            const refSlug =
                (typeof evaluatorRefMeta?.slug === "string" && evaluatorRefMeta.slug.length
                    ? evaluatorRefMeta.slug
                    : undefined) ??
                (typeof evaluatorRefMeta?.id === "string" && evaluatorRefMeta.id.length
                    ? evaluatorRefMeta.id
                    : undefined) ??
                (typeof evaluatorRefMeta?.name === "string" && evaluatorRefMeta.name.length
                    ? evaluatorRefMeta.name
                    : undefined) ??
                undefined
            const evaluator =
                evaluatorDefinitions.find(
                    (def) => def.slug === refSlug || def.id === refSlug || def.name === refSlug,
                ) ?? null
            const label = evaluator?.name || evaluator?.slug || refSlug || stepKey
            const evaluatorRef: EvaluatorRef | null =
                evaluator || evaluatorRefMeta
                    ? {
                          id:
                              evaluator?.id ??
                              (typeof evaluatorRefMeta?.id === "string"
                                  ? evaluatorRefMeta.id
                                  : null),
                          slug:
                              evaluator?.slug ??
                              (typeof evaluatorRefMeta?.slug === "string"
                                  ? evaluatorRefMeta.slug
                                  : null),
                      }
                    : null
            return {stepKey, label, evaluatorRef}
        })
    }, [evaluatorDefinitions, runIndex])

    const fallbackMetricMap = useMemo(
        () => buildEvaluatorFallbackMetricsByStep(runIndex ?? null, evaluatorDefinitions),
        [evaluatorDefinitions, runIndex],
    )

    const evaluatorMetricEntries = useMemo(
        () => buildEvaluatorMetricEntries(baseStatsMap, evaluatorSteps, fallbackMetricMap),
        [baseStatsMap, evaluatorSteps, fallbackMetricMap],
    )

    const metricCatalog = useMemo(() => {
        const evaluatorMetrics = evaluatorMetricEntries.flatMap((entry) =>
            entry.metrics.map((metric) => {
                const metricKey = metric.canonicalKey || metric.rawKey
                const displayLabel =
                    humanizeMetricPath(metric.canonicalKey) ||
                    humanizeMetricPath(metric.rawKey) ||
                    metric.rawKey.replace(/[_\.]/g, " ")
                return {
                    id: `${entry.stepKey}:${metricKey}`,
                    evaluatorLabel: humanizeEvaluatorName(entry.label),
                    evaluatorRef: entry.evaluatorRef ?? null,
                    fallbackEvaluatorLabel: humanizeEvaluatorName(entry.label),
                    stepKey: entry.stepKey,
                    canonicalKey: metric.canonicalKey,
                    rawKey: metric.rawKey,
                    fullKey: metric.fullKey,
                    displayLabel,
                }
            }),
        )

        const invocationMetrics = INVOCATION_METRIC_KEYS.map((key) => ({
            id: `invocation:${key}`,
            evaluatorLabel: "Invocation",
            evaluatorRef: null,
            fallbackEvaluatorLabel: "Invocation",
            stepKey: "",
            canonicalKey: key,
            rawKey: key,
            fullKey: key,
            displayLabel: INVOCATION_METRIC_LABELS[key] ?? key,
        }))

        return [...evaluatorMetrics, ...invocationMetrics]
    }, [evaluatorMetricEntries])

    const metricCatalogSignature = useMemo(
        () => metricCatalog.map((metric) => metric.id).join("|"),
        [metricCatalog],
    )

    const metricSelectionsAtom = useMemo(
        () =>
            atom((get) =>
                metricCatalog.map((metric) => ({
                    metric,
                    selections: orderedRunIds.map((runId, index) => ({
                        runId,
                        index,
                        runKey: index === 0 ? "run_base" : `run_${index}`,
                        selection: get(
                            previewRunMetricStatsSelectorFamily({
                                runId,
                                stepKey: metric.stepKey,
                                metricPath: metric.fullKey,
                                metricKey: metric.rawKey,
                            }),
                        ),
                    })),
                })),
            ),
        [metricCatalogSignature, orderedRunIds],
    )
    const metricSelections = useAtomValueWithSchedule(metricSelectionsAtom, {
        priority: LOW_PRIORITY,
    })

    const selectorLoading = metricSelections.some(({selections}) =>
        selections.some(({selection}) => selection.state === "loading"),
    )
    const hasResolvedMetrics = metricSelections.some(({selections}) =>
        selections.some(({selection}) => selection.state === "hasData" && Boolean(selection.stats)),
    )

    const isLoading = metricsLoadable.state === "loading" || selectorLoading

    return {
        baseRunId,
        runDescriptors,
        metricSelections,
        runColorMap,
        isLoading,
        hasResolvedMetrics,
        hasTemporalMetrics,
        temporalSeriesByMetric,
    }
}
