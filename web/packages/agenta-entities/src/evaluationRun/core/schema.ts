/**
 * EvaluationRun Entity Schemas
 *
 * Zod schemas for evaluation run entities returned by the
 * `/evaluations/runs/` API.
 *
 * @packageDocumentation
 */

import {z} from "zod"

// Import from the pure zodSchema source rather than the shared barrel. The
// shared barrel transitively re-exports paginated/table helpers that depend on
// agenta-ui (CSS modules), which breaks Node-side execution. Schemas must stay
// Node-safe so they can be reused in scripts, tests, and ETL adapters.
import {auditFieldsSchema, timestampFieldsSchema} from "../../shared/utils/zodSchema"

// ============================================================================
// ENUMS
// ============================================================================

export const evaluationRunStepTypeSchema = z.enum(["input", "invocation", "annotation"])
export type EvaluationRunStepType = z.infer<typeof evaluationRunStepTypeSchema>

export const evaluationRunStepOriginSchema = z.enum(["custom", "human", "auto"])
export type EvaluationRunStepOrigin = z.infer<typeof evaluationRunStepOriginSchema>

export const evaluationRunMappingKindSchema = z.enum([
    "input",
    "ground_truth",
    "application",
    "evaluator",
    "annotation",
])
export type EvaluationRunMappingKind = z.infer<typeof evaluationRunMappingKindSchema>

// ============================================================================
// SUB-SCHEMAS
// ============================================================================

export const evaluationRunStepInputSchema = z.object({
    key: z.string(),
})

export const evaluationRunStepReferenceSchema = z.object({
    id: z.string(),
    slug: z.string().nullable().optional(),
    version: z.coerce.number().nullable().optional(),
})

export const evaluationRunDataStepSchema = z.object({
    key: z.string(),
    type: evaluationRunStepTypeSchema,
    origin: evaluationRunStepOriginSchema.nullable().optional(),
    inputs: z.array(evaluationRunStepInputSchema).nullable().optional(),
    references: z.record(z.string(), evaluationRunStepReferenceSchema).nullable().optional(),
})
export type EvaluationRunDataStep = z.infer<typeof evaluationRunDataStepSchema>

export const evaluationRunDataMappingSchema = z.object({
    column: z
        .object({
            kind: evaluationRunMappingKindSchema.nullable().optional(),
            name: z.string().nullable().optional(),
        })
        .nullable()
        .optional(),
    step: z
        .object({
            key: z.string(),
            path: z.string().nullable().optional(),
        })
        .nullable()
        .optional(),
})
export type EvaluationRunDataMapping = z.infer<typeof evaluationRunDataMappingSchema>

export const evaluationRunDataSchema = z.object({
    steps: z.array(evaluationRunDataStepSchema).nullable().optional(),
    repeats: z.number().nullable().optional(),
    mappings: z.array(evaluationRunDataMappingSchema).nullable().optional(),
})
export type EvaluationRunData = z.infer<typeof evaluationRunDataSchema>

export const evaluationRunFlagsSchema = z.record(z.string(), z.unknown()).nullable().optional()
export type EvaluationRunFlags = z.infer<typeof evaluationRunFlagsSchema>

// ============================================================================
// MAIN ENTITY SCHEMA
// ============================================================================

export const evaluationRunSchema = z
    .object({
        // Identifier
        id: z.string(),

        // Header
        name: z.string().nullable().optional(),
        description: z.string().nullable().optional(),

        // Flags
        flags: evaluationRunFlagsSchema,

        // Status
        status: z.string().nullable().optional(),

        // Data
        data: evaluationRunDataSchema.nullable().optional(),

        // Metadata
        tags: z.array(z.string()).nullable().optional(),
        meta: z.record(z.string(), z.unknown()).nullable().optional(),
    })
    .merge(timestampFieldsSchema)
    .merge(auditFieldsSchema)

