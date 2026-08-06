import type {BasicStats} from "@/oss/lib/metricUtils"

export interface AggregatedMetricEntrySummary {
    value: number
    formatted: string
    type: "boolean" | "numeric"
}

export interface AggregatedMetricChartEntry {
    runKey: string
    runId: string
    runName: string
    color: string
    stats: BasicStats
    scenarioCount?: number
    summary?: AggregatedMetricEntrySummary
}

export interface AggregatedMetricChartData {
    id: string
    label: string
    evaluatorLabel: string
    evaluatorRef?: {id?: string | null; slug?: string | null} | null
    entries: AggregatedMetricChartEntry[]
}
