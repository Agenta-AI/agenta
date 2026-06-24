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

// These string-union "kinds" are deliberately validated as plain `z.string()`, NOT
// `z.enum([...])`. The backend mounts run payloads with `extra="allow"` and its taxonomy
// drifts (e.g. mapping `kind` emits "testset"/"invocation", not the older
// "input"/"ground_truth"/... set). A `z.enum` here is catastrophic: these fields sit deep
// inside the optional `data.steps[]` / `data.mappings[]` tree, and a single unrecognized
// value fails the ENTIRE run parse, which fails the whole `runs: z.array(...)` batch ->
// `safeParseWithLogging` returns null -> the run table renders blank cells. We keep the
// known values as documented unions (for autocomplete) but never reject unknown strings.
export const EVALUATION_RUN_STEP_TYPES = ["input", "invocation", "annotation"] as const
export const evaluationRunStepTypeSchema = z.string()
export type EvaluationRunStepType = (typeof EVALUATION_RUN_STEP_TYPES)[number] | (string & {})

export const EVALUATION_RUN_STEP_ORIGINS = ["custom", "human", "auto"] as const
export const evaluationRunStepOriginSchema = z.string()
export type EvaluationRunStepOrigin = (typeof EVALUATION_RUN_STEP_ORIGINS)[number] | (string & {})

export const EVALUATION_RUN_MAPPING_KINDS = [
    "testset",
    "invocation",
    "annotation",
    // legacy / alternate taxonomy still accepted defensively
    "input",
    "ground_truth",
    "application",
    "evaluator",
] as const
export const evaluationRunMappingKindSchema = z.string()
export type EvaluationRunMappingKind = (typeof EVALUATION_RUN_MAPPING_KINDS)[number] | (string & {})

// ============================================================================
// SUB-SCHEMAS
// ============================================================================

// NOTE: every object schema in this file uses `.passthrough()` so unknown backend
// fields survive validation instead of being silently stripped. The backend mounts
// these payloads with `extra="allow"`, and downstream consumers (e.g. the OSS
// EvalRunDetails run enrichment: buildRunIndex, evaluator-ref patching) read fields
// beyond what this schema declares. Stripping them would silently lose data. Known
// fields are still strictly validated; this is a validator, not a field filter.
export const evaluationRunStepInputSchema = z
    .object({
        key: z.string(),
    })
    .passthrough()

export const evaluationRunStepReferenceSchema = z
    .object({
        id: z.string(),
        slug: z.string().nullable().optional(),
        version: z.coerce.number().nullable().optional(),
    })
    .passthrough()

export const evaluationRunDataStepSchema = z
    .object({
        key: z.string(),
        type: evaluationRunStepTypeSchema,
        origin: evaluationRunStepOriginSchema.nullable().optional(),
        inputs: z.array(evaluationRunStepInputSchema).nullable().optional(),
        references: z.record(z.string(), evaluationRunStepReferenceSchema).nullable().optional(),
    })
    .passthrough()
export type EvaluationRunDataStep = z.infer<typeof evaluationRunDataStepSchema>

export const evaluationRunDataMappingSchema = z
    .object({
        column: z
            .object({
                kind: evaluationRunMappingKindSchema.nullable().optional(),
                name: z.string().nullable().optional(),
            })
            .passthrough()
            .nullable()
            .optional(),
        step: z
            .object({
                key: z.string(),
                path: z.string().nullable().optional(),
            })
            .passthrough()
            .nullable()
            .optional(),
    })
    .passthrough()
export type EvaluationRunDataMapping = z.infer<typeof evaluationRunDataMappingSchema>

export const evaluationRunDataSchema = z
    .object({
        steps: z.array(evaluationRunDataStepSchema).nullable().optional(),
        repeats: z.number().nullable().optional(),
        mappings: z.array(evaluationRunDataMappingSchema).nullable().optional(),
    })
    .passthrough()
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
    .passthrough()

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

// NOTE: EvaluationScenario schemas were promoted to a first-class entity —
// see @agenta/entities/evaluationScenario.

// ============================================================================
// EVALUATION RESULT (SCENARIO STEP) SCHEMAS
// ============================================================================

/**
 * A single evaluation result — represents one step's output for a scenario.
 * Each result links a scenario to a trace via `trace_id` and `span_id`.
 *
 * Fetched via `POST /evaluations/results/query`.
 */
export const evaluationResultSchema = z
    .object({
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
    .passthrough()
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
    .passthrough()

export type EvaluationMetric = z.infer<typeof evaluationMetricSchema>

/**
 * Response envelope for evaluation metrics query.
 */
export const evaluationMetricsResponseSchema = z.object({
    count: z.number().optional().default(0),
    metrics: z.array(evaluationMetricSchema).default([]),
})
export type EvaluationMetricsResponse = z.infer<typeof evaluationMetricsResponseSchema>
