export type EvaluationColumnKind =
    | "meta"
    | "testset"
    | "query"
    | "invocation"
    | "annotation"
    | "evaluator"
    | "metric"

export interface EvaluationTableColumn {
    /** Unique id used by the table component */
    id: string
    /** Display label */
    label: string
    /** Optional pre-formatted label for display */
    displayLabel?: string
    /** Column kind as returned by the backend mapping */
    kind: EvaluationColumnKind
    /** Step key that provides the value for this column */
    stepKey?: string
    /** Dot-path describing how to resolve the value inside the step */
    path: string
    /** Dot-path segmented for convenience */
    pathSegments?: string[]
    /** Step role resolved from the run index (input | invocation | annotation) */
    stepType: "meta" | "input" | "invocation" | "annotation" | "metric"
    /** Group identifier the column belongs to */
    groupId?: string
    /** Stable order hint for column placement */
    order?: number
    /** Preferred width hints for virtual table */
    width?: number
    minWidth?: number
    /** Sticky placement hints */
    sticky?: "left" | "right"
    /** Evaluation types the column should be visible for */
    visibleFor?: Array<"auto" | "human">
    /** Last segment of the path used for quick lookups */
    valueKey?: string
    /** Metric key (for annotation columns) */
    metricKey?: string
    /** Metric data type */
    metricType?: string
    /** Evaluator metadata (when applicable) */
    evaluatorId?: string
    evaluatorSlug?: string
    evaluatorName?: string
    /** Meta column semantic role */
    metaRole?: "scenarioIndexStatus" | "action" | "other"
    /** Sorting and UX helpers */
    isSortable?: boolean
    description?: string
}

export interface MetricColumnDefinition {
    name: string
    kind: "metric"
    path: string
    stepKey: string
    metricType: string
    displayLabel?: string
    description?: string
}

export type EvaluationColumnGroupKind = "meta" | "input" | "invocation" | "annotation" | "metric"

export interface EvaluationTableColumnGroup {
    id: string
    label: string
    kind: EvaluationColumnGroupKind
    columnIds: string[]
    order?: number
    description?: string
    /** Optional static metric definitions associated with this group */
    staticMetricColumns?: MetricColumnDefinition[]
    /** Optional metadata for advanced rendering */
    meta?: Record<string, any>
}

export interface EvaluatorDefinition {
    id: string
    name: string
    slug?: string
    description?: string | null
    version?: number | string | null
    metrics: MetricColumnDefinition[]
    raw?: any
}

export interface EvaluationTableColumnsResult {
    columns: EvaluationTableColumn[]
    groups: EvaluationTableColumnGroup[]
    staticMetricColumns: {
        auto: MetricColumnDefinition[]
        human: MetricColumnDefinition[]
    }
    evaluators: EvaluatorDefinition[]
    ungroupedColumns: EvaluationTableColumn[]
}

export interface EvaluationScenarioRow {
    id: string
    status: string
    createdAt: string
    updatedAt: string
    createdById?: string
    updatedById?: string
    testcaseId?: string | null
}

export interface WindowingState {
    next: string | null
    stop?: string | null
    order?: string | null
    limit?: number | null
}

export interface ScenarioRowsQueryResult {
    rows: EvaluationScenarioRow[]
    totalCount: number | null
    hasMore: boolean
    nextOffset: number | null
    nextCursor: string | null
    nextWindowing: WindowingState | null
}
