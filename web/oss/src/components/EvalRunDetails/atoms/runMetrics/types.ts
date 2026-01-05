/**
 * Types for the metric processor used in evaluation run details.
 */

export type MetricScope = "scenario" | "run"

export interface MetricShapeSummary {
    id: string | null
    scenarioId: string | null
    status: string | null
    keyCount: number
    sampleKeys: string[]
    sampleData: Record<string, any>
    canonicalSampleKeys: string[]
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

export interface MetricProcessorOptions {
    projectId: string
    runId: string
    source: string
}

export interface MetricProcessorFlushOptions {
    triggerRefresh?: boolean
    isTemporalOnly?: boolean
}

export interface ScenarioRefreshDetailResult {
    scenarioId: string
    reasons: string[]
    oldMetricIds: string[]
    newMetricIds: string[]
    reusedMetricIds: string[]
    returnedCount: number
    attempts: string[]
}

export interface RunRefreshDetailResult {
    reasons: string[]
    oldMetricIds: string[]
    newMetricIds: string[]
    reusedMetricIds: string[]
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

export interface ScenarioContext {
    hasInvocation?: boolean
    hasAnnotation?: boolean
}

export interface MetricProcessor {
    processMetric: (metric: any, scope: MetricScope) => MetricProcessorResult
    markRunLevelGap: (reason: string) => void
    markScenarioGap: (
        scenarioId: string,
        reason: string,
        scenarioStatus?: string | null,
        scenarioContext?: ScenarioContext,
    ) => void
    getPendingActions: () => {
        pending: MetricProcessorResult[]
        scenarioIds: string[]
        metricIds: string[]
        runLevelFlags: string[]
        scenarioGaps: {scenarioId: string; reason: string}[]
    }
    flush: (options?: MetricProcessorFlushOptions) => Promise<MetricProcessorFlushResult>
}
