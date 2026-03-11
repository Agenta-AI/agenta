/**
 * SimpleQueue Core - Schemas and Types
 *
 * Pure types and schemas with no external dependencies.
 */

// Schemas and entity types
export {
    // Enums
    simpleQueueKindSchema,
    type SimpleQueueKind,
    evaluationStatusSchema,
    type EvaluationStatus,
    // Sub-schemas
    simpleQueueSettingsSchema,
    type SimpleQueueSettings,
    simpleQueueDataSchema,
    type SimpleQueueData,
    // Entity
    simpleQueueSchema,
    type SimpleQueue,
    // Evaluation scenario
    evaluationScenarioSchema,
    type EvaluationScenario,
    // Response schemas
    simpleQueueResponseSchema,
    type SimpleQueueResponse,
    simpleQueuesResponseSchema,
    type SimpleQueuesResponse,
    simpleQueueIdResponseSchema,
    type SimpleQueueIdResponse,
    simpleQueueScenariosResponseSchema,
    type SimpleQueueScenariosResponse,
} from "./schema"

// API parameter types
export type {
    SimpleQueueListParams,
    SimpleQueueDetailParams,
    SimpleQueueScenariosParams,
} from "./types"
