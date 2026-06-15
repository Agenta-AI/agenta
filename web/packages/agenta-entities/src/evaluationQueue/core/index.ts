/**
 * EvaluationQueue Core - Schemas and Types
 *
 * Pure types and schemas with no external dependencies.
 */

// Schemas and entity types
export {
    // Re-exported shared enum
    evaluationStatusSchema,
    type SimpleQueueStatus,
    // Sub-schemas
    evaluationQueueFlagsSchema,
    type EvaluationQueueFlags,
    evaluationQueueDataSchema,
    type EvaluationQueueData,
    // Entity
    evaluationQueueSchema,
    type EvaluationQueue,
    // Response schemas
    evaluationQueueResponseSchema,
    type EvaluationQueueResponse,
    evaluationQueuesResponseSchema,
    type EvaluationQueuesResponse,
    evaluationQueueIdResponseSchema,
    type EvaluationQueueIdResponse,
    evaluationQueueIdsResponseSchema,
    type EvaluationQueueIdsResponse,
} from "./schema"

// API parameter types
export type {EvaluationQueueListParams, EvaluationQueueDetailParams} from "./types"
