import {atom, Atom} from "jotai"
import {atomFamily, loadable} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {evaluationRunQueryAtomFamily} from "@/oss/components/EvalRunDetails2/atoms/table/run"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {BasicStats, canonicalizeMetricKey, getMetricValueWithAliases} from "@/oss/lib/metricUtils"
import createBatchFetcher from "@/oss/state/utils/createBatchFetcher"

import {createMetricProcessor, type MetricScope} from "./metricProcessor"
import {effectiveProjectIdAtom} from "./run"

type RunLevelStatsMap = Record<string, BasicStats>

export interface TemporalMetricPoint {
    timestamp: number
    stats: BasicStats
}

const temporalRunFlags = new Map<string, boolean>()
const temporalRunSeries = new Map<string, Record<string, TemporalMetricPoint[]>>()

const metricKeyAliases: Record<string, string> = {
    "costs.total": "totalCost",
    "tokens.total": "totalTokens",
    "tokens.prompt": "promptTokens",
    "tokens.completion": "completionTokens",
}

const MAX_CATEGORICAL_ENTRIES = 20
const STAT_KEYS_TO_DROP = [
    "pcts",
    "pct",
    "iqrs",
    "pscs",
    "hist",
    "quartiles",
    "percentiles",
    "bins",
]

const normalizeStatValue = (value: any): any => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value
    const next: any = {...value}

    if (Array.isArray(next.freq)) {
        next.frequency = next.freq
        delete next.freq
    }
    if (Array.isArray(next.uniq)) {
        next.unique = next.uniq
        delete next.uniq
    }

    if (Array.isArray(next.frequency)) {
        next.frequency = next.frequency.map((entry: any) => ({
            value: entry?.value,
            count: entry?.count ?? entry?.frequency ?? 0,
        }))

        const sorted = [...next.frequency].sort(
            (a, b) => b.count - a.count || (a.value === true ? -1 : 1),
        )
        next.rank = sorted.slice(0, MAX_CATEGORICAL_ENTRIES)
        if (!Array.isArray(next.unique) || !next.unique.length) {
            next.unique = sorted.map((entry) => entry.value)
        }
        if (next.frequency.length > MAX_CATEGORICAL_ENTRIES) {
            next.frequency = next.frequency.slice(0, MAX_CATEGORICAL_ENTRIES)
        }
    } else if (Array.isArray(next.rank)) {
        next.rank = next.rank.map((entry: any) => ({
            value: entry?.value,
            count: entry?.count ?? entry?.frequency ?? 0,
        }))
        if (next.rank.length > MAX_CATEGORICAL_ENTRIES) {
            next.rank = next.rank.slice(0, MAX_CATEGORICAL_ENTRIES)
        }
    }

    if (Array.isArray(next.hist)) {
        if (!Array.isArray(next.distribution) || next.distribution.length === 0) {
            next.distribution = next.hist.map((entry: any) => {
                const interval = Array.isArray(entry?.interval) ? entry.interval : []
                const start =
                    interval.length > 0 && typeof interval[0] === "number"
                        ? interval[0]
                        : typeof entry?.value === "number"
                          ? entry.value
                          : typeof entry?.bin === "number"
                            ? entry.bin
                            : 0
                return {
                    value: start,
                    count: entry?.count ?? 0,
                }
            })
            next.distribution.sort((a: any, b: any) => (a?.value ?? 0) - (b?.value ?? 0))
        }

        if (typeof next.binSize !== "number") {
            const firstInterval = Array.isArray(next.hist[0]?.interval)
                ? next.hist[0]?.interval
                : undefined
            if (firstInterval && firstInterval.length >= 2) {
                const width = Number(firstInterval[1]) - Number(firstInterval[0])
                if (Number.isFinite(width) && width > 0) {
                    next.binSize = width
                }
            }
        }

        if (typeof next.min !== "number") {
            const firstInterval = Array.isArray(next.hist[0]?.interval)
                ? next.hist[0]?.interval
                : undefined
            const start = firstInterval && firstInterval.length > 0 ? firstInterval[0] : undefined
            if (typeof start === "number") {
                next.min = start
            }
        }

        if (typeof next.max !== "number") {
            const last = next.hist[next.hist.length - 1]
            const interval = Array.isArray(last?.interval) ? last.interval : undefined
            const end =
                interval && interval.length > 0
                    ? interval[interval.length - 1]
                    : typeof last?.edge === "number"
                      ? last.edge
                      : undefined
            if (typeof end === "number") {
                next.max = end
            }
        }

        delete next.hist
    }

    if (Array.isArray(next.unique) && next.unique.length > MAX_CATEGORICAL_ENTRIES) {
        next.unique = next.unique.slice(0, MAX_CATEGORICAL_ENTRIES)
    }

    STAT_KEYS_TO_DROP.forEach((key) => {
        if (key in next) {
            delete next[key]
        }
    })

    if (Array.isArray(next.distribution) && next.distribution.length > MAX_CATEGORICAL_ENTRIES) {
        next.distribution = next.distribution.slice(0, MAX_CATEGORICAL_ENTRIES)
    }

    return next
}

const toNumber = (value: any): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined

