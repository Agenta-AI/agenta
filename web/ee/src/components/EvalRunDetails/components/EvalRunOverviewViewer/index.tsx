import {memo, useCallback, useMemo} from "react"

import clsx from "clsx"
import deepEqual from "fast-deep-equal"
import {atom, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {Area, CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis} from "recharts"

import {useRunId} from "@/oss/contexts/RunIdContext"
import {
    evaluationEvaluatorsFamily,
    evaluationRunStateFamily,
    loadingStateAtom,
    loadingStateFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {
    runMetricStatsFamily,
    runMetricsFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/runScopedMetrics"
import useEvaluators from "@/oss/lib/hooks/useEvaluators"
import {canonicalizeMetricKey, getMetricValueWithAliases} from "@/oss/lib/metricUtils"

import {formatMetricName} from "../../AutoEvalRun/assets/utils"
import {EVAL_COLOR} from "../../AutoEvalRun/assets/utils"
import EvalRunScoreTable from "../../AutoEvalRun/components/EvalRunScoreTable"
import EvaluatorMetricsChart from "../../AutoEvalRun/components/EvaluatorMetricsChart"
import EvaluatorMetricsTimeSeriesChart, {
    PLACEHOLDER_LINE_COLOR,
    PLACEHOLDER_TIME_SERIES,
} from "../../AutoEvalRun/components/EvaluatorMetricsChart/TimeSeriesChart"
import PlaceholderOverlay, {
    PlaceholderEvaluationType,
} from "../../AutoEvalRun/components/shared/PlaceholderOverlay"
import SpiderChartPlaceholder from "../../AutoEvalRun/components/shared/SpiderChartPlaceholder"
import {evalTypeAtom} from "../../state/evalType"
import {urlStateAtom} from "../../state/urlState"
import {
    collectEvaluatorIdentifiers,
    collectMetricSchemasFromEvaluator,
    deriveSchemaMetricType,
    mergeEvaluatorRecords,
    pickString,
    toArray,
} from "../VirtualizedScenarioTable/assets/evaluatorSchemaUtils"

import EvalRunOverviewViewerSkeleton from "./assets/EvalRunOverviewViewerSkeleton"

const PlaceholderTimeSeriesBackdrop = () => (
    <ResponsiveContainer width="100%" height="100%">
        <LineChart
            data={PLACEHOLDER_TIME_SERIES as any}
            margin={{top: 16, right: 24, bottom: 24, left: 32}}
        >
            <CartesianGrid
                stroke={PLACEHOLDER_LINE_COLOR}
                strokeOpacity={0.18}
                strokeDasharray="5 5"
            />
            <XAxis
                dataKey="timestamp"
                type="number"
                domain={["dataMin", "dataMax"]}
                scale="time"
                tick={{fill: "#94A3B8", fontSize: 11}}
                axisLine={{stroke: "rgba(148, 163, 184, 0.35)"}}
                tickFormatter={(value: number) => {
                    const date = new Date(value)
                    return date.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})
                }}
            />
            <YAxis
                domain={[0, 60]}
                tick={{fill: "#94A3B8", fontSize: 11}}
                axisLine={{stroke: "rgba(148, 163, 184, 0.35)"}}
            />
            <defs>
                <linearGradient id="placeholderTimeSeriesFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={PLACEHOLDER_LINE_COLOR} stopOpacity={0.35} />
                    <stop offset="55%" stopColor={PLACEHOLDER_LINE_COLOR} stopOpacity={0.12} />
                    <stop offset="100%" stopColor={PLACEHOLDER_LINE_COLOR} stopOpacity={0.01} />
                </linearGradient>
            </defs>
            <Area
                type="monotone"
                dataKey="value"
                stroke="none"
                fill="url(#placeholderTimeSeriesFill)"
                isAnimationActive={false}
            />
            <Line
                type="monotone"
                dataKey="value"
                stroke={PLACEHOLDER_LINE_COLOR}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
            />
        </LineChart>
    </ResponsiveContainer>
)

// Only evaluator metrics (slug-prefixed) should render in overview charts; skip invocation metrics.
const INVOCATION_METRIC_PREFIX = "attributes.ag."

const toFiniteNumber = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined

const getStatusCount = (meta: Record<string, any> | undefined, keys: string[]): number => {
    if (!meta) return 0
    const seen = new Set<string>()
    let total = 0
    keys.forEach((rawKey) => {
        const key = typeof rawKey === "string" ? rawKey.trim() : ""
        if (!key || seen.has(key)) return
        const direct = toFiniteNumber(meta[key])
        if (direct !== undefined) {
            total += direct
            seen.add(key)
            return
        }
        const summary = (meta?.statusSummary ?? {}) as Record<string, unknown>
        const summaryValue = toFiniteNumber(summary[key])
        if (summaryValue !== undefined) {
            total += summaryValue
            seen.add(key)
        }
    })
    return total
}

const extractTimeSeriesValue = (rawValue: any): {value: number; isBoolean: boolean} | null => {
    if (rawValue === null || rawValue === undefined) return null

    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
        return {value: rawValue, isBoolean: false}
    }
    if (typeof rawValue === "boolean") {
        return {value: rawValue ? 100 : 0, isBoolean: true}
    }

    if (Array.isArray(rawValue) && rawValue.length) {
        const numericValues = rawValue.filter((entry) => typeof entry === "number")
        if (numericValues.length) {
            const sum = numericValues.reduce((acc, num) => acc + num, 0)
            return {value: sum / numericValues.length, isBoolean: false}
        }
    }

    if (rawValue && typeof rawValue === "object") {
        if (typeof rawValue.mean === "number" && Number.isFinite(rawValue.mean)) {
            return {value: rawValue.mean, isBoolean: false}
        }
        if (typeof rawValue.value === "number" && Number.isFinite(rawValue.value)) {
            return {value: rawValue.value, isBoolean: false}
        }

        const frequency = Array.isArray(rawValue.frequency)
            ? rawValue.frequency
            : Array.isArray(rawValue.rank)
              ? rawValue.rank
              : undefined

        if (Array.isArray(rawValue.unique) || frequency) {
            const counts = frequency?.map((entry) => entry?.count ?? entry?.frequency ?? 0) ?? []
            const total =
                typeof rawValue.count === "number"
                    ? rawValue.count
                    : counts.reduce((acc, v) => acc + v, 0)

            if (total > 0 && frequency) {
                const trueEntry = frequency.find((entry) => entry?.value === true)
                const trueCount = trueEntry ? (trueEntry.count ?? trueEntry.frequency ?? 0) : 0
                const pct = (trueCount / total) * 100
                const clamped = Math.max(0, Math.min(100, pct))
                return {value: clamped, isBoolean: true}
            }
        }

        if (Array.isArray(rawValue.distribution) && rawValue.distribution.length) {
            const totalCount = rawValue.distribution.reduce(
                (acc: number, entry: any) => acc + (entry?.count ?? 0),
                0,
            )
            if (totalCount > 0) {
                const sum = rawValue.distribution.reduce(
                    (acc: number, entry: any) => acc + (entry?.value ?? 0) * (entry?.count ?? 0),
                    0,
                )
                return {value: sum / totalCount, isBoolean: false}
            }
        }
    }

    return null
}

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
const runsRawMetricsFamily = atomFamily(
    (runIds: string[]) =>
        atom((get) => runIds.map((id) => ({id, metrics: get(runMetricsFamily(id))}))),
    deepEqual,
)

