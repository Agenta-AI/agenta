/**
 * EvaluationRun Entity Schemas
 *
 * Zod schemas for evaluation run entities returned by the
 * `/preview/evaluations/runs/` API.
 *
 * @packageDocumentation
 */

import {z} from "zod"

import {auditFieldsSchema, timestampFieldsSchema} from "../../shared"

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
 * `GET /preview/evaluations/runs/{run_id}`
 */
export const evaluationRunResponseSchema = z.object({
    count: z.number(),
    run: evaluationRunSchema.nullable().optional(),
})
export type EvaluationRunResponse = z.infer<typeof evaluationRunResponseSchema>

/**
 * Multi-run query response envelope.
 * `POST /preview/evaluations/runs/query`
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
 * Fetched via `POST /preview/evaluations/results/query`.
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