const mergeFrequencyArrays = (a?: any[], b?: any[]): any[] | undefined => {
    if ((!a || !a.length) && (!b || !b.length)) return a || b
    const map = new Map<string, number>()
    const addEntries = (entries?: any[]) => {
        entries?.forEach((entry: any) => {
            const rawValue =
                entry?.value !== undefined
                    ? entry.value
                    : entry?.label !== undefined
                      ? entry.label
                      : entry?.name !== undefined
                        ? entry.name
                        : entry
            const key = JSON.stringify(rawValue)
            const count = toNumber(entry?.count ?? entry?.frequency ?? entry?.value ?? 0)
            if (count === undefined) return
            map.set(key, (map.get(key) ?? 0) + count)
        })
    }
    addEntries(a)
    addEntries(b)
    const merged = Array.from(map.entries()).map(([key, count]) => ({
        value: JSON.parse(key),
        count,
    }))
    merged.sort((x, y) => (y.count ?? 0) - (x.count ?? 0))
    return merged
}

const mergeUniqueValues = (a?: any[], b?: any[]): any[] | undefined => {
    if ((!a || !a.length) && (!b || !b.length)) return a || b
    const set = new Set<string>()
    const add = (values?: any[]) => values?.forEach((value) => set.add(JSON.stringify(value)))
    add(a)
    add(b)
    return Array.from(set.values()).map((value) => JSON.parse(value))
}

const mergeBasicStats = (current: BasicStats | undefined, incoming: BasicStats): BasicStats => {
    if (!current) return {...incoming}
    const result: any = {...current}

    const incomingCount = toNumber(incoming.count)
    const existingCount = toNumber(result.count) ?? 0
    if (incomingCount !== undefined) {
        result.count = existingCount + incomingCount
    }

    const computeSum = (stats: BasicStats, countFallback?: number) => {
        if (toNumber((stats as any)?.sum) !== undefined) return toNumber((stats as any)?.sum)
        if (toNumber((stats as any)?.mean) !== undefined) {
            const c = toNumber(stats.count)
            if (c !== undefined) return (stats as any).mean * c
            if (countFallback !== undefined) return (stats as any).mean * countFallback
        }
        return undefined
    }

    const existingSum = computeSum(result as BasicStats, existingCount)
    const incomingSum = computeSum(incoming, incomingCount)
    if (existingSum !== undefined || incomingSum !== undefined) {
        const total = (existingSum ?? 0) + (incomingSum ?? 0)
        result.sum = total
        const totalCount = toNumber(result.count)
        if (totalCount !== undefined && totalCount > 0) {
            result.mean = total / totalCount
        }
    }

    const minValues = [toNumber(result.min), toNumber(incoming.min)].filter(
        (value) => value !== undefined,
    ) as number[]
    if (minValues.length) {
        result.min = Math.min(...minValues)
    }

    const maxValues = [toNumber(result.max), toNumber(incoming.max)].filter(
        (value) => value !== undefined,
    ) as number[]
    if (maxValues.length) {
        result.max = Math.max(...maxValues)
    }

    if (toNumber(result.min) !== undefined && toNumber(result.max) !== undefined) {
        result.range = toNumber(result.max)! - toNumber(result.min)!
    }

    const mergedFrequency = mergeFrequencyArrays(result.frequency, incoming.frequency)
    if (mergedFrequency) {
        result.frequency = mergedFrequency
        result.rank = mergedFrequency
    }
    const mergedRank = mergeFrequencyArrays(result.rank, incoming.rank)
    if (mergedRank) {
        result.rank = mergedRank
    }

    const mergedUnique = mergeUniqueValues(result.unique, incoming.unique)
    if (mergedUnique) {
        result.unique = mergedUnique
    }

    return result
}

const ensureBinSize = (statsMap: RunLevelStatsMap): RunLevelStatsMap => {
    const result: RunLevelStatsMap = {}
    Object.entries(statsMap).forEach(([key, value]) => {
        const entry = value as any
        if (
            entry &&
            entry.binSize === undefined &&
            Array.isArray(entry.distribution) &&
            entry.distribution.length
        ) {
            const bins = entry.distribution.length
            const range = (entry.max ?? 0) - (entry.min ?? 0)
            result[key] = {
                ...entry,
                binSize: bins ? (range !== 0 ? range / bins : 1) : 1,
            }
        } else {
            result[key] = entry
        }
    })
    return result
}

const STAT_OBJECT_KEYS = new Set([
    "count",
    "mean",
    "sum",
    "min",
    "max",
    "median",
    "p50",
    "p75",
    "p90",
    "p95",
    "p99",
    "variance",
    "var",
    "stddev",
    "std",
    "frequency",
    "freq",
    "distribution",
    "rank",
    "unique",
])

const isLikelyStatObject = (value: any): boolean => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    const keys = Object.keys(value)
    if (!keys.length) return false
    return keys.some((key) => STAT_OBJECT_KEYS.has(key))
}

const collectNestedStats = (
    value: any,
    prefix: string,
    results: {key: string; stats: BasicStats}[],
    visited: Set<any>,
) => {
    if (!value || typeof value !== "object") return
    if (visited.has(value)) return
    visited.add(value)

    if (Array.isArray(value)) {
        // Arrays are either frequency lists or raw samples. We do not descend further.
        return
    }

    if (prefix && isLikelyStatObject(value)) {
        const normalized = normalizeStatValue(value) as BasicStats
        results.push({key: prefix, stats: normalized})
        return
    }

    Object.entries(value as Record<string, unknown>).forEach(([childKey, childValue]) => {
        if (!childKey) return
        const nextPrefix = prefix ? `${prefix}.${childKey}` : childKey
        collectNestedStats(childValue, nextPrefix, results, visited)
    })
}

