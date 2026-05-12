/**
 * EvaluationQueue Entity Schemas
 *
 * Zod schemas for validation and type safety of EvaluationQueue entities.
 * Maps to the backend `EvaluationQueue` DTO at `/evaluations/queues/`.
 *
 * @packageDocumentation
 */

import {z} from "zod"

import {timestampFieldsSchema, auditFieldsSchema} from "../../shared"

// Re-export shared evaluation status from simpleQueue
export {evaluationStatusSchema, type EvaluationStatus} from "../../simpleQueue/core/schema"

// ============================================================================
// SUB-SCHEMAS
// ============================================================================

/**
 * EvaluationQueueFlags.
 * Maps to backend `EvaluationQueueFlags`.
 */
export const evaluationQueueFlagsSchema = z
    .object({
        is_sequential: z.boolean().optional().default(false),
    })
    .nullable()
    .optional()

export type EvaluationQueueFlags = z.infer<typeof evaluationQueueFlagsSchema>

/**
 * EvaluationQueueData — the data payload of an evaluation queue.
 * Maps to backend `EvaluationQueueData`.
 */
export const evaluationQueueDataSchema = z.object({
    /** User assignments per repeat: [[user_a, user_b], [user_c]] */
    user_ids: z.array(z.array(z.string())).nullable().optional(),
    /** Scenario IDs assigned to this queue */
    scenario_ids: z.array(z.string()).nullable().optional(),
    /** Step keys for evaluator steps */
    step_keys: z.array(z.string()).nullable().optional(),
    /** Batch size for sequential assignment */
    batch_size: z.number().nullable().optional(),
    /** Starting offset for batch assignment */
    batch_offset: z.number().nullable().optional(),
})

export type EvaluationQueueData = z.infer<typeof evaluationQueueDataSchema>

// ============================================================================
// EVALUATION QUEUE SCHEMA
// ============================================================================

/**
 * EvaluationQueue entity schema.
 * Maps to backend `EvaluationQueue(Version, Identifier, Lifecycle, Header, Metadata)`.
 */
export const evaluationQueueSchema = z
    .object({
        // Identifier
        id: z.string(),

        // Version
        version: z.string().nullable().optional(),

        // Header
        name: z.string().nullable().optional(),
        description: z.string().nullable().optional(),

        // Flags
        flags: evaluationQueueFlagsSchema,

        // Status
        status: z.string().nullable().optional(),

        // Data payload
        data: evaluationQueueDataSchema.nullable().optional(),

        // Parent evaluation run ID
        run_id: z.string(),

        // Metadata
        tags: z.array(z.string()).nullable().optional(),
        meta: z.record(z.string(), z.unknown()).nullable().optional(),
    })
    .merge(timestampFieldsSchema)
    .merge(auditFieldsSchema)

export type EvaluationQueue = z.infer<typeof evaluationQueueSchema>

// ============================================================================
// RESPONSE SCHEMAS
// ============================================================================

/**
 * Single queue response.
 * Matches backend `EvaluationQueueResponse`.
 */
export const evaluationQueueResponseSchema = z.object({
    count: z.number().optional().default(0),
    queue: evaluationQueueSchema.nullable().optional(),
})

export type EvaluationQueueResponse = z.infer<typeof evaluationQueueResponseSchema>

/**
 * Multiple queues response.
 * Matches backend `EvaluationQueuesResponse`.
 */
export const evaluationQueuesResponseSchema = z.object({
    count: z.number().optional().default(0),
    queues: z.array(evaluationQueueSchema).default([]),
})

export type EvaluationQueuesResponse = z.infer<typeof evaluationQueuesResponseSchema>

/**
 * Queue ID response.
 * Matches backend `EvaluationQueueIdResponse`.
 */
export const evaluationQueueIdResponseSchema = z.object({
    count: z.number().optional().default(0),
    queue_id: z.string().nullable().optional(),
})

export type EvaluationQueueIdResponse = z.infer<typeof evaluationQueueIdResponseSchema>

/**
 * Queue IDs response.
 * Matches backend `EvaluationQueueIdsResponse`.
 */
export const evaluationQueueIdsResponseSchema = z.object({
    count: z.number().optional().default(0),
    queue_ids: z.array(z.string()).default([]),
})

export type EvaluationQueueIdsResponse = z.infer<typeof evaluationQueueIdsResponseSchema>

/**
 * Scenario IDs response.
 * Matches backend `EvaluationQueueScenarioIdsResponse`.
 */
export const evaluationQueueScenarioIdsResponseSchema = z.object({
    count: z.number().optional().default(0),
    scenario_ids: z.array(z.array(z.string())).default([]),
})

export type EvaluationQueueScenarioIdsResponse = z.infer<
    typeof evaluationQueueScenarioIdsResponseSchema
>
