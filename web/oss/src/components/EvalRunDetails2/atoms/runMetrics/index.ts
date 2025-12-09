import {atom} from "jotai"
import {atomFamily, loadable} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {evaluationRunQueryAtomFamily} from "@/oss/components/EvalRunDetails2/atoms/table/run"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {BasicStats, canonicalizeMetricKey, getMetricValueWithAliases} from "@/oss/lib/metricUtils"
import createBatchFetcher from "@/oss/state/utils/createBatchFetcher"

import {createMetricProcessor} from "../metricProcessor"
import {effectiveProjectIdAtom} from "../run"

import {
    type MetricScope,
    PreviewRunMetricStatsQueryArgs,
    PreviewRunMetricStatsSelectorArgs,
    RunLevelMetricSelection,
    RunLevelStatsMap,
    RunMetricsBatchRequest,
    RunMetricSelectorAtom,
    TemporalMetricPoint,
} from "./types"
import {
    deleteMetricsByIds,
    flattenRunLevelMetricData,
    includeTemporalFlag,
    mergeBasicStats,
    normalizeStatValue,
    normalizeStatsMap,
} from "./utils"

const temporalRunFlags = new Map<string, boolean>()
const temporalRunSeries = new Map<string, Record<string, TemporalMetricPoint[]>>()

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
                    scenario_ids: true,
                    timestamps: true,
                },
                windowing: {},
            }

            const metricsByRun = new Map<
                string,
                {runLevel: any[]; temporal: any[]; scenario: any[]}
            >()

            const addMetrics = (
                collection: any[],
                bucket: "runLevel" | "temporal" | "scenario",
            ) => {
                collection.forEach((metric: any) => {
                    const runId = metric?.run_id || metric?.runId
                    if (!runId) return
                    const hasScenario = Boolean(metric?.scenario_id) || Boolean(metric?.scenarioId)
                    if (bucket === "scenario" && !hasScenario) return
                    if (!metricsByRun.has(runId)) {
                        metricsByRun.set(runId, {runLevel: [], temporal: [], scenario: []})
                    }
                    const target = metricsByRun.get(runId)!
                    target[bucket].push(metric)
                    if (hasScenario && bucket !== "scenario") {
                        target.scenario.push(metric)
                    }
                })
            }

            const response = await axios.post(`/preview/evaluations/metrics/query`, basePayload, {
                params: {project_id: entry.projectId},
            })

            const primaryMetrics = Array.isArray(response.data?.metrics)
                ? response.data.metrics
                : []
            addMetrics(primaryMetrics, "runLevel")

            if (entry.needsTemporal) {
                try {
                    const temporalResponse = await axios.post(
                        `/preview/evaluations/metrics/query`,
                        {
                            ...basePayload,
                            metrics: {
                                ...basePayload.metrics,
                                scenario_ids: true,
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

            try {
                const scenarioPayload = {
                    metrics: {
                        ...basePayload.metrics,
                        scenario_ids: false,
                    },
                    windowing: {},
                }

                const scenarioResponse = await axios.post(
                    `/preview/evaluations/metrics/query`,
                    scenarioPayload,
                    {params: {project_id: entry.projectId}},
                )

                const scenarioMetrics = Array.isArray(scenarioResponse.data?.metrics)
                    ? scenarioResponse.data.metrics
                    : []
                addMetrics(scenarioMetrics, "scenario")
            } catch (error) {
                console.warn("[EvalRunDetails2] Failed to fetch scenario metrics", {
                    projectId: entry.projectId,
                    runIds: Array.from(entry.runIds),
                    error,
                })
            }

            entry.items.forEach(({request, serializedKey}) => {
                const runMetrics = metricsByRun.get(request.runId)
                if (!runMetrics) {
                    results.set(serializedKey, [])
                    return
                }
                const wantsTemporal = includeTemporalFlag(request.includeTemporal)
                const payload = wantsTemporal
                    ? [...runMetrics.runLevel, ...runMetrics.temporal, ...runMetrics.scenario]
                    : [...runMetrics.runLevel, ...runMetrics.scenario]
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
                        // Only skip bootstrap for actual temporal/live evaluations
                        // A temporal-only evaluation has temporal entries but NO static run-level entry
                        // Note: We must have actual temporal entries to consider it temporal-only
                        // Missing run-level metrics (deleted or not yet created) should NOT be treated as temporal-only
                        const isTemporalOnly = hasTemporalEntries && !hasStaticRunLevelEntry

                        const processed = entries.map((entry: any) => {
                            const scope: MetricScope =
                                entry?.scenario_id || entry?.scenarioId ? "scenario" : "run"
                            const result = processor.processMetric(entry, scope)
                            return {entry, result}
                        })

                        const filtered = processed
                            .filter(({result}) => !result.shouldRefresh)
                            .map(({entry}) => entry)

                        if (
                            hasRunLevelEntry &&
                            !filtered.some(
                                (entry: any) => !entry?.scenario_id && !entry?.scenarioId,
                            )
                        ) {
                            processor.markRunLevelGap("missing-run-level-entry")
                        }

                        const flushResult = await processor.flush({triggerRefresh, isTemporalOnly})

                        return {metrics: filtered, flushResult}
                    }

                    const attemptCleanup = async (
                        flushResult: Awaited<ReturnType<typeof processMetrics>>["flushResult"],
                    ) => {
                        const staleMetricIds = flushResult.staleMetricIds ?? []
                        if (!staleMetricIds.length) return false
                        return deleteMetricsByIds({projectId, metricIds: staleMetricIds})
                    }

                    // Do NOT trigger refresh when the run is in progress
                    // This prevents premature run-level metric creation during polling
                    let {metrics, flushResult} = await processMetrics({
                        entries: fetchedMetrics,
                        source: "run-metric-stats-query",
                        triggerRefresh: !isRunInProgress,
                    })

                    let cleanupPerformed = await attemptCleanup(flushResult)

                    if (cleanupPerformed || flushResult.refreshed) {
                        const refreshedMetrics = await fetchMetrics()
                        const retry = await processMetrics({
                            entries: refreshedMetrics,
                            source: "run-metric-stats-query:retry",
                            triggerRefresh: false,
                        })

                        metrics = retry.metrics
                        flushResult = retry.flushResult

                        const retryCleanupPerformed = await attemptCleanup(flushResult)
                        cleanupPerformed = cleanupPerformed || retryCleanupPerformed
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

export const previewRunMetricStatsSelectorFamily = atomFamily(
    ({
        runId,
        metricKey,
        metricPath,
        stepKey,
        includeTemporal,
    }: PreviewRunMetricStatsSelectorArgs): RunMetricSelectorAtom => {
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

            const candidates = [...stepCandidates, ...baseCandidates].filter(
                (candidate, index, array) => array.indexOf(candidate) === index,
            )

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
        const loadable = get(previewRunMetricStatsLoadableFamily({runId, includeTemporal: true}))
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

const emptyTemporalSeriesAtom = atom<Record<string, TemporalMetricPoint[]>>({})

export const runTemporalMetricSeriesAtomFamily = atomFamily((runId: string | null | undefined) => {
    return atom((get) => {
        if (!runId) return {}
        get(previewRunMetricStatsLoadableFamily({runId, includeTemporal: true}))
        return temporalRunSeries.get(runId) ?? {}
    })
})