const flattenRunLevelMetricData = (data: Record<string, any>): Record<string, any> => {
    const flat: Record<string, any> = {}

    Object.entries(data || {}).forEach(([stepKey, metrics]) => {
        if (!metrics || typeof metrics !== "object") return

        Object.entries(metrics as Record<string, any>).forEach(([metricKey, rawValue]) => {
            const normalizedValue = normalizeStatValue(rawValue)

            const originalKey = `${stepKey}.${metricKey}`
            flat[originalKey] = mergeBasicStats(flat[originalKey], normalizedValue)

            flat[metricKey] = mergeBasicStats(flat[metricKey], normalizedValue)
            const canonicalMetricKey = canonicalizeMetricKey(metricKey)
            if (canonicalMetricKey !== metricKey) {
                flat[canonicalMetricKey] = mergeBasicStats(
                    flat[canonicalMetricKey],
                    normalizedValue,
                )
            }

            const aliasKey = metricKeyAliases[metricKey]
            if (aliasKey) {
                const aliasComposite = `${stepKey}.${aliasKey}`
                flat[aliasComposite] = mergeBasicStats(flat[aliasComposite], normalizedValue)
                const canonicalAlias = canonicalizeMetricKey(aliasComposite)
                if (canonicalAlias !== aliasComposite) {
                    flat[canonicalAlias] = mergeBasicStats(flat[canonicalAlias], normalizedValue)
                }
            }

            const analyticsIndex = originalKey.indexOf("attributes.ag.")
            if (analyticsIndex >= 0) {
                const analyticsKey = originalKey.slice(analyticsIndex)
                flat[analyticsKey] = mergeBasicStats(flat[analyticsKey], normalizedValue)
                const canonicalAnalyticsKey = canonicalizeMetricKey(analyticsKey)
                if (canonicalAnalyticsKey !== analyticsKey) {
                    flat[canonicalAnalyticsKey] = mergeBasicStats(
                        flat[canonicalAnalyticsKey],
                        normalizedValue,
                    )
                }
            }

            const nestedStats: {key: string; stats: BasicStats}[] = []
            collectNestedStats(normalizedValue, "", nestedStats, new Set<any>())

            nestedStats.forEach(({key: nestedKey, stats}) => {
                const stepScopedNestedKey = `${stepKey}.${nestedKey}`
                flat[stepScopedNestedKey] = mergeBasicStats(flat[stepScopedNestedKey], stats)
                flat[nestedKey] = mergeBasicStats(flat[nestedKey], stats)

                const canonicalNestedKey = canonicalizeMetricKey(nestedKey)
                if (canonicalNestedKey !== nestedKey) {
                    flat[canonicalNestedKey] = mergeBasicStats(flat[canonicalNestedKey], stats)
                    const canonicalStepScoped = `${stepKey}.${canonicalNestedKey}`
                    flat[canonicalStepScoped] = mergeBasicStats(flat[canonicalStepScoped], stats)
                }
            })
        })
    })

    return flat
}

const normalizeStatsMap = (stats: Record<string, any>): RunLevelStatsMap => {
    const normalized: RunLevelStatsMap = {}
    Object.entries(stats || {}).forEach(([key, value]) => {
        const normalizedValue = normalizeStatValue(value)
        normalized[key] = mergeBasicStats(normalized[key], normalizedValue as BasicStats)
        const canonical = canonicalizeMetricKey(key)
        if (canonical !== key) {
            normalized[canonical] = mergeBasicStats(
                normalized[canonical],
                normalizedValue as BasicStats,
            )
        }
    })

    return ensureBinSize(normalized)
}

const includeTemporalFlag = (flag?: boolean) => flag !== false

interface RunMetricsBatchRequest {
    projectId: string
    runId: string
    includeTemporal?: boolean
}

const runMetricsBatchFetcher = createBatchFetcher<RunMetricsBatchRequest, any[]>({
    serializeKey: (request) => JSON.stringify(request),
    batchFn: async (requests, serializedKeys) => {
        const groups = new Map<
            string,
            {
                projectId: string
                runIds: Set<string>
                needsTemporal: boolean
                items: {request: RunMetricsBatchRequest; serializedKey: string}[]
            }
        >()

        requests.forEach((request, index) => {
            if (!request.projectId || !request.runId) return
            const groupKey = request.projectId
            const serializedKey = serializedKeys[index]
            if (!groups.has(groupKey)) {
                groups.set(groupKey, {
                    projectId: request.projectId,
                    runIds: new Set(),
                    needsTemporal: false,
                    items: [],
                })
            }
            const entry = groups.get(groupKey)!
            entry.runIds.add(request.runId)
            if (includeTemporalFlag(request.includeTemporal)) {
                entry.needsTemporal = true
            }
            entry.items.push({request, serializedKey})
        })

        const results = new Map<string, any[]>()

        for (const [, entry] of groups) {
            const basePayload = {
                metrics: {
                    run_ids: Array.from(entry.runIds),
                    scenario_ids: false,
                    timestamps: false,
                },
                // windowing: {
                //     limit: 1,
                //     order: "descending",
                // },
            }

            const response = await axios.post(`/preview/evaluations/metrics/query`, basePayload, {
                params: {project_id: entry.projectId},
            })

            const metricsByRun = new Map<string, {runLevel: any[]; temporal: any[]}>()

            const addMetrics = (collection: any[], bucket: "runLevel" | "temporal") => {
                collection.forEach((metric: any) => {
                    const runId = metric?.run_id || metric?.runId
                    if (!runId) return
                    if (!metricsByRun.has(runId)) {
                        metricsByRun.set(runId, {runLevel: [], temporal: []})
                    }
                    metricsByRun.get(runId)![bucket].push(metric)
                })
            }

            const runLevelMetrics = Array.isArray(response.data?.metrics)
                ? (response.data.metrics as {run_id: string; name: string; value: any}[])
                : []

            console.log("runLevelMetrics", runLevelMetrics)
            // addMetrics([runLevelMetrics.pop()], "runLevel")
            addMetrics(runLevelMetrics, "runLevel")

            if (entry.needsTemporal) {
                try {
                    const temporalResponse = await axios.post(
                        `/preview/evaluations/metrics/query`,
                        {
                            ...basePayload,
                            metrics: {
                                ...basePayload.metrics,
                                timestamps: false,
                            },
                        },
                        {params: {project_id: entry.projectId}},
                    )
                    const temporalMetrics = Array.isArray(temporalResponse.data?.metrics)
                        ? temporalResponse.data.metrics
                        : []
                    addMetrics(temporalMetrics, "temporal")
                } catch (error) {
                    console.warn("[EvalRunDetails2] Failed to fetch temporal metrics", {
                        projectId: entry.projectId,
                        runIds: Array.from(entry.runIds),
                        error,
                    })
                }
            }

            entry.items.forEach(({request, serializedKey}) => {
                const runMetrics = metricsByRun.get(request.runId)
                if (!runMetrics) {
                    results.set(serializedKey, [])
                    return
                }
                const wantsTemporal = includeTemporalFlag(request.includeTemporal)
                const payload = wantsTemporal
                    ? [...runMetrics.runLevel, ...runMetrics.temporal]
                    : [...runMetrics.runLevel]
                results.set(serializedKey, payload)
            })
        }

        return results
    },
    resolveResult: (response, request, serializedKey) => {
        return (response as Map<string, any[]>).get(serializedKey) ?? []
    },
})

