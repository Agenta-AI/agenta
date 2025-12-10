import axios from "@/oss/lib/api/assets/axiosConfig"
import {canonicalizeMetricKey} from "@/oss/lib/metricUtils"

import {wasScenarioRecentlySaved} from "./metrics"
import {
    MetricProcessor,
    MetricProcessorFlushOptions,
    MetricProcessorFlushResult,
    MetricProcessorOptions,
    MetricProcessorResult,
    MetricScope,
    MetricShapeSummary,
    RunRefreshDetailResult,
    ScenarioRefreshDetailResult,
} from "./runMetrics/types"

// Debug logger that only logs in development environments
const isDev = process.env.NODE_ENV === "development"
const metricProcessorDebug = {
    log: (...args: Parameters<typeof console.log>) => {
        if (isDev) console.log("[MetricProcessor]", ...args)
    },
    debug: (...args: Parameters<typeof console.debug>) => {
        if (isDev) console.debug("[MetricProcessor]", ...args)
    },
    info: (...args: Parameters<typeof console.info>) => {
        if (isDev) console.info("[MetricProcessor]", ...args)
    },
    warn: (...args: Parameters<typeof console.warn>) => {
        if (isDev) console.warn("[MetricProcessor]", ...args)
    },
    error: (...args: Parameters<typeof console.error>) => {
        if (isDev) console.error("[MetricProcessor]", ...args)
    },
}

// Track which runIds have already attempted bootstrap refresh
// This prevents repeated refresh attempts when backend returns empty results
const bootstrapAttemptedRuns = new Set<string>()

export const clearBootstrapAttempt = (runId: string) => {
    bootstrapAttemptedRuns.delete(runId)
}

export const clearAllBootstrapAttempts = () => {
    bootstrapAttemptedRuns.clear()
}

const LEGACY_VALUE_ALLOWED_KEYS = new Set([
    "value",
    "count",
    "confidence",
    "support",
    "stepKey",
    "step_key",
    "timestamp",
])

export const isPlainObject = (value: unknown): value is Record<string, any> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value))

export const isLegacyValueLeaf = (value: Record<string, any>): boolean => {
    if (!("value" in value) || typeof value.value === "object") {
        return false
    }
    if ("frequency" in value || "rank" in value || "distribution" in value) {
        return false
    }
    const unknownKeys = Object.keys(value).filter((key) => !LEGACY_VALUE_ALLOWED_KEYS.has(key))
    if (unknownKeys.length) {
        return false
    }
    return true
}

export const containsLegacyValueLeaf = (node: unknown): boolean => {
    if (!node) return false
    if (Array.isArray(node)) {
        return node.some((item) => containsLegacyValueLeaf(item))
    }
    if (isPlainObject(node)) {
        if (isLegacyValueLeaf(node)) {
            return true
        }
        return Object.values(node).some((value) => containsLegacyValueLeaf(value))
    }
    return false
}

interface MetricProcessorState {
    pending: MetricProcessorResult[]
    scenarioIds: Set<string>
    metricIds: Set<string>
    runLevelFlags: string[]
    scenarioGaps: {scenarioId: string; reason: string}[]
}

export const summarizeMetricEntry = (entry: any): MetricShapeSummary => {
    if (!entry || typeof entry !== "object") {
        return {
            id: null,
            scenarioId: null,
            status: null,
            keyCount: 0,
            sampleKeys: [],
            sampleData: {},
            canonicalSampleKeys: [],
        }
    }

    const data =
        entry?.data && typeof entry.data === "object" && !Array.isArray(entry.data)
            ? (entry.data as Record<string, any>)
            : {}
    const keys = Object.keys(data)
    const sampleKeys = keys.slice(0, 5)
    const sampleData = sampleKeys.reduce<Record<string, any>>((acc, key) => {
        acc[key] = data[key]
        return acc
    }, {})

    const canonicalSampleKeys = sampleKeys
        .map((key) => canonicalizeMetricKey(key))
        .filter((key): key is string => Boolean(key && key !== ""))

    return {
        id: (entry?.id ?? null) as string | null,
        scenarioId: (entry?.scenario_id ?? entry?.scenarioId ?? null) as string | null,
        status:
            typeof entry?.status === "string"
                ? (entry.status as string | null)
                : (entry?.status ?? null),
        keyCount: keys.length,
        sampleKeys,
        sampleData,
        canonicalSampleKeys,
    }
}