export type EvaluationRun = z.infer<typeof evaluationRunSchema>

// ============================================================================
// RESPONSE SCHEMAS
// ============================================================================

/**
 * Single run response envelope.
 * `GET /evaluations/runs/{run_id}`
 */
export const evaluationRunResponseSchema = z.object({
    count: z.number(),
    run: evaluationRunSchema.nullable().optional(),
})
export type EvaluationRunResponse = z.infer<typeof evaluationRunResponseSchema>

/**
 * Multi-run query response envelope.
 * `POST /evaluations/runs/query`
 */
export const evaluationRunsResponseSchema = z.object({
    count: z.number(),
    runs: z.array(evaluationRunSchema),
})
export type EvaluationRunsResponse = z.infer<typeof evaluationRunsResponseSchema>

// ============================================================================
// EVALUATION RESULT (SCENARIO STEP) SCHEMAS
// ============================================================================

/**
 * A single evaluation result — represents one step's output for a scenario.
 * Each result links a scenario to a trace via `trace_id` and `span_id`.
 *
 * Fetched via `POST /evaluations/results/query`.
 */
export const evaluationResultSchema = z.object({
    id: z.string().optional(),
    run_id: z.string(),
    scenario_id: z.string(),
    step_key: z.string(),
    status: z.string().nullable().optional(),
    trace_id: z.string().nullable().optional(),
    span_id: z.string().nullable().optional(),
    testcase_id: z.string().nullable().optional(),
    references: z.record(z.string(), z.unknown()).nullable().optional(),
    data: z.record(z.string(), z.unknown()).nullable().optional(),
    error: z.record(z.string(), z.unknown()).nullable().optional(),
})
export type EvaluationResult = z.infer<typeof evaluationResultSchema>

/**
 * Response envelope for evaluation results query.
 */
export const evaluationResultsResponseSchema = z.object({
    count: z.number().optional().default(0),
    results: z.array(evaluationResultSchema).default([]),
})
export type EvaluationResultsResponse = z.infer<typeof evaluationResultsResponseSchema>

// ============================================================================
// EVALUATION METRIC SCHEMAS
// ============================================================================

/**
 * A single evaluation metric — carries the actual scores / stat blobs for a
 * scenario (when `scenario_id` is set) or for the whole run (when null = aggregate).
 *
 * `data` is a nested dict keyed by step_key, with values that are either raw
 * scores or stat objects (e.g. `{type: "numeric/continuous", mean: 7.5, ...}` or
 * `{type: "binary", freq: [...]}`). The shape of `data` is run-specific and
 * driven by run.data.mappings — consumers should join through mappings to
 * resolve column names.
 *
 * Fetched via `POST /evaluations/metrics/query`.
 */
export const evaluationMetricSchema = z
    .object({
        id: z.string(),
        run_id: z.string(),
        // null on run-level aggregates, populated on per-scenario metrics
        scenario_id: z.string().nullable().optional(),
        status: z.string().nullable().optional(),
        // Used for temporal metrics; null on point-in-time metrics
        interval: z.number().nullable().optional(),
        timestamp: z.string().nullable().optional(),
        // The actual values keyed by step_key → mapping path
        data: z.record(z.string(), z.unknown()).nullable().optional(),
        flags: z.record(z.string(), z.unknown()).nullable().optional(),
        tags: z.array(z.string()).nullable().optional(),
        meta: z.record(z.string(), z.unknown()).nullable().optional(),
    })
    .merge(timestampFieldsSchema)
    .merge(auditFieldsSchema)

export type EvaluationMetric = z.infer<typeof evaluationMetricSchema>

/**
 * Response envelope for evaluation metrics query.
 */
export const evaluationMetricsResponseSchema = z.object({
    count: z.number().optional().default(0),
    metrics: z.array(evaluationMetricSchema).default([]),
})
export type EvaluationMetricsResponse = z.infer<typeof evaluationMetricsResponseSchema>
