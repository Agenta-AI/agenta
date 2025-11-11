import {BasicStats, SchemaMetricType} from "@/oss/lib/metricUtils"

import {TableColumn} from "../types"

export interface MetricCellProps {
    scenarioId: string
    metricKey: string
    fullKey?: string
    value: any
    distInfo?: Record<string, BasicStats> | Promise<Record<string, BasicStats>>
    metricType?: SchemaMetricType
    isComparisonMode?: boolean
}

export interface MetricValueCellProps {
    scenarioId: string
    metricKey: string
    fallbackKey?: string
    fullKey?: string
    distInfo?: Record<string, BasicStats> | Promise<Record<string, BasicStats>>
    metricType?: SchemaMetricType
    evalType?: "auto" | "human"
    runId?: string
}

export interface AnnotationValueCellProps {
    scenarioId: string
    fieldPath: string // e.g. "data.outputs.isGood"
    metricKey: string
    fullKey?: string
    distInfo?: Record<string, BasicStats> | Promise<Record<string, BasicStats>>
    metricType?: SchemaMetricType
    stepKey?: string
    name?: string
}

export interface CollapsedAnnotationValueCellProps {
    scenarioId: string
    childrenDefs: TableColumn[]
    runId?: string
}