interface PreviewRunMetricStatsQueryArgs {
    runId: string
    includeTemporal?: boolean
}

const previewRunMetricStatsQueryFamily = atomFamily(
    ({runId, includeTemporal}: PreviewRunMetricStatsQueryArgs) => {
        return atomWithQuery<RunLevelStatsMap>((get) => {
            const projectId = get(effectiveProjectIdAtom)
            const runQuery = runId ? get(evaluationRunQueryAtomFamily(runId)) : undefined
            const runStatusRaw = runQuery?.data?.rawRun?.status ?? runQuery?.data?.camelRun?.status
            const runStatus =
                typeof runStatusRaw === "string"
                    ? runStatusRaw.toLowerCase()
                    : typeof runStatusRaw?.value === "string"
                      ? runStatusRaw.value.toLowerCase()
                      : undefined

            const includeTemporalFlagValue = includeTemporalFlag(includeTemporal)

            // Statuses that indicate an evaluation is still in progress
            // When in progress, we should NOT trigger metric refresh as:
            // 1. 0 metrics means the evaluation hasn't produced any results yet
            // 2. Partial metrics means the evaluation is still running
            // Triggering refresh during in-progress state causes premature run-level metrics creation
            const IN_PROGRESS_STATUSES = new Set([
                "evaluation_initialized",
                "initialized",
                "evaluation_started",
                "started",
                "running",
                "pending",
            ])
            // If runStatus is undefined (not yet loaded), assume in-progress to prevent premature refresh
            const isRunInProgress = runStatus ? IN_PROGRESS_STATUSES.has(runStatus) : true

            const fetchMetrics = async () => {
                if (!projectId || !runId) return []
                return runMetricsBatchFetcher({
                    projectId,
                    runId,
                    includeTemporal: includeTemporalFlagValue,
                })
            }

            return {
                queryKey: [
                    "preview",
                    "run-metric-stats",
                    projectId,
                    runId,
                    includeTemporalFlagValue,
                    isRunInProgress, // Include to re-run query when status changes from in-progress to terminal
                ],
                enabled: Boolean(projectId && runId),
                staleTime: 30_000,
                gcTime: 5 * 60 * 1000,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                queryFn: async () => {
                    if (!projectId || !runId) return {}

                    const fetchedMetrics = await fetchMetrics()

                    if (!fetchedMetrics.length) {
                        temporalRunFlags.set(runId, false)
                        temporalRunSeries.set(runId, {})
                        if (
                            runStatus === "failure" ||
                            runStatus === "errors" ||
                            runStatus === "cancelled"
                        ) {
                            return {}
                        }
                    }

                    const processMetrics = async ({
                        entries,
                        source,
                        triggerRefresh,
                    }: {
                        entries: any[]
                        source: string
                        triggerRefresh: boolean
                    }) => {
                        const processor = createMetricProcessor({
                            projectId,
                            runId,
                            source,
                        })

                        const hasRunLevelEntry = entries.some(
                            (entry: any) => !entry?.scenario_id && !entry?.scenarioId,
                        )
                        if (!hasRunLevelEntry) {
                            processor.markRunLevelGap("missing-run-level-entry")
                        }

                        // Detect if this is a temporal/live evaluation
                        // Temporal evaluations have entries with timestamp/interval but no static run-level entry
                        const hasTemporalEntries = entries.some(
                            (entry: any) =>
                                !entry?.scenario_id &&
                                !entry?.scenarioId &&
                                (entry?.timestamp || entry?.interval?.timestamp),
                        )
                        const hasStaticRunLevelEntry = entries.some(
                            (entry: any) =>
                                !entry?.scenario_id &&
                                !entry?.scenarioId &&
                                !entry?.timestamp &&
                                !entry?.interval?.timestamp,
                        )
                        // If we have temporal entries but no static run-level entry, this is a temporal-only evaluation
                        // Also treat completed runs with no entries as temporal-only to skip bootstrap
                        // (completed runs that would have run-level metrics already have them)
                        const TERMINAL_STATUSES = new Set([
                            "success",
                            "completed",
                            "failure",
                            "failed",
                            "errors",
                            "error",
                            "cancelled",
                            "canceled",
                        ])
                        const isRunTerminal = runStatus ? TERMINAL_STATUSES.has(runStatus) : false
                        const isTemporalOnly =
                            (hasTemporalEntries && !hasStaticRunLevelEntry) ||
                            (isRunTerminal && !hasStaticRunLevelEntry && entries.length === 0)

                        // Process all metrics to track which need refresh, but don't filter them out
                        // Refresh is a background operation that may not succeed, so we should
                        // still display existing data
                        entries.forEach((entry: any) => {
                            const scope: MetricScope =
                                entry?.scenario_id || entry?.scenarioId ? "scenario" : "run"
                            processor.processMetric(entry, scope)
                        })

                        const flushResult = await processor.flush({triggerRefresh, isTemporalOnly})

                        return {metrics: entries, flushResult}
                    }

                    // Do NOT trigger refresh when the run is in progress
                    // This prevents premature run-level metric creation during polling
                    let {metrics, flushResult} = await processMetrics({
                        entries: fetchedMetrics,
                        source: "run-metric-stats-query",
                        triggerRefresh: !isRunInProgress,
                    })

                    // Re-fetch after refresh to get updated metrics
                    if (flushResult.refreshed) {
                        const refreshedMetrics = await fetchMetrics()
                        const retry = await processMetrics({
                            entries: refreshedMetrics,
                            source: "run-metric-stats-query:retry",
                            triggerRefresh: false,
                        })

                        metrics = retry.metrics
                    }

                    if (process.env.NODE_ENV !== "production") {
                        try {
                            const metricSummaries = metrics.map((entry: any) => ({
                                scenarioId: entry?.scenario_id ?? entry?.scenarioId ?? null,
                                status: entry?.status ?? null,
                                keyCount: entry?.data
                                    ? Object.keys(entry.data as object).length
                                    : 0,
                                sampleKeys: entry?.data
                                    ? Object.keys(entry.data as object).slice(0, 5)
                                    : [],
                            }))
                        } catch (error) {
                            console.debug("[EvalRunDetails2] metrics.query summary failure", {
                                runId,
                                error,
                            })
                        }
                    }

                    const runLevelCandidates = metrics.filter(
                        (entry: any) => !entry?.scenario_id && !entry?.scenarioId,
                    )

                    let runLevelEntry = runLevelCandidates.find(
                        (entry: any) => !entry?.timestamp && !entry?.interval,
                    )

                    if (!runLevelEntry && runLevelCandidates.length > 0) {
                        runLevelEntry = runLevelCandidates.reduce((latest: any, entry: any) => {
                            const ts = new Date(
                                entry?.timestamp ?? entry?.interval?.timestamp ?? 0,
                            ).getTime()
                            if (!latest) return entry
                            const latestTs = new Date(
                                latest?.timestamp ?? latest?.interval?.timestamp ?? 0,
                            ).getTime()
                            return ts > latestTs ? entry : latest
                        }, null as any)
                    }

                    const shouldMarkRunLevelGap =
                        !runLevelEntry && fetchedMetrics.some((entry: any) => !entry?.scenario_id)
                    if (shouldMarkRunLevelGap) {
                        metricProcessor.markRunLevelGap("missing-run-level-entry")
                    }

                    const combinedFlat: Record<string, any> = {}
                    const runLevelKeys = new Set<string>()

                    if (runLevelEntry) {
                        const flattened = flattenRunLevelMetricData(runLevelEntry?.data || {})
                        Object.entries(flattened).forEach(([key, value]) => {
                            runLevelKeys.add(key)
                            combinedFlat[key] = mergeBasicStats(
                                combinedFlat[key],
                                value as BasicStats,
                            )
                        })
                    }

                    const hasRunLevelCoverage = Boolean(runLevelEntry)

                    metrics
                        .filter((entry: any) => entry?.scenario_id || entry?.scenarioId)
                        .forEach((entry: any) => {
                            const flattened = flattenRunLevelMetricData(entry?.data || {})
                            Object.entries(flattened).forEach(([key, value]) => {
                                if (hasRunLevelCoverage && runLevelKeys.has(key)) {
                                    return
                                }
                                combinedFlat[key] = mergeBasicStats(
                                    combinedFlat[key],
                                    value as BasicStats,
                                )
                            })
                        })

                    const temporalSeriesByMetric: Record<string, TemporalMetricPoint[]> = {}

                    metrics
                        .filter(
                            (entry: any) =>
                                !entry?.scenario_id &&
                                !entry?.scenarioId &&
                                (entry?.timestamp || entry?.interval?.timestamp),
                        )
                        .forEach((entry: any) => {
                            const rawTimestamp = entry?.timestamp || entry?.interval?.timestamp
                            const timestamp = Number(new Date(rawTimestamp || 0).getTime())
                            if (!Number.isFinite(timestamp)) return
                            const stepMetrics = entry?.data || {}
                            Object.entries(stepMetrics as Record<string, any>).forEach(
                                ([stepKey, metricsMap]) => {
                                    Object.entries(metricsMap || {}).forEach(
                                        ([metricKey, rawStats]) => {
                                            const canonicalMetric = canonicalizeMetricKey(metricKey)
                                            const seriesKey = `${stepKey}:${canonicalMetric}`
                                            const normalizedStats = normalizeStatValue(
                                                rawStats,
                                            ) as BasicStats
                                            const bucket = (temporalSeriesByMetric[seriesKey] ||=
                                                [])
                                            bucket.push({timestamp, stats: normalizedStats})
                                        },
                                    )
                                },
                            )
                        })

                    Object.values(temporalSeriesByMetric).forEach((series) =>
                        series.sort((a, b) => a.timestamp - b.timestamp),
                    )

                    const normalized = normalizeStatsMap(combinedFlat)
                    const hasTemporal =
                        Object.keys(temporalSeriesByMetric).length > 0 ||
                        metrics.some(
                            (entry: any) =>
                                !entry?.scenario_id &&
                                !entry?.scenarioId &&
                                (entry?.timestamp || entry?.interval?.timestamp),
                        )

                    temporalRunFlags.set(runId, hasTemporal)
                    if (Object.keys(temporalSeriesByMetric).length) {
                        temporalRunSeries.set(runId, temporalSeriesByMetric)
                    } else {
                        temporalRunSeries.set(runId, {})
                    }

                    if (!Object.keys(normalized).length) {
                        return {}
                    }

                    return normalized
                },
            }
        })
    },
    (a, b) =>
        a.runId === b.runId &&
        includeTemporalFlag(a.includeTemporal) === includeTemporalFlag(b.includeTemporal),
)

