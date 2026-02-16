import {SchemaMetricType} from "@/oss/lib/metricUtils"

export interface BaseColumn {
    name: string
    title: string
    key: string
    kind: string
    path: string
    fallbackPath?: string
    stepKey: string
    stepKeyByRunId?: Record<string, string | undefined>
    metricType: SchemaMetricType
    children?: TableColumn[]
}

export interface TableColumn extends BaseColumn {
    children?: TableColumn[]
}
