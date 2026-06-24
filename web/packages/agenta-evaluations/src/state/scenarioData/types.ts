/**
 * Generic scenario-data types for the evaluations engine.
 *
 * Relocated faithfully from `@agenta/annotation`'s session controller / types,
 * adapting only the keying (no queue concepts, no session reads). These are the
 * GENERIC, source-agnostic shapes keyed purely by `{projectId, runId, scenarioId}`.
 */

/**
 * A column definition derived from an evaluation run mapping + annotation step.
 * Used by list views to build mapping-driven table columns.
 *
 * Relocated from `AnnotationColumnDef` (annotation/types.ts), renamed to
 * `EvaluatorColumnDef` — the shape is identical.
 */
export interface EvaluatorColumnDef {
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
    /** Evaluator revision ID from the annotation step's references */
    evaluatorRevisionId: string | null
    /** Evaluator slug from step refs, step key, or mapping column fallback */
    evaluatorSlug: string | null
}

/**
 * Evaluator references embedded in an evaluation run annotation step.
 * Preserves the run's pinned revision while keeping workflow IDs available
 * for downstream payloads.
 */
export interface EvaluatorStepRef {
    workflowId?: string | null
    variantId?: string | null
    revisionId?: string | null
    slug?: string | null
    stepKey?: string | null
}

/**
 * Key for compound evaluator-scoped selectors.
 * Used to look up metric data for a specific evaluator within a scenario.
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
 * GENERIC version: value + stats resolved from metrics only (no annotation lookup).
 */
export interface ScenarioMetricForEvaluator {
    value: unknown
    stats: Record<string, unknown> | undefined
}

/**
 * Metrics data for a single scenario, fetched from
 * `POST /evaluations/metrics/query`.
 *
 * `raw`  — nested metric data as returned by the API (merged across entries).
 * `flat` — flattened key→value map for easy column lookup.
 */
export interface ScenarioMetricData {
    raw: Record<string, unknown>
    flat: Record<string, unknown>
    /** Full metric stats objects keyed the same as `flat`, for distribution rendering */
    stats: Record<string, Record<string, unknown>>
}
