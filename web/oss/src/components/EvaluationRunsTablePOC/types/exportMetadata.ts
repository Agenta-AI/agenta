import type {ReferenceColumnDescriptor} from "../utils/referenceSchema"
import type {RunMetricDescriptor} from "./runMetrics"

export type ReferenceColumnExportMetadata = {
    type: "reference"
    descriptor: ReferenceColumnDescriptor
}

export type MetricColumnExportMetadata = {
    type: "metric"
    descriptor: RunMetricDescriptor
    groupLabel?: string | null
}

export type CreatedByColumnExportMetadata = {
    type: "createdBy"
}

export type RunNameColumnExportMetadata = {
    type: "runName"
}

export type EvaluationRunsColumnExportMetadata =
    | ReferenceColumnExportMetadata
    | MetricColumnExportMetadata
    | CreatedByColumnExportMetadata
    | RunNameColumnExportMetadata
