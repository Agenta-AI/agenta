import type {ReferenceColumnDescriptor} from "../utils/referenceSchema"

import type {RunMetricDescriptor} from "./runMetrics"

export interface ReferenceColumnExportMetadata {
    type: "reference"
    descriptor: ReferenceColumnDescriptor
}

export interface MetricColumnExportMetadata {
    type: "metric"
    descriptor: RunMetricDescriptor
    groupLabel?: string | null
}

export interface CreatedByColumnExportMetadata {
    type: "createdBy"
}

export interface RunNameColumnExportMetadata {
    type: "runName"
}

export type EvaluationRunsColumnExportMetadata =
    | ReferenceColumnExportMetadata
    | MetricColumnExportMetadata
    | CreatedByColumnExportMetadata
    | RunNameColumnExportMetadata
