/**
 * SimpleQueue Entity Schemas
 *
 * Zod schemas for validation and type safety of SimpleQueue entities.
 * Maps to the backend `SimpleQueue` DTO at `POST /simple/queues/`.
 *
 * @packageDocumentation
 */

import {z} from "zod"

import {timestampFieldsSchema, auditFieldsSchema} from "../../shared"

// ============================================================================
// ENUMS
// ============================================================================

/**
 * SimpleQueue kind — "traces" or "testcases".
 * Maps to backend `SimpleQueueKind` enum.
 */
export const simpleQueueKindSchema = z.enum(["traces", "testcases"])
export type SimpleQueueKind = z.infer<typeof simpleQueueKindSchema>

/**
 * Evaluation status enum (shared with EvaluationRun/Scenario).
 * Maps to backend `EvaluationStatus` enum.
 */
export const evaluationStatusSchema = z.enum([
    "pending",
    "queued",
    "running",
    "success",
    "failure",
    "errors",
    "cancelled",
])
export type EvaluationStatus = z.infer<typeof evaluationStatusSchema>

// ============================================================================
// SUB-SCHEMAS
// ============================================================================

/**
 * SimpleQueueSettings — distribution settings for scenario assignment.
 * Maps to backend `SimpleQueueSettings`.
 */
export const simpleQueueSettingsSchema = z.object({
    batch_size: z.number().nullable().optional(),
    batch_offset: z.number().nullable().optional(),
})

export type SimpleQueueSettings = z.infer<typeof simpleQueueSettingsSchema>

/**
 * SimpleQueueData — the data payload of a SimpleQueue.
 * Maps to backend `SimpleQueueData`.
 */
export const simpleQueueDataSchema = z.object({
    /** Kind of items in the queue */
    kind: simpleQueueKindSchema,
    /** Evaluator references — List<UUID> or Dict<UUID, origin> */
    evaluators: z.unknown().nullable().optional(),
    /** Number of annotation repeats */
    repeats: z.number().nullable().optional(),
    /** User assignments per repeat: [[user_a, user_b], [user_c]] */
    assignments: z.array(z.array(z.string())).nullable().optional(),
    /** Distribution settings */
    settings: simpleQueueSettingsSchema.nullable().optional(),
})

export type SimpleQueueData = z.infer<typeof simpleQueueDataSchema>

// ============================================================================
// SIMPLE QUEUE SCHEMA
// ============================================================================

/**
 * SimpleQueue entity schema.
 * Maps to backend `SimpleQueue(Identifier, Lifecycle, Header, Metadata)`.
 */
export const simpleQueueSchema = z
    .object({
        // Identifier
        id: z.string(),

        // Header
        name: z.string().nullable().optional(),
        description: z.string().nullable().optional(),

        // Status
        status: evaluationStatusSchema.nullable().optional(),

        // Data payload
        data: simpleQueueDataSchema.nullable().optional(),

        // Parent evaluation run ID
        run_id: z.string(),

        // Metadata
        tags: z.array(z.string()).nullable().optional(),
        meta: z.record(z.string(), z.unknown()).nullable().optional(),
    })
    .merge(timestampFieldsSchema)
    .merge(auditFieldsSchema)

export type SimpleQueue = z.infer<typeof simpleQueueSchema>

// ============================================================================
// EVALUATION SCENARIO SCHEMA
// ============================================================================

/**
 * EvaluationScenario — a single item within a queue that needs annotation.
 * Maps to backend `EvaluationScenario(Version, Identifier, Lifecycle, Metadata)`.
 */
export const evaluationScenarioSchema = z
    .object({
        id: z.string(),
        status: evaluationStatusSchema.nullable().optional(),
        interval: z.number().nullable().optional(),
        timestamp: z.string().nullable().optional(),
        run_id: z.string(),
        version: z.string().nullable().optional(),
        tags: z.record(z.string(), z.unknown()).nullable().optional(),
        meta: z.record(z.string(), z.unknown()).nullable().optional(),
    })
    .merge(timestampFieldsSchema)
    .merge(auditFieldsSchema)

export type EvaluationScenario = z.infer<typeof evaluationScenarioSchema>

// ============================================================================
// RESPONSE SCHEMAS
// ============================================================================

/**
 * Single queue response.
 * Matches backend `SimpleQueueResponse`.
 */
export const simpleQueueResponseSchema = z.object({
    count: z.number().optional().default(0),
    queue: simpleQueueSchema.nullable().optional(),
})

export type SimpleQueueResponse = z.infer<typeof simpleQueueResponseSchema>

/**
 * Windowing (cursor-based pagination) response shape.
 * Matches backend `Windowing` model.
 */
export const windowingResponseSchema = z
    .object({
        next: z.string().nullable().optional(),
        oldest: z.string().nullable().optional(),
        newest: z.string().nullable().optional(),
        stop: z.string().nullable().optional(),
        order: z.string().nullable().optional(),
        limit: z.number().nullable().optional(),
    })
    .nullable()
    .optional()

/**
 * Multiple queues response.
 * Matches backend `SimpleQueuesResponse`.
 */
export const simpleQueuesResponseSchema = z.object({
    count: z.number().optional().default(0),
    queues: z.array(simpleQueueSchema).default([]),
    windowing: windowingResponseSchema,
})

export type SimpleQueuesResponse = z.infer<typeof simpleQueuesResponseSchema>

/**
 * Queue ID response (returned from add traces/testcases).
 * Matches backend `SimpleQueueIdResponse`.
 */
export const simpleQueueIdResponseSchema = z.object({
    count: z.number().optional().default(0),
    queue_id: z.string().nullable().optional(),
})

export type SimpleQueueIdResponse = z.infer<typeof simpleQueueIdResponseSchema>

/**
 * Queue IDs response.
 * Matches backend `EvaluationQueueIdsResponse` when deleting multiple queues.
 */
export const simpleQueueIdsResponseSchema = z.object({
    count: z.number().optional().default(0),
    queue_ids: z.array(z.string()).default([]),
})

export type SimpleQueueIdsResponse = z.infer<typeof simpleQueueIdsResponseSchema>

/**
 * Scenarios response.
 * Matches backend `SimpleQueueScenariosResponse`.
 */
export const simpleQueueScenariosResponseSchema = z.object({
    count: z.number().optional().default(0),
    scenarios: z.array(evaluationScenarioSchema).default([]),
    windowing: windowingResponseSchema,
})

export type SimpleQueueScenariosResponse = z.infer<typeof simpleQueueScenariosResponseSchema>
