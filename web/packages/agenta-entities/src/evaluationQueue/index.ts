/**
 * EvaluationQueue Entity Module
 *
 * Provides molecules and utilities for managing EvaluationQueue entities.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { evaluationQueueMolecule } from '@agenta/entities/evaluationQueue'
 *
 * // Reactive atoms (for useAtomValue)
 * const data = useAtomValue(evaluationQueueMolecule.selectors.data(queueId))
 *
 * // Write atoms (for useSetAtom)
 * set(evaluationQueueMolecule.actions.update, queueId, { name: 'New name' })
 *
 * // Imperative API
 * const data = evaluationQueueMolecule.get.data(queueId)
 * ```
 */

// ============================================================================
// MOLECULE (Primary API)
// ============================================================================

export {evaluationQueueMolecule, type EvaluationQueueMolecule} from "./state/molecule"

// ============================================================================
// SCHEMAS & TYPES
// ============================================================================

export {
    // Re-exported shared enum
    evaluationStatusSchema,
    type EvaluationStatus,
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
    evaluationQueueScenarioIdsResponseSchema,
    type EvaluationQueueScenarioIdsResponse,
} from "./core"

export type {
    EvaluationQueueListParams,
    EvaluationQueueDetailParams,
    EvaluationQueueScenariosParams,
} from "./core"

// ============================================================================
// API FUNCTIONS
// ============================================================================

export {queryEvaluationQueues, fetchEvaluationQueue, queryEvaluationQueueScenarios} from "./api"

// ============================================================================
// STATE ATOMS
// ============================================================================

export {
    // List query
    evaluationQueuesListQueryAtom,
    evaluationQueuesListDataAtom,
    // Single entity
    evaluationQueueQueryAtomFamily,
    evaluationQueueDraftAtomFamily,
    evaluationQueueEntityAtomFamily,
    evaluationQueueIsDirtyAtomFamily,
    // Mutations
    updateEvaluationQueueDraftAtom,
    discardEvaluationQueueDraftAtom,
    // Cache invalidation
    invalidateEvaluationQueuesListCache,
    invalidateEvaluationQueueCache,
} from "./state"
