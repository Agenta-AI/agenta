import type {Atom} from "jotai"

import type {BasicStats} from "@/oss/lib/metricUtils"

export type RunLevelStatsMap = Record<string, BasicStats>

export interface TemporalMetricPoint {
    timestamp: number
    stats: BasicStats
}

export interface RunMetricsBatchRequest {
    projectId: string
    runId: string
    includeTemporal?: boolean
}

export type LoadableState<T> =
    | {state: "loading"}
    | {state: "hasError"; error: unknown}
    | {state: "hasData"; data: T}

export interface RunLevelMetricSelection {
    state: LoadableState<BasicStats | undefined>["state"]
    stats?: BasicStats
    resolvedKey?: string
    error?: unknown
}

export interface PreviewRunMetricStatsQueryArgs {
    runId: string
    includeTemporal?: boolean
}

export interface PreviewRunMetricStatsSelectorArgs {
    runId: string
    metricKey?: string
    metricPath?: string
    stepKey?: string
    includeTemporal?: boolean
}

export type RunMetricSelectorAtom = Atom<RunLevelMetricSelection>

export type MetricScope = "run" | "scenario"

export interface MetricShapeSummary {
    id: string | null
    scenarioId: string | null
    status: string | null
    keyCount: number
    sampleKeys: string[]
    sampleData: Record<string, any>
    canonicalSampleKeys: string[]
}

export interface MetricProcessorOptions {
    projectId: string
    runId: string
    source: string
}

export interface MetricProcessorFlushOptions {
    triggerRefresh?: boolean
    /** If true, this is a temporal/live evaluation that doesn't produce run-level metrics */
    isTemporalOnly?: boolean
}

export interface MetricProcessorResult {
    metricId: string | null
    scenarioId: string | null
    scope: MetricScope
    status: string | null
    reasons: string[]
    summary: MetricShapeSummary
    shouldRefresh: boolean
    shouldDelete: boolean
}

export interface ScenarioRefreshDetailResult {
    scenarioId: string
    reasons: string[]
    oldMetricIds: string[]
    newMetricIds: string[]
    reusedMetricIds: string[]
    staleMetricIds: string[]
    returnedCount: number
    attempts: string[]
}

export interface RunRefreshDetailResult {
    reasons: string[]
    oldMetricIds: string[]
    newMetricIds: string[]
    reusedMetricIds: string[]
    staleMetricIds: string[]
    returnedCount: number
}

export interface MetricProcessorFlushResult {
    refreshed: boolean
    deleted: boolean
    staleMetricIds: string[]
    refreshedScenarioIds: string[]
    missingScenarioIdsAfterAttempts: string[]
    scenarioRefreshDetails: ScenarioRefreshDetailResult[]
    runRefreshDetails: RunRefreshDetailResult | null
    runLevelMetricIdsFromScenarioRefresh: string[]
    runLevelMetricIdsFromScenarioFallback: string[]
    unexpectedScenarioMetricIds: string[]
}

export interface MetricProcessor {
    processMetric: (metric: any, scope: MetricScope) => MetricProcessorResult
    markRunLevelGap: (reason: string) => void
    markScenarioGap: (scenarioId: string, reason: string) => void
    getPendingActions: () => {
        pending: MetricProcessorResult[]
        scenarioIds: string[]
        metricIds: string[]
        runLevelFlags: string[]
        scenarioGaps: {scenarioId: string; reason: string}[]
    }
    flush: (options?: MetricProcessorFlushOptions) => Promise<MetricProcessorFlushResult>
}