export const createMetricProcessor = ({
    projectId,
    runId,
    source,
    evaluationType,
}: MetricProcessorOptions & {evaluationType?: "auto" | "human" | "online" | null}): MetricProcessor => {
    const state: MetricProcessorState = {
        pending: [],
        scenarioIds: new Set<string>(),
        metricIds: new Set<string>(),
        runLevelFlags: [],
        scenarioGaps: [],
    }

    const resetState = () => {
        state.pending = []
        state.scenarioIds = new Set<string>()
        state.metricIds = new Set<string>()
        state.runLevelFlags = []
        state.scenarioGaps = []
    }

    const processMetric = (metric: any, scope: MetricScope): MetricProcessorResult => {
        const summary = summarizeMetricEntry(metric)
        const reasons: string[] = []
        const status = summary.status?.toLowerCase?.() ?? null
        const hasLegacyShape = containsLegacyValueLeaf(metric?.data)

        // Statuses that indicate a scenario has NOT been executed yet
        // These should NOT trigger a metric refresh - there's nothing to refresh
        //
        // EXCEPTION for human evaluations:
        // For human evals, "pending" means invocations have run but annotations are pending.
        // Metrics should exist from the invocations, so "pending" should not be treated as not-yet-executed.
        const pendingStatuses = new Set([
            ...(evaluationType === "human" ? [] : ["pending"]),
            "waiting",
            "created",
            "queued",
            "scheduled",
            "initializing",
            "not_started",
            "not-started",
        ])
        // A scenario is considered "pending" (not yet run) if:
        // 1. It has an explicit pending status, OR
        // 2. It has no status at all (null/undefined means not yet executed)
        // Exception: For human evals, null status doesn't mean not-yet-executed
        const isPendingScenario = status
            ? pendingStatuses.has(status)
            : evaluationType !== "human"

        if (scope === "scenario") {
            // Skip ALL refresh logic for scenarios that haven't been run yet
            // There's no data to refresh if the scenario hasn't been executed
            if (isPendingScenario) {
                // Return early - don't add any reasons for pending scenarios
            } else {
                // Only trigger refresh for scenarios that have been executed
                if (status && status !== "success") {
                    reasons.push(`status:${status}`)
                }
                if (hasLegacyShape) {
                    reasons.push("legacy-value-leaf")
                }
            }
        } else if (hasLegacyShape) {
            reasons.push("legacy-run-value-leaf")
        }

        const shouldRefresh = reasons.length > 0

        const shouldDelete = shouldRefresh && scope === "scenario" && Boolean(summary.id)

        if (shouldRefresh) {
            const result: MetricProcessorResult = {
                metricId: summary.id,
                scenarioId: summary.scenarioId,
                scope,
                status: summary.status,
                reasons,
                summary,
                shouldRefresh: true,
                shouldDelete,
            }

            state.pending.push(result)

            if (summary.scenarioId) {
                state.scenarioIds.add(summary.scenarioId)
            }
            if (shouldDelete && summary.id) {
                state.metricIds.add(summary.id)
            }

            return result
        }

        return {
            metricId: summary.id,
            scenarioId: summary.scenarioId,
            scope,
            status: summary.status,
            reasons,
            summary,
            shouldRefresh: false,
            shouldDelete: false,
        }
    }

    const markRunLevelGap = (reason: string) => {
        state.runLevelFlags.push(reason)
    }

    const markScenarioGap = (
        scenarioId: string,
        reason: string,
        scenarioStatus?: string | null,
    ) => {
        // Track the gap for informational purposes
        state.scenarioGaps.push({scenarioId, reason})

        // Skip refresh for scenarios that were recently saved
        // This prevents triggering refresh before new metrics are persisted
        if (wasScenarioRecentlySaved(scenarioId)) {
            metricProcessorDebug.debug("Skipping refresh for recently saved scenario", {
                scenarioId,
                reason,
            })
            return
        }

        // Terminal statuses indicate the scenario HAS been executed
        // If metrics are missing for a terminal scenario, we should trigger a refresh
        const terminalStatuses = new Set([
            "success",
            "completed",
            "finished",
            "done",
            "failed",
            "error",
            "failure",
        ])

        const normalizedStatus = scenarioStatus?.toLowerCase?.() ?? null
        const isTerminalState = normalizedStatus && terminalStatuses.has(normalizedStatus)

        if (isTerminalState && reason === "missing-scenario-metric") {
            // Scenario is in terminal state but has no metrics - trigger refresh
            metricProcessorDebug.debug("Terminal scenario missing metrics, triggering refresh", {
                scenarioId,
                reason,
                scenarioStatus: normalizedStatus,
            })
            state.scenarioIds.add(scenarioId)
        }
        // NOTE: For non-terminal states (pending, waiting, etc.), we intentionally
        // do NOT add to state.scenarioIds to prevent refresh for scenarios that
        // simply haven't been executed yet
    }

    const getPendingActions = () => {
        const pending = [...state.pending]
        const scenarioIds = Array.from(state.scenarioIds)
        const metricIds = Array.from(state.metricIds)
        const runLevelFlags = [...state.runLevelFlags]
        const scenarioGaps = [...state.scenarioGaps]
        return {pending, scenarioIds, metricIds, runLevelFlags, scenarioGaps}
    }

    const makeEmptyFlushResult = (): MetricProcessorFlushResult => ({
        refreshed: false,
        deleted: false,
        staleMetricIds: [],
        refreshedScenarioIds: [],
        missingScenarioIdsAfterAttempts: [],
        scenarioRefreshDetails: [],
        runRefreshDetails: null,
        runLevelMetricIdsFromScenarioRefresh: [],
        runLevelMetricIdsFromScenarioFallback: [],
        unexpectedScenarioMetricIds: [],
    })

    const flush = async ({
        triggerRefresh = true,
        isTemporalOnly = false,
    }: MetricProcessorFlushOptions = {}): Promise<MetricProcessorFlushResult> => {
        const {pending, scenarioIds, runLevelFlags, scenarioGaps} = getPendingActions()

        // console.debug("[MetricProcessor] flush called", {
        //     triggerRefresh,
        //     pendingCount: pending.length,
        //     scenarioIdsCount: scenarioIds.length,
        //     scenarioIds,
        //     runLevelFlagsCount: runLevelFlags.length,
        //     scenarioGapsCount: scenarioGaps.length,
        //     scenarioGaps,
        //     projectId,
        //     runId,
        //     source,
        // })

        if (!pending.length && !runLevelFlags.length && !scenarioGaps.length) {
            metricProcessorDebug.debug("flush: nothing to do, returning empty result")
            return makeEmptyFlushResult()
        }

        let refreshed = false
        let scenarioRefreshDetails: ScenarioRefreshDetailResult[] = []
        let runLevelMetricIdsFromScenarioRefresh: string[] = []
        let runLevelMetricIdsFromScenarioFallback: string[] = []
        let unexpectedScenarioMetricIds: string[] = []
        let missingScenarioIdsAfterAttempts: string[] = []
        let runRefreshDetails: RunRefreshDetailResult | null = null

        if (triggerRefresh) {
            const uniqueScenarioIds = Array.from(new Set(scenarioIds.filter(Boolean)))
            if (uniqueScenarioIds.length) {
                metricProcessorDebug.debug("flush: will trigger refresh for scenarios", {
                    uniqueScenarioIds,
                })
                const pendingByScenario = new Map<string, MetricProcessorResult[]>()
                pending.forEach((result) => {
                    if (!result.scenarioId) return
                    const list = pendingByScenario.get(result.scenarioId) ?? []
                    list.push(result)
                    pendingByScenario.set(result.scenarioId, list)
                })

                const detailByScenario = new Map<
                    string,
                    {
                        scenarioId: string
                        reasons: string[]
                        oldMetricIds: string[]
                        newMetricIds: Set<string>
                        reusedMetricIds: Set<string>
                        returnedCount: number
                        attempts: string[]
                    }
                >()

                uniqueScenarioIds.forEach((scenarioId) => {
                    const flagged = pendingByScenario.get(scenarioId) ?? []
                    const reasonSet = new Set<string>()
                    const oldMetricIds = new Set<string>()
                    flagged.forEach((entry) => {
                        entry.reasons.forEach((reason) => reasonSet.add(reason))
                        if (entry.metricId) oldMetricIds.add(entry.metricId)
                    })

                    detailByScenario.set(scenarioId, {
                        scenarioId,
                        reasons: Array.from(reasonSet),
                        oldMetricIds: Array.from(oldMetricIds),
                        newMetricIds: new Set<string>(),
                        reusedMetricIds: new Set<string>(),
                        returnedCount: 0,
                        attempts: [],
                    })
                })

                const runLevelMetricIdsFromScenarioRefreshSet = new Set<string>()
                const runLevelMetricIdsFromScenarioFallbackSet = new Set<string>()
                const unexpectedScenarioMetricIdsSet = new Set<string>()
                const missingScenarioIds = new Set<string>(uniqueScenarioIds)

                try {
                    const params = new URLSearchParams()
                    params.set("project_id", projectId)
                    const response = await axios.post(
                        `/preview/evaluations/metrics/refresh`,
                        {
                            metrics: {
                                run_id: runId,
                                scenario_ids: uniqueScenarioIds,
                            },
                        },
                        {
                            params,
                        },
                    )
                    const refreshedMetrics = Array.isArray(response.data?.metrics)
                        ? response.data.metrics
                        : []

                    refreshedMetrics.forEach((metric: any) => {
                        const metricId = metric?.id
                        const refreshedScenario = metric?.scenario_id ?? metric?.scenarioId ?? null
                        if (metricId && !refreshedScenario) {
                            runLevelMetricIdsFromScenarioRefreshSet.add(metricId)
                        }
                        if (
                            refreshedScenario &&
                            !uniqueScenarioIds.includes(refreshedScenario) &&
                            metricId
                        ) {
                            unexpectedScenarioMetricIdsSet.add(metricId)
                        }
                        if (refreshedScenario && detailByScenario.has(refreshedScenario)) {
                            const detail = detailByScenario.get(refreshedScenario)!
                            detail.attempts.push("batch")
                            detail.returnedCount += 1
                            if (metricId) {
                                detail.newMetricIds.add(metricId)
                                if (detail.oldMetricIds.includes(metricId)) {
                                    detail.reusedMetricIds.add(metricId)
                                }
                            }
                            missingScenarioIds.delete(refreshedScenario)
                        }
                    })
                } catch (error) {
                    console.warn("[EvalRunDetails2] Scenario metrics batch refresh failed", {
                        projectId,
                        runId,
                        source,
                        scenarioIds: uniqueScenarioIds,
                        error,
                    })
                }

                if (missingScenarioIds.size) {
                    for (const scenarioId of Array.from(missingScenarioIds)) {
                        try {
                            const params = new URLSearchParams()
                            params.set("project_id", projectId)
                            const response = await axios.post(
                                `/preview/evaluations/metrics/refresh`,
                                {
                                    metrics: {
                                        run_id: runId,
                                        scenario_id: scenarioId,
                                    },
                                },
                                {
                                    params,
                                },
                            )
                            const refreshedMetrics = Array.isArray(response.data?.metrics)
                                ? response.data.metrics
                                : []
                            const detail = detailByScenario.get(scenarioId)
                            refreshedMetrics.forEach((metric: any) => {
                                const metricId = metric?.id
                                const refreshedScenario =
                                    metric?.scenario_id ?? metric?.scenarioId ?? null
                                if (metricId && !refreshedScenario) {
                                    runLevelMetricIdsFromScenarioFallbackSet.add(metricId)
                                }
                                if (refreshedScenario === scenarioId && detail) {
                                    detail.attempts.push("fallback")
                                    detail.returnedCount += 1
                                    if (metricId) {
                                        detail.newMetricIds.add(metricId)
                                        if (detail.oldMetricIds.includes(metricId)) {
                                            detail.reusedMetricIds.add(metricId)
                                        }
                                    }
                                    missingScenarioIds.delete(scenarioId)
                                }
                            })
                        } catch (error) {
                            console.warn("[EvalRunDetails2] Scenario fallback refresh failed", {
                                projectId,
                                runId,
                                source,
                                scenarioId,
                                error,
                            })
                        }
                    }
                }

                scenarioRefreshDetails = Array.from(detailByScenario.values()).map((detail) => {
                    const newMetricIds = Array.from(detail.newMetricIds)
                    const reusedMetricIds = Array.from(detail.reusedMetricIds)
                    const staleMetricIds = detail.oldMetricIds.filter(
                        (id) => !reusedMetricIds.includes(id) && !newMetricIds.includes(id),
                    )

                    return {
                        scenarioId: detail.scenarioId,
                        reasons: detail.reasons,
                        oldMetricIds: detail.oldMetricIds,
                        newMetricIds,
                        reusedMetricIds,
                        staleMetricIds,
                        returnedCount: detail.returnedCount,
                        attempts: detail.attempts,
                    }
                })

                missingScenarioIdsAfterAttempts = scenarioRefreshDetails
                    .filter((detail) => detail.returnedCount === 0)
                    .map((detail) => detail.scenarioId)

                const scenarioRefreshed = scenarioRefreshDetails.some(
                    (detail) => detail.returnedCount > 0,
                )
                refreshed = refreshed || scenarioRefreshed

                runLevelMetricIdsFromScenarioRefresh = Array.from(
                    runLevelMetricIdsFromScenarioRefreshSet,
                )
                runLevelMetricIdsFromScenarioFallback = Array.from(
                    runLevelMetricIdsFromScenarioFallbackSet,
                )
                unexpectedScenarioMetricIds = Array.from(unexpectedScenarioMetricIdsSet)

                // console.info("[EvalRunDetails2] Scenario metrics refresh triggered", {
                //     projectId,
                //     runId,
                //     source,
                //     scenarioIds: uniqueScenarioIds,
                //     details: scenarioRefreshDetails,
                //     runLevelMetricIdsFromScenarioRefresh,
                //     runLevelMetricIdsFromScenarioFallback,
                //     unexpectedScenarioMetricIds,
                //     missingScenarioIdsAfterAttempts,
                // })
            }

            // Only attempt run-level refresh when there are actionable signals.
            // Allow a bootstrap attempt when the ONLY flag is "missing-run-level-entry"
            // and there are no scenario or run pending signals (prevents total suppression).
            const hasRunPending = pending.some(
                (entry) => entry.scope === "run" && entry.shouldRefresh,
            )
            const hasActionableRunFlag = runLevelFlags.some((f) => f !== "missing-run-level-entry")
            const hasScenarioSignals = scenarioIds.length > 0 || scenarioGaps.length > 0
            const hasMissingRunOnly =
                runLevelFlags.length > 0 &&
                runLevelFlags.every((f) => f === "missing-run-level-entry")

            // Option A: Track bootstrap attempts to prevent repeated refresh when backend returns empty
            const alreadyAttemptedBootstrap = bootstrapAttemptedRuns.has(runId)

            // Option C: Skip bootstrap for temporal/live evaluations that don't produce run-level metrics
            const canAttemptBootstrap =
                !isTemporalOnly && !alreadyAttemptedBootstrap && hasMissingRunOnly

            // Allow run-level refresh when:
            // 1. There's an actionable run flag (not just missing-run-level-entry)
            // 2. Can attempt bootstrap (only missing-run-level-entry flag, not temporal, not already attempted)
            //    even if there are scenario signals (scenarios with terminal status but missing metrics)
            const shouldRunRefresh =
                (!hasRunPending && hasActionableRunFlag) || (!hasRunPending && canAttemptBootstrap)

            if (shouldRunRefresh) {
                // Mark bootstrap attempt to prevent repeated tries
                if (canAttemptBootstrap) {
                    bootstrapAttemptedRuns.add(runId)
                }

                try {
                    const params = new URLSearchParams()
                    params.set("project_id", projectId)
                    const response = await axios.post(
                        `/preview/evaluations/metrics/refresh`,
                        {
                            metrics: {
                                run_id: runId,
                            },
                        },
                        {
                            params,
                        },
                    )
                    const refreshedMetrics = Array.isArray(response.data?.metrics)
                        ? response.data.metrics
                        : []
                    const runMetrics = refreshedMetrics.filter(
                        (metric: any) => !metric?.scenario_id && !metric?.scenarioId,
                    )
                    const newMetricIds = runMetrics
                        .map((metric: any) => metric?.id)
                        .filter((id): id is string => Boolean(id))
                    const runReasons = new Set<string>()
                    const runOldMetricIds = new Set<string>()
                    pending
                        .filter((entry) => entry.scope === "run")
                        .forEach((entry) => {
                            entry.reasons.forEach((reason) => runReasons.add(reason))
                            if (entry.metricId) runOldMetricIds.add(entry.metricId)
                        })

                    const oldMetricIdsArray = Array.from(runOldMetricIds)
                    const reusedRunMetricIds = newMetricIds.filter((id) => runOldMetricIds.has(id))
                    const staleRunMetricIds = oldMetricIdsArray.filter(
                        (id) => !reusedRunMetricIds.includes(id),
                    )

                    runRefreshDetails = {
                        reasons: Array.from(runReasons),
                        oldMetricIds: oldMetricIdsArray,
                        newMetricIds,
                        reusedMetricIds: reusedRunMetricIds,
                        staleMetricIds: staleRunMetricIds,
                        returnedCount: runMetrics.length,
                    }

                    refreshed = refreshed || runMetrics.length > 0

                    if (runMetrics.length > 0) {
                        console.info("[EvalRunDetails2] Run-level metrics refresh triggered", {
                            projectId,
                            runId,
                            source,
                            runLevelFlags,
                            details: runRefreshDetails,
                        })
                    } else {
                        console.debug("[EvalRunDetails2] Run-level metrics refresh returned 0", {
                            projectId,
                            runId,
                            source,
                            runLevelFlags,
                        })
                    }
                } catch (error) {
                    console.warn("[EvalRunDetails2] Run-level metrics refresh failed", {
                        projectId,
                        runId,
                        source,
                        runLevelFlags,
                        error,
                    })
                }
            }
        }

        const scenarioStaleMetricIds = scenarioRefreshDetails.flatMap(
            (detail) => detail.staleMetricIds,
        )
        const runStaleMetricIds = runRefreshDetails?.staleMetricIds ?? []
        const staleMetricIdsSet = new Set<string>([...scenarioStaleMetricIds, ...runStaleMetricIds])
        const scenarioReusedMetricIds = scenarioRefreshDetails.flatMap(
            (detail) => detail.reusedMetricIds,
        )
        const runReusedMetricIds = runRefreshDetails?.reusedMetricIds ?? []
        const flaggedMetricIds = Array.from(state.metricIds)

        flaggedMetricIds.forEach((metricId) => {
            if (
                !staleMetricIdsSet.has(metricId) &&
                !scenarioReusedMetricIds.includes(metricId) &&
                !runReusedMetricIds.includes(metricId)
            ) {
                staleMetricIdsSet.add(metricId)
            }
        })

        const staleMetricIds = Array.from(staleMetricIdsSet)
        const refreshedScenarioIds = scenarioRefreshDetails
            .filter((detail) => detail.returnedCount > 0)
            .map((detail) => detail.scenarioId)

        // console.info("[EvalRunDetails2] Metric processor flush (debug mode)", {
        //     projectId,
        //     runId,
        //     source,
        //     flaggedMetrics: pending.length,
        //     scenarioIds,
        //     metricIds,
        //     runLevelFlags,
        //     scenarioGaps,
        //     triggerRefresh,
        //     refreshed,
        //     scenarioRefreshDetails,
        //     runRefreshDetails,
        //     runLevelMetricIdsFromScenarioRefresh,
        //     runLevelMetricIdsFromScenarioFallback,
        //     unexpectedScenarioMetricIds,
        //     missingScenarioIdsAfterAttempts,
        //     refreshedScenarioIds,
        //     staleMetricIds,
        //     action: triggerRefresh ? "refresh-attempted" : "skipped-refresh",
        // })

        resetState()

        return {
            refreshed,
            deleted: false,
            staleMetricIds,
            refreshedScenarioIds,
            missingScenarioIdsAfterAttempts,
            scenarioRefreshDetails,
            runRefreshDetails,
            runLevelMetricIdsFromScenarioRefresh,
            runLevelMetricIdsFromScenarioFallback,
            unexpectedScenarioMetricIds,
        }
    }

    return {
        processMetric,
        markRunLevelGap,
        markScenarioGap,
        getPendingActions,
        flush,
    }
}