const EvalRunOverviewViewer = ({type = "auto"}: {type: "auto" | "online"}) => {
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
    const rawMetricsByRun = useAtomValue(runsRawMetricsFamily(allRunIds))
    const {data: previewEvaluators} = useEvaluators({preview: true, queries: {is_human: false}})
    const {data: projectEvaluators} = useEvaluators()

    const catalogEvaluators = useMemo(
        () => [...toArray(previewEvaluators), ...toArray(projectEvaluators)],
        [previewEvaluators, projectEvaluators],
    )

    const catalogEvaluatorsByIdentifier = useMemo(() => {
        const map = new Map<string, any>()
        catalogEvaluators.forEach((entry) => {
            collectEvaluatorIdentifiers(entry).forEach((identifier) => {
                if (!map.has(identifier)) {
                    map.set(identifier, entry)
                }
            })
        })
        return map
    }, [catalogEvaluators])

    const evaluatorsBySlug = useMemo(() => {
        const map = new Map<string, any>()
        const register = (entry: any) => {
            if (!entry || typeof entry !== "object") return
            const identifiers = collectEvaluatorIdentifiers(entry)
            let catalogMatch: any
            for (const identifier of identifiers) {
                const match = catalogEvaluatorsByIdentifier.get(identifier)
                if (match) {
                    catalogMatch = match
                    break
                }
            }
            const merged = mergeEvaluatorRecords(entry, catalogMatch) ?? catalogMatch ?? entry
            const slug =
                pickString(merged?.slug) ||
                pickString(entry?.slug) ||
                pickString(catalogMatch?.slug) ||
                undefined
            if (!slug || map.has(slug)) return
            map.set(slug, merged)
        }

        runs.forEach((state) => {
            toArray(state?.enrichedRun?.evaluators).forEach(register)
        })
        toArray(evaluators).forEach(register)

        return Object.fromEntries(map.entries())
    }, [runs, evaluators, catalogEvaluatorsByIdentifier])

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

    const schemaMetricNamesBySlug = useMemo(() => {
        const map: Record<string, string[]> = {}
        Object.entries(schemaMetricDefinitionsBySlug).forEach(([slug, definitions]) => {
            const names = Array.from(
                new Set(
                    definitions
                        .map((definition) => definition.name.trim())
                        .filter((name) => name.length > 0),
                ),
            )
            if (map[slug]) {
                const merged = new Set([...map[slug], ...names])
                map[slug] = Array.from(merged)
            } else {
                map[slug] = names
            }
        })
        return map
    }, [schemaMetricDefinitionsBySlug])

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
        if (freq && freq.some((entry) => Number(entry?.count ?? entry?.frequency ?? 0) > 0))
            return true

        const unique = (metric as any).unique
        if (Array.isArray(unique) && unique.length > 0) {
            // if we have unique values but no counts, treat as data only if mean exists
            return typeof metric.mean === "number"
        }

        return false
    }

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
            if (!metricHasContent(metric)) return

            const [slug, ...rest] = canonical.split(".")
            const metricKey = rest.join(".") || slug

            const evaluator = evaluatorsBySlug[slug]
            if (!evaluator) {
                return
            }

            const allowedKeys = evaluatorMetricKeysBySlug[slug]
            if (allowedKeys) {
                if (allowedKeys.size === 0) return
                const segments = metricKey.split(".").filter(Boolean)
                const candidateKeys = new Set<string>([metricKey])
                segments.forEach((_, idx) => {
                    const prefix = segments.slice(0, idx + 1).join(".")
                    const suffix = segments.slice(idx).join(".")
                    if (prefix) candidateKeys.add(prefix)
                    if (suffix) candidateKeys.add(suffix)
                    const segment = segments[idx]
                    if (segment) candidateKeys.add(segment)
                })
                const matchesDefinition = Array.from(candidateKeys).some((key) =>
                    allowedKeys.has(key),
                )
                if (!matchesDefinition) return
            }

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
    }, [metrics, metricsByRun, evaluatorsBySlug, evaluatorMetricKeysBySlug])

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

    const rawMetricsLookup = useMemo(() => {
        const map: Record<string, any[]> = {}
        rawMetricsByRun.forEach(({id, metrics}) => {
            map[id] = Array.isArray(metrics) ? metrics : []
        })
        return map
    }, [rawMetricsByRun])

    const hasMetrics = combinedMetricEntries.length > 0
    const isRefreshingMetrics = loadingStateFamilyData.isRefreshingMetrics
    const shouldShowMetricsSkeleton =
        loadingState.isLoadingMetrics ||
        (loadingStateFamilyData.isLoadingMetrics && (!isRefreshingMetrics || !hasMetrics))
    const evaluatorList = Object.values(evaluatorsBySlug)
    const resolvedEvalType: PlaceholderEvaluationType =
        evalType === "online" ? "online" : evalType === "human" ? "human" : "auto"
    const evaluatorKeysWithMetrics = useMemo(() => {
        const set = new Set<string>()
        combinedMetricEntries.forEach(({evaluatorSlug}) => {
            if (evaluatorSlug) set.add(evaluatorSlug)
        })
        return set
    }, [combinedMetricEntries])

    const placeholderEvaluators = useMemo(() => {
        if (!evaluatorList.length) return []
        return evaluatorList.filter((ev: any) => {
            const key = ev?.slug
            if (!key) return true
            return !evaluatorKeysWithMetrics.has(key)
        })
    }, [evaluatorList, evaluatorKeysWithMetrics])

    const statusInsights = useMemo(() => {
        let runsWithAnyOutcome = 0
        let runsWithSuccess = 0
        let hasAnyError = false

        runs.forEach((state) => {
            if (!state) return

            const meta = (state.statusMeta ?? {}) as Record<string, any>
            const total = getStatusCount(meta, ["total"])
            const completed = getStatusCount(meta, ["completed"])
            const successCount = getStatusCount(meta, ["success"])
            const errorCount = getStatusCount(meta, ["error"]) + getStatusCount(meta, ["failed"])
            const cancelledCount = getStatusCount(meta, ["cancelled", "canceled"])
            const normalizedStatus = String(
                (state.enrichedRun as any)?.status ?? (state.rawRun as any)?.status ?? "",
            ).toLowerCase()
            const runMarkedError =
                normalizedStatus === "error" ||
                normalizedStatus === "failed" ||
                normalizedStatus === "failure"

            const encounteredError =
                errorCount > 0 ||
                runMarkedError ||
                !!state?.isError?.run ||
                !!state?.isError?.metrics ||
                !!state?.isError?.scenarios

            const hasOutcome =
                total > 0 ||
                completed > 0 ||
                successCount > 0 ||
                errorCount > 0 ||
                cancelledCount > 0 ||
                runMarkedError ||
                !!state?.isError?.run ||
                !!state?.isError?.metrics ||
                !!state?.isError?.scenarios ||
                Array.isArray(state?.scenarios)

            if (hasOutcome) {
                runsWithAnyOutcome += 1
            }

            if (encounteredError) {
                hasAnyError = true
            }

            if (successCount > 0) {
                runsWithSuccess += 1
            }
        })

        return {runsWithAnyOutcome, runsWithSuccess, hasAnyError}
    }, [runs])

    const {runsWithAnyOutcome, runsWithSuccess, hasAnyError} = statusInsights
    const shouldShowErrorCopy = runsWithAnyOutcome > 0 && hasAnyError && runsWithSuccess === 0

    const buildPlaceholderCopy = useCallback(
        (
            context: "timeSeries" | "chart" | "empty",
            options?: {metricName?: string; evaluatorLabel?: string},
        ) => {
            const rawMetricName = options?.metricName?.trim()
            const metricName = rawMetricName && rawMetricName.length ? rawMetricName : undefined
            const rawEvaluatorLabel = options?.evaluatorLabel?.trim()
            const evaluatorLabel =
                rawEvaluatorLabel && rawEvaluatorLabel.length ? rawEvaluatorLabel : undefined
            const evaluatorDisplay = evaluatorLabel ?? "this evaluator"

            if (shouldShowErrorCopy) {
                if (context === "timeSeries") {
                    const traceLabel = metricName ? `${metricName} traces` : "traces"
                    return {
                        title: `${metricName ?? "Metric"} traces unavailable`,
                        description: `All executions ended in errors${
                            evaluatorLabel ? ` for ${evaluatorDisplay}` : ""
                        }. Resolve the failures and rerun to see ${traceLabel}.`,
                    }
                }
                if (context === "chart") {
                    const resultLabel = metricName ? `${metricName} results` : "metric results"
                    return {
                        title: `${metricName ?? "Metric"} results unavailable`,
                        description: `All scenarios ended in errors${
                            evaluatorLabel ? ` for ${evaluatorDisplay}` : ""
                        }. Resolve the failures and rerun to see ${resultLabel}.`,
                    }
                }
                return {
                    title:
                        resolvedEvalType === "online"
                            ? "Traces ended in error"
                            : "Evaluations ended in error",
                    description: `Every run finished with errors. Resolve the issues and rerun to see ${
                        resolvedEvalType === "online" ? "new traces" : "metrics"
                    }.`,
                }
            }

            if (context === "timeSeries") {
                const traceLabel = metricName ?? "metric"
                const resultLabel = metricName ? `${metricName} results` : "results"
                return {
                    title: `Waiting for ${traceLabel} traces`,
                    description: `Generate traces with ${evaluatorDisplay} to start collecting ${resultLabel}.`,
                }
            }

            if (context === "chart") {
                const metricLabel = metricName ?? "metric"
                const distributionLabel = metricName
                    ? `${metricName} distribution data`
                    : "distribution data"
                return {
                    title: `Waiting for ${metricLabel} results`,
                    description: `Annotate your scenarios with ${evaluatorDisplay} to start seeing ${distributionLabel}.`,
                }
            }

            return {
                title:
                    resolvedEvalType === "online"
                        ? "Waiting for your traces"
                        : "Waiting for evaluation runs",
                description:
                    resolvedEvalType === "online"
                        ? "Generate traces to start collecting results."
                        : "Run your prompt against testcases to start collecting metrics.",
            }
        },
        [resolvedEvalType, shouldShowErrorCopy],
    )

    const scaffoldItems = useMemo(() => {
        if (hasMetrics) return []
        if (!evaluatorList.length)
            return [
                {
                    id: "placeholder",
                    label: "Awaiting evaluators",
                },
            ]
        return evaluatorList.map((ev: any, idx: number) => ({
            id: ev?.slug || `evaluator-${idx}`,
            label: ev?.name || ev?.slug || "Evaluator",
        }))
    }, [hasMetrics, evaluatorList])

    const getEvaluatorLabel = (ev: any) => ev?.name || ev?.slug || "this evaluator"

    const placeholderCards = useMemo(() => {
        if (!placeholderEvaluators.length) return []

        return placeholderEvaluators.flatMap((evaluator, idx) => {
            const evaluatorKey = evaluator?.slug || evaluator?.id || `placeholder-${idx}`
            const label = getEvaluatorLabel(evaluator)
            const slug = evaluator?.slug
            const metricKeys = slug ? (schemaMetricNamesBySlug[slug] ?? []) : []
            const uniqueMetricKeys = metricKeys.length
                ? Array.from(new Set(metricKeys))
                : ["__metrics_pending__"]

            return uniqueMetricKeys.map((metricKey, metricIdx) => {
                const formattedName =
                    metricKey === "__metrics_pending__"
                        ? "Metrics pending"
                        : formatMetricName(metricKey)
                const copy =
                    type === "online"
                        ? buildPlaceholderCopy("timeSeries", {
                              metricName: formattedName,
                              evaluatorLabel: label,
                          })
                        : buildPlaceholderCopy("chart", {
                              metricName: formattedName,
                              evaluatorLabel: label,
                          })
                if (type === "online") {
                    return (
                        <EvaluatorMetricsTimeSeriesChart
                            key={`placeholder-online-${evaluatorKey}-${metricKey}-${metricIdx}`}
                            className="w-full"
                            name={formattedName}
                            metricKey={metricKey === "__metrics_pending__" ? undefined : metricKey}
                            evaluator={evaluator as any}
                            isBoolean={false}
                            evaluationType="online"
                            series={[]}
                            placeholderTitle={copy.title}
                            placeholderDescription={copy.description}
                        />
                    )
                }
                return (
                    <EvaluatorMetricsChart
                        key={`placeholder-${evaluatorKey}-${metricKey}-${metricIdx}`}
                        className="w-[calc(50%-0.3rem)] 2xl:w-[calc(33.33%-0.34rem)]"
                        name={formattedName}
                        metricKey={metricKey === "__metrics_pending__" ? undefined : metricKey}
                        metric={{}}
                        evaluator={evaluator as any}
                        isCompare={false}
                        averageRows={[]}
                        summaryRows={[]}
                        evaluationType={resolvedEvalType}
                        hasMetricData={false}
                        placeholderTitle={copy.title}
                        placeholderDescription={copy.description}
                    />
                )
            })
        })
    }, [
        buildPlaceholderCopy,
        getEvaluatorLabel,
        placeholderEvaluators,
        resolvedEvalType,
        schemaMetricNamesBySlug,
        type,
    ])

    const emptyPlaceholder = useMemo(() => {
        const copy = buildPlaceholderCopy("empty")
        return (
            <div className="relative w-full overflow-hidden rounded-lg border border-dashed border-[#D0D5DD] bg-white">
                <div className="absolute inset-0 opacity-60">
                    {resolvedEvalType === "online" ? (
                        <PlaceholderTimeSeriesBackdrop />
                    ) : (
                        <SpiderChartPlaceholder className="h-full w-full" />
                    )}
                </div>
                <PlaceholderOverlay className="px-8" evaluationType={resolvedEvalType}>
                    <div className="flex max-w-xl flex-col items-center gap-3 text-center">
                        <span className="text-sm font-medium text-[#1D2939]">{copy.title}</span>
                        <span className="text-xs text-[#667085]">{copy.description}</span>
                        {scaffoldItems.length ? (
                            <div className="flex flex-wrap justify-center gap-2 text-xs text-[#475467]">
                                {scaffoldItems.map(({id, label}) => (
                                    <span
                                        key={`metric-pill-${id}`}
                                        className="rounded-full bg-[#EEF2FF] px-3 py-1 text-[#344054]"
                                    >
                                        {label}
                                    </span>
                                ))}
                            </div>
                        ) : null}
                    </div>
                </PlaceholderOverlay>
            </div>
        )
    }, [buildPlaceholderCopy, resolvedEvalType, scaffoldItems])

    if (shouldShowMetricsSkeleton) {
        return <EvalRunOverviewViewerSkeleton className={clsx({"px-6": evalType === "auto"})} />
    }
    return (
        <>
            <div className="px-6">
                <EvalRunScoreTable type={type} />
            </div>

            <div className="px-6 w-full flex flex-wrap gap-2">
                {hasMetrics ? (
                    <>
                        {combinedMetricEntries.map(
                            ({fullKey, metric, evaluatorSlug, metricKey}, idx) => {
                                if (!metric || !Object.keys(metric || {}).length) return null

                                const isBooleanMetric =
                                    Array.isArray(metric?.unique) && metric.unique.length > 0
                                const chartWidthClass =
                                    type === "online"
                                        ? "w-full"
                                        : "w-[calc(50%-0.3rem)] 2xl:w-[calc(33.33%-0.34rem)]"

                                if (type === "online") {
                                    const resolveEntryTimestamp = (entry: any): number | null => {
                                        const rawTs =
                                            entry?.timestamp ??
                                            entry?.window?.timestamp ??
                                            entry?.window?.end ??
                                            entry?.created_at ??
                                            entry?.createdAt ??
                                            entry?.window_start ??
                                            null
                                        if (typeof rawTs === "number") {
                                            return Number.isFinite(rawTs) ? rawTs : null
                                        }
                                        if (typeof rawTs === "string" && rawTs.length) {
                                            const parsed = new Date(rawTs).getTime()
                                            return Number.isFinite(parsed) ? parsed : null
                                        }
                                        if (rawTs instanceof Date) {
                                            const time = rawTs.getTime()
                                            return Number.isFinite(time) ? time : null
                                        }
                                        return null
                                    }

                                    const timeSeries = allRunIds
                                        .map((id, i) => {
                                            const state = evalById[id]
                                            const compareIdx = state?.compareIndex || i + 1
                                            const entries = rawMetricsLookup[id] || []
                                            if (!entries.length) return null
                                            const timestampedEntries = entries.filter(
                                                (entry: any) =>
                                                    resolveEntryTimestamp(entry) !== null,
                                            )
                                            if (!timestampedEntries.length) return null

                                            const points = timestampedEntries
                                                .map((entry: any) => {
                                                    const ts = resolveEntryTimestamp(entry)
                                                    if (ts == null) return null

                                                    const source = entry?.data || {}
                                                    let rawValue = source?.[fullKey]
                                                    if (rawValue === undefined) {
                                                        rawValue = getMetricValueWithAliases(
                                                            source,
                                                            fullKey,
                                                        )
                                                    }
                                                    if (rawValue === undefined) return null

                                                    const resolved =
                                                        extractTimeSeriesValue(rawValue)
                                                    if (!resolved) return null
                                                    const {value, isBoolean: valueIsBoolean} =
                                                        resolved

                                                    const percentiles = (() => {
                                                        if (
                                                            !rawValue ||
                                                            typeof rawValue !== "object"
                                                        )
                                                            return {}
                                                        const pcts = (rawValue as any).pcts
                                                        if (!pcts || typeof pcts !== "object")
                                                            return {}
                                                        const read = (key: string) => {
                                                            const v = (pcts as Record<string, any>)[
                                                                key
                                                            ]
                                                            return typeof v === "number" &&
                                                                Number.isFinite(v)
                                                                ? v
                                                                : undefined
                                                        }
                                                        return {
                                                            p25: read("p25") ?? read("P25"),
                                                            p50: read("p50") ?? read("P50"),
                                                            p75: read("p75") ?? read("P75"),
                                                        }
                                                    })()

                                                    const scenarioCount = (() => {
                                                        let resolved: number | undefined
                                                        if (
                                                            rawValue &&
                                                            typeof rawValue === "object"
                                                        ) {
                                                            const countValue = (rawValue as any)
                                                                .count
                                                            const numericCount = Number(countValue)
                                                            if (
                                                                Number.isFinite(numericCount) &&
                                                                numericCount >= 0
                                                            ) {
                                                                resolved = numericCount
                                                            } else {
                                                                const freq = Array.isArray(
                                                                    (rawValue as any).frequency,
                                                                )
                                                                    ? (rawValue as any).frequency
                                                                    : Array.isArray(
                                                                            (rawValue as any).rank,
                                                                        )
                                                                      ? (rawValue as any).rank
                                                                      : undefined
                                                                if (freq) {
                                                                    const total = freq.reduce(
                                                                        (acc: number, item: any) =>
                                                                            acc +
                                                                            Number(
                                                                                item?.count ??
                                                                                    item?.frequency ??
                                                                                    0,
                                                                            ),
                                                                        0,
                                                                    )
                                                                    if (
                                                                        Number.isFinite(total) &&
                                                                        total > 0
                                                                    ) {
                                                                        resolved = total
                                                                    }
                                                                }
                                                            }
                                                        }
                                                        if (resolved === undefined) {
                                                            const entryCount = Number(entry?.count)
                                                            if (
                                                                Number.isFinite(entryCount) &&
                                                                entryCount >= 0
                                                            ) {
                                                                resolved = entryCount
                                                            }
                                                        }
                                                        if (
                                                            resolved === undefined &&
                                                            Array.isArray(entry?.scenario_ids)
                                                        ) {
                                                            resolved = entry.scenario_ids.length
                                                        }
                                                        if (
                                                            resolved === undefined &&
                                                            Array.isArray(entry?.scenarioIds)
                                                        ) {
                                                            resolved = entry.scenarioIds.length
                                                        }
                                                        return resolved
                                                    })()

                                                    const histogram = (() => {
                                                        if (
                                                            !rawValue ||
                                                            typeof rawValue !== "object"
                                                        )
                                                            return
                                                        const hist = (rawValue as any).hist
                                                        if (!Array.isArray(hist)) return
                                                        const bins = hist
                                                            .map((bin: any) => {
                                                                const interval = Array.isArray(
                                                                    bin?.interval,
                                                                )
                                                                    ? bin.interval
                                                                    : []
                                                                const from = Number(interval?.[0])
                                                                const to = Number(interval?.[1])
                                                                let count = Number(
                                                                    bin?.count ?? bin?.frequency,
                                                                )
                                                                if (
                                                                    !Number.isFinite(from) ||
                                                                    !Number.isFinite(to) ||
                                                                    !Number.isFinite(count)
                                                                )
                                                                    return null
                                                                if (
                                                                    scenarioCount !== undefined &&
                                                                    scenarioCount > 1 &&
                                                                    count > 0 &&
                                                                    count <= 1
                                                                ) {
                                                                    count *= scenarioCount
                                                                }
                                                                return {from, to, count}
                                                            })
                                                            .filter(
                                                                (
                                                                    bin,
                                                                ): bin is {
                                                                    from: number
                                                                    to: number
                                                                    count: number
                                                                } => bin !== null,
                                                            )
                                                        return bins.length ? bins : undefined
                                                    })()

                                                    return {
                                                        timestamp: ts,
                                                        value,
                                                        isBoolean: valueIsBoolean,
                                                        scenarioCount,
                                                        p25: percentiles.p25,
                                                        p50: percentiles.p50,
                                                        p75: percentiles.p75,
                                                        histogram,
                                                    }
                                                })
                                                .filter(
                                                    (
                                                        point,
                                                    ): point is {
                                                        timestamp: number
                                                        value: number
                                                        isBoolean?: boolean
                                                        scenarioCount?: number
                                                        p25?: number
                                                        p50?: number
                                                        p75?: number
                                                        histogram?: {
                                                            from: number
                                                            to: number
                                                            count: number
                                                        }[]
                                                    } => point !== null,
                                                )
                                                .sort((a, b) => a.timestamp - b.timestamp)

                                            if (!points.length) return null

                                            const containsBoolean = points.some((p) => p.isBoolean)

                                            return {
                                                id,
                                                name:
                                                    state?.enrichedRun?.name ||
                                                    `Eval ${compareIdx}`,
                                                color: (EVAL_COLOR as any)[compareIdx] || "#3B82F6",
                                                points,
                                                isBoolean: containsBoolean,
                                            }
                                        })
                                        .filter(Boolean) as {
                                        id: string
                                        name: string
                                        color: string
                                        points: {
                                            timestamp: number
                                            value: number
                                            isBoolean?: boolean
                                            scenarioCount?: number
                                            p25?: number
                                            p50?: number
                                            p75?: number
                                            histogram?: {from: number; to: number; count: number}[]
                                        }[]
                                        isBoolean?: boolean
                                    }[]

                                    const isSeriesBoolean =
                                        isBooleanMetric ||
                                        timeSeries.some((series) => series.isBoolean)

                                    if (timeSeries.length) {
                                        const placeholderCopy = shouldShowErrorCopy
                                            ? buildPlaceholderCopy("timeSeries", {
                                                  metricName: formatMetricName(metricKey),
                                                  evaluatorLabel: getEvaluatorLabel(
                                                      evaluatorsBySlug[evaluatorSlug],
                                                  ),
                                              })
                                            : undefined
                                        return (
                                            <EvaluatorMetricsTimeSeriesChart
                                                key={`${metricKey}-${idx}`}
                                                className={chartWidthClass}
                                                name={formatMetricName(metricKey)}
                                                metricKey={metricKey}
                                                evaluator={evaluatorsBySlug[evaluatorSlug]}
                                                isBoolean={isSeriesBoolean}
                                                evaluationType={
                                                    evalType === "online"
                                                        ? "online"
                                                        : evalType === "human"
                                                          ? "human"
                                                          : "auto"
                                                }
                                                series={timeSeries.map((series) => ({
                                                    id: series.id,
                                                    name: series.name,
                                                    color: series.color,
                                                    points: series.points.map(
                                                        ({
                                                            timestamp,
                                                            value,
                                                            scenarioCount,
                                                            p25,
                                                            p50,
                                                            p75,
                                                            histogram,
                                                        }) => ({
                                                            timestamp,
                                                            value,
                                                            scenarioCount,
                                                            p25,
                                                            p50,
                                                            p75,
                                                            histogram,
                                                        }),
                                                    ),
                                                }))}
                                                placeholderTitle={placeholderCopy?.title}
                                                placeholderDescription={
                                                    placeholderCopy?.description
                                                }
                                            />
                                        )
                                    }
                                    // fall through to histogram fallback when no time series data
                                }

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
                                                  const trueEntry = (
                                                      m?.frequency ||
                                                      m?.rank ||
                                                      []
                                                  )?.find((f: any) => f?.value === true)
                                                  const total = m?.count ?? 0
                                                  y = total
                                                      ? ((trueEntry?.count ?? 0) / total) * 100
                                                      : 0
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
                                const hasMetricData =
                                    rowsWithMeta?.some((row) => row.hasMetric) ?? false

                                const placeholderCopy = shouldShowErrorCopy
                                    ? buildPlaceholderCopy("chart", {
                                          metricName: formatMetricName(metricKey),
                                          evaluatorLabel: getEvaluatorLabel(
                                              evaluatorsBySlug[evaluatorSlug],
                                          ),
                                      })
                                    : undefined

                                return (
                                    <EvaluatorMetricsChart
                                        key={`${metricKey}-${idx}`}
                                        className={chartWidthClass}
                                        name={formatMetricName(metricKey)}
                                        metricKey={metricKey}
                                        metric={metric}
                                        evaluator={evaluatorsBySlug[evaluatorSlug]}
                                        isCompare={isCompare}
                                        averageRows={averageRows}
                                        summaryRows={summaryRows}
                                        evaluationType={
                                            evalType === "online"
                                                ? "online"
                                                : evalType === "human"
                                                  ? "human"
                                                  : "auto"
                                        }
                                        hasMetricData={hasMetricData}
                                        placeholderTitle={placeholderCopy?.title}
                                        placeholderDescription={placeholderCopy?.description}
                                    />
                                )
                            },
                        )}
                        {placeholderCards.length ? placeholderCards : null}
                    </>
                ) : placeholderCards.length ? (
                    placeholderCards
                ) : (
                    emptyPlaceholder
                )}
            </div>
        </>
    )
}

export default memo(EvalRunOverviewViewer)