export const previewRunMetricStatsLoadableFamily = atomFamily(
    ({runId, includeTemporal}: {runId: string; includeTemporal?: boolean}) => {
        return loadable(previewRunMetricStatsQueryFamily({runId, includeTemporal}))
    },
    (a, b) =>
        a.runId === b.runId &&
        includeTemporalFlag(a.includeTemporal) === includeTemporalFlag(b.includeTemporal),
)

type LoadableState<T> =
    | {state: "loading"}
    | {state: "hasError"; error: unknown}
    | {state: "hasData"; data: T}

export interface RunLevelMetricSelection {
    state: LoadableState<BasicStats | undefined>["state"]
    stats?: BasicStats
    resolvedKey?: string
    error?: unknown
}

interface PreviewRunMetricStatsSelectorArgs {
    runId: string
    metricKey?: string
    metricPath?: string
    stepKey?: string
    includeTemporal?: boolean
}

export const previewRunMetricStatsSelectorFamily = atomFamily(
    ({
        runId,
        metricKey,
        metricPath,
        stepKey,
        includeTemporal,
    }: PreviewRunMetricStatsSelectorArgs): Atom<RunLevelMetricSelection> => {
        return atom((get) => {
            if (!runId) {
                return {state: "hasData", stats: undefined, resolvedKey: undefined}
            }

            const loadableResult = get(
                previewRunMetricStatsLoadableFamily({runId, includeTemporal}),
            )

            if (loadableResult.state === "loading") {
                return {state: "loading"}
            }
            if (loadableResult.state === "hasError") {
                return {state: "hasError", error: loadableResult.error}
            }

            const rawStats = loadableResult.data as
                | RunLevelStatsMap
                | {data?: RunLevelStatsMap}
                | undefined
            const statsMap =
                rawStats && typeof rawStats === "object" && "data" in rawStats
                    ? ((rawStats.data as RunLevelStatsMap) ?? {})
                    : ((rawStats as RunLevelStatsMap) ?? {})
            if (!statsMap || !Object.keys(statsMap).length) {
                return {state: "hasData", stats: undefined, resolvedKey: undefined}
            }

            const primaryKey = canonicalizeMetricKey(metricKey ?? metricPath ?? "")
            const baseCandidates = Array.from(
                new Set(
                    [primaryKey, metricKey, metricPath]
                        .filter((candidate): candidate is string =>
                            Boolean(candidate && candidate.length),
                        )
                        .map((candidate) => canonicalizeMetricKey(candidate)),
                ),
            )

            const stepCandidates: string[] = []
            if (stepKey) {
                baseCandidates.forEach((base) => {
                    stepCandidates.push(`${stepKey}.${base}`)
                    if (base.startsWith(`${stepKey}.`)) {
                        stepCandidates.push(base)
                    }
                })
            }

            // When stepKey is provided, only use step-prefixed candidates to ensure
            // we match metrics from the same evaluator. This prevents cross-evaluator
            // matching when comparing runs with different evaluator configurations.
            const candidates = (
                stepKey && stepCandidates.length > 0
                    ? stepCandidates
                    : [...stepCandidates, ...baseCandidates]
            ).filter((candidate, index, array) => array.indexOf(candidate) === index)

            const statsKeys = Object.keys(statsMap || {})

            const expandPlaceholderMetricCandidates = (candidate: string | undefined): string[] => {
                if (!candidate) return []
                const segments = candidate.split(".")
                if (segments.length <= 1) return []
                const last = segments[segments.length - 1]
                if (last !== "outputs") return []
                const prefix = segments.slice(0, -1).join(".")
                if (!prefix) return []
                const matches = statsKeys.filter((key) => {
                    if (key === candidate) return false
                    if (!key.startsWith(prefix)) return false
                    const remainder = key.slice(prefix.length)
                    return remainder.startsWith(".") && remainder.length > 1
                })
                return matches
            }

            const expandedCandidates = [...candidates]
            candidates.forEach((candidate) => {
                const expansions = expandPlaceholderMetricCandidates(candidate)
                expansions.forEach((expansion) => {
                    if (!expandedCandidates.includes(expansion)) {
                        expandedCandidates.push(expansion)
                    }
                })
            })

            const shouldLogDebug =
                process.env.NEXT_PUBLIC_EVAL_RUN_DEBUG === "true" && typeof window !== "undefined"
            // if (shouldLogDebug) {
            //     try {
            //         console.debug("[EvalRunDetails2][RunMetricSelector] Resolving metric stats", {
            //             runId,
            //             stepKey,
            //             metricKey,
            //             metricPath,
            //             candidateCount: candidates.length,
            //             sampleCandidates: candidates.slice(0, 6),
            //             availableKeys: Object.keys(statsMap || {}).slice(0, 12),
            //         })
            //     } catch (error) {
            //         console.debug(
            //             "[EvalRunDetails2][RunMetricSelector] Failed to log candidate summary",
            //             {runId, error},
            //         )
            //     }
            // }

            for (const candidate of expandedCandidates) {
                if (!candidate) continue
                const direct = statsMap[candidate]
                if (direct !== undefined) {
                    return {state: "hasData", stats: direct as BasicStats, resolvedKey: candidate}
                }
                const aliased = getMetricValueWithAliases<BasicStats>(statsMap, candidate)
                if (aliased !== undefined) {
                    return {state: "hasData", stats: aliased, resolvedKey: candidate}
                }
                const canonical = canonicalizeMetricKey(candidate)
                if (canonical !== candidate) {
                    const directCanonical = statsMap[canonical]
                    if (directCanonical !== undefined) {
                        return {
                            state: "hasData",
                            stats: directCanonical as BasicStats,
                            resolvedKey: canonical,
                        }
                    }
                    const aliasedCanonical = getMetricValueWithAliases<BasicStats>(
                        statsMap,
                        canonical,
                    )
                    if (aliasedCanonical !== undefined) {
                        return {state: "hasData", stats: aliasedCanonical, resolvedKey: canonical}
                    }
                }
            }

            return {
                state: "hasData",
                stats: undefined,
                resolvedKey: candidates[0],
            }
        })
    },
    (a, b) =>
        a.runId === b.runId &&
        includeTemporalFlag(a.includeTemporal) === includeTemporalFlag(b.includeTemporal) &&
        a.metricKey === b.metricKey &&
        a.metricPath === b.metricPath &&
        a.stepKey === b.stepKey,
)

