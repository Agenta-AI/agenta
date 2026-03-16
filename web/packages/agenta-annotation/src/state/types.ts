import type {Annotation} from "@agenta/entities/annotation"
import type {QueueType} from "@agenta/entities/queue"

/**
 * The active view in the annotation session.
 * - "list": IVT table showing all scenarios with status indicators
 * - "annotate": Focus view — one item at a time with annotation panel
 * - "configuration": Queue configuration (name, description, evaluators, settings)
 */
export type SessionView = "list" | "annotate" | "configuration"

/**
 * Payload for opening a queue for annotation.
 */
export interface OpenQueuePayload {
    queueId: string
    queueType: QueueType
    /** Optional pre-fetched scenario IDs (avoids extra API call) */
    scenarioIds?: string[]
    /** Optional initial view from route state. */
    initialView?: SessionView
    /** Optional initial focused scenario from route state. */
    initialScenarioId?: string | null
}

export interface ApplyRouteStatePayload {
    view?: SessionView
    scenarioId?: string | null
}

/**
 * Session progress information.
 */
export interface AnnotationProgress {
    /** Total number of scenarios */
    total: number
    /** Number of completed annotations */
    completed: number
    /** Remaining items */
    remaining: number
    /** Current position (0-indexed) */
    currentIndex: number
}

/**
 * Callbacks for annotation session side-effects.
 * Used by platform-specific code (OSS/EE) to react to session events.
 */
export interface AnnotationSessionCallbacks {
    onQueueOpened?: (queueId: string, queueType: QueueType) => void
    onAnnotationSubmitted?: (scenarioId: string) => void
    onSessionClosed?: () => void
    onNavigate?: (scenarioId: string, index: number) => void
}

// ============================================================================
// ANNOTATION COLUMN DEFINITIONS (derived from evaluation run mappings)
// ============================================================================

/**
 * A column definition derived from an evaluation run mapping + annotation step.
 * Used by ScenarioListView to build mapping-driven table columns.
 */
export interface AnnotationColumnDef {
    /** Step key from the mapping (e.g. "evaluator-3f4fd5293619") */
    stepKey: string
    /** Column display name from mapping.column.name (e.g. "outputs") */
    columnName: string | null
    /** Column kind from mapping.column.kind (e.g. "annotation") */
    columnKind: string | null
    /** Data path from mapping.step.path (e.g. "attributes.ag.data.outputs.outputs") */
    path: string | null
    /** Evaluator workflow ID from the annotation step's references */
    evaluatorId: string | null
    /** Evaluator slug from the annotation step's references */
    evaluatorSlug: string | null
}

// ============================================================================
// SCENARIO LIST COLUMN DEFINITIONS
// ============================================================================

/**
 * Discriminated union of column types for the scenario list table.
 * The `columnType` field determines how the presentation layer renders each column.
 */
export type ScenarioListColumnDef =
    | IndexColumnDef
    | TraceNameColumnDef
    | TraceInputGroupColumnDef
    | TraceOutputColumnDef
    | TestcaseColumnDef
    | AnnotationDataColumnDef
    | StatusColumnDef
    | ActionsColumnDef

interface BaseColumnDef {
    key: string
    title: string
    width: number
    fixed?: "left" | "right"
}

export interface IndexColumnDef extends BaseColumnDef {
    columnType: "index"
}

export interface TraceNameColumnDef extends BaseColumnDef {
    columnType: "trace-name"
}

export interface TraceInputGroupColumnDef extends BaseColumnDef {
    columnType: "trace-input-group"
    /** Individual input keys to show as sub-columns. Empty = show all inputs in one column. */
    inputKeys: string[]
}

export interface TraceOutputColumnDef extends BaseColumnDef {
    columnType: "trace-output"
}

export interface TestcaseColumnDef extends BaseColumnDef {
    columnType: "testcase-input" | "testcase-output" | "testcase-expected"
    /** Key to read from scenario record (supports "meta.xxx" paths) */
    dataKey: string
}

export interface AnnotationDataColumnDef extends BaseColumnDef {
    columnType: "annotation"
    annotationDef: AnnotationColumnDef
    /** Output keys from the evaluator's output schema (used for sub-columns). */
    outputKeys: string[]
}

export interface StatusColumnDef extends BaseColumnDef {
    columnType: "status"
}

export interface ActionsColumnDef extends BaseColumnDef {
    columnType: "actions"
}

// ============================================================================
// ANNOTATION FORM CONTROLLER TYPES
// ============================================================================

/**
 * A single annotation metric field with value and schema metadata.
 */
export interface AnnotationMetricField {
    value: unknown
    type?: string | string[]
    minimum?: number
    maximum?: number
    enum?: unknown[]
    items?: {
        type?: string
        enum?: string[]
    }
    [key: string]: unknown
}

/**
 * Annotation metrics grouped by evaluator slug, then by field key.
 */
export type AnnotationMetrics = Record<string, Record<string, AnnotationMetricField>>

/**
 * Context for a scenario: its annotations and trace/span references.
 */
export interface ScenarioContext {
    scenarioId: string
    annotations: Annotation[]
    traceId: string
    spanId: string
}

/**
 * Payload for updating a single metric field.
 */
export interface UpdateMetricPayload {
    scenarioId: string
    slug: string
    fieldKey: string
    value: unknown
}

/**
 * Payload for submitting annotations.
 */
export interface SubmitAnnotationsPayload {
    scenarioId: string
    queueId: string
    markComplete?: boolean
}

// ============================================================================
// COMPOUND SELECTOR TYPES
// ============================================================================

/**
 * Key for compound evaluator-scoped selectors.
 * Used to look up annotation/metric data for a specific evaluator within a scenario.
 */
export interface ScenarioEvaluatorKey {
    scenarioId: string
    evaluatorId?: string | null
    evaluatorSlug?: string | null
    path?: string | null
    stepKey?: string | null
}

/**
 * Resolved metric data for a specific evaluator in a scenario.
 * Combines annotation value, metric fallback, and stats in one object.
 */
export interface ScenarioMetricForEvaluator {
    value: unknown
    stats: Record<string, unknown> | undefined
    annotation: Annotation | null
}