export const invalidatePreviewRunMetricStatsAtom = atom(null, (_, set, runId?: string | null) => {
    if (!runId) return
    const variants = [true, false] as const
    variants.forEach((temporal) => {
        previewRunMetricStatsQueryFamily.remove({
            runId,
            includeTemporal: temporal,
        })
        previewRunMetricStatsLoadableFamily.remove({
            runId,
            includeTemporal: temporal,
        })
    })
})
export const runTemporalMetricKeysAtomFamily = atomFamily((runId: string | null | undefined) =>
    atom((get) => {
        if (!runId) return false
        const cachedFlag = temporalRunFlags.get(runId)
        if (cachedFlag === true) return true
        const loadable = get(previewRunMetricStatsLoadableFamily({runId}))
        if (loadable.state !== "hasData") {
            return cachedFlag ?? false
        }
        const statsMap = (loadable.data as RunLevelStatsMap) ?? {}
        const inferred = Object.keys(statsMap || {}).some((key) => key.includes("temporal"))
        if (inferred) {
            temporalRunFlags.set(runId, true)
        }
        const series = temporalRunSeries.get(runId)
        if (series && Object.keys(series).length > 0) {
            temporalRunFlags.set(runId, true)
            return true
        }
        return inferred || Boolean(cachedFlag)
    }),
)

const _emptyTemporalSeriesAtom = atom<Record<string, TemporalMetricPoint[]>>({})

export const runTemporalMetricSeriesAtomFamily = atomFamily((runId: string | null | undefined) => {
    return atom((get) => {
        if (!runId) return {}
        get(previewRunMetricStatsLoadableFamily({runId}))
        return temporalRunSeries.get(runId) ?? {}
    })
})

/**
 * Selector for getting the latest temporal metric stats for a given metric.
 * Used for online evaluations where we want to show the most recent temporal data
 * instead of run-level aggregated stats.
 */
interface LatestTemporalMetricStatsSelectorArgs {
    runId: string
    metricKey?: string
    metricPath?: string
    stepKey?: string
}

/**
 * Helper function to build series key candidates for temporal metric lookup
 */
const buildTemporalSeriesKeyCandidates = (
    temporalSeries: Record<string, TemporalMetricPoint[]>,
    metricKey?: string,
    metricPath?: string,
    stepKey?: string,
): string[] => {
    const primaryKey = canonicalizeMetricKey(metricKey ?? metricPath ?? "")
    const baseCandidates = Array.from(
        new Set(
            [primaryKey, metricKey, metricPath]
                .filter((candidate): candidate is string => Boolean(candidate && candidate.length))
                .map((candidate) => canonicalizeMetricKey(candidate)),
        ),
    )

    const seriesKeyCandidates: string[] = []
    if (stepKey) {
        baseCandidates.forEach((base) => {
            seriesKeyCandidates.push(`${stepKey}:${base}`)
        })
    }
    baseCandidates.forEach((base) => {
        Object.keys(temporalSeries).forEach((seriesKey) => {
            if (seriesKey.endsWith(`:${base}`) || seriesKey === base) {
                if (!seriesKeyCandidates.includes(seriesKey)) {
                    seriesKeyCandidates.push(seriesKey)
                }
            }
        })
    })

    return seriesKeyCandidates
}

export const latestTemporalMetricStatsSelectorFamily = atomFamily(
    ({
        runId,
        metricKey,
        metricPath,
        stepKey,
    }: LatestTemporalMetricStatsSelectorArgs): Atom<RunLevelMetricSelection> => {
        return atom((get) => {
            if (!runId) {
                return {state: "hasData", stats: undefined, resolvedKey: undefined}
            }

            // First ensure the metrics are loaded
            const loadableResult = get(
                previewRunMetricStatsLoadableFamily({runId, includeTemporal: true}),
            )

            if (loadableResult.state === "loading") {
                return {state: "loading"}
            }
            if (loadableResult.state === "hasError") {
                return {state: "hasError", error: loadableResult.error}
            }

            // Get temporal series for this run
            const temporalSeries = temporalRunSeries.get(runId) ?? {}

            // Try temporal series first if available
            if (Object.keys(temporalSeries).length) {
                const seriesKeyCandidates = buildTemporalSeriesKeyCandidates(
                    temporalSeries,
                    metricKey,
                    metricPath,
                    stepKey,
                )

                // Find matching series and get the latest point
                for (const seriesKey of seriesKeyCandidates) {
                    const series = temporalSeries[seriesKey]
                    if (series && series.length > 0) {
                        // Series is sorted by timestamp ascending, so last element is latest
                        const latestPoint = series[series.length - 1]
                        if (latestPoint?.stats) {
                            return {
                                state: "hasData",
                                stats: latestPoint.stats,
                                resolvedKey: seriesKey,
                            }
                        }
                    }
                }
            }

            // Fallback to run-level stats if temporal series is empty or doesn't have matching data
            // This is important for online evaluations where metrics might not have timestamps
            if (loadableResult.state === "hasData" && loadableResult.data) {
                const runLevelStats = loadableResult.data as Record<string, BasicStats>
                // Run-level stats use dot separator (stepKey.metricKey), not colon
                const candidates = [
                    stepKey && metricPath ? `${stepKey}.${metricPath}` : null,
                    stepKey && metricKey ? `${stepKey}.${metricKey}` : null,
                    metricPath,
                    metricKey,
                ].filter((c): c is string => Boolean(c))

                for (const candidate of candidates) {
                    const stats = runLevelStats[candidate]
                    if (stats) {
                        return {
                            state: "hasData",
                            stats,
                            resolvedKey: candidate,
                        }
                    }
                }
            }

            return {state: "hasData", stats: undefined, resolvedKey: undefined}
        })
    },
    (a, b) =>
        a.runId === b.runId &&
        a.metricKey === b.metricKey &&
        a.metricPath === b.metricPath &&
        a.stepKey === b.stepKey,
)

/**
 * Selector for getting temporal metric stats at a specific timestamp.
 * Used for online evaluation scenario popovers where we want to show
 * the temporal distribution at the time of that scenario.
 */
interface TemporalMetricStatsAtTimestampArgs {
    runId: string
    metricKey?: string
    metricPath?: string
    stepKey?: string
    /** ISO timestamp string or epoch milliseconds */
    timestamp?: string | number | null
}

export const temporalMetricStatsAtTimestampSelectorFamily = atomFamily(
    ({
        runId,
        metricKey,
        metricPath,
        stepKey,
        timestamp,
    }: TemporalMetricStatsAtTimestampArgs): Atom<RunLevelMetricSelection> => {
        return atom((get) => {
            if (!runId) {
                return {state: "hasData", stats: undefined, resolvedKey: undefined}
            }

            // First ensure the metrics are loaded
            const loadableResult = get(
                previewRunMetricStatsLoadableFamily({runId, includeTemporal: true}),
            )

            if (loadableResult.state === "loading") {
                return {state: "loading"}
            }
            if (loadableResult.state === "hasError") {
                return {state: "hasError", error: loadableResult.error}
            }

            // Get temporal series for this run
            const temporalSeries = temporalRunSeries.get(runId) ?? {}
            if (!Object.keys(temporalSeries).length) {
                return {state: "hasData", stats: undefined, resolvedKey: undefined}
            }

            const seriesKeyCandidates = buildTemporalSeriesKeyCandidates(
                temporalSeries,
                metricKey,
                metricPath,
                stepKey,
            )

            // Parse target timestamp
            const targetTimestamp = timestamp
                ? typeof timestamp === "number"
                    ? timestamp
                    : new Date(timestamp).getTime()
                : null

            // Find matching series and get the point at or before the target timestamp
            for (const seriesKey of seriesKeyCandidates) {
                const series = temporalSeries[seriesKey]
                if (series && series.length > 0) {
                    let matchingPoint: TemporalMetricPoint | null = null

                    if (targetTimestamp && Number.isFinite(targetTimestamp)) {
                        // Find the point at or closest before the target timestamp
                        for (let i = series.length - 1; i >= 0; i--) {
                            if (series[i].timestamp <= targetTimestamp) {
                                matchingPoint = series[i]
                                break
                            }
                        }
                        // If no point before, use the first point
                        if (!matchingPoint && series.length > 0) {
                            matchingPoint = series[0]
                        }
                    } else {
                        // No timestamp specified, use the latest point
                        matchingPoint = series[series.length - 1]
                    }

                    if (matchingPoint?.stats) {
                        return {
                            state: "hasData",
                            stats: matchingPoint.stats,
                            resolvedKey: seriesKey,
                        }
                    }
                }
            }

            return {state: "hasData", stats: undefined, resolvedKey: undefined}
        })
    },
    (a, b) =>
        a.runId === b.runId &&
        a.metricKey === b.metricKey &&
        a.metricPath === b.metricPath &&
        a.stepKey === b.stepKey &&
        a.timestamp === b.timestamp,
)
